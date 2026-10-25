import { prisma } from "@/lib/prisma";
import { decryptFiscalSecret } from "@/lib/fiscal/secrets-crypto";

export async function getIssuerApiKeyForUser(userId: string): Promise<string | null> {
  const issuer = await prisma.fiscalIssuerProfile.findUnique({
    where: { userId },
    select: { encryptedProjectApiKey: true, status: true, certificateStatus: true },
  });
  if (
    !issuer?.encryptedProjectApiKey ||
    issuer.status !== "CERTIFICATE_ACTIVE" ||
    issuer.certificateStatus !== "ACTIVE"
  ) {
    return null;
  }
  try {
    return decryptFiscalSecret(issuer.encryptedProjectApiKey);
  } catch {
    return null;
  }
}
