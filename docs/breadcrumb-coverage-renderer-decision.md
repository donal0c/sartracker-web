# Breadcrumb complete-coverage renderer decision (G2)

Status: **measured; Candidate B recommended; pending Donal ratification**

Linear: `DON-273` / BCP-07

Measured application SHA: `8eff87b724ae6b4ffa9123479a8982d1d08f47ef`

Exact PR-2 base: `7021fc1ef33e6da5c91c96cd86e836fc3754f48f`

Branch: `codex/breadcrumb-pr3-complete-coverage`

BCP-08 production work remained blocked while this decision was measured and
documented. Schema v10, the coverage ledger/worker, production IPC/controller,
and production renderer integration must not begin until Donal ratifies this
memo.

## Decision recommendation

Choose **Candidate B: SQLite-backed local vector tiles**. It was the only
candidate to pass every hard gate on both the 960,000-position qualification
fixture and the 2,000,000-position headroom fixture.

No budget amendment is proposed. Ratify the existing budgets, including the
proposed memory gates of 1.5 GiB settled renderer RSS at 960k and 2.5 GiB peak
renderer RSS at 2M.

The renderer p95 target of less than 33 ms was not met by any candidate on this
software-rendered llvmpipe host. That metric is a target, not a rejection gate.
Candidate B still had the best or second-best renderer p95 at both scales and
passed the hard 200 ms main-process stall gate with substantial margin.

## Chosen contract

Candidate B's production contract is:

1. The worker reads lossless mission/device/logical-period pages from SQLite in
   `(timestamp, id)` order using the existing mission/device/timestamp index.
   It applies the same deterministic 30-minute trail segmentation contract as
   the live breadcrumb path.
2. The worker encodes those segments into protobuf vector tiles in a bounded
   on-disk derived cache. Tile and catalog identity bind the exact contributing
   tagged chunk keys and their `content_rev` values.
3. Invalidation removes only tiles touched by the affected chunk. An unrelated
   chunk revision must not cause global cache churn or starve unchanged history.
4. The renderer receives tiles through a custom protocol and uses separate
   vector sources per logical period. Generalized tile geometry is rendering
   only and can never reach exact inspection or export.
5. Current selected-participant positions remain in their separate,
   history-independent source. They never wait for coverage construction and
   history filters never hide them.
6. Durable cache residency never certifies completeness. Operator completion
   requires the BCP-08 ledger plus renderer delivery attestation for the exact
   current chunk revisions; pending invalidation prevents a 100% claim.
7. Exact paged Dots remains unchanged as the inspection/export truth path.
8. There is no global mission timestamp index and no mission-sized work on the
   Electron main isolate.

## Method and evidence binding

The packaged benchmark executed the prescribed 18 serial runs: three
candidates, two fixtures, and three repetitions per candidate/fixture. Each
group has one cold run and two warm runs. Candidates were interleaved to reduce
host-drift bias. All candidates used the same cursor-paged SQLite query and
deterministic segmentation pipeline; only the delivery/rendering mechanism
differed.

Reference host:

- hostname `donal-Precision-5570`
- Ubuntu kernel `7.0.0-28-generic`, x86-64
- Intel Core i7-12800H
- desktop session Wayland; Electron app window X11 through Xwayland on
  `DISPLAY=:0`
- launch flags `--ozone-platform=x11 --no-sandbox --ignore-gpu-blocklist
  --use-gl=angle --use-angle=gl`
- Mesa 25.2.8 llvmpipe (LLVM 20.1.2), direct rendering available,
  hardware acceleration unavailable

The host arrangement is the established qualification path: the desktop
session remains Wayland while the packaged app is explicitly launched on X11.
No desktop-session change was required.

Fixtures:

| Fixture | Schema generator | Positions | Bytes | SHA-256 |
| --- | ---: | ---: | ---: | --- |
| `bcp-960k.sqlite` | v4 | 960,000 | 476,151,808 | `6b92005b6f150f712fb73ac89bce6b3bcdf02ce54caac7644e02e3a76bbccdc0` |
| `bcp-2m.sqlite` | v4 | 2,000,000 | 991,227,904 | `f70f1ac4526dc6f0398b6baabfef6a7ace8ead8ad1afeae7428c7246029133ca` |

