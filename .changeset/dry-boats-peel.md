---
---

No release: the change is confined to a browser spec under `e2e/`, which
`package.json#files` does not ship. Consumers receive identical bytes.

The gate exempts only `docs/` and `.github/`, so "it ships nothing" is not by
itself grounds for silence here — a spec-only diff still owes an explicit
no-release record. Noting it because reasoning from what ships, rather than
from the exempt paths, has now tripped this gate twice.
