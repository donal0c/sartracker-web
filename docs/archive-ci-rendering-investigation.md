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

Normal hosted CI is pending and must exercise the rendering correction before
this PR is called merge-ready.
