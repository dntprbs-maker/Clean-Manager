import { createHash } from "node:crypto";

export function sha256Hex(str) {
  return createHash("sha256").update(str, "utf8").digest("hex");
}
