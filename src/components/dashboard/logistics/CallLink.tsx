import { phoneCallHref } from "@/lib/logistics/phone-link";

export function CallLink({ phone, who }: { phone: string | null | undefined; who: string }) {
  const href = phoneCallHref(phone);
  if (!href || !phone?.trim()) return null;
  return (
    <a href={href} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
      Ligar para {who} · {phone.trim()}
    </a>
  );
}
