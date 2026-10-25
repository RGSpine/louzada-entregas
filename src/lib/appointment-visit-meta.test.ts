import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGoogleCalendarDescription,
  buildGoogleEventSummary,
  formatAppointmentMetaSubtitle,
  parseGoogleCalendarMetadata,
  parsePatientNameFromAievoluiSummary,
} from "./appointment-visit-meta";
import {
  AppointmentCareSetting,
  AppointmentStatus,
  AppointmentVisitKind,
} from "@prisma/client";

test("buildGoogleEventSummary usa prefixo por tipo", () => {
  assert.equal(
    buildGoogleEventSummary({
      patientName: "Ana",
      visitKind: AppointmentVisitKind.RETURN,
    }),
    "Retorno — Ana",
  );
  assert.equal(
    buildGoogleEventSummary({
      patientName: "Ana",
      visitKind: AppointmentVisitKind.TREATMENT_PLAN,
    }),
    "Pacote — Ana",
  );
});

test("parsePatientNameFromAievoluiSummary extrai nome dos prefixos Louzada Entregas", () => {
  assert.equal(parsePatientNameFromAievoluiSummary("Retorno — João"), "João");
  assert.equal(parsePatientNameFromAievoluiSummary("Pacote — Maria"), "Maria");
  assert.equal(parsePatientNameFromAievoluiSummary("Serviço — Pedro"), "Pedro");
});

test("round-trip Google metadata via extendedProperties e description", () => {
  const description = buildGoogleCalendarDescription({
    visitKind: AppointmentVisitKind.RETURN,
    careSetting: AppointmentCareSetting.ONLINE,
    notes: "Link: meet.example/abc",
    status: AppointmentStatus.SCHEDULED,
  });

  const parsed = parseGoogleCalendarMetadata({
    description,
    extendedProperties: {
      private: {
        aievolui_visit_kind: "RETURN",
        aievolui_care_setting: "ONLINE",
      },
    },
  });

  assert.equal(parsed.visitKind, AppointmentVisitKind.RETURN);
  assert.equal(parsed.careSetting, AppointmentCareSetting.ONLINE);
  assert.equal(parsed.notes, "Link: meet.example/abc");
});

test("formatAppointmentMetaSubtitle prioriza nome do serviço", () => {
  const subtitle = formatAppointmentMetaSubtitle({
    visitKind: AppointmentVisitKind.UNIQUE_CONSULTATION,
    careSetting: AppointmentCareSetting.HOME_VISIT,
    priceCents: 15000,
    serviceName: "Fisioterapia",
  });
  assert.match(subtitle, /Fisioterapia/);
  assert.match(subtitle, /Domiciliar/);
  assert.match(subtitle, /R\$/);
});

test("formatAppointmentMetaSubtitle usa forma de cobrança sem serviço", () => {
  const subtitle = formatAppointmentMetaSubtitle({
    visitKind: AppointmentVisitKind.RETURN,
    careSetting: AppointmentCareSetting.IN_PERSON_CLINIC,
  });
  assert.match(subtitle, /Retorno/);
});
