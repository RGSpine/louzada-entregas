"use client";

import { useRef } from "react";
import { useServerInsertedHTML } from "next/navigation";
import { CLINICAL_THEME_BOOTSTRAP_SCRIPT } from "@/lib/clinical-theme";

/**
 * O script de tema entra uma vez no HTML do servidor, fora da árvore
 * que o React hidrata. No cliente este componente não renderiza <script>.
 */
export function ClinicalThemeBootstrap() {
  const inserted = useRef(false);
  useServerInsertedHTML(() => {
    if (inserted.current) return null;
    inserted.current = true;
    return (
      <script
        dangerouslySetInnerHTML={{ __html: CLINICAL_THEME_BOOTSTRAP_SCRIPT }}
      />
    );
  });
  return null;
}
