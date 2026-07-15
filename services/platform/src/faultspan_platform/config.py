from dataclasses import dataclass
from pathlib import Path
import os


@dataclass(frozen=True)
class Settings:
    evidence_dir: Path
    allowed_origins: tuple[str, ...]
    max_evidence_bytes: int = 256_000
    challenge_ttl_seconds: int = 300
    storage_backend: str = "filesystem"
    projection_backend: str = "memory"
    supabase_url: str | None = None
    supabase_secret_key: str | None = None
    supabase_evidence_bucket: str = "faultspan-evidence"

    @classmethod
    def from_env(cls) -> "Settings":
        origins = tuple(
            origin.strip()
            for origin in os.getenv("FAULTSPAN_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
            if origin.strip()
        )
        storage_backend = os.getenv("FAULTSPAN_STORAGE_BACKEND", "filesystem").strip().lower()
        if storage_backend not in {"filesystem", "supabase"}:
            raise ValueError("FAULTSPAN_STORAGE_BACKEND must be 'filesystem' or 'supabase'")
        projection_backend = os.getenv("FAULTSPAN_PROJECTION_BACKEND", "memory").strip().lower()
        if projection_backend not in {"memory", "supabase"}:
            raise ValueError("FAULTSPAN_PROJECTION_BACKEND must be 'memory' or 'supabase'")
        secret_key = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        return cls(
            evidence_dir=Path(os.getenv("FAULTSPAN_EVIDENCE_DIR", "data/evidence")).resolve(),
            allowed_origins=origins,
            max_evidence_bytes=int(os.getenv("FAULTSPAN_MAX_EVIDENCE_BYTES", "256000")),
            challenge_ttl_seconds=int(os.getenv("FAULTSPAN_CHALLENGE_TTL_SECONDS", "300")),
            storage_backend=storage_backend,
            projection_backend=projection_backend,
            supabase_url=os.getenv("SUPABASE_URL"),
            supabase_secret_key=secret_key,
            supabase_evidence_bucket=os.getenv("SUPABASE_EVIDENCE_BUCKET", "faultspan-evidence"),
        )
