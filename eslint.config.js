import js from "@eslint/js";

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        crypto: "readonly",
        document: "readonly",
        window: "readonly",
        alert: "readonly",
        navigator: "readonly",
        console: "readonly",
        importMeta: "readonly",
      },
    },
  },
];