Mirrored evidence is under
`output/g2-coverage-renderer/8eff87b724ae6b4ffa9123479a8982d1d08f47ef/`.
The evidence checksum manifest itself has SHA-256
`470449f739fcf8ff89ea03daf4662a2cc87b57acecc7ba4cf60297e7a1ccc980`.
All 29 listed files passed local SHA-256 verification after transfer from the
reference host.

## Measured results

Budgets are judged on the worst warm run. Phase columns are medians across the
three repetitions. Times are milliseconds; memory is GiB.

| Candidate | Fixture | Verdict | First useful worst warm | Complete worst warm | Filter worst warm | Append re-render worst warm | Main max worst warm | Renderer p95 worst warm | Settled / peak GiB | Query / segment / encode / source / settle median |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| A | 960k | **REJECT** | 8,732 | 9,480 | 204 | 654 | 53 | 184 | 0.64 / 0.64 | 6,239 / 1,314 / 0 / 81 / 3,461 |
| A | 2M | **REJECT** | 5,432 | 13,593 | 196 | 609 | 58 | 150 | 0.92 / 0.97 | 6,899 / 1,279 / 0 / 58 / 3,091 |
| B | 960k | **PASS** | 3,465 | 5,976 | 133 | 657 | 58 | 117 | 0.26 / 0.26 | 3,509 / 798 / 217 / 0 / 3,396 |
| B | 2M | **PASS** | 3,334 | 7,554 | 104 | 489 | 33 | 84 | 0.27 / 0.27 | 5,000 / 985 / 300 / 0 / 3,641 |
| C | 960k | **REJECT** | 5,806 | 6,555 | 178 | 1,756 | 51 | 67 | 0.83 / 1.01 | 2,960 / 604 / 0 / 2 / 2,138 |
| C | 2M | **REJECT** | 8,500 | 9,208 | 349 | 3,090 | 55 | 117 | 1.32 / 1.38 | 4,953 / 947 / 0 / 2 / 2,583 |

Hard-gate reading:

- **First useful coverage ≤5 s:** B passes both fixtures. A fails both. C fails
  both.
- **Complete selected coverage ≤30 s at 960k:** all candidates pass. The 2M
  value is recorded as headroom and B completes in 7.554 s.
- **Filter ≤500 ms:** all candidates pass both fixtures.
- **Current fix visible within one poll cycle:** every run passes while the
  late 5,000-fix append is applied.
- **Main-process stall ≤200 ms:** every candidate passes; B's maxima are 58 ms
  at 960k and 33 ms at 2M.
- **Memory:** B passes by wide margins at 0.26 GiB settled at 960k and 0.27 GiB
  peak at 2M.
- **Correctness and restart honesty:** all required Boolean attestations are
  true in every accepted run and kill proof.

## Rejections and falsifiers

### Candidate A — rejected

A breaches the five-second first-useful hard gate on both fixtures: 8.732 s at
960k and 5.432 s at 2M. Its current-position source did remain independent
during append, so it was rejected on measured startup usefulness rather than
the Candidate-A-specific safety falsifier.

### Candidate C — rejected

C breaches first-useful on both fixtures: 5.806 s at 960k and 8.500 s at 2M.
Its monolithic replacement path also has the slowest append re-render at both
scales and substantially higher memory than B. The control therefore confirms
the full-source replacement boundary is unsuitable even though its complete,
filter, and main-stall values remain inside their individual hard gates.

### Candidate B — falsifiers survived

Across all six B runs and both B kill proofs:

- a current fix stayed visible within one poll cycle;
- restart began with honest zero-delivered progress and converged to the same
  totals without claiming undelivered chunks;
- all nine deterministic camera panes matched exact worker/rendered segment
  counts and SHA-256 feature/revision digests;
- an invalidated tile could not render stale without the partial state active;
- revising an unrelated chunk preserved unrelated tile identity;
- generalized coverage geometry did not reach exact Dots;
- exact paged Dots equality passed independently (`10/10`).

The A-over-B tie-break does not apply because A did not pass all hard gates.
A hybrid is not required because B passed both fixtures.

## Run manifest checksums

