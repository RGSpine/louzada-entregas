import { cn } from "@/lib/utils";

/** Sombra de profundidade sobre a foto — borda clara e queda escura, no máximo 2 camadas. */
export const landingPhotoSurfaceClass =
  "!shadow-[0_1px_0_rgba(255,255,255,0.55),0_10px_24px_rgba(12,18,34,0.46)]";

/** Texto sobre a foto — contraste com áreas claras e escuras da imagem. */
export const landingPhotoTypeClass =
  "[text-shadow:0_1px_0_rgba(255,255,255,0.62),0_2px_1px_rgba(12,18,34,0.45),0_8px_16px_rgba(12,18,34,0.4)]";

/** Área rolável de cada painel — mobile com scroll vertical. */
export const landingPanelScrollClass =
  "landing-panel-scroll landing-panel-scroll-mobile max-md:touch-pan-y max-md:overscroll-y-contain";

/** Padding e overflow do container interno do painel. */
export const landingPanelInnerClass = cn(
  landingPanelScrollClass,
  "!overflow-y-auto",
  "!pt-[calc(4.25rem+env(safe-area-inset-top,0px))]",
  "!pb-[calc(9rem+env(safe-area-inset-bottom,0px))]",
  "!px-11",
  "flex min-h-0 w-full min-w-0 flex-1 flex-col",
);

/** Conteúdo do painel — largura total do slide; altura natural no mobile para scroll. */
export const landingPanelContentClass =
  "landing-panel-content w-full min-w-0 max-md:shrink-0";

export const landingPanelHeadingClass =
  "mb-2 text-center text-2xl font-bold tracking-tight text-foreground md:mb-3 md:text-4xl " +
  landingPhotoTypeClass;

/** Azul accent + profundidade tipográfica — claro e escuro (todos os breakpoints). */
export const landingPanelMobileLeadAccentClass =
  "font-bold text-[color:var(--primary-light)] leading-snug [text-shadow:0_1px_0_rgb(255_255_255/0.92),0_2px_10px_rgb(0_0_143/0.22),0_1px_2px_rgb(0_0_143/0.35)] dark:[text-shadow:0_1px_3px_rgb(0_0_0/0.5),0_0_16px_rgb(185_186_255/0.4),0_1px_0_rgb(255_255_255/0.12)]";

/** Subtítulo de painel — azul accent com profundidade (mobile e desktop). */
export const landingPanelLeadClass = cn(
  "mx-auto mb-5 max-w-2xl text-center text-sm md:mb-8 md:text-lg md:leading-relaxed",
  landingPanelMobileLeadAccentClass,
);

/** Texto descritivo dentro de cards — azul accent com profundidade (mobile e desktop). */
export const landingPanelCardTextClass = cn(
  "mt-2 text-sm leading-snug md:mt-2 md:text-base md:leading-relaxed",
  landingPanelMobileLeadAccentClass,
);

/** Card com interior claro (tema light) quando a página está no dark mode. */
export const landingPanelCardLightInDarkShellClass =
  "dark:bg-white dark:border-[#e2e8f0] " + landingPhotoSurfaceClass;

/** Shell — cards Antes/Depois: light → azul do subtítulo; dark → card branco. */
export const landingPanelAntesDepoisCardShellClass = cn(
  "border-[color:var(--primary-light)] bg-[color:var(--primary-light)]",
  landingPhotoSurfaceClass,
  landingPanelCardLightInDarkShellClass,
);

/** Rótulo — card Antes: branco no light / cinza no dark. */
export const landingPanelAntesCardLabelClass = cn(
  "text-sm font-semibold uppercase tracking-wide text-white [text-shadow:none] md:text-xl",
  "dark:text-[#64748b] dark:[text-shadow:none]",
);

/** Lista — card Antes: branco no light / cinza no dark. */
export const landingPanelAntesCardMutedTextClass = cn(
  "text-sm leading-snug text-white [text-shadow:none] md:text-lg md:leading-relaxed",
  "dark:font-normal dark:text-[#64748b] dark:[text-shadow:none]",
);

/** Rótulo e lista — card Depois: branco no light / azul no dark. */
export const landingPanelDepoisCardAccentLabelClass = cn(
  "text-sm font-semibold uppercase tracking-wide font-bold text-white [text-shadow:none] md:text-xl",
  "dark:text-[#2563eb] dark:[text-shadow:none]",
);

