import { randomUUID } from "node:crypto";

/** prefix 付きの短い ID を生成する (例: `claim_3f9a1c2b`)。 */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
