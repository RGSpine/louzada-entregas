import test from "node:test";
import assert from "node:assert/strict";
import {
  formatServiceBillingLabel,
  resolveAppointmentServiceDisplayName,
} from "./appointment-service-meta";
import { AppointmentVisitKind } from "@prisma/client";

test("formatServiceBillingLabel rotula formas de cobrança", () => {
  assert.equal(formatServiceBillingLabel(AppointmentVisitKind.UNIQUE_CONSULTATION), "Avulso (1 sessão)");
  assert.equal(formatServiceBillingLabel(AppointmentVisitKind.TREATMENT_PLAN), "Sessão de pacote vendido");
});

test("resolveAppointmentServiceDisplayName prioriza catálogo", () => {
  assert.equal(
    resolveAppointmentServiceDisplayName({
      serviceName: "Nutrição",
      visitKind: AppointmentVisitKind.UNIQUE_CONSULTATION,
    }),
    "Nutrição",
  );
  assert.equal(
    resolveAppointmentServiceDisplayName({
      serviceName: null,
      visitKind: AppointmentVisitKind.RETURN,
    }),
    "Retorno",
  );
});
