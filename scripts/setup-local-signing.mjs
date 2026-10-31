import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { localSigningIdentity, localSigningName } from "./local-signing.mjs";

if (process.platform !== "darwin") throw new Error("Local signing setup requires macOS.");
const existing = localSigningIdentity();
if (existing) {
  console.log(`Using existing ${localSigningName}: ${existing}`);
  process.exit(0);
}
const certificate = spawnSync("security", ["find-certificate", "-c", localSigningName], { encoding: "utf8" });
if (certificate.status === 0) {
  throw new Error(`A certificate named ${localSigningName} already exists but is not a valid signing identity. Check its private key, expiry, and code-signing trust in Keychain Access. Setup will not replace it.`);
}
const archivePassword = randomBytes(32).toString("hex");
const directory = mkdtempSync(join(tmpdir(), "octode-signing-"));
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: { ...process.env, OCTODE_SIGNING_ARCHIVE_PASSWORD: archivePassword } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed. If a certificate was already imported, repair it in Keychain Access instead of replacing it.`);
}
try {
  const key = join(directory, "key.pem");
  const cert = join(directory, "cert.pem");
  const archive = join(directory, "identity.p12");
  const config = join(directory, "certificate.cnf");
  writeFileSync(config, `[req]\nprompt = no\ndistinguished_name = subject\nx509_extensions = signing\n[subject]\nCN = ${localSigningName}\n[signing]\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature\nextendedKeyUsage = critical,codeSigning\n`, { mode: 0o600 });
  run("openssl", ["req", "-new", "-x509", "-newkey", "rsa:3072", "-noenc", "-sha256", "-days", "3650", "-config", config, "-keyout", key, "-out", cert]);
  run("openssl", ["pkcs12", "-export", "-legacy", "-inkey", key, "-in", cert, "-name", localSigningName, "-macalg", "sha1", "-keypbe", "PBE-SHA1-3DES", "-certpbe", "PBE-SHA1-3DES", "-passout", "env:OCTODE_SIGNING_ARCHIVE_PASSWORD", "-out", archive]);
  const keychain = join(homedir(), "Library", "Keychains", "login.keychain-db");
  // Only codesign is preauthorized to use this signing key, never every app.
  run("security", ["import", archive, "-k", keychain, "-P", archivePassword, "-T", "/usr/bin/codesign"]);
  // User-domain trust applies only to code signing, not websites or TLS.
  run("security", ["add-trusted-cert", "-r", "trustRoot", "-p", "codeSign", "-k", keychain, cert]);
  const identity = localSigningIdentity();
  if (!identity) throw new Error("The signing identity was imported but is not yet valid. Check code-signing trust in Keychain Access.");
  console.log(`Local signing is ready: ${localSigningName} (${identity}). Keep this identity for future builds.`);
} finally {
  // The persistent key lives in Keychain; no private-key files remain in the repo or temp directory.
  rmSync(directory, { recursive: true, force: true });
}
