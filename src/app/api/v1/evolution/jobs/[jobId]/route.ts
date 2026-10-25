import type { NextRequest } from "next/server";
import {
  apiV1Error,
  apiV1Ok,
  requireApiV1Auth,
} from "@/lib/api-v1/response";
import { getEvolutionJobForUser } from "@/server/services/evolution-jobs";
import { JOB_POLL_RATE_LIMIT } from "@/lib/rate-limit";

type RouteParams = {
  params: Promise<{ jobId: string }>;
};

/** Polling de job assíncrono de evolução — isolado por userId. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireApiV1Auth(
    request,
    JOB_POLL_RATE_LIMIT,
    "api/v1/evolution/jobs",
  );
  if (!auth.ok) {
    return auth.response;
  }

  const { jobId } = await params;
  const job = await getEvolutionJobForUser(jobId, auth.ctx.dbUser.id);

  if (!job.ok) {
    const status = job.reason === "invalid_id" ? 400 : 404;
    const code = job.reason === "invalid_id" ? "INVALID_JOB_ID" : "JOB_NOT_FOUND";
    return apiV1Error(code, job.message, status);
  }

  return apiV1Ok(job.payload);
}
