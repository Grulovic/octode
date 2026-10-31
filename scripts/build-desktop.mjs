import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
const flags = process.argv.slice(3);
if (!["dev", "prod"].includes(mode) || flags.some((flag) => !["--check", "--offline"].includes(flag))) {
  console.error("Usage: npm run buildDev|buildProd -- [--check] [--offline]");
  process.exit(1);
}
if (process.platform !== "darwin") {
  console.error("These app-bundle commands target macOS. Use npm run tauri -- build for other platforms.");
  process.exit(1);
}
const supported = (version) => {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  return major === 20 ? minor >= 19 : major === 22 ? minor >= 12 : major > 22;
};
let node = process.execPath;
if (!supported(process.versions.node)) {
  const versions = join(process.env.NVM_DIR || join(homedir(), ".nvm"), "versions", "node");
  const available = existsSync(versions) ? readdirSync(versions).filter(supported).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) : [];
  node = available.map((version) => join(versions, version, "bin", "node")).find(existsSync);
  if (!node) {
    console.error("Node 20.19+ or 22.12+ is required. Install a supported Node version, then retry.");
    process.exit(1);
  }
  console.log(`Using supported Node: ${node}`);
}
const env = {
  ...process.env,
  PATH: [dirname(node), join(process.env.CARGO_HOME || join(homedir(), ".cargo"), "bin"), process.env.PATH].filter(Boolean).join(delimiter),
};
if (flags.includes("--offline")) env.CARGO_NET_OFFLINE = "true";
function run(command, args, nativeBuild = false) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) {
    if (nativeBuild) console.error("\nNative build failed; the existing app was not refreshed. Read the first Cargo error above. Missing Rust crates require network access to crates.io; retry without --offline when online.");
    process.exit(result.status ?? 1);
  }
}
for (const dependency of ["typescript/bin/tsc", "vite/bin/vite.js", "@tauri-apps/cli/tauri.js"]) {
  if (!existsSync(join(root, "node_modules", dependency))) {
    console.error("Build dependencies are missing. Run npm install first.");
    process.exit(1);
  }
}
run("cargo", ["--version"]);
run("xcode-select", ["-p"]);
// Build once with the selected Node. Tauri's npm hook is disabled below.
run(node, [join(root, "node_modules/typescript/bin/tsc"), "-b"]);
run(node, [join(root, "node_modules/vite/bin/vite.js"), "build"]);
const check = flags.includes("--check");
const config = { build: { beforeBuildCommand: null } };
if (check) Object.assign(config, { productName: "Octode Check", identifier: "dev.octode.autosavecheck" });
const args = [join(root, "node_modules/@tauri-apps/cli/tauri.js"), "build", "--bundles", "app", "--no-sign", "--ci", "--config", JSON.stringify(config)];
if (mode === "dev") args.push("--debug");
args.push("--", "--locked");
run(node, args, true);
const profile = mode === "dev" ? "debug" : "release";
const app = join(root, "src-tauri", "target", profile, "bundle", "macos", `${check ? "Octode Check" : "Octode"}.app`);
// Rust's executable signature is invalid once placed inside an unsigned bundle.
// Seal the finished bundle locally so Launch Services can open it reliably.
run("codesign", ["--force", "--deep", "--sign", "-", app]);
run("codesign", ["--verify", "--deep", "--strict", app]);
console.log(`\nBuilt: ${app}\nOpen this app directly. After rebuilding, click Restart inside that same app to load changes.\nLocal ad-hoc signature verified. Developer ID signing and notarization are not included.`);