These checksums bind the canonical stable JSON run manifests, distinct from
the transfer-level file checksums in `evidence-files.sha256`.

| Candidate / fixture | Run 1 cold | Run 2 warm | Run 3 warm |
| --- | --- | --- | --- |
| A / 960k | `c62899f923e50a5656a2fa2d9e7564cf953eda37bfcc94b2745cf38507be72d3` | `6c6ba80d6df115248e94f4b0aa3cb59de5db5a9767ad9f7c92cfd700a03ce85d` | `2e47a9202b57a2654a6a4fb9ca865aab838309607d3d227f2ee7d05ded84faa2` |
| A / 2M | `47382cdf08e871f758935f12fb7006ddaac3458c8c6df6b629a1f35568ad7f7a` | `eefdbcddacc34f00f20417a4f6c940385ef4b4760281bf598532ffa77738e8a0` | `9b7981bdeb645629ad8dcbcd815aef6ecbffb3c547e6da59b38e0cf713273fb9` |
| B / 960k | `d2ddc6d7e962fd63f765e4eebe85c80aba9772f64bbe262c71bfbd82c9e38539` | `87ecc2c27fdae663e01645167ee1bd1e1cabfe33acc1c0b66b7e0ac311042f05` | `448d1598901120513ecda6b5e4ce7068e821408e17b322969140628a796edef8` |
| B / 2M | `e3050d3b1a0160180c0e05aa0e55608fcb92b1f9813b4cc232e7b7f123f56ad7` | `e60206900081d3199104453c6445f79b693b877ff87f840ed400a21feb527667` | `21e3afedbaf83591264d4f5d902b3b10066d7f223eaef99f347af8e9eddef0e9` |
| C / 960k | `652d378eebae84777289b4c54581322abc77b926b2f59ca4d2c5697c46905ee5` | `a6c6a9481211ec1130165f012bc237b6b9a1232e3f112c805b0cf0197fc69ba7` | `cde55e1db1be232ecd3c16279ecbff941c59da96b874501a78dbc889d724d698` |
| C / 2M | `e234c220f62f9c24f8c54c525118bfd5fda11bb586bf7b90493f5d242bb16964` | `2af198419646aba94786cb552ce15ff861a8a78a2f7178827b147b0540d80f1c` | `b1bf0337104ed3cc0a22db78c6deedae68fc0ef49a1042fc3ebf92fa8c45eb1c` |

## Excluded preflight attempts

Three preflight failures were corrected before the accepted matrix and are not
mixed into the results:

1. the unpacked Linux package needed the recorded `--no-sandbox` launch flag;
2. llvmpipe needed the reference-host WebGL flags recorded above;
3. Candidate B's prototype period-source replacement reused a live source ID
   after deletion; the stable logical-period source ID fix is the exact
   measured SHA `8eff87b...`.

Each failure was fail-loudly corrected in the benchmark harness. No production
renderer was selected or implemented by those fixes.

## Residual uncertainty and standing-result rule

- This is comparative T2 evidence from the reference Ubuntu host, not field
  machine, live Traccar, release, or post-merge packaged proof.
- The host used software llvmpipe. The Electron GPU API reported `unreported
  GPU` in manifests, so same-session `glxinfo` is retained as the independent
  renderer fact. Hardware GPU frame timing may differ materially.
- B misses the optional 33 ms renderer-p95 target on llvmpipe (117 ms at 960k,
  84 ms at 2M). The production UI still needs the planned Chromium/visual and
  packaged verification; this result does not waive those gates.
- The harness proves the candidate mechanism and falsifiers. It does not prove
  the later BCP-08 ledger, progressive worker, delivery-map, or operator
  completeness wording, which do not yet exist.
- These G2 results remain standing unless a later commit changes B's measured
  query shape, segmentation, tile/source strategy, or equivalent pipeline.
  Such a change reruns the affected G2 rows before merge.

## Ratification requested

Recommended smallest decision:

> Approve Candidate B and the unchanged G2 budgets, including 1.5 GiB settled
> renderer RSS at 960k and 2.5 GiB peak renderer RSS at 2M.

If amended, identify only the candidate/contract or budget value to change.
`DON-273` remains open and BCP-08 remains blocked until that decision is
recorded.
