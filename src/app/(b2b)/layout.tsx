import type { ReactNode } from "react";

/**
 * Shell B2B — sem header da vitrine de pacientes.
 * O chrome clínico (sidebar/evolução) fica só em `dashboard/layout.tsx`.
 */
export default function B2bLayout({ children }: { children: ReactNode }) {
  return <div data-audience="b2b">{children}</div>;
}
