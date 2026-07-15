from dataclasses import dataclass, field
from time import time
from typing import Protocol
from supabase import create_client


@dataclass
class CaseProjection:
    case_id: str
    title: str
    owner: str
    coordinator: str
    contract_address: str
    tx_hash: str | None = None
    status: str = "CREATED"
    updated_at: float = field(default_factory=time)


@dataclass
class SpanProjection:
    case_id: str
    span_id: str
    parent_id: str | None
    requester: str
    provider: str
    obligation: str
    bond_wei: str
    status: str = "PROPOSED"
    tx_hash: str | None = None
    updated_at: float = field(default_factory=time)


@dataclass
class ActivityRecord:
    activity_id: str
    case_id: str
    span_id: str | None
    actor: str
    action: str
    status: str
    tx_hash: str | None
    summary: str
    created_at: float = field(default_factory=time)


@dataclass
class SearchRow:
    result_type: str
    case_id: str
    span_id: str | None
    tx_hash: str | None
    title: str
    subtitle: str


class ProjectionStore(Protocol):
    def upsert_case(self, case: CaseProjection) -> CaseProjection: ...
    def list_cases(self, query: str = "") -> list[CaseProjection]: ...
    def get_case(self, case_id: str) -> CaseProjection | None: ...
    def upsert_span(self, span: SpanProjection) -> SpanProjection: ...
    def list_spans(self, case_id: str) -> list[SpanProjection]: ...
    def append_activity(self, activity: ActivityRecord) -> ActivityRecord: ...
    def list_activity(self, case_id: str) -> list[ActivityRecord]: ...
    def search(self, query: str = "") -> list[SearchRow]: ...


class MemoryProjectionStore:
    def __init__(self):
        self.cases: dict[str, CaseProjection] = {}
        self.spans: dict[str, SpanProjection] = {}
        self.activities: dict[str, ActivityRecord] = {}

    def upsert_case(self, case: CaseProjection) -> CaseProjection:
        case.updated_at = time()
        self.cases[case.case_id] = case
        return case

    def list_cases(self, query: str = "") -> list[CaseProjection]:
        needle = query.lower().strip()
        values = sorted(self.cases.values(), key=lambda item: item.updated_at, reverse=True)
        if not needle:
            return values
        return [
            item for item in values
            if needle in item.case_id.lower()
            or needle in item.title.lower()
            or needle in (item.tx_hash or "").lower()
            or needle in item.owner.lower()
        ]

    def get_case(self, case_id: str) -> CaseProjection | None:
        return self.cases.get(case_id)

    def upsert_span(self, span: SpanProjection) -> SpanProjection:
        span.updated_at = time()
        self.spans[f"{span.case_id}::{span.span_id}"] = span
        return span

    def list_spans(self, case_id: str) -> list[SpanProjection]:
        rows = [item for item in self.spans.values() if item.case_id == case_id]
        return sorted(rows, key=lambda item: item.updated_at, reverse=True)

    def append_activity(self, activity: ActivityRecord) -> ActivityRecord:
        self.activities[activity.activity_id] = activity
        return activity

    def list_activity(self, case_id: str) -> list[ActivityRecord]:
        rows = [item for item in self.activities.values() if item.case_id == case_id]
        return sorted(rows, key=lambda item: item.created_at, reverse=True)

    def search(self, query: str = "") -> list[SearchRow]:
        needle = query.lower().strip()
        rows: list[SearchRow] = []
        for case in self.list_cases(query):
            rows.append(SearchRow("case", case.case_id, None, case.tx_hash, case.title, f"{case.status} · {case.owner}"))
        for span in self.spans.values():
            if needle and not (
                needle in span.case_id.lower()
                or needle in span.span_id.lower()
                or needle in span.obligation.lower()
                or needle in span.provider.lower()
                or needle in (span.tx_hash or "").lower()
            ):
                continue
            rows.append(SearchRow("span", span.case_id, span.span_id, span.tx_hash, span.span_id, f"{span.status} · {span.provider}"))
        for activity in self.activities.values():
            if needle and not (
                needle in activity.case_id.lower()
                or needle in (activity.span_id or "").lower()
                or needle in activity.action.lower()
                or needle in activity.summary.lower()
                or needle in activity.actor.lower()
                or needle in (activity.tx_hash or "").lower()
            ):
                continue
            rows.append(SearchRow("activity", activity.case_id, activity.span_id, activity.tx_hash, activity.action, activity.summary))
            if activity.tx_hash:
                rows.append(SearchRow("transaction", activity.case_id, activity.span_id, activity.tx_hash, activity.tx_hash, f"{activity.action} · {activity.status}"))
        return rows[:100]


