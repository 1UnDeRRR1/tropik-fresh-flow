// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.

// Diagnostic runtime build marker. COMMIT_REF may be a branch name (e.g. "main"),
// so accept only candidates that look like a real Git commit identity
// (7–40 hex chars). If none qualify, fall back to the literal string "unknown" —
// never a branch name, timestamp, or "dev".
const buildVersionCandidates = [
  process.env.CF_PAGES_COMMIT_SHA,
  process.env.GITHUB_SHA,
  process.env.COMMIT_SHA,
  process.env.COMMIT_REF,
  process.env.VITE_APP_VERSION,
];

const buildVersion =
  buildVersionCandidates
    .map((value) => value?.trim())
    .find((value): value is string => !!value && /^[0-9a-f]{7,40}$/i.test(value)) ??
  "unknown";

const buildTime = new Date().toISOString();

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(buildVersion),
      "import.meta.env.VITE_BUILD_TIME": JSON.stringify(buildTime),
    },
    plugins: [mcpPlugin()],
  },
});