export const landingPanelDepoisCardAccentListTextClass = cn(
  "text-sm leading-snug font-bold text-white [text-shadow:none] md:text-lg md:leading-relaxed",
  "dark:text-[#2563eb] dark:[text-shadow:none]",
);

export const landingPanelCardLightInDarkTitleClass =
  "text-base font-bold text-foreground dark:text-[#0f172a] md:text-xl";

/** Texto do card claro-in-dark — azul nítido no interior branco (sem glow). */
export const landingPanelCardLightInDarkTextClass = cn(
  landingPanelCardTextClass,
  "dark:font-bold dark:text-[#2563eb] dark:[text-shadow:none]",
  "md:dark:font-bold md:dark:text-[#2563eb] md:dark:[text-shadow:none]",
);

/** Rótulo accent dentro de card claro-in-dark (ex.: "Com a Louzada Entregas"). */
export const landingPanelCardLightInDarkAccentLabelClass = cn(
  "text-sm font-semibold uppercase tracking-wide font-bold text-[color:var(--primary-light)] [text-shadow:none]",
  "dark:text-[#2563eb] dark:[text-shadow:none]",
);

/** Item de lista accent dentro de card claro-in-dark — azul nítido, sem glow. */
export const landingPanelCardLightInDarkAccentListTextClass = cn(
  "text-sm leading-snug font-bold text-[color:var(--primary-light)] [text-shadow:none]",
  "dark:text-[#2563eb] dark:[text-shadow:none]",
);

/** Texto cinza dentro de card claro-in-dark (ex.: lista "Antes"). */
export const landingPanelCardLightInDarkMutedTextClass = cn(
  "text-sm leading-snug text-muted-foreground",
  "dark:font-normal dark:text-[#64748b] dark:[text-shadow:none]",
  "md:dark:font-normal md:dark:text-[#64748b] md:dark:[text-shadow:none]",
);

/** Subtítulo do hero (painel 1) — mobile accent; desktop compacto para caber em h-dvh. */
export const landingHeroPanelSubheadlineClass = cn(
  landingPanelLeadClass,
  "mb-0 text-sm leading-snug max-md:text-justify sm:text-base",
  "max-md:dark:font-bold max-md:dark:!text-white max-md:dark:![text-shadow:0_1px_0_rgb(255_255_255/0.15),0_1px_3px_rgb(0_0_0/0.5),0_2px_10px_rgb(0_0_0/0.28)]",
  "md:mx-auto md:mb-4 md:max-w-xl md:font-medium md:!text-foreground/88 md:text-[0.9375rem] md:leading-snug md:text-center md:![text-shadow:0_1px_0_rgb(255_255_255/0.85)]",
  "md:dark:!text-foreground/92 md:dark:![text-shadow:0_1px_2px_rgb(0_0_0/0.35)] lg:mb-5 lg:max-w-2xl lg:text-base lg:leading-relaxed",
);

/** Layout do painel hero — mobile distribui na altura; desktop preenche o slide. */
export const landingHeroPanelSectionClass =
  "flex w-full min-w-0 flex-1 flex-col min-h-0";

/** Mobile: distribui na altura útil acima dos dots; desktop: fluxo normal. */
export const landingHeroPanelInnerClass =
  "max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col max-md:justify-evenly max-md:gap-2 max-md:py-0";

/** Painéis com conteúdo alto (benefícios, FAQ) — scroll vertical no desktop para não cortar. */
export const landingPanelTallDesktopInnerClass =
  "md:!overflow-y-auto md:!justify-start md:!pt-[calc(4.5rem+env(safe-area-inset-top,0px))] md:!pb-[calc(3.25rem+env(safe-area-inset-bottom,0px))]";

/** Layout compacto — painel Benefícios (mockup + título). */
export const landingBeneficiosPanelLayoutClass =
  "container mx-auto flex w-full max-w-4xl shrink-0 flex-col items-center py-1 md:py-2";

export const landingBeneficiosPanelHeadingClass = cn(landingPanelHeadingClass, "mb-1 md:mb-1.5");

export const landingBeneficiosPanelLeadClass = cn(
  landingPanelLeadClass,
  "mb-3 max-w-sm md:mb-4 md:max-w-xl md:text-base md:leading-snug lg:max-w-2xl",
);

