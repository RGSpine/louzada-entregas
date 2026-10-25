"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { InstallTutorialCard } from "@/components/install-app/InstallTutorialCard";
import { landingMobileNavButtonClass } from "@/components/landing/landing-panel-styles";
import type { InstallTutorialDef } from "@/lib/app-install-tutorials";
import { cn } from "@/lib/utils";

type Props = {
  tutorials: readonly InstallTutorialDef[];
};

export function InstallTutorialsMobileCarousel({ tutorials }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const updateActiveIndex = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth <= 0) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    setActiveIndex(Math.min(Math.max(index, 0), tutorials.length - 1));
  }, [tutorials.length]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const clamped = Math.min(Math.max(index, 0), tutorials.length - 1);
      el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
      setActiveIndex(clamped);
    },
    [tutorials.length],
  );

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
  }, [updateActiveIndex, tutorials.length]);

  if (tutorials.length === 0) return null;

  return (
    <div className="md:hidden">
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          className={cn(landingMobileNavButtonClass, "self-center")}
          disabled={activeIndex <= 0}
          aria-label="Tutorial anterior"
          onClick={() => scrollToIndex(activeIndex - 1)}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>

        <div
          ref={scrollRef}
          className="flex min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-roledescription="carrossel"
          aria-label="Tutoriais de instalação por dispositivo"
        >
          {tutorials.map((tutorial, index) => (
            <div
              key={tutorial.id}
              className="w-full shrink-0 snap-center"
              aria-hidden={index !== activeIndex}
            >
              <InstallTutorialCard tutorial={tutorial} />
            </div>
          ))}
        </div>

        <button
          type="button"
          className={cn(landingMobileNavButtonClass, "self-center")}
          disabled={activeIndex >= tutorials.length - 1}
          aria-label="Próximo tutorial"
          onClick={() => scrollToIndex(activeIndex + 1)}
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <p className="mt-3 text-center text-xs font-medium text-muted-foreground">
        Dispositivo {activeIndex + 1} de {tutorials.length}
      </p>
    </div>
  );
}
