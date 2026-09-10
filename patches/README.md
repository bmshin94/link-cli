# incur security patch

`incur@0.4.26.patch` adds a `packageName` option to `Cli.create` and uses it
with the explicit CLI version for MCP defaults and skill-refresh suggestions.
The resolver rejects missing or invalid identity instead of inspecting project
dependency manifests or executable paths. `link-cli` remains the binary and
MCP registration name; `@stripe/link-cli` is the package identity.

Both the framework source and distributed JavaScript/types are patched. The
normal CLI build bundles incur (`noExternal`) because npm consumers do not apply
this repository's pnpm patches. Keep incur as an exact development dependency;
the standalone build already bundles all dependencies.

The patch also makes the MCP stdio import a literal so the bundler includes it.
The normal build keeps a single output file and provides Node's `require` for
bundled CommonJS dependencies such as YAML, matching the standalone build.

When replacing this patch with an upstream fix, retain the self-command and
package-specifier regression tests, and verify a packed CLI install without a
workspace-patched incur. A dependency upgrade alone must not reintroduce runtime
inference from surrounding manifests.
