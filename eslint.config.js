import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**", "apps/web/src/routeTree.gen.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // The registry erases block config types on purpose; see packages/plugin-sdk.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["apps/web/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs["recommended-latest"].rules },
  },
);
