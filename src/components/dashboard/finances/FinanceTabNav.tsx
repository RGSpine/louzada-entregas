"use client";

import { cn } from "@/lib/utils";
import { FINANCE_TABS, type FinanceTabId } from "./finance-tab-types";

export function FinanceTabNav({
  active,
  onChange,
  allowed,
}: {
  active: FinanceTabId;
  onChange: (tab: FinanceTabId) => void;
  /** Restringe as abas visíveis (RBAC: MEMBER da clínica vê só Catálogo e Registrar). */
  allowed?: readonly FinanceTabId[];
}) {
  const tabs = allowed ? FINANCE_TABS.filter((t) => allowed.includes(t.id)) : FINANCE_TABS;
  return (
    <nav
      className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-border bg-white p-1 shadow-sm dark:border-border dark:bg-card [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Secções do financeiro"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => {
            if (allowed && !allowed.includes(tab.id)) return;
            onChange(tab.id);
          }}
          className={cn(
            "min-w-[5.5rem] shrink-0 rounded-lg px-3 py-2.5 text-sm font-medium transition sm:px-4",
            active === tab.id
              ? "bg-clinical text-white shadow-sm"
              : "text-muted-foreground hover:bg-muted dark:text-muted-foreground dark:hover:bg-muted",
          )}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
