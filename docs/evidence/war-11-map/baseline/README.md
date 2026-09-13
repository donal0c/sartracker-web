# WAR-11 baseline receipts

These receipts preserve the raw Vitest stdout/stderr bodies from an isolated
detached worktree at `2b2bf8e605e27123c9e454598828d71cb7c062aa`, before the
WAR-11 production integration edits in the active worktree. The detached
checkout used the active lane's `node_modules` through a symlink after
`npm ci --ignore-scripts` and `npm rebuild better-sqlite3`; no source from the
dirty active worktree was copied into it.

Commands, each run from the detached checkout:

```text
npx vitest run --config scripts/assurance/war-04/maps/vitest.config.ts
npx vitest run --config tmp/war-11/vitest.config.ts tmp/war-11/map-lifecycle-genuine-png.test.ts
npx vitest run --config tmp/war-11/vitest.config.ts tmp/war-11/aud11-no-coverage-decoder.test.ts
```

All three baseline commands exited `1` because they intentionally reproduce
the pre-fix red probes. The `.stdout-stderr.log` files contain the exact
command output body, including Vitest's test observations. The exit status and
command-to-file mapping are recorded here because Vitest does not print its
process exit code into stdout.

| Receipt | Exit | Result |
| --- | ---: | --- |
| `map-war04-red.stdout-stderr.log` | 1 | Existing WAR-04 MAP01/02/03 probes: 4 failures. |
| `genuine.stdout-stderr.log` | 1 | Independent opaque 256x256 PNG controls: Chromium decodes both controls; MAP01 deletion and MAP03 same-path replacement remain red. |
| `aud11.stdout-stderr.log` | 1 | Built-in `NO_COVERAGE_TILE_BASE64` has PNG signature and 256x256 dimensions, Chromium decodes it, but a strict bounded PNG oracle rejects its malformed chunk length. |

SHA-256 of the retained raw output bodies:

```text
map-war04-red.stdout-stderr.log  bbf80be171282d5c5de0de85773b917fa0a9e74148848e70cf1c903afcd5e041
genuine.stdout-stderr.log        75f2b6b36c37a7e5b958c46276d94f1489b86d1492a42ac18ba6fbc82c0a95fd
aud11.stdout-stderr.log          8f15b51fd979a4c555b51b4c73d196ea1d86be277b4046b21fa0dc37a3233e23
```

The older `map-war04-red.raw.log` file is a sanitized summarized receipt. It
is retained separately from the raw command output and must not be treated as
the raw stdout/stderr source.
