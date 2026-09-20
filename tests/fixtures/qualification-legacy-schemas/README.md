# Legacy migration inputs

These small synthetic stores retain the schema emitted by exact historical
repository revisions. The JSON records the source commit and source-module
SHA-256. Schemas 3–5 and 7–12 were created by that revision's actual Electron
mission-store factory and public mission, marker and tracking methods. Schemas
1–2 use the literal migration DDL from the original Rust persistence source,
with synthetic rows projected into its actual columns. Schema 1 had only mission
and audit tables; it is not represented as containing markers or tracking rows.

No schema-6-producing revision was found in the retained Electron history.
That fixture is explicitly **synthetic schema-6 compatibility using the historical
schema-5 shape**, matching the current store's supported numeric migration path.
It must never be described as a recovered schema-6 field database.

Regenerate with `node scripts/qualification/build-legacy-schema-fixtures.mjs`
using a compatible local SQLite native module and full repository history.
Generation deliberately gives new synthetic row identifiers and timestamps;
review the resulting fixture changes. It never contacts a provider or reads an
operator profile. The generator's historical source trees are temporary and
removed after use.

Source integration tests and the default-application packaged producer check
that original mission, marker and position fields survive migration. These
small inputs do not replace the separately required large-store or interruption
lanes.
