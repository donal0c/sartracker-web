# Linux archive CI rendering investigation

PR #12, DON-254, 2026-09-09. This is CI investigation evidence, not field or
release acceptance. The archive workload and strict 200 ms gates are unchanged.

## Rejected CI and controlled reproduction

Head `b6004b0b98c7d04f1ad9c28f3194986186036dda` passed Linux run
`34373548949` attempt 1, then failed attempt 2 with a 219.5 ms renderer frame
gap before any archive operation started. Current-position delivery was at
most 24 ms and the main watchdog at most 50.873 ms. The earlier 226 ms
restore/current-position rejection remains a separate measurement; its exact
cause has not been established by the frame investigation.

A disposable local Debian 12 ARM64 container reproduced a 219.2 ms frame gap
on the same source. It used Electron 40.10.0, Mesa 22.3.6 llvmpipe, Xvfb
1440x900x24 and Node 22.23.2. This is a different architecture from hosted CI.
The product source and archive workload were unchanged.

Repeated launches can reuse Mesa's shader cache outside Electron's temporary
profile. Subsequent comparisons therefore assigned a fresh
`MESA_SHADER_CACHE_DIR` to each run. With a cold cache, original code rejected
a 210.3 ms frame while source-to-renderer delivery stayed at most 4 ms.
Startup tracing found long graphics-thread page-raster tasks, including
782.1 ms in `RasterDecoderImpl::DoEndRasterCHROMIUM`, and renderer waits
behind graphics work. The trace was collected from process start; the optional
CDP profiler can delay startup and was not used for timing comparisons.

An icon-canvas CPU-readback experiment did not fix the cold-cache failure
(214.8 ms), and was reverted. Unchanged MapLibre style setters also request
repainting, but no change to them is claimed as a remedy.

## Scoped correction and verification

The Linux archive smoke adds `--disable-gpu-rasterization`: Chromium draws
page content on the CPU instead of submitting it to Mesa's shared graphics
queue. WebGL MapLibre rendering, compositing, tracking, archive operations,
restart, cleanup and all timing gates remain enabled. This does not change
the shipped application or its default graphics settings.

Controlled cold-cache runs with this switch passed the complete packaged
lifecycle on the original application source:

| CPU allocation | Maximum frame gap | Maximum current-fix gap |
| --- | --- | --- |
| 16 logical CPUs | 45.1 ms | 71 ms |
| 4 logical CPUs | 148.1 ms | 157 ms |

The four-CPU run retained the 50 ms main/source polling profile and both
launches. No warm-up delay, discarded timing sample or threshold adjustment
was introduced. Local receipts and raw traces are retained in the task's
`tmp/war04b-local-linux/` evidence directory. The first container supervisor
also rejected unreaped orphan processes; subsequent direct diagnostic runs
used a subreaper and retained process/profile cleanup results. These local
runs are not substitutes for the normal hosted CI supervisor.

Both passing receipts independently validate with
`validateArchiveLifecycleSmokeEvidence`. Their SHA-256 digests are:

```text
16 CPUs: 6a192216f985f8b21be315eec61da7d0c75172be7ee9592dff59b62db4d579a6
 4 CPUs: bbc617efee893904e2da360df54df3de4e0eb0ac88f3d8b35fe929af6bebfaf3
```

The CI argument regression failed before the switch was added; 216 affected
tests then passed. The full source run passed 395 files; five server suites
were denied loopback binding by the local sandbox (`listen EPERM`). All 63
tests in those five suites passed with local-port permission, completing
coverage of 400 files / 4,157 tests. Lint and production build also passed.
An independent visual run centered the synthetic tracker and confirmed its
rendered dot and label in the packaged map. The active WebGL context reported
`ANGLE (Mesa/X.org, llvmpipe (LLVM 15.0.6 128 bits), OpenGL 4.5)`.
Remote basemap tiles were intentionally blocked by the smoke profile; their
degraded state is not tile-rendering proof. Screenshot capture was separate
from the cold-cache timing comparisons.

## Independent runner package-index failure

The correction was pushed as `de4d367e`. Both attempts of run `34385748674`
stopped during `apt-get update`, before Node installation or application tests.
Google's Chrome repository supplied a package index whose SHA-256 differed
from its release metadata. One diagnosed retry confirmed the same mismatch;
no package-integrity check was bypassed.

The standalone validation job installs Ubuntu runtime packages, so its APT
update and install commands now use `Dir::Etc::sourceparts=-`. This excludes
runner-added third-party feeds for these invocations, retaining the runner's
main Ubuntu source list and normal authentication/integrity checks. A missing
or empty main source list fails before APT runs. No source-list file is deleted.

The workflow regression failed before this correction; 17 affected tests,
lint and actionlint then passed. A real APT `--print-uris` comparison with
separate Ubuntu and Chrome fixture sources confirmed that Ubuntu remains
selected and Chrome is excluded. Product/runtime code is unchanged since
the completed source cycle above; those results remain applicable.

## Hosted verification and merge readiness

