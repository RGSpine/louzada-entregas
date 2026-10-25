"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { trackCtaClick } from "@/lib/analytics/ga";

type Props = ComponentProps<typeof Link> & {
  /** Identificador estável do CTA (ex.: hero_register, footer_trial). */
  placement: string;
};

/** Link de marketing que dispara `cta_click` quando Analytics está consentido. */
export function TrackedCtaLink({ placement, href, onClick, ...rest }: Props) {
  return (
    <Link
      href={href}
      {...rest}
      onClick={(e) => {
        trackCtaClick(placement, typeof href === "string" ? href : href.toString());
        onClick?.(e);
      }}
    />
  );
}
