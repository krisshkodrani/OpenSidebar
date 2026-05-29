module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["@typescript-eslint", "react-hooks"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
    "no-console": "off",
    "no-empty": "warn",
  },
  env: {
    browser: true,
    node: true,
    es2022: true,
    worker: true,
  },
  overrides: [
    {
      // Boundary rule (bulletproof-react unidirectional architecture):
      // the React UI must not reach into the agent runtime layers.
      // Share via packages/shared-types or route through sidepanel/runtime.ts.
      files: [
        "apps/extension/src/sidepanel/**/*.{ts,tsx}",
        "apps/extension/src/trace-viewer/**/*.{ts,tsx}",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "**/background/**",
                  "**/content/**",
                  "**/offscreen/**",
                  "@/background/**",
                  "@/content/**",
                  "@/offscreen/**",
                ],
                message:
                  "UI must not import from runtime layers (background/content/offscreen). Share types via packages/shared-types or route calls through sidepanel/runtime.ts.",
              },
            ],
          },
        ],
      },
    },
  ],
};
