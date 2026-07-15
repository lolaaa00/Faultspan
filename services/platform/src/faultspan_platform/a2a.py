from hashlib import sha256
import re
from .evidence import canonical_json
from .models import A2ATask, NormalizedA2ASpan


def _slug(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-").lower()
    return (cleaned or fallback)[:64]


def normalize_task(task: A2ATask) -> NormalizedA2ASpan:
    obligation = {
        "taskId": task.task_id,
        "contextId": task.context_id,
        "requester": task.requester,
        "provider": task.provider,
        "description": task.description,
    }
    digest = sha256(canonical_json(obligation)).hexdigest()
    return NormalizedA2ASpan(
        external_task_id=task.task_id,
        case_id=_slug(task.context_id, "a2a-case"),
        span_id=_slug(task.task_id, "a2a-span"),
        requester=task.requester,
        provider=task.provider,
        obligation=task.description,
        obligation_digest=f"sha256:{digest}",
        external_status=task.status,
        evidence={
            "source": "A2A",
            "events": [event.model_dump(mode="json") for event in task.events],
            "artifacts": task.artifacts,
            "warning": "A2A history is external evidence and may be incomplete.",
        },
    )

