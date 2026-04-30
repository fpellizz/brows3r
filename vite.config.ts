import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  // Split heavy vendor libs into their own chunks. Keeps the main app
  // bundle below the 500 kB warning threshold and isolates churny
  // libraries (react-syntax-highlighter, react-markdown) so a small
  // app-code change doesn't reship them every build.
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          // Markdown + syntax-highlighting share `mdast`/`unist`/`hast`
          // through refractor, so splitting them creates a circular
          // chunk dep. Ship them together.
          if (
            id.includes("react-syntax-highlighter") ||
            id.includes("/refractor/") ||
            id.includes("highlight.js") ||
            id.includes("react-markdown") ||
            id.includes("/remark") ||
            id.includes("/rehype") ||
            id.includes("/micromark") ||
            id.includes("/mdast") ||
            id.includes("/hast") ||
            id.includes("/unist")
          )
            return "vendor-preview";
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (id.includes("@tauri-apps")) return "vendor-tauri";
          if (id.includes("/lucide-react/")) return "vendor-icons";
          if (id.includes("/i18next") || id.includes("react-i18next"))
            return "vendor-i18n";
          // Everything else: let Rollup decide. A catch-all "vendor"
          // chunk would create a circular dep with the named ones
          // (react-dom internals importing object-assign etc.).
          return undefined;
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
