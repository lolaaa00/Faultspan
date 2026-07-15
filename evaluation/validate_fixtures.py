from collections import Counter
from pathlib import Path
import json
import sys


ALLOWED = {
    "COMPLIED",
    "CONTRIBUTED_TO_FAILURE",
    "CAUSED_FAILURE",
    "INSUFFICIENT_EVIDENCE",
}


def validate(path: Path) -> dict[str, object]:
    document = json.loads(path.read_text(encoding="utf-8"))
    errors: list[str] = []
    cases = document.get("cases", [])
    if len(cases) < 20:
        errors.append(f"expected at least 20 fixtures, found {len(cases)}")

    ids: set[str] = set()
    category_counts: Counter[str] = Counter()
    finding_counts: Counter[str] = Counter()
    for case in cases:
        case_id = case.get("id", "")
        if case_id in ids:
            errors.append(f"duplicate case id: {case_id}")
        ids.add(case_id)
        spans = case.get("spans", [])
        expected = case.get("expected", {})
        if not 1 <= len(spans) <= 8:
            errors.append(f"{case_id}: span count outside 1..8")
        if set(spans) != set(expected):
            errors.append(f"{case_id}: verdict does not cover exactly the supplied spans")
        invalid = set(expected.values()) - ALLOWED
        if invalid:
            errors.append(f"{case_id}: invalid findings {sorted(invalid)}")
        category_counts[case.get("category", "missing")] += 1
        finding_counts.update(expected.values())

    if not any(case.get("promptInjection") for case in cases):
        errors.append("fixture corpus has no prompt-injection case")
    if finding_counts["INSUFFICIENT_EVIDENCE"] == 0:
        errors.append("fixture corpus never exercises insufficient evidence")
    if finding_counts["CONTRIBUTED_TO_FAILURE"] == 0:
        errors.append("fixture corpus never exercises contribution")

    return {
        "status": "PASS" if not errors else "FAIL",
        "fixtureCount": len(cases),
        "categories": dict(sorted(category_counts.items())),
        "findings": dict(sorted(finding_counts.items())),
        "errors": errors,
        "limitation": "This validates corpus shape and expected decisions; it does not run GenLayer validators.",
    }


if __name__ == "__main__":
    result = validate(Path(__file__).with_name("fixtures.json"))
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["status"] == "PASS" else 1)

