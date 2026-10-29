import { expect, it } from "vitest";
import { fileIconName, fileIconUrl } from "./fileIcons";
it("recognizes exact filenames, compound extensions, languages and unknown files", () => {
  expect(fileIconName("/app/package.json")).toBe("nodejs");
  expect(fileIconName("/app/Example.PHP")).toBe("php");
  expect(fileIconName("/app/Card.tsx")).toBe("react_ts");
  expect(fileIconName("/app/types.d.ts")).toBe("typescript-def");
  expect(fileIconName("/app/unknown.octode-unknown")).toBe("file");
  expect(fileIconUrl("/app/test.php")).toContain("php");
  expect(fileIconUrl("unknown.octode-unknown")).toContain("file");
});
