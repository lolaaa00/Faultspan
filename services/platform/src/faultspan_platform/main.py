from fastapi import Depends, FastAPI, Header, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from .config import Settings
from .evidence import create_evidence_store
from .models import (
    A2ATask,
    ActivityRecordIn,
    ActivityRecordOut,
    CaseProjectionIn,
    CaseProjectionOut,
    NormalizedA2ASpan,
    SearchResult,
    SpanProjectionIn,
    SpanProjectionOut,
    ChallengeRequest,
    ChallengeResponse,
    EvidenceBundle,
    EvidenceReceipt,
    SessionResponse,
    VerifyRequest,
    X402Receipt,
    X402Verification,
)
from .projection import ActivityRecord, CaseProjection, SpanProjection, create_projection_store
from time import time
from .security import Session, WalletAuth
from .x402 import verify_receipt
from .a2a import normalize_task


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    auth = WalletAuth(challenge_ttl_seconds=settings.challenge_ttl_seconds)
    evidence = create_evidence_store(
        settings.storage_backend,
        settings.evidence_dir,
        settings.max_evidence_bytes,
        settings.supabase_url,
        settings.supabase_secret_key,
        settings.supabase_evidence_bucket,
    )
    projection = create_projection_store(
        settings.supabase_url,
        settings.supabase_secret_key,
        settings.projection_backend == "supabase",
    )
    app = FastAPI(title="Faultspan Platform", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

    def session(authorization: str | None = Header(default=None)) -> Session:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="bearer session required")
        try:
            return auth.authenticate(authorization.removeprefix("Bearer "))
        except ValueError as error:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(error)) from error

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "faultspan-platform"}

    @app.get("/ready")
    def ready() -> dict[str, str | int]:
        try:
            evidence.ready()
        except OSError as error:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="evidence store is unavailable") from error
        return {
            "status": "ready",
            "storage_backend": settings.storage_backend,
            "projection_backend": settings.projection_backend,
            "max_evidence_bytes": settings.max_evidence_bytes,
        }

    @app.post("/v1/auth/challenge", response_model=ChallengeResponse)
    def challenge(request: ChallengeRequest) -> ChallengeResponse:
        challenge_id, value = auth.issue(request.address)
        return ChallengeResponse(challenge_id=challenge_id, message=value.message, expires_at=value.expires_at)

    @app.post("/v1/auth/verify", response_model=SessionResponse)
    def verify(request: VerifyRequest) -> SessionResponse:
        try:
            token, value = auth.verify(request.challenge_id, request.signature)
        except ValueError as error:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(error)) from error
        return SessionResponse(session_token=token, address=value.address, expires_at=value.expires_at)

    @app.post("/v1/evidence", response_model=EvidenceReceipt, status_code=status.HTTP_201_CREATED)
    def create_evidence(bundle: EvidenceBundle, current: Session = Depends(session)) -> EvidenceReceipt:
        if current.address != bundle.submitted_by:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="session does not own submission")
        try:
            return evidence.put(bundle)
        except ValueError as error:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error

    @app.get("/v1/evidence/{digest}")
    def get_evidence(digest: str) -> Response:
        try:
            payload = evidence.get(digest)
        except FileNotFoundError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="evidence not found") from error
        except ValueError as error:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error
        return Response(content=payload, media_type="application/json", headers={"Cache-Control": "public, immutable"})

    @app.get("/v1/cases", response_model=list[CaseProjectionOut])
    def list_cases(query: str = "") -> list[CaseProjectionOut]:
        try:
            return [CaseProjectionOut(**case.__dict__) for case in projection.list_cases(query)]
        except Exception as error:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="case projection store is unavailable") from error

    @app.get("/v1/cases/{case_id}", response_model=CaseProjectionOut)
    def get_case_projection(case_id: str) -> CaseProjectionOut:
        try:
            case = projection.get_case(case_id)
        except Exception as error:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="case projection store is unavailable") from error
        if case is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case not indexed")
        return CaseProjectionOut(**case.__dict__)

    @app.get("/v1/cases/{case_id}/spans", response_model=list[SpanProjectionOut])
    def list_case_spans(case_id: str) -> list[SpanProjectionOut]:
        try:
            return [SpanProjectionOut(**span.__dict__) for span in projection.list_spans(case_id)]
        except Exception as error:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="span projection store is unavailable") from error

    @app.get("/v1/cases/{case_id}/activity", response_model=list[ActivityRecordOut])
    def list_case_activity(case_id: str) -> list[ActivityRecordOut]:
        try:
            return [ActivityRecordOut(**activity.__dict__) for activity in projection.list_activity(case_id)]
        except Exception as error:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="activity projection store is unavailable") from error

    @app.post("/v1/cases", response_model=CaseProjectionOut, status_code=status.HTTP_201_CREATED)
    def upsert_case_projection(case: CaseProjectionIn, current: Session = Depends(session)) -> CaseProjectionOut:
        if current.address != case.owner:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="session does not own case")
        try:
            saved = projection.upsert_case(CaseProjection(**case.model_dump()))
        except Exception as error:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="case projection store is unavailable") from error
        return CaseProjectionOut(**saved.__dict__)

    @app.post("/v1/spans", response_model=SpanProjectionOut, status_code=status.HTTP_201_CREATED)
    def upsert_span_projection(span: SpanProjectionIn, current: Session = Depends(session)) -> SpanProjectionOut:
        if current.address != span.requester and current.address != span.provider:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="session does not own span")
        try:
            saved = projection.upsert_span(SpanProjection(**span.model_dump()))
        except Exception as error:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="span projection store is unavailable") from error
        return SpanProjectionOut(**saved.__dict__)

    @app.post("/v1/activity", response_model=ActivityRecordOut, status_code=status.HTTP_201_CREATED)
    def append_activity_record(activity: ActivityRecordIn, current: Session = Depends(session)) -> ActivityRecordOut:
        if current.address != activity.actor:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="session does not own activity actor")
        payload = ActivityRecord(
            activity_id=f"{activity.case_id}:{activity.action}:{int(time() * 1000)}",
            case_id=activity.case_id,
            span_id=activity.span_id,
            actor=activity.actor,
            action=activity.action,
            status=activity.status,
            tx_hash=activity.tx_hash,
            summary=activity.summary,
        )
        try:
            saved = projection.append_activity(payload)
        except Exception as error:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="activity projection store is unavailable") from error
        return ActivityRecordOut(**saved.__dict__)

    @app.get("/v1/search", response_model=list[SearchResult])
    def search_projection(query: str = "") -> list[SearchResult]:
        try:
            return [SearchResult(**item.__dict__) for item in projection.search(query)]
        except Exception as error:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="search projection store is unavailable") from error

    @app.post("/v1/integrations/x402/verify", response_model=X402Verification)
    def verify_x402(receipt: X402Receipt) -> X402Verification:
        return verify_receipt(receipt)

    @app.post("/v1/integrations/a2a/normalize", response_model=NormalizedA2ASpan)
    def normalize_a2a(task: A2ATask) -> NormalizedA2ASpan:
        return normalize_task(task)

    return app


app = create_app()
