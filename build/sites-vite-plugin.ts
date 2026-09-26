import type { Plugin } from "vite";

// Minimal stand-in for the platform-specific Sites plugin so the project can
// be built and run outside the original managed environment (Docker included).
export function sites(_options: { mockAuth?: boolean } = {}): Plugin {
  return {
    name: "sites-stub",
    enforce: "pre",
  };
}

export default sites;
