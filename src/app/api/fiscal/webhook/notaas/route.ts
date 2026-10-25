import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notaasProvider, verifyNotaasWebhookSignature } from "@/lib/fiscal/providers/notaas";
import { logger } from "@/lib/logger";
import { isProductionRuntime } from "@/lib/edge-ratelimit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const headers: Record<string, string | null> = {
    "x-notaas-signature": request.headers.get("x-notaas-signature"),
    "x-notaas-delivery": request.headers.get("x-notaas-delivery"),
    "x-notaas-event": request.headers.get("x-notaas-event"),
  };

  const secret = process.env.NOTAAS_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // Produção: fail-closed (igual Auth/IA). Dev/preview: permite sem assinatura.
    if (isProductionRuntime()) {
      logger.error("fiscal.webhook.secret_missing", {
        feature: "fiscal-webhook-notaas",
      });
      return NextResponse.json(
        { error: "Webhook fiscal indisponível (secret ausente)." },
        { status: 503 },
      );
    }
  } else {
    const sig = headers["x-notaas-signature"];
    if (!verifyNotaasWebhookSignature(rawBody, sig)) {
      return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
    }
  }

  const event = notaasProvider.parseWebhook(rawBody, headers);
  if (!event) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const doc = await prisma.fiscalDocument.findFirst({
    where: { externalInvoiceId: event.data.invoiceId },
  });
  if (!doc) {
    logger.warn("fiscal.webhook.unknown_invoice", { invoiceId: event.data.invoiceId });
    return NextResponse.json({ ok: true });
  }

  if (event.deliveryId && doc.webhookDeliveryIds.includes(event.deliveryId)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const deliveryIds = event.deliveryId
    ? [...doc.webhookDeliveryIds, event.deliveryId]
    : doc.webhookDeliveryIds;

  if (event.event === "nfse.issued") {
    await prisma.fiscalDocument.update({
      where: { id: doc.id },
      data: {
        status: "ISSUED",
        nfseNumber: event.data.nNFSe ?? undefined,
        nfseAccessKey: event.data.chNFSe ?? undefined,
        issuedAt: new Date(),
        webhookDeliveryIds: deliveryIds,
        errorCode: null,
        errorMessage: null,
      },
    });
    await prisma.financialTransaction.update({
      where: { id: doc.transactionId },
      data: { fiscalExportStatus: "EXPORTED", fiscalExportedAt: new Date() },
    });
  } else if (event.event === "nfse.error") {
    await prisma.fiscalDocument.update({
      where: { id: doc.id },
      data: {
        status: "ERROR",
        errorCode: event.data.errorCode ?? "UNKNOWN",
        errorMessage: event.data.errorMessage ?? "Erro na emissão NFS-e.",
        webhookDeliveryIds: deliveryIds,
      },
    });
  } else if (event.event === "nfse.documents_ready") {
    await prisma.fiscalDocument.update({
      where: { id: doc.id },
      data: {
        pdfUrl: event.data.pdfUrl ?? undefined,
        xmlUrl: event.data.xmlUrl ?? undefined,
        webhookDeliveryIds: deliveryIds,
      },
    });
  } else if (event.event === "nfse.cancelled") {
    await prisma.fiscalDocument.update({
      where: { id: doc.id },
      data: {
        status: "CANCELLED",
        webhookDeliveryIds: deliveryIds,
        errorCode: null,
        errorMessage: null,
      },
    });
    await prisma.financialTransaction.update({
      where: { id: doc.transactionId },
      data: { fiscalExportStatus: "READY", fiscalExportedAt: null },
    });
  }

  return NextResponse.json({ ok: true });
}
