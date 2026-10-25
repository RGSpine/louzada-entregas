import { cn } from "@/lib/utils";
import {
  ESTER_AGENT_NAME,
  ESTER_CHAT_HEADER_SUBTITLE,
  ESTER_FEATURE_SUBTITLE,
} from "@/lib/clinical-chat/ester-branding";
import { EsterBrandName } from "@/components/dashboard/clinical-chat/EsterBrandName";

type EsterFeatureTitleProps = {
  className?: string;
  nameClassName?: string;
  subtitleClassName?: string;
  /** `feature` = card/navegação; `chat` = cabeçalho com conversa aberta */
  variant?: "feature" | "chat";
};

export function EsterFeatureTitle({
  className,
  nameClassName,
  subtitleClassName,
  variant = "chat",
}: EsterFeatureTitleProps) {
  const subtitle =
    variant === "feature" ? ESTER_FEATURE_SUBTITLE : ESTER_CHAT_HEADER_SUBTITLE;

  const isFeature = variant === "feature";

  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-1", className)}>
      <EsterBrandName
        className={cn(
          isFeature
            ? // Menu Principal / nav: nome preto (claro) e branco (escuro), alinhado aos outros cards
              "border-foreground/35 text-foreground hover:border-foreground/60 hover:text-foreground/90 dark:border-foreground/40 dark:text-foreground dark:hover:border-foreground/60 dark:hover:text-foreground/90"
            : "border-foreground/35 text-foreground dark:border-primary/50 dark:text-primary",
          nameClassName,
        )}
      />
      <span
        className={cn(
          isFeature
            ? "font-bold leading-snug text-foreground"
            : "text-base font-normal text-muted-foreground",
          subtitleClassName,
        )}
      >
        — {subtitle}
      </span>
    </span>
  );
}
