import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function katexWoff2Only(): Plugin {
  return {
    name: "katex-woff2-only",
    enforce: "pre",
    transform: {
      filter: { id: /katex\.min\.css$/ },
      handler(code) {
        return {
          code: code.replace(/,url\([^)]+\.(?:woff|ttf)\)\s*format\([^)]+\)/g, ""),
          map: null,
        };
      },
    },
  };
}

export default defineConfig({
  plugins: [katexWoff2Only(), react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
