import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.d.ts",
      "packages/store/drizzle/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        sourceType: "module",
        ecmaVersion: "latest",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportDefaultDeclaration",
          message: "No default exports — use named exports.",
        },
      ],
    },
  },
  {
    // Tool config files (vitest, drizzle-kit) require a default export by convention.
    files: [
      "**/vitest.config.ts",
      "**/vitest.workspace.ts",
      "**/drizzle.config.ts",
      "**/vite.config.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
];
