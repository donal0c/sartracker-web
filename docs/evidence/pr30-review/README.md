# Review evidence provenance

The reviewed ancestor was `01fb1c24`. Initial corrections were committed as
`f7da1d8b`; `correctness-final.txt` records that working source's 4,997 passing
tests, and `browser-final.txt` its six passing rendered cases. Those receipts
remain historical after the final monotonic-deadline correction.

`backward-clock-red.txt` reproduces both attachment states extending their
lifetime on f7da1d8b when wall time moves backward. `backward-clock-green.txt`
records the corrected store plus affected hook/camera tests (23 passing).
`browser-clock-final.txt` rechecks unavailable-style expiry with the corrected
store. Earlier camera/rendering evidence is reused because that code is unchanged.
`correctness-clock-final.txt` records the final clock-corrected source cycle:
473 files, 4,999 passing tests and six existing qualification skips.

The map-target-store red receipt is explicitly an agent-written summary, not raw
Vitest output. Other selected text receipts retain tool output with ANSI escapes,
carriage returns and trailing whitespace normalized. Original working logs,
including interrupted runs and the first browser locator failure, remain under
`tmp/train-c-review/`.

Screenshots use synthetic backgrounds. The manifest links each PNG to its actual
test-output path and SHA-256. Similar or identical pixels establish the same final
visual state; test assertions and traces establish the different event orderings.
No licensed imagery, credentials or production mission data are included.
