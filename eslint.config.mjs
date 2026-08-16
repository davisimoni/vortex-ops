import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * Flat config. `eslint-config-next` ships flat configs directly from v16, so
 * there is no FlatCompat shim here — the eslintrc bridge cannot serialise the
 * plugin graph these configs build.
 *
 * @type {import("eslint").Linter.Config[]}
 */
const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },

  ...coreWebVitals,
  ...nextTypescript,

  {
    rules: {
      // An unused variable is usually a leftover; an underscore-prefixed one is
      // a deliberate discard (destructuring a field out of an object).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
          ignoreRestSiblings: true,
        },
      ],
      // `any` erases the type safety the rest of the codebase is built on.
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
    },
  },

  {
    // Tests assert on shapes that are deliberately wrong; the strict rules above
    // would make several of those assertions impossible to write.
    files: ["**/*.test.ts", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },

  {
    // Build-time Node scripts, not application code — a CLI tool's whole job
    // is printing to stdout.
    files: ["scripts/**/*.mjs"],
    rules: {
      "no-console": "off",
    },
  },
];

export default config;
