import { buildCouponPricePreview } from "@/lib/coupon-display";

type Props = {
  /** Valor exibido como /mês (mensal ou equivalente mensal no anual). */
  perMonthPrice: string;
  annualTotalPrice?: string;
  isAnnual: boolean;
  discountPercent: number | null;
  featured?: boolean;
};

export function PlanPriceDisplay({
  perMonthPrice,
  annualTotalPrice,
  isAnnual,
  discountPercent,
  featured = false,
}: Props) {
  const priceClass = featured
    ? "text-4xl font-extrabold tracking-tight text-primary"
    : "text-4xl font-extrabold tracking-tight text-foreground";
  if (!discountPercent || discountPercent <= 0) {
    return (
      <div className="mt-4">
        <span className={priceClass}>
          R$ {perMonthPrice}
        </span>
        <span className="ml-1.5 text-sm font-medium text-foreground/65">/mês</span>
        {isAnnual && annualTotalPrice ? (
          <p className="mt-1.5 text-xs font-medium text-foreground/60">
            Cobrado anualmente: R$ {annualTotalPrice}
          </p>
        ) : null}
      </div>
    );
  }

  const monthlyPreview = buildCouponPricePreview(perMonthPrice, discountPercent);
  const annualPreview =
    isAnnual && annualTotalPrice
      ? buildCouponPricePreview(annualTotalPrice, discountPercent)
      : null;

  return (
    <div className="mt-4 space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xl font-medium text-muted-foreground line-through dark:text-muted-foreground">
          R$ {monthlyPreview.original}
        </span>
        <span className="text-4xl font-extrabold tracking-tight text-foreground">
          R$ {monthlyPreview.discounted}
        </span>
        <span className="text-sm font-medium text-foreground/65">/mês</span>
        <span className="text-sm font-semibold text-success">
          {discountPercent}%
        </span>
      </div>
      {annualPreview ? (
        <p className="text-xs text-muted-foreground">
          <span className="text-muted-foreground line-through dark:text-muted-foreground">
            Cobrado anualmente: R$ {annualPreview.original}
          </span>{" "}
          <span className="font-semibold text-foreground">
            R$ {annualPreview.discounted}
          </span>
        </p>
      ) : null}
    </div>
  );
}
