import { defineConfig, type Plugin } from "vitest/config";

/**
 * Lets the page reach the data Worker (VITE_DATA_BASE_URL, see src/config.ts): its origin joins
 * connect-src in index.html's Content-Security-Policy. Without the setting the policy is left as written.
 */
function dataCsp(): Plugin {
  return {
    name: "data-csp",
    transformIndexHtml(html) {
      const url = process.env.VITE_DATA_BASE_URL;
      if (!url) return html;
      const origin = new URL(url).origin;
      if (!/^https:\/\/[a-z0-9.-]+$/.test(origin) && !/^http:\/\/localhost:\d+$/.test(origin)) {
        throw new Error(`VITE_DATA_BASE_URL must be an https origin, not ${url}`);
      }
      return html.replace(/connect-src 'self'/, `connect-src 'self' ${origin}`);
    },
  };
}

// Served from the root of its own custom domain on GitHub Pages.
export default defineConfig({
  base: "/",
  plugins: [dataCsp()],
  server: { port: 5173 },
  build: {
    target: "es2022",
    sourcemap: false,
    // The ArcGIS SDK lazy-loads large chunks; only the entry chunk matters for first paint.
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