class SupabaseProjectionStore:
    def __init__(self, url: str, secret_key: str):
        self.client = create_client(url, secret_key)

    @staticmethod
    def _case_from_row(row: dict) -> CaseProjection:
        return CaseProjection(
            case_id=row["case_id"],
            title=row.get("title") or row["case_id"],
            owner=row.get("owner") or "",
            coordinator=row.get("coordinator") or "",
            contract_address=row.get("contract_address") or "",
            tx_hash=row.get("tx_hash"),
            status=row.get("status") or "CREATED",
            updated_at=0,
        )

    @staticmethod
    def _span_from_row(row: dict) -> SpanProjection:
        return SpanProjection(
            case_id=row["case_id"],
            span_id=row["span_id"],
            parent_id=row.get("parent_id"),
            requester=row.get("requester") or "",
            provider=row.get("provider") or "",
            obligation=row.get("obligation") or "",
            bond_wei=row.get("bond_wei") or "0",
            status=row.get("status") or "PROPOSED",
            tx_hash=row.get("tx_hash"),
            updated_at=0,
        )

    @staticmethod
    def _activity_from_row(row: dict) -> ActivityRecord:
        return ActivityRecord(
            activity_id=row["activity_id"],
            case_id=row["case_id"],
            span_id=row.get("span_id"),
            actor=row.get("actor") or "",
            action=row.get("action") or "",
            status=row.get("status") or "FINALIZED",
            tx_hash=row.get("tx_hash"),
            summary=row.get("summary") or "",
            created_at=0,
        )

    def upsert_case(self, case: CaseProjection) -> CaseProjection:
        payload = {
            "case_id": case.case_id,
            "title": case.title,
            "owner": case.owner,
            "coordinator": case.coordinator,
            "contract_address": case.contract_address,
            "tx_hash": case.tx_hash,
            "status": case.status,
        }
        self.client.table("faultspan_cases").upsert(payload, on_conflict="case_id").execute()
        return case

    def list_cases(self, query: str = "") -> list[CaseProjection]:
        request = self.client.table("faultspan_cases").select("*").order("updated_at", desc=True).limit(50)
        needle = query.strip()
        if needle:
            request = request.or_(f"case_id.ilike.%{needle}%,title.ilike.%{needle}%,tx_hash.ilike.%{needle}%,owner.ilike.%{needle}%")
        response = request.execute()
        return [self._case_from_row(row) for row in response.data or []]

    def get_case(self, case_id: str) -> CaseProjection | None:
        response = self.client.table("faultspan_cases").select("*").eq("case_id", case_id).limit(1).execute()
        rows = response.data or []
        return self._case_from_row(rows[0]) if rows else None

    def upsert_span(self, span: SpanProjection) -> SpanProjection:
        payload = {
            "case_id": span.case_id,
            "span_id": span.span_id,
            "parent_id": span.parent_id,
            "requester": span.requester,
            "provider": span.provider,
            "obligation": span.obligation,
            "bond_wei": span.bond_wei,
            "status": span.status,
            "tx_hash": span.tx_hash,
        }
        self.client.table("faultspan_spans").upsert(payload, on_conflict="case_id,span_id").execute()
        return span

    def list_spans(self, case_id: str) -> list[SpanProjection]:
        response = self.client.table("faultspan_spans").select("*").eq("case_id", case_id).order("updated_at", desc=True).execute()
        return [self._span_from_row(row) for row in response.data or []]

    def append_activity(self, activity: ActivityRecord) -> ActivityRecord:
        payload = {
            "activity_id": activity.activity_id,
            "case_id": activity.case_id,
            "span_id": activity.span_id,
            "actor": activity.actor,
            "action": activity.action,
            "status": activity.status,
            "tx_hash": activity.tx_hash,
            "summary": activity.summary,
        }
        self.client.table("faultspan_activity").upsert(payload, on_conflict="activity_id").execute()
        return activity

    def list_activity(self, case_id: str) -> list[ActivityRecord]:
        response = self.client.table("faultspan_activity").select("*").eq("case_id", case_id).order("created_at", desc=True).execute()
        return [self._activity_from_row(row) for row in response.data or []]

    def search(self, query: str = "") -> list[SearchRow]:
        needle = query.strip()
        rows: list[SearchRow] = []
        for case in self.list_cases(needle):
            rows.append(SearchRow("case", case.case_id, None, case.tx_hash, case.title, f"{case.status} · {case.owner}"))
        span_request = self.client.table("faultspan_spans").select("*").limit(50)
        if needle:
            span_request = span_request.or_(f"case_id.ilike.%{needle}%,span_id.ilike.%{needle}%,obligation.ilike.%{needle}%,provider.ilike.%{needle}%,tx_hash.ilike.%{needle}%")
        for row in span_request.execute().data or []:
            span = self._span_from_row(row)
            rows.append(SearchRow("span", span.case_id, span.span_id, span.tx_hash, span.span_id, f"{span.status} · {span.provider}"))
        activity_request = self.client.table("faultspan_activity").select("*").limit(50)
        if needle:
            activity_request = activity_request.or_(f"case_id.ilike.%{needle}%,span_id.ilike.%{needle}%,action.ilike.%{needle}%,summary.ilike.%{needle}%,actor.ilike.%{needle}%,tx_hash.ilike.%{needle}%")
        for row in activity_request.execute().data or []:
            activity = self._activity_from_row(row)
            rows.append(SearchRow("activity", activity.case_id, activity.span_id, activity.tx_hash, activity.action, activity.summary))
            if activity.tx_hash:
                rows.append(SearchRow("transaction", activity.case_id, activity.span_id, activity.tx_hash, activity.tx_hash, f"{activity.action} · {activity.status}"))
        return rows[:100]


def create_projection_store(url: str | None, secret_key: str | None, enabled: bool) -> ProjectionStore:
    if enabled and url and secret_key:
        return SupabaseProjectionStore(url, secret_key)
    return MemoryProjectionStore()
