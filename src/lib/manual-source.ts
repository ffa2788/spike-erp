import { readFileSync } from "node:fs";
import path from "node:path";

export function shippedManual(): string {
  return readFileSync(path.join(process.cwd(), "docs", "OPERATING-MANUAL.md"), "utf8");
}
