import assert from "node:assert/strict";
import { subscriptionCollectsPayment } from "@/lib/stripe-influencer-pause";

assert.equal(
  subscriptionCollectsPayment({ status: "active", pause_collection: null }),
  true,
);
assert.equal(
  subscriptionCollectsPayment({
    status: "active",
    pause_collection: { behavior: "void", resumes_at: null },
  }),
  false,
);
assert.equal(
  subscriptionCollectsPayment({ status: "canceled", pause_collection: null }),
  false,
);
assert.equal(
  subscriptionCollectsPayment({ status: "trialing", pause_collection: null }),
  true,
);

console.log("stripe influencer pause tests ok");
