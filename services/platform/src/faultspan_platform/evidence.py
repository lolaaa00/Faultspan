from hashlib import sha256
from pathlib import Path
from typing import Protocol
import json
from supabase import Client, create_client
from .models import EvidenceBundle, EvidenceReceipt


def canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def validate_digest(digest: str) -> None:
    if len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
        raise ValueError("invalid evidence digest")


class EvidenceStore(Protocol):
    def put(self, bundle: EvidenceBundle) -> EvidenceReceipt: ...
    def get(self, digest: str) -> bytes: ...
    def ready(self) -> None: ...


class FilesystemEvidenceStore:
    def __init__(self, root: Path, max_bytes: int = 256_000):
        self.root = root
        self.max_bytes = max_bytes
        self.root.mkdir(parents=True, exist_ok=True)

    def put(self, bundle: EvidenceBundle) -> EvidenceReceipt:
        payload = canonical_json(bundle.model_dump(mode="json"))
        if len(payload) > self.max_bytes:
            raise ValueError(f"evidence exceeds {self.max_bytes} byte limit")
        hex_digest = sha256(payload).hexdigest()
        evidence_id = f"ev_{hex_digest[:24]}"
        path = self.root / f"{hex_digest}.json"
        if path.exists() and path.read_bytes() != payload:
            raise ValueError("content-address collision")
        path.write_bytes(payload)
        return EvidenceReceipt(
            evidence_id=evidence_id,
            digest=f"sha256:{hex_digest}",
            public_path=f"/v1/evidence/{hex_digest}",
            byte_length=len(payload),
        )

    def get(self, digest: str) -> bytes:
        validate_digest(digest)
        path = self.root / f"{digest}.json"
        if not path.exists():
            raise FileNotFoundError(digest)
        payload = path.read_bytes()
        if sha256(payload).hexdigest() != digest:
            raise ValueError("stored evidence failed integrity check")
        return payload

    def ready(self) -> None:
        probe = self.root / ".ready"
        probe.write_text("ready", encoding="utf-8")
        probe.unlink(missing_ok=True)


class SupabaseEvidenceStore:
    def __init__(self, url: str, secret_key: str, bucket: str, max_bytes: int = 256_000):
        if not url or not secret_key:
            raise ValueError("SUPABASE_URL and a server-only Supabase secret key are required")
        self.client: Client = create_client(url, secret_key)
        self.bucket = bucket
        self.max_bytes = max_bytes

    def put(self, bundle: EvidenceBundle) -> EvidenceReceipt:
        payload = canonical_json(bundle.model_dump(mode="json"))
        if len(payload) > self.max_bytes:
            raise ValueError(f"evidence exceeds {self.max_bytes} byte limit")
        hex_digest = sha256(payload).hexdigest()
        path = f"sha256/{hex_digest}.json"
        storage = self.client.storage.from_(self.bucket)
        try:
            storage.upload(
                path=path,
                file=payload,
                file_options={"content-type": "application/json", "cache-control": "31536000", "upsert": "false"},
            )
        except Exception as error:
            try:
                existing = storage.download(path)
            except Exception:
                raise ValueError("Supabase evidence upload failed") from error
            if existing != payload:
                raise ValueError("content-address collision") from error
        return EvidenceReceipt(
            evidence_id=f"ev_{hex_digest[:24]}",
            digest=f"sha256:{hex_digest}",
            public_path=f"/v1/evidence/{hex_digest}",
            byte_length=len(payload),
        )

    def get(self, digest: str) -> bytes:
        validate_digest(digest)
        try:
            payload = self.client.storage.from_(self.bucket).download(f"sha256/{digest}.json")
        except Exception as error:
            raise FileNotFoundError(digest) from error
        if sha256(payload).hexdigest() != digest:
            raise ValueError("stored evidence failed integrity check")
        return payload

    def ready(self) -> None:
        try:
            self.client.storage.from_(self.bucket).list(path="sha256", options={"limit": 1})
        except Exception as error:
            raise OSError("Supabase evidence bucket is unavailable") from error


def create_evidence_store(
    backend: str,
    root: Path,
    max_bytes: int,
    supabase_url: str | None,
    supabase_secret_key: str | None,
    supabase_bucket: str,
) -> EvidenceStore:
    if backend == "supabase":
        return SupabaseEvidenceStore(
            supabase_url or "", supabase_secret_key or "", supabase_bucket, max_bytes=max_bytes
        )
    return FilesystemEvidenceStore(root, max_bytes=max_bytes)
