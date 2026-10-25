import { apiV1Ok } from "@/lib/api-v1/response";
import { listClinicalDocumentTypesForApi } from "@/server/services/clinical-documents";

/** Tipos de documento clínico disponíveis (público). */
export async function GET() {
  return apiV1Ok({ types: listClinicalDocumentTypesForApi() });
}
