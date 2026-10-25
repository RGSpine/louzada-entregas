import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function deriveKey(): Buffer {
  const raw =
    process.env.FISCAL_SECRETS_ENCRYPTION_KEY?.trim() ||
    process.env.DOCUMENT_SHARE_LINK_SECRET?.trim();
  if (!raw || raw.length < 16) {
    throw new Error(
      "FISCAL_SECRETS_ENCRYPTION_KEY não configurada (mín. 16 caracteres).",
    );
  }
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

/** Encripta segredo em repouso (API keys de projeto Notaas). */
export function encryptFiscalSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Desencripta segredo fiscal. */
export function decryptFiscalSecret(encoded: string): string {
  const key = deriveKey();
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("Segredo fiscal corrompido.");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}

export function maskApiKeyPrefix(prefix: string | null | undefined): string {
  if (!prefix) return "—";
  return `${prefix}…`;
}
