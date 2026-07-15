# Faultspan Evaluation Corpus

`fixtures.json` contains 20 bounded adjudication scenarios covering clear causes, multiple contributors, deadline failures, ambiguity, unavailable evidence, digest/signature failures, and evidence prompt injection.

Run the deterministic corpus check:

```powershell
.\.venv\Scripts\python.exe evaluation\validate_fixtures.py
```

This check validates fixture coverage and expected-verdict structure. It does **not** measure LLM or validator accuracy.

The later Studionet evaluation must:

1. Materialize each fixture as locked evidence.
2. Submit `adjudicate_case` using the deployed contract.
3. Capture transaction status and execution result.
4. Compare consensus findings with the expected decision fields.
5. Record rotations, undetermined results, latency, and model/provider configuration.
6. Repeat sufficiently to expose non-deterministic disagreement.

No accuracy or consistency percentage should be published until that live evaluation runs.

