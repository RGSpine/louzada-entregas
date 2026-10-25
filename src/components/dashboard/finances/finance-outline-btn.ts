/**
 * Botões outline legíveis no financeiro — tokens Clinical Calm.
 */
const financeOutlineColors =
  "bg-card text-foreground border border-border shadow-[var(--shadow-elevation-1)] " +
  "hover:bg-muted hover:text-foreground " +
  "dark:bg-card dark:text-foreground dark:border-border dark:hover:bg-muted dark:hover:text-foreground " +
  "[&_svg]:text-foreground dark:[&_svg]:text-foreground";

/** Sobrescreve variant outline do shadcn (fundo translúcido + hover accent). */
export const financeOutlineBtnClass = financeOutlineColors;

/** Labels «ficheiro» / «câmara» com a mesma aparência de botão outline. */
export const financeOutlineLabelBtnClass =
  `${financeOutlineColors} inline-flex h-8 cursor-pointer items-center rounded-md px-2.5 text-xs font-medium`;

/** Label de anexo um pouco maior (agente financeiro). */
export const financeOutlineLabelBtnMdClass =
  `${financeOutlineColors} inline-flex cursor-pointer items-center rounded-md px-3 py-2 text-sm font-medium`;
