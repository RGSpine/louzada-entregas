"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { clinicalCtaPillVariants } from "@/design/motion-presets";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

type Props = {
  href: string;
  className?: string;
};

export function PlanWhiteLabelHook({ href, className }: Props) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className={cn("mx-auto w-full max-w-2xl", className)}
      variants={reduced ? undefined : clinicalCtaPillVariants}
      initial="idle"
      animate={reduced ? "idle" : "pulse"}
      whileTap={reduced ? undefined : "tap"}
    >
      <Link
        href={href}
        className={cn(
          "flex min-h-[3.25rem] w-full items-center justify-center rounded-full px-6 py-3.5 text-center text-sm font-medium shadow-lg ring-4 transition-colors sm:text-base",
          "bg-primary text-primary-foreground ring-primary/25 hover:bg-primary/90 hover:ring-primary/35",
          "dark:bg-white dark:text-[#00008f] dark:ring-white/15 dark:hover:bg-white/95 dark:hover:ring-white/25",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        <span>
          Quer criar a plataforma com a sua cara e funções?{" "}
          <span className="font-semibold">Clique aqui!</span>
        </span>
      </Link>
    </motion.div>
  );
}
