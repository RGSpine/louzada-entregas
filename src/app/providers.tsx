"use client";

import { usePathname } from "next/navigation";
import { ThemeProvider } from "@/components/theme/ClinicalThemeProvider";
import { Toaster } from "sonner";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { ClinicalThemeSync } from "@/components/theme/ClinicalThemeSync";
import { PwaRegister } from "@/components/pwa/PwaRegister";
import { PushNotificationPrompt } from "@/components/pwa/PushNotificationPrompt";
import { PwaInstallProvider } from "@/components/pwa/PwaInstallProvider";
import { RateLimitFetchGuard } from "@/components/security/RateLimitFetchGuard";

/** Rotas `/dashboard/*` usam chrome próprio com ThemeToggle no `DashboardSubnavChrome`. */
function useShowFloatingThemeToggle(): boolean {
  const pathname = usePathname();
  if (!pathname) return true;
  if (pathname.startsWith("/dashboard")) return false;
  if (pathname === "/paciente") return false;
  return true;
}

function FloatingThemeToggle() {
  const show = useShowFloatingThemeToggle();
  if (!show) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-end p-4 safe-area-pt">
      <div className="pointer-events-auto">
        <ThemeToggle className="!shadow-[0_1px_0_rgba(255,255,255,0.55),0_10px_24px_rgba(12,18,34,0.46)] hover:!shadow-[0_1px_0_rgba(255,255,255,0.55),0_10px_24px_rgba(12,18,34,0.46)]" />
      </div>
    </div>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ClinicalThemeSync />
      <PwaInstallProvider>
        <RateLimitFetchGuard />
        <PwaRegister />
        <PushNotificationPrompt />
        <FloatingThemeToggle />
        {children}
        <Toaster position="top-right" richColors />
      </PwaInstallProvider>
    </ThemeProvider>
  );
}
