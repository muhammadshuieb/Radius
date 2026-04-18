import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

const PREFIX = "v1:";

function key32(): Buffer {
  const hex = config.fieldEncryptionKey?.trim();
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  return createHash("sha256").update(config.jwtSecret).digest();
}

/**
 * AES-256-GCM; ciphertext format: v1:<ivHex>:<tagHex>:<base64 ciphertext>
 */
export function encryptField(plain: string): string {
  if (!plain) return plain;
  if (plain.startsWith(PREFIX)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key32(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("base64")}`;
}

export function decryptField(stored: string): string {
  if (!stored || !stored.startsWith(PREFIX)) return stored;
  const rest = stored.slice(PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) return stored;
  const [ivHex, tagHex, b64] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(b64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key32(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function isEncryptedField(s: string): boolean {
  return s.startsWith(PREFIX);
}
