import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowed = ["file_core", "terminal_core", "search_core"];
const modules = process.argv.length > 2 ? process.argv.slice(2) : allowed;
const directory = mkdtempSync(join(tmpdir(), "octode-native-tests-"));
try {
  for (const name of modules) {
    if (!allowed.includes(name))
      throw new Error(`Unknown native test module: ${name}`);
    const executable = join(
      directory,
      process.platform === "win32" ? `${name}.exe` : name,
    );
    const compile = spawnSync(
      "rustc",
      [
        "--edition",
        "2021",
        "--test",
        join(root, `src-tauri/src/${name}.rs`),
        "-o",
        executable,
      ],
      { stdio: "inherit" },
    );
    if (compile.error)
      throw new Error(`Could not run rustc: ${compile.error.message}`);
    if (compile.status !== 0) {
      process.exitCode = compile.status ?? 1;
      break;
    }
    const result = spawnSync(executable, [], {
      stdio: "inherit",
      timeout: 30000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
