# WAR-02B mutation baseline receipt

The baseline is deliberately bounded to three named seams. It uses explicit
semantic boundary mutants so the evidence stays reviewable and avoids a
repository-wide mutation-tool configuration. The harness must not be read as a
whole-source mutation score. Every current named mutant is killed; this is a
sensitivity receipt, not a claim that every possible source mutation is covered.

| Mutant | Seam | Seed | Budget / actual runs | Result |
| --- | --- | ---: | ---: | --- |
| `coordinate-tm65-golden-anchor-perturbation` | coordinate transform | 2026091201 | 50 / bounded | killed |
| `cursor-public-boundary-fault-injection` | cursor/window arithmetic | 2026091202 | 25 / bounded | killed |
| `ingest-timestamp-without-normalization` | position-ingest policy | 2026091203 | 100 / bounded | killed |
| `ingest-unversioned-hash-integrity` | position-ingest policy | 2026091204 | 100 / bounded | killed |

The previous `legacy:` survivor was removed because that branch does not exist
in the current production policy. It was not a meaningful current mutant. The
replacement mutates the current `v1:` version check and is killed by generated
unknown-prefix hash cases with independent canonical hashes. Any future legacy
hash migration must add its own explicit production contract before entering
this receipt.

The coordinate mutant is tested against fixed WGS84/TM65 anchors rather than a
self-inverse round trip. The cursor mutant passes through the real polling
manager and is injected only at the client boundary; the red proof separately
requires the current manager arithmetic to remain correct. Future mutation
additions must use one of the three approved seams and add a deterministic row
here, including any honest survivor.
