import { notaasProvider, isNotaasConfigured } from "@/lib/fiscal/providers/notaas";
import type { FiscalProvider } from "@/lib/fiscal/providers/types";

export type { FiscalProvider, NotaasEmitPayload, NotaasWebhookEvent } from "@/lib/fiscal/providers/types";

export function resolveFiscalProvider(): FiscalProvider | null {
  const kind = (process.env.FISCAL_PROVIDER ?? "notaas").trim().toLowerCase();
  if (kind === "none" || kind === "off") return null;
  if (kind === "focus") {
    // Adapter Focus — Fase 1.1; usar Notaas como default
    return null;
  }
  if (!isNotaasConfigured()) return null;
  return notaasProvider;
}

export { isNotaasConfigured, notaasProvider, verifyNotaasWebhookSignature } from "@/lib/fiscal/providers/notaas";
export {
  isNotaasOrgConfigured,
  getNotaasOrgToken,
} from "@/lib/fiscal/providers/notaas-org";
