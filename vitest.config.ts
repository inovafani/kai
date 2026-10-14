import { defineConfig } from "vitest/config";

export default defineConfig({
  // Components are written for Next.js, which supplies the JSX runtime; tests that render one need it too.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"]
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname
    }
  }
});
