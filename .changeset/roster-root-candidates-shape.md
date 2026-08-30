---
"@nerima-games/mc-compose": patch
---

Assert the roster root candidates by shape (distinct roots), not by path spelling — the substring check was false by construction when this repository runs inside mc-dev-meta's repos/ mirror, which check:workspace does.
