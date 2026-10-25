"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Se o Supabase redirecionar recovery para a Site URL (home) com #access_token&type=recovery,
 * encaminha para /reset-password preservando o hash.
 */
export function RecoveryHashRedirect() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname === "/reset-password") return;
    if (typeof window === "undefined") return;

    const hash = window.location.hash;
    if (!hash) return;
    if (!hash.includes("type=recovery") || !hash.includes("access_token")) return;

    router.replace(`/reset-password${hash}`);
  }, [pathname, router]);

  return null;
}