[Linux run 34386382652](https://github.com/donal0c/sartracker-web/actions/runs/34386382652)
passed on `03b09a7ecae3adb5d39fdd3d193d82f28128ce36`, tree
`b21c86d784131bcec991733bfde857a229318ba5`: setup, lint, 400 files / 4,158
tests, production build, native Linux packaging, 960k replay, packaged
tracking, archive lifecycle, terminal evidence and AppImage launch/close.

The downloaded archive receipt independently validates with matching clean
before/after head and tree, exact packaged build identity and successful
cleanup. SHA-256:
`78d8093bb85287089bbfd7d5c37ebbd697e9db2ef5c8621aaa99c4b142c7c9f8`.

| Phase | Frame maximum | Current-fix maximum |
| --- | --- | --- |
| Create | 94.5 ms | 128 ms |
| Verify | 117.5 ms | 155 ms |
| Restore | 114.3 ms | 172 ms |
| Cleanup | 69.3 ms | 135 ms |

GitHub reported the tested head open, clean and mergeable, with all review
threads resolved and latest master `9c73c62d` included. This resolves the
current PR pipeline rejection. Historical failures remain recorded; this is
not field qualification or a reversal of the release HOLD.

The subsequent closeout changes only this evidence document and the handoff.
Its executable, test, dependency and workflow trees are byte-identical to the
green tested head above. Following the repository's documentation-only
evidence-reuse policy, it does not claim a new runtime run for that closeout.

## PR #15 integration: bounded software-renderer concurrency

Linux run `34458799719` on executable integration `35dd1c83` passed source,
lint/build, installer inspection, 960k replay, native SQLite and tracking, then
rejected a 206 ms current-fix interval during post-cleanup archive Review.
Server receipt timestamps were 210 ms apart; the two source-to-renderer delays
were 25 and 21 ms. This localizes the gap before the next server receipt, but
does not distinguish delayed polling from delayed execution of the mock server.
Restore renderer frames reached 108.8 ms and the main watchdog 71.3 ms.
The exact-head failure and clean teardown are retained in `tmp/pr15-ci-35dd1c83`.

A cold-cache diagnostic used the unchanged application at docs-only descendant
`57f33519`, builder 26.16.1 and Electron 40.10.0 in the owned Linux ARM64 container.
It has a four-CPU quota but exposes sixteen CPUs, unlike hosted x64's four logical
CPUs/two physical cores. A 50 ms observer in the smoke/mock-server process recorded
scheduler delays separately from the authoritative liveness gate. A first launch
omitted the required Linux launch flags and failed before renderer readiness;
the default exploratory run then enabled the Linux graphics flags but omitted
the occluded-window switch. The controlled four/two-worker comparisons use the
exact normal CI launch arguments, including that switch.

| Mesa workers | Current-fix maximum | Main maximum | Frame maximum | External loop gaps over 70 ms during run | CPU throttled time |
| --- | --- | --- | --- | --- | --- |
| Default | 194 ms | 109.1 ms | 130.4 ms | Frequent, mostly about 100 ms | Not captured as a run delta |
| 4 | 92 ms | 97.6 ms | 126.4 ms | 10 | 26.87 s |
| 2 | 171 ms | 69.3 ms | 167.2 ms | 1 | 5.78 s |

Each comparison used a separate cold Mesa cache and the same package/workload.
Both explicitly bounded worker runs completed the full two-launch lifecycle and
their receipts independently validate. Files are under
`tmp/batch2-linux-source/tmp/pr15-archive-lp{4,2}` with corresponding
`pr15-external-loop-*` and `pr15-cgroup-*` diagnostics. These are local synthetic
comparisons, not a reproduction or causal explanation of the hosted rejection.
Four workers had the best current-fix maximum; two reduced measured contention.

The Linux archive CI environment now pins `LP_NUM_THREADS=2` to bound graphics
concurrency. [Mesa documents this variable](https://docs.mesa3d.org/envvars.html#envvar-LP_NUM_THREADS)
as the rendering worker count, defaulting to detected CPU cores. Rasterization,
WebGL map rendering, the original workload, all observations and the strict
200 ms limits remain enabled. macOS and the shipped application are unchanged.
This is a bounded environment adjustment requiring a new hosted run, not a claim
that the earlier 242/210/206 ms failures are explained. The regression failed with
an inherited sixteen-worker setting, then passed with Linux pinned to two and
non-Linux settings preserved. Local liveness-boundary tests and lint pass; the
normal new-head CI result and receipt validation are recorded on PR #15/DON-215.

Hosted result: [CI 34462624720](https://github.com/donal0c/sartracker-web/actions/runs/34462624720)
passed on `e60dc43e13997b5297e396ce74561c30172025f7`, tree
`e2a15683385a7cc10155488b9bb5bd572a09fd4e`, including every source and packaged
gate. Downloaded source binding, package-safety v2 and archive-lifecycle receipts
independently validate the exact clean head/tree, native runtime, custody and
teardown. Current-fix maxima were 116/143/175/188 ms for create/verify/restore/
cleanup; renderer frames peaked at 110.3 ms. The strict 200 ms gate passes with
12 ms current-fix headroom. Packaged app.asar SHA-256:
`05bf28a73adc53ad021261478ecd7585e92da349001567d96aa4c8f526a11966`.
Receipts: `tmp/pr15-ci-e60dc43e`. This establishes the configured hosted run,
not a causal explanation of earlier failures or release/field qualification.
Subsequent closeout changes only documentation and reuses this executable proof.
