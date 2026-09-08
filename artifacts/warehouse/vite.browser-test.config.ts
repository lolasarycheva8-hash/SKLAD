import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const browserTest = path.resolve(import.meta.dirname, "browser-test");

export default defineConfig({
  root: browserTest,
  plugins: [react(), tailwindcss({ optimize: false })],
  resolve: {
    alias: [
      {
        find: "@workspace/api-client-react",
        replacement: path.join(browserTest, "api-client-stub.ts"),
      },
      {
        find: "@/hooks/use-permissions",
        replacement: path.join(browserTest, "permissions-stub.ts"),
      },
      {
        find: "@/hooks/use-toast",
        replacement: path.join(browserTest, "toast-stub.ts"),
      },
      {
        find: "@/components/delivery-photos-dialog",
        replacement: path.join(browserTest, "photos-dialog-stub.tsx"),
      },
      {
        find: "@/components/delivery-comment-dialog",
        replacement: path.join(browserTest, "comment-dialog-stub.tsx"),
      },
      {
        find: "@",
        replacement: path.resolve(import.meta.dirname, "src"),
      },
    ],
  },
  build: {
    outDir: "/tmp/warehouse-my-deliveries-browser-test",
    emptyOutDir: true,
  },
});