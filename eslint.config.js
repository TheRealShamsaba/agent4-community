export default [
  {
    files: ["src/**/*.js", "test/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        AbortController: "readonly",
        AbortSignal: "readonly",
        Blob: "readonly",
        Buffer: "readonly",
        FormData: "readonly",
        Headers: "readonly",
        URL: "readonly",
        console: "readonly",
        clearTimeout: "readonly",
        fetch: "readonly",
        performance: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        structuredClone: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error"
    }
  },
  {
    files: ["hq/src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        AbortController: "readonly",
        Blob: "readonly",
        Element: "readonly",
        EventSource: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        globalThis: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        requestAnimationFrame: "readonly",
        setTimeout: "readonly",
        structuredClone: "readonly",
        window: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error"
    }
  }
];
