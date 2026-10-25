import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plan-limits";
import { createDirectUploadSignedUrl } from "@/lib/uploads/direct-upload";
import { getEvolutionJobForUser } from "@/server/services/evolution-jobs";
import { EVOLUTION_ASYNC_POLL_INTERVAL_MS } from "@/lib/evolution-async-client";
import { hasUsableEvolutionTranscription } from "@/lib/evolution-long-audio";

export type E2EUserContext = {
  dbUserId: string;
  authUserId: string;
  email: string;
  plan: string | null;
};

export type StepResult = {
  id: string;
  ok: boolean;
  detail: string;
  ms?: number;
};

export function record(steps: StepResult[], id: string, ok: boolean, detail: string, ms?: number) {
  steps.push({ id, ok, detail, ms });
}

export async function resolveE2EUser(): Promise<E2EUserContext | null> {
  const emailHint = process.env.E2E_TEST_EMAIL?.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: emailHint
      ? { email: { equals: emailHint, mode: "insensitive" } }
      : { OR: [{ plan: "PREMIUM" }, { isInfluencer: true }] },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      email: true,
      plan: true,
      authUserId: true,
      isInfluencer: true,
    },
  });
  if (!user?.email || !user.authUserId?.trim()) return null;
  return {
    dbUserId: user.id,
    authUserId: user.authUserId.trim(),
    email: user.email,
    plan: user.plan,
  };
}

export async function uploadWavToDirectStorage(
  dbUserId: string,
  wav: Buffer,
): Promise<{ storagePath: string; sizeBytes: number; contentType: string }> {
  const signed = await createDirectUploadSignedUrl(dbUserId, {
    kind: "audio",
    contentType: "audio/wav",
    sizeBytes: wav.length,
  });
  if (!signed.ok) {
    throw new Error(signed.error);
  }
  const put = await fetch(signed.data.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": signed.data.contentType },
    body: new Uint8Array(wav),
  });
  if (!put.ok) {
    throw new Error(`PUT Storage falhou: HTTP ${put.status}`);
  }
  return {
    storagePath: signed.data.path,
    sizeBytes: wav.length,
    contentType: signed.data.contentType,
  };
}

export async function pollJobUntilTerminal(
  jobId: string,
  userId: string,
  maxAttempts = 120,
): Promise<{ status: string; result?: unknown; error?: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    const job = await getEvolutionJobForUser(jobId, userId);
    if (!job.ok) throw new Error(job.message);
    if (job.payload.status === "SUCCEEDED") {
      return { status: "SUCCEEDED", result: job.payload.result };
    }
    if (job.payload.status === "FAILED") {
      return { status: "FAILED", error: job.payload.error };
    }
    await new Promise((r) => setTimeout(r, EVOLUTION_ASYNC_POLL_INTERVAL_MS));
  }
  throw new Error(`Polling expirou após ${maxAttempts} tentativas`);
}

export function proMaxAudioSeconds(): number {
  const limits = getPlanLimits("PREMIUM", null, false);
  return Math.max(1, Math.round(limits.maxAudioMinutes * 60));
}

export async function findStuckEvolutionJobs(staleMinutes = 30) {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
  return prisma.evolutionProcessingJob.findMany({
    where: {
      status: { in: ["QUEUED", "PROCESSING"] },
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: {
      id: true,
      status: true,
      createdAt: true,
      startedAt: true,
      errorMessage: true,
      user: { select: { email: true } },
    },
  });
}

export async function signInSupabaseForPlaywright(): Promise<{
  accessToken: string;
  refreshToken: string;
} | null> {
  const url = process.env.SUPABASE_URL?.trim();
  const anon = process.env.SUPABASE_ANON_KEY?.trim();
  const email = process.env.E2E_TEST_EMAIL?.trim();
  const password = process.env.E2E_TEST_PASSWORD?.trim();
  if (!url || !anon || !email || !password) return null;

  const client = createClient(url, anon);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(error?.message ?? "Login E2E falhou");
  }
  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}

export function assertTranscriptionIfPresent(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  return hasUsableEvolutionTranscription(result as Record<string, string>);
}
