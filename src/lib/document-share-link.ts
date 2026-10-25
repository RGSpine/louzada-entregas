import { createHmac, timingSafeEqual } from "crypto";

const PATIENT_EXAMS_BUCKET = "patient-exams";
const TOKEN_VERSION = "1";

/** Validade do link partilhado (ex.: WhatsApp). */
export const DOCUMENT_SHARE_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 dias

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getDocumentShareSecret(): string | null {
  const s = process.env.DOCUMENT_SHARE_LINK_SECRET?.trim();
  return s && s.length >= 16 ? s : null;
}

function getServerAppOrigin(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

/** Prefixos aceites para `PatientExam.fileUrl` (bucket público do projecto). */
export function patientExamPublicUrlPrefixes(): string[] {
  const out: string[] = [];
  for (const raw of [process.env.SUPABASE_URL]) {
    if (!raw?.trim()) continue;
    const base = raw.trim().replace(/\/$/, "");
    out.push(`${base}/storage/v1/object/public/${PATIENT_EXAMS_BUCKET}/`);
  }
  return [...new Set(out)];
}

export function isPatientExamFileUrlTrusted(fileUrl: string): boolean {
  const u = fileUrl.trim();
  if (!u.startsWith("https://")) return false;
  return patientExamPublicUrlPrefixes().some((p) => u.startsWith(p));
}

/**
 * Assina um token HMAC ligado ao `PatientExam.id`. Sem `DOCUMENT_SHARE_LINK_SECRET` devolve `null`.
 */
export function signPatientExamShareToken(examId: string): string | null {
  if (!UUID_RE.test(examId)) return null;
  const secret = getDocumentShareSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + DOCUMENT_SHARE_TOKEN_TTL_SECONDS;
  const payload = `${TOKEN_VERSION}|${examId}|${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}|${sig}`, "utf8").toString("base64url");
}

export function verifyPatientExamShareToken(
  token: string
): { examId: string; exp: number } | null {
  const secret = getDocumentShareSecret();
  if (!secret) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const parts = decoded.split("|");
  if (parts.length !== 4) return null;
  const [version, examId, expStr, sig] = parts;
  if (version !== TOKEN_VERSION) return null;
  if (!UUID_RE.test(examId)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= 0) return null;
  if (exp < Math.floor(Date.now() / 1000)) return null;
  const payload = `${TOKEN_VERSION}|${examId}|${expStr}`;
  const expectedHex = createHmac("sha256", secret).update(payload).digest("hex");
  if (expectedHex.length !== sig.length) return null;
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(expectedHex, "hex");
    b = Buffer.from(sig, "hex");
  } catch {
    return null;
  }
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return { examId, exp };
}

/** URL da app para `/api/document-share?t=…` (domínio Louzada Entregas no WhatsApp). */
export function buildPatientExamShareUrl(examId: string): string | null {
  const token = signPatientExamShareToken(examId);
  if (!token) return null;
  const base = getServerAppOrigin();
  return `${base}/api/document-share?t=${encodeURIComponent(token)}`;
}
