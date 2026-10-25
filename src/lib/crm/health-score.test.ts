import assert from "node:assert/strict";
import { computeChurnRisk, computeHealthBreakdown, estimateLtvCents } from "@/lib/crm/health-score";
import { computeRetentionPriorityScore } from "@/lib/crm/priority";
import type { CrmAccountSignals, CrmFeaturesActivated } from "@/lib/crm/types";

function baseSignals(overrides: Partial<CrmAccountSignals> = {}): CrmAccountSignals {
  const features: CrmFeaturesActivated = {
    evolution: true,
    patients: true,
    agenda: false,
    finance: false,
    chat: false,
    documents: false,
    googleCalendar: false,
  };
  return {
    userId: "u1",
    email: "a@test.com",
    name: "Test",
    phone: null,
    profession: "Fisioterapeuta",
    plan: "BASICO",
    planInterval: null,
    isInfluencer: false,
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    currentPeriodEnd: null,
    stripeCancelAtPeriodEnd: false,
    recentPaymentFailure: false,
    evolutionCount: 3,
    patientCount: 2,
    googleCalendarLastSyncedAt: null,
    daysSinceSignup: 10,
    daysSinceActive: 2,
    evolutionsLast30Days: 5,
    evolutionsPrev30Days: 5,
    totalEvolutions: 5,
    features,
    firstEvolutionAt: new Date(),
    firstPatientAt: new Date(),
    firstAgendaAt: null,
    firstFinanceAt: null,
    firstChatAt: null,
    firstDocumentAt: null,
    lastActiveAt: new Date(),
    paidSinceAt: null,
    ...overrides,
  };
}

const health = computeHealthBreakdown(baseSignals());
assert.ok(health.total >= 40 && health.total <= 100);
assert.ok(typeof health.usageTrend === "number");
assert.ok(typeof health.paymentHealth === "number");

const churnLow = computeChurnRisk(baseSignals(), health.total);
assert.equal(churnLow, "LOW");

const churnCritical = computeChurnRisk(
  baseSignals({ plan: "PREMIUM", daysSinceActive: 20 }),
  20,
);
assert.equal(churnCritical, "CRITICAL");

const influencerLtv = estimateLtvCents(
  baseSignals({ plan: "PREMIUM", isInfluencer: true }),
  new Date(),
);
assert.equal(influencerLtv, 0);

const influencerChurn = computeChurnRisk(
  baseSignals({ plan: "PREMIUM", isInfluencer: true, daysSinceActive: 20 }),
  20,
);
assert.notEqual(influencerChurn, "CRITICAL");

const cancelScheduledChurn = computeChurnRisk(
  baseSignals({ plan: "PREMIUM", stripeCancelAtPeriodEnd: true }),
  80,
);
assert.equal(cancelScheduledChurn, "CRITICAL");

const paymentFailChurn = computeChurnRisk(
  baseSignals({ plan: "PREMIUM", recentPaymentFailure: true }),
  80,
);
assert.equal(paymentFailChurn, "CRITICAL");

const momDrop = computeChurnRisk(
  baseSignals({
    plan: "PREMIUM",
    evolutionsLast30Days: 2,
    evolutionsPrev30Days: 10,
    daysSinceActive: 3,
  }),
  70,
);
assert.equal(momDrop, "HIGH");

const payFailHealth = computeHealthBreakdown(
  baseSignals({ recentPaymentFailure: true, plan: "PREMIUM" }),
);
assert.equal(payFailHealth.paymentHealth, 0);

assert.ok(
  computeRetentionPriorityScore({
    churnRisk: "CRITICAL",
    mrrCents: 8790,
    cancelScheduled: true,
  }) >
    computeRetentionPriorityScore({
      churnRisk: "LOW",
      mrrCents: 1890,
    }),
);

console.log("crm health-score tests ok");
