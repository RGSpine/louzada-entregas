/**
 * PIN de perfil ADMIN (Opção B).
 * Hash com scrypt (Node crypto) — sem dependência externa.
 * Formato armazenado: `scrypt$N$r$p$saltB64$hashB64`
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

/** PIN inicial do administrador principal, definido no cadastro da equipe. */
export const LAB_PRINCIPAL_ADMIN_PIN = "1322";

const PIN_MIN_LEN = 4;
const PIN_MAX_LEN = 6;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

type ScryptParams = { N: number; r: number; p: number };

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptParams,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
}

/** PIN numérico de 4 a 6 dígitos. */
export function isValidAdminPinFormat(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN_LEN},${PIN_MAX_LEN}}$`).test(pin);
}

export function adminPinFormatError(): string {
  return `O PIN deve ter de ${PIN_MIN_LEN} a ${PIN_MAX_LEN} dígitos numéricos.`;
}

export async function hashAdminPin(pin: string): Promise<string> {
  if (!isValidAdminPinFormat(pin)) {
    throw new Error(adminPinFormatError());
  }
  const salt = randomBytes(SALT_LEN);
  const derived = await scryptAsync(pin, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyAdminPin(
  pin: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash || !isValidAdminPinFormat(pin)) return false;
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4]!, "base64url");
  const expected = Buffer.from(parts[5]!, "base64url");
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const derived = await scryptAsync(pin, salt, expected.length, { N, r, p });
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** ADMIN exige PIN; MEMBER não. */
export function intraUserRequiresPin(role: "ADMIN" | "MEMBER"): boolean {
  return role === "ADMIN";
}
