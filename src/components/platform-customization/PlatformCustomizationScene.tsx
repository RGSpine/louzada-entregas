"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import { clinicalPanelTransition } from "@/design/motion-presets";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";
import { PLATFORM_CUSTOMIZATION_BG } from "@/components/platform-customization/platform-customization-scenes";

type Props = {
  children: ReactNode;
  header?: ReactNode;
  className?: string;
  contentClassName?: string;
};

function PlatformCustomizationBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <picture className="block h-full w-full">
        <source
          media="(max-width: 767px)"
          srcSet={PLATFORM_CUSTOMIZATION_BG.mobile}
        />
        <img
          src={PLATFORM_CUSTOMIZATION_BG.desktop}
          alt=""
          className="h-full w-full object-cover object-center"
          decoding="async"
        />
      </picture>
      <div className="absolute inset-0 bg-gradient-to-b from-background/15 via-transparent to-background/35 dark:from-background/25 dark:to-background/50" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.08)_100%)] dark:bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.22)_100%)]" />
    </div>
  );
}

function PlatformCustomizationBrandMark() {
  return (
    <div
      className="pointer-events-none absolute bottom-4 right-4 z-20 safe-area-pb safe-area-pr sm:bottom-5 sm:right-5"
      aria-hidden
    >
      <Image
        src="/logo-light.png"
        alt=""
        width={258}
        height={168}
        className="h-7 w-auto object-contain drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)] sm:h-8"
        unoptimized
      />
    </div>
  );
}

export function PlatformCustomizationScene({
  children,
  header,
  className,
  contentClassName,
}: Props) {
  const reduced = useReducedMotion();

  return (
    <div className={cn("relative flex min-h-full flex-1 flex-col", className)}>
      <PlatformCustomizationBackground />
      <PlatformCustomizationBrandMark />

      {header ? <div className="relative z-10 shrink-0">{header}</div> : null}

      <motion.div
        className={cn("relative z-10 flex flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8", contentClassName)}
        initial={reduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={clinicalPanelTransition}
      >
        {children}
      </motion.div>
    </div>
  );
}
