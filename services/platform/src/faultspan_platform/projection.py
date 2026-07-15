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


class ProjectionStore(Protocol):
    def upsert_case(self, case: CaseProjection) -> CaseProjection: ...
    def list_cases(self, query: str = "") -> list[CaseProjection]: ...
    def get_case(self, case_id: str) -> CaseProjection | None: ...


class MemoryProjectionStore:
    def __init__(self):
        self.cases: dict[str, CaseProjection] = {}

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


class SupabaseProjectionStore:
    def __init__(self, url: str, secret_key: str):
        self.client = create_client(url, secret_key)

    @staticmethod
    def _from_row(row: dict) -> CaseProjection:
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
        return [self._from_row(row) for row in response.data or []]

    def get_case(self, case_id: str) -> CaseProjection | None:
        response = self.client.table("faultspan_cases").select("*").eq("case_id", case_id).limit(1).execute()
        rows = response.data or []
        return self._from_row(rows[0]) if rows else None


def create_projection_store(url: str | None, secret_key: str | None, enabled: bool) -> ProjectionStore:
    if enabled and url and secret_key:
        return SupabaseProjectionStore(url, secret_key)
    return MemoryProjectionStore()
