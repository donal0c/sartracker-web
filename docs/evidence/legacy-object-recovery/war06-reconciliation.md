# WAR-06 integration receipt — 2026-09-13

PR26 merged at `8f93f8d1cc4554178706e23401ecd496d1193195`. PR25 is rebased
onto that master. Resolution keeps the compact upstream handoff, both planning
records and both packaged CI steps. No production, test-helper or probe conflict
required code changes. All seven recovery test/helper/probe hashes in
`final-source-binding.json` remain unchanged; the workflow combines the two
previously independent packaged checks. PR25 changes no `electron`, `src` or
`shared` production files relative to the new base.

Earlier reviews, red/green source evidence, macOS package measurements and Linux
CI `34747643041` still describe `09710eba` and its recorded inputs. They are not
relabeled as new combined-head runs. WAR-06 changed tracking/cache production
behavior, while the six production files bound by the recovery probe are unchanged.
The push-triggered ordinary CI checks the combined source and both packaged
boundaries. The terminal PR25/Linear receipt records that run and artifact binding.
No repeat whole-candidate qualification, release, deployment or merge is authorized.
