from typing import Any, Literal
from pydantic import BaseModel, Field, field_validator


class ChallengeRequest(BaseModel):
    address: str

    @field_validator("address")
    @classmethod
    def validate_address(cls, value: str) -> str:
        normalized = value.lower()
        if not normalized.startswith("0x") or len(normalized) != 42:
            raise ValueError("address must be a 20-byte 0x-prefixed value")
        int(normalized[2:], 16)
        return normalized


class ChallengeResponse(BaseModel):
    challenge_id: str
    message: str
    expires_at: int


class VerifyRequest(BaseModel):
    challenge_id: str
    signature: str


class SessionResponse(BaseModel):
    session_token: str
    address: str
    expires_at: int


class EvidenceBundle(BaseModel):
    schema_version: Literal["1"] = "1"
    case_id: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    span_id: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    submitted_by: str
    created_at: str
    obligation: dict[str, Any]
    delivery: dict[str, Any]
    task_events: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    payment_receipts: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    attachments: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    statements: list[dict[str, Any]] = Field(default_factory=list, max_length=20)

    @field_validator("submitted_by")
    @classmethod
    def normalize_submitted_by(cls, value: str) -> str:
        return ChallengeRequest(address=value).address


class EvidenceReceipt(BaseModel):
    evidence_id: str
    digest: str
    public_path: str
    byte_length: int


class CaseProjectionIn(BaseModel):
    case_id: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    title: str = Field(min_length=3, max_length=500)
    owner: str
    coordinator: str
    contract_address: str
    tx_hash: str | None = Field(default=None, max_length=128)
    status: str = Field(default="CREATED", min_length=1, max_length=64)

    @field_validator("owner", "coordinator", "contract_address")
    @classmethod
    def normalize_addresses(cls, value: str) -> str:
        return ChallengeRequest(address=value).address


class CaseProjectionOut(CaseProjectionIn):
    updated_at: float | None = None


class X402Receipt(BaseModel):
    receipt_id: str = Field(min_length=3, max_length=128)
    payer: str
    payee: str
    resource: str = Field(min_length=1, max_length=500)
    amount: str = Field(pattern=r"^[0-9]+$")
    asset: str = Field(min_length=1, max_length=32)
    timestamp: str
    signature: str
    signer: str

    @field_validator("payer", "payee", "signer")
    @classmethod
    def normalize_addresses(cls, value: str) -> str:
        return ChallengeRequest(address=value).address


class X402Verification(BaseModel):
    valid: bool
    recovered_signer: str | None
    reason: str


class A2ATaskEvent(BaseModel):
    at: str
    status: str = Field(min_length=1, max_length=64)
    actor: str = Field(min_length=1, max_length=256)
    detail: dict[str, Any] = Field(default_factory=dict)


class A2ATask(BaseModel):
    task_id: str = Field(min_length=3, max_length=128)
    context_id: str = Field(min_length=3, max_length=128)
    requester: str = Field(min_length=1, max_length=256)
    provider: str = Field(min_length=1, max_length=256)
    description: str = Field(min_length=8, max_length=4_000)
    status: str = Field(min_length=1, max_length=64)
    artifacts: list[dict[str, Any]] = Field(default_factory=list, max_length=50)
    events: list[A2ATaskEvent] = Field(default_factory=list, max_length=100)


class NormalizedA2ASpan(BaseModel):
    schema_version: Literal["faultspan-a2a/1"] = "faultspan-a2a/1"
    external_task_id: str
    case_id: str
    span_id: str
    requester: str
    provider: str
    obligation: str
    obligation_digest: str
    external_status: str
    evidence: dict[str, Any]
    completeness: Literal["UNVERIFIED"] = "UNVERIFIED"
