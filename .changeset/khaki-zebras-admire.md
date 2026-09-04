---
---

No release: a browser spec only, which `package.json#files` does not ship. Consumers receive
identical bytes. An explicit no-release record because the changeset gate exempts `docs/` and
`.github/` paths only — a spec-only diff is not exempt even though it ships nothing.
