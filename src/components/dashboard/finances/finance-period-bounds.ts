export {
  exclusiveEndFromInclusiveUtc,
  inclusiveEndFromExclusiveUtc,
} from "@/lib/finance/period-bounds";

export function toDateInputLocal(v: Date): string {
  const y = v.getFullYear();
  const m = String(v.getMonth() + 1).padStart(2, "0");
  const d = String(v.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
