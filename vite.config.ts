import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const spaFallback = {
    name: "spa-fallback",
    configureServer(server: any) {
      return () => {
        server.middlewares.use((req: any, res: any, next: any) => {
          if (!req.url.match(/\.(js|css|png|jpg|gif|svg|woff|woff2|ttf|eot|ico)/) && !req.url.startsWith("/api")) {
            req.url = "/index.html";
          }
          next();
        });
      };
    },
  };

  return {
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    middlewareMode: false,
  },
  plugins: [react(), mode === "development" && componentTagger(), spaFallback].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  };
});
