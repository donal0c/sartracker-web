# WAR-02B mutation baseline and survivors

The baseline is deliberately bounded to three named seams. It uses explicit
semantic boundary mutants so the evidence stays reviewable and avoids a
repository-wide mutation-tool configuration. The harness must not be read as a
whole-source mutation score.

| Mutant | Seam | Seed | Budget / actual runs | Result |
| --- | --- | ---: | ---: | --- |
| `coordinate-easting-plus-one-metre` | coordinate transform | 2026091201 | 50 / 1 | killed |
| `cursor-plus-one-second` | cursor/window arithmetic | 2026091202 | 25 / 1 | killed |
| `ingest-timestamp-without-normalization` | position-ingest policy | 2026091203 | 100 / 4 | killed |
| `ingest-legacy-prefix-conflict-uncovered` | position-ingest policy | 2026091204 | 100 / 100 | survived |

The survivor is intentional and must remain visible in the receipt. The bounded
input generator does not create a stored `legacy:` hash prefix, so the mutant
that classifies a changed row with that prefix as a duplicate is not exercised.
That is a coverage gap for legacy-hash migration behaviour, not evidence that
the mutant is safe and not a production change made by WAR-02B.

The two killed boundary mutants are the important regression signal for this
slice: a one-metre transformed-coordinate error violates round-trip precision,
and the historical DON-228 `previous cursor + 1000 ms` request violates the
inclusive cursor oracle. Future mutation additions must use one of the three
approved seams and add a deterministic row here, including any survivor.
