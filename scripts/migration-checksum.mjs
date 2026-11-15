/**
 * Line-ending-insensitive migration checksums.
 *
 * Checksums used to be sha256 of the raw file bytes, so the same migration
 * hashed differently on a Windows checkout (core.autocrlf → CRLF) than on
 * Linux/macOS (LF). schema_migrations ended up with a mix of both, and the
 * Monitor flagged unchanged migrations as "changed".
 *
 * Canonical checksum = sha256 of the body with CRLF normalized to LF.
 * `checksum_crlf` is the same body with every LF as CRLF — kept only so rows
 * that were applied from a CRLF checkout before this fix still match.
 */
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

export const toLF = (body) => body.replace(/\r\n/g, "\n");

export function migrationChecksums(body) {
  const lf = toLF(body);
  return { checksum: sha(lf), checksum_crlf: sha(lf.replace(/\n/g, "\r\n")) };
}

/** True if a recorded DB checksum matches either line-ending form. */
export function checksumMatches(recorded, { checksum, checksum_crlf }) {
  return recorded === checksum || (!!checksum_crlf && recorded === checksum_crlf);
}