/** Layout compacto — painel FAQ. */
export const landingFaqPanelLayoutClass = "container mx-auto w-full max-w-3xl shrink-0 py-1 md:py-2";

export const landingFaqPanelHeadingClass = cn(landingPanelHeadingClass, "mb-3 md:mb-4");

export const landingFaqPanelListClass = "space-y-1.5 md:space-y-2";

/** Links de navegação do header — claro: azul accent; escuro: branco com profundidade. */
export const landingHeaderNavLinkClass = cn(
  landingPanelMobileLeadAccentClass,
  "font-semibold transition-opacity hover:opacity-85",
  "dark:font-bold dark:!text-white dark:![text-shadow:0_1px_0_rgb(255_255_255/0.15),0_1px_3px_rgb(0_0_0/0.5),0_2px_10px_rgb(0_0_0/0.28)]",
);

/** Painel Antes (4) — título, subtítulo e card com o mesmo ritmo. */
export const landingAntesPanelLayoutClass =
  "container mx-auto flex w-full max-w-lg shrink-0 flex-col gap-3 md:w-[min(70vw,52rem)] md:max-w-none md:gap-[0.75cm]";

export const landingAntesPanelHeadingClass = cn(
  landingPanelHeadingClass,
  "mb-0 text-balance leading-tight",
);

export const landingAntesPanelLeadClass = cn(
  landingPanelLeadClass,
  "mb-0 max-w-none text-balance leading-snug text-[#2563eb]",
  "![text-shadow:none] dark:text-[#2563eb] dark:![text-shadow:none]",
);

/** Card branco do texto de apoio — painéis Antes e Depois. */
export const landingAntesLeadCardClass =
  "mx-auto mt-[1.5cm] w-full max-w-md rounded-xl border border-[#e2e8f0] bg-white px-5 py-4 text-center md:max-w-xl md:px-8 md:py-5 " +
  landingPhotoSurfaceClass;

/** Card Antes/Depois — um único respiro no topo, sem o py do card somado ao pt do conteúdo. */
export const landingAntesDepoisCardContentClass = "px-5 py-0 md:px-10";

/** Painel Depois (5) — mais espaço título→subtítulo; subtítulo→card inalterado. */
export const landingDepoisPanelHeadingBlockClass =
  "max-md:-mb-6 md:-mb-4";

export const landingDepoisPanelHeadingClass = cn(
  landingPanelHeadingClass,
  "mb-0 max-md:pb-6 md:pb-4",
);

export const landingDepoisPanelLeadClass = cn(landingPanelLeadClass, "mb-5 max-md:mb-5 md:mb-8");

/** Layout com card centralizado abaixo do título (mobile) — painel Depois. */
export const landingPanelCardBelowHeadingLayoutClass =
  "flex min-h-[calc(100dvh-14rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] flex-col md:min-h-0";
export const landingMobileNavButtonClass =
  "pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/80 bg-background/90 text-primary backdrop-blur-md dark:border-white/15 dark:bg-card/90 dark:text-white " +
  landingPhotoSurfaceClass;

/** FAQ — card branco no dark; resposta em azul accent (claro e escuro). */
export const landingFaqItemShellClass = cn(
  "group rounded-xl border border-border bg-muted px-4 py-3",
  "dark:bg-white dark:border-[#e2e8f0]",
  landingPhotoSurfaceClass,
);

export const landingFaqQuestionClass = cn(
  "cursor-pointer list-none font-semibold text-foreground outline-none marker:content-none [&::-webkit-details-marker]:hidden",
  "dark:text-[#0f172a]",
);

export const landingFaqChevronClass =
  "text-muted-foreground transition group-open:rotate-180 dark:text-[#64748b]";

export const landingFaqAnswerClass = cn(
  "mt-3 border-t border-border pt-3 text-sm leading-relaxed",
  landingPanelMobileLeadAccentClass,
  "dark:border-[#e2e8f0] dark:font-bold dark:text-[#2563eb] dark:[text-shadow:none]",
);

/** Contorno dos mockups de dispositivo — claro: azul escuro; escuro: branco. */
export const landingDeviceMockupBorderClass =
  "border-[color:var(--primary-dark)] dark:border-white";

/** Detalhes metálicos dos mockups (botões laterais, dobradiça). */
export const landingDeviceMockupAccentDetailClass =
  "bg-[color:var(--primary-dark)] dark:bg-white/85";
