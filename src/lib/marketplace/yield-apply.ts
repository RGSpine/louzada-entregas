export type YieldRuleMatch = {
  id: string;
  hoursBeforeTrigger: number;
  discountPercentage: number;
};

export function hoursUntilSlot(datetime: Date, now = new Date()): number {
  return (datetime.getTime() - now.getTime()) / 3_600_000;
}

export function computeDiscountPrice(basePrice: number, discountPercentage: number): number {
  const pct = Math.min(90, Math.max(0, discountPercentage));
  return Math.round(basePrice * (1 - pct / 100) * 100) / 100;
}

/** Entre regras que já dispararam, fica a de maior desconto. */
export function selectActiveYieldRule(
  hoursUntil: number,
  rules: YieldRuleMatch[],
): YieldRuleMatch | null {
  const matching = rules.filter(
    (rule) => hoursUntil > 0 && hoursUntil <= rule.hoursBeforeTrigger,
  );
  if (matching.length === 0) return null;
  return matching.reduce((best, rule) =>
    rule.discountPercentage > best.discountPercentage ? rule : best,
  );
}
