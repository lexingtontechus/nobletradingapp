// Next.js 16 flat ESLint config (Next removed the built-in `next lint`).
// Repo is plain JS (jsconfig.json) — core-web-vitals rules only, no TS preset.
//
// Baseline policy (2026-08-11): the codebase was never linted. Dead/scratch
// code (`_`-prefixed, `_archive/`) is ignored, the pure-copy typography rule
// is off (static marketing copy intentionally uses raw quotes), and the
// noisy React-Hooks pattern rules are WARNINGS — visible in output, never
// failing. Genuine bug rules (rules-of-hooks, jsx-no-undef) stay ERRORS so
// new live code is checked strictly.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "supabase/**",
    "**/_*", // underscore-prefixed scratch/dead files (Next convention)
  ]),
  {
    rules: {
      "react/no-unescaped-entities": "off", // legal/copy text uses raw quotes on purpose
      "@next/next/no-img-element": "off", // legacy <img>, no image-optimization dep
      "react-hooks/set-state-in-effect": "warn", // fetch-in-effect pattern predates the rule
      "react-hooks/exhaustive-deps": "warn", // missing deps often intentional here
      "@next/next/no-location-assign-relative-destination": "warn", // legacy checkout redirect
    },
  },
]);
