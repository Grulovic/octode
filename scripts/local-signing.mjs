import { spawnSync } from "node:child_process";

export const localSigningName = "Octode Local Development";

export function localSigningIdentity() {
  const result = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Could not read signing identities from Keychain.");
  const identities = [...result.stdout.matchAll(/^\s*\d+\)\s+([A-F0-9]{40})\s+"([^"]+)"/gm)]
    .filter((match) => match[2] === localSigningName);
  if (identities.length > 1) throw new Error(`Multiple identities named ${localSigningName}. Resolve the duplicate certificates in Keychain Access before building.`);
  return identities[0]?.[1] ?? null;
}
