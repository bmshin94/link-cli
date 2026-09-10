---
'@stripe/link-cli': patch
---

Use the CLI's build-time package identity for skill-refresh suggestions and framework MCP defaults. Reject invalid package names and versions instead of inferring executable packages from project dependencies, and bundle the patched framework in published builds.
