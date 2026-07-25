import json
from hashlib import sha256
from pathlib import Path
from typing import Protocol

import httpx
from supabase import Client, create_client

from .models import EvidenceBundle, EvidenceReceipt

_PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files"
_PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs"


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


class PinataEvidenceStore:
    def __init__(self, pinata_jwt: str, index_path: Path, max_bytes: int = 256_000):
        if not pinata_jwt:
            raise ValueError("PINATA_JWT is required for the pinata storage backend")
        self.pinata_jwt = pinata_jwt
        self.index_path = index_path
        self.max_bytes = max_bytes
        index_path.parent.mkdir(parents=True, exist_ok=True)

    def _load_index(self) -> dict[str, str]:
        if not self.index_path.exists():
            return {}
        try:
            return json.loads(self.index_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, ValueError):
            return {}

    def _save_index(self, index: dict[str, str]) -> None:
        self.index_path.write_text(json.dumps(index, sort_keys=True, indent=2), encoding="utf-8")

    def put(self, bundle: EvidenceBundle) -> EvidenceReceipt:
        payload = canonical_json(bundle.model_dump(mode="json"))
        if len(payload) > self.max_bytes:
            raise ValueError(f"evidence exceeds {self.max_bytes} byte limit")
        hex_digest = sha256(payload).hexdigest()
        index = self._load_index()
        if hex_digest in index:
            cid = index[hex_digest]
            return EvidenceReceipt(
                evidence_id=f"ev_{hex_digest[:24]}",
                digest=f"sha256:{hex_digest}",
                public_path=f"{_PINATA_GATEWAY}/{cid}",
                byte_length=len(payload),
            )
        response = httpx.post(
            _PINATA_UPLOAD_URL,
            headers={"Authorization": f"Bearer {self.pinata_jwt}"},
            files={"file": (f"{hex_digest[:16]}.json", payload, "application/json")},
            data={"name": f"faultspan-{hex_digest[:16]}"},
            timeout=30,
        )
        if not response.is_success:
            raise ValueError(f"Pinata upload failed: {response.status_code} {response.text[:200]}")
        cid = response.json()["data"]["cid"]
        index[hex_digest] = cid
        self._save_index(index)
        return EvidenceReceipt(
            evidence_id=f"ev_{hex_digest[:24]}",
            digest=f"sha256:{hex_digest}",
            public_path=f"{_PINATA_GATEWAY}/{cid}",
            byte_length=len(payload),
        )

    def get(self, digest: str) -> bytes:
        validate_digest(digest)
        index = self._load_index()
        cid = index.get(digest)
        if not cid:
            raise FileNotFoundError(digest)
        response = httpx.get(f"{_PINATA_GATEWAY}/{cid}", timeout=30, follow_redirects=True)
        if not response.is_success:
            raise FileNotFoundError(digest)
        payload = response.content
        if sha256(payload).hexdigest() != digest:
            raise ValueError("fetched evidence failed integrity check")
        return payload

    def ready(self) -> None:
        response = httpx.get(
            "https://api.pinata.cloud/v3/files?limit=1",
            headers={"Authorization": f"Bearer {self.pinata_jwt}"},
            timeout=10,
        )
        if response.status_code in (401, 403):
            raise OSError(f"Pinata authentication failed: {response.status_code}")


def create_evidence_store(
    backend: str,
    root: Path,
    max_bytes: int,
    supabase_url: str | None,
    supabase_secret_key: str | None,
    supabase_bucket: str,
    pinata_jwt: str | None = None,
) -> EvidenceStore:
    if backend == "supabase":
        return SupabaseEvidenceStore(
            supabase_url or "", supabase_secret_key or "", supabase_bucket, max_bytes=max_bytes
        )
    if backend == "pinata":
        return PinataEvidenceStore(
            pinata_jwt or "", index_path=root / "pinata_index.json", max_bytes=max_bytes
        )
    return FilesystemEvidenceStore(root, max_bytes=max_bytes)
