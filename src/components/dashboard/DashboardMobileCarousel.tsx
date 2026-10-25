"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type CarouselProps = {
  children: ReactNode;
  slideLabels: string[];
  className?: string;
  hint?: string;
  ariaLabel?: string;
  /** Grid no desktop — o carrossel horizontal só abaixo deste breakpoint. */
  desktopGridClassName?: string;
};

/**
 * Em viewports &lt; md: faixa horizontal com snap (swipe).
 * A partir de md: o container vira grid (classes passadas pelo pai).
 */
export function DashboardMobileCarousel({
  children,
  slideLabels,
  className,
  hint = "Deslize para ver mais →",
  ariaLabel = "Secções",
  desktopGridClassName = "md:mx-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:snap-none md:px-0 md:pb-0 xl:grid-cols-4 xl:items-stretch",
}: CarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const updateActiveIndex = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const items = Array.from(el.children) as HTMLElement[];
    if (items.length === 0) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    items.forEach((item, index) => {
      const itemCenter = item.offsetLeft + item.offsetWidth / 2;
      const dist = Math.abs(center - itemCenter);
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    });
    setActiveIndex(best);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateActiveIndex();
    el.addEventListener("scroll", updateActiveIndex, { passive: true });
    window.addEventListener("resize", updateActiveIndex);
    return () => {
      el.removeEventListener("scroll", updateActiveIndex);
      window.removeEventListener("resize", updateActiveIndex);
    };
  }, [updateActiveIndex, slideLabels.length]);

  function scrollToIndex(index: number) {
    const el = scrollRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  return (
    <div className={className}>
      <p className="mb-2 px-1 text-xs text-muted-foreground md:hidden">{hint}</p>
      <div
        ref={scrollRef}
        className={cn(
          "flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2",
          "-mx-4 scroll-pl-4 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          desktopGridClassName,
        )}
      >
        {children}
      </div>
      <div
        className="mt-2 flex justify-center gap-1.5 md:hidden"
        role="tablist"
        aria-label={ariaLabel}
      >
        {slideLabels.map((label, index) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            aria-label={label}
            className={cn(
              "h-1.5 rounded-full transition-all",
              index === activeIndex ? "w-5 bg-primary" : "w-1.5 bg-muted dark:bg-muted",
            )}
            onClick={() => scrollToIndex(index)}
          />
        ))}
      </div>
    </div>
  );
}

/** Envolve cada card no carrossel mobile; no desktop participa do grid. */
export function DashboardMobileCarouselSlide({
  children,
  className,
  fullWidthOnDesktop = false,
  fullWidthDesktopClassName = "md:col-span-2 xl:col-span-4",
  mobileMaxHeightClassName = "max-h-[min(72vh,520px)]",
}: {
  children: ReactNode;
  className?: string;
  fullWidthOnDesktop?: boolean;
  fullWidthDesktopClassName?: string;
  mobileMaxHeightClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 w-[min(88vw,360px)] shrink-0 snap-center flex-col overflow-y-auto",
        mobileMaxHeightClassName,
        "md:h-full md:max-h-none md:w-auto md:shrink md:snap-align-none md:overflow-visible",
        fullWidthOnDesktop && fullWidthDesktopClassName,
        className,
      )}
    >
      {children}
    </div>
  );
}
