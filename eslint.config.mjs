// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── Strict type-safety ──────────────────────────────────────
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",

      // ── Code quality ────────────────────────────────────────────
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_|^error$|^e$|^err$",
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      "@typescript-eslint/prefer-optional-chain": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",

      // ── Relaxed where pragmatic ─────────────────────────────────
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-invalid-void-type": "off",
      "@typescript-eslint/no-base-to-string": "off", // String() on unknown is acceptable
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off", // too strict
      "@typescript-eslint/require-await": "off", // async without await is fine for consistency
      "@typescript-eslint/no-require-imports": "off", // require() needed for optional deps
      "@typescript-eslint/no-unnecessary-type-conversion": "off", // explicit String() is fine
      "no-control-regex": "off", // needed for ANSI escape stripping
      "no-useless-escape": "off", // regex patterns may have valid escapes
      "no-empty": "off", // empty catch blocks are sometimes intentional
      "no-case-declarations": "off", // let in case is fine with proper blocks
    },
  },
  {
    ignores: [
      "dist/",
      "coverage/",
      "benchmarks/",
      "node_modules/",
      "tests/",
      "*.js",
      "*.mjs",
    ],
  },
);
