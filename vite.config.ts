import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const manifest = JSON.parse(readFileSync(new URL("./node_modules/material-icon-theme/dist/material-icons.json", import.meta.url), "utf8")) as {
  file: string;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  iconDefinitions: Record<string, { iconPath: string }>;
};

// Serve bundled icons offline without importing hundreds of SVG modules into React.
function fileIconAssets(): Plugin {
  let build = false;
  return {
    name: "octode-file-icons",
    configResolved(config) { build = config.command === "build"; },
    resolveId(id) { if (id === "virtual:octode-file-icons") return "\0octode-file-icons"; },
    load(id) {
      if (id !== "\0octode-file-icons") return;
      const icons = new Set([manifest.file, ...Object.values(manifest.fileNames), ...Object.values(manifest.fileExtensions)]);
      const definitions: Record<string, { iconPath: string }> = manifest.iconDefinitions;
      const entries = [...icons].map((icon) => {
        const filename = definitions[icon].iconPath.split("/").at(-1)!;
        const path = `node_modules/material-icon-theme/icons/${filename}`;
        const url = build
          ? `import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: "asset", name: filename, source: readFileSync(resolve(path)) })}`
          : JSON.stringify(`/${path}`);
        return `${JSON.stringify(icon)}:${url}`;
      });
      return `export default {${entries.join(",")}}`;
    },
  };
}

export default defineConfig({
  plugins: [react(), fileIconAssets()],
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  build: { target: "es2022" },
});
