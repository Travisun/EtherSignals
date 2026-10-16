import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    env: {
      DATABASE_URL: "postgresql://test:test@127.0.0.1:54329/test",
      WEBHOOK_SECRETS: "test-webhook-secret",
    },
  },
});
