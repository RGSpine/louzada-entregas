import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="depth-stage relative min-h-screen">
      <div className="flex min-h-screen items-center justify-center px-4 py-12">
        <div className="depth-front relative w-full max-w-3xl p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
