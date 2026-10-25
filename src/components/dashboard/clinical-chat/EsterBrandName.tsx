"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  ESTER_AGENT_NAME,
  ESTER_TOOLTIP_BODY,
  ESTER_TOOLTIP_TITLE,
} from "@/lib/clinical-chat/ester-branding";

type EsterBrandNameProps = {
  className?: string;
  /** Use `span` quando o nome já estiver dentro de um `<button>` / `<a>`. */
  as?: "button" | "span";
};

type TooltipPlacement = "top" | "bottom";

type TooltipLayout = {
  top: number;
  left: number;
  width: number;
  arrowLeft: number;
  placement: TooltipPlacement;
};

const TOOLTIP_MAX_WIDTH = 320;
const VIEWPORT_PADDING = 16;
const GAP = 10;

function computeLayout(
  trigger: HTMLElement,
  tooltip: HTMLElement | null,
): TooltipLayout {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(window.innerWidth - VIEWPORT_PADDING * 2, TOOLTIP_MAX_WIDTH);
  const height = tooltip?.offsetHeight ?? 200;

  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const placement: TooltipPlacement =
    spaceBelow >= height + GAP + 12 || spaceBelow >= spaceAbove ? "bottom" : "top";

  const top =
    placement === "bottom"
      ? rect.bottom + GAP
      : Math.max(VIEWPORT_PADDING, rect.top - height - GAP);

  const triggerCenter = rect.left + rect.width / 2;
  const idealLeft = triggerCenter - width / 2;
  const left = Math.max(
    VIEWPORT_PADDING,
    Math.min(idealLeft, window.innerWidth - width - VIEWPORT_PADDING),
  );
  const arrowLeft = Math.max(18, Math.min(triggerCenter - left, width - 18));

  return { top, left, width, arrowLeft, placement };
}

export function EsterBrandName({ className, as = "button" }: EsterBrandNameProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [layout, setLayout] = useState<TooltipLayout | null>(null);
  const [ready, setReady] = useState(false);
  const triggerRef = useRef<HTMLElement>(null);
  const isSpan = as === "span";
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [canHover, setCanHover] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setCanHover(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    setLayout(computeLayout(trigger, tooltipRef.current));
  }, []);

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => {
    setOpen(false);
    setLayout(null);
    setReady(false);
  }, []);

  const toggle = useCallback(() => {
    if (open) hide();
    else show();
  }, [hide, open, show]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const raf = requestAnimationFrame(() => {
      measure();
      setReady(true);
    });
    return () => {
      cancelAnimationFrame(raf);
      setReady(false);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => measure();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open || canHover) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !tooltipRef.current?.contains(target)) {
        hide();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [canHover, hide, open]);

  const tooltip =
    open && mounted ? (
      <div
        ref={tooltipRef}
        id={tooltipId}
        role="tooltip"
        style={{
          top: layout?.top ?? -9999,
          left: layout?.left ?? 0,
          width: layout?.width ?? TOOLTIP_MAX_WIDTH,
          visibility: ready && layout ? "visible" : "hidden",
        }}
        className="fixed z-[300] box-border"
      >
        <div className="relative rounded-2xl border border-border bg-card px-4 py-3.5 shadow-[var(--shadow-elevation-3)]">
          {layout?.placement === "top" ? (
            <span
              aria-hidden
              className="pointer-events-none absolute -bottom-[7px] size-3.5 rotate-45 border-b border-r border-border bg-card"
              style={{ left: (layout?.arrowLeft ?? 24) - 7 }}
            />
          ) : (
            <span
              aria-hidden
              className="pointer-events-none absolute -top-[7px] size-3.5 rotate-45 border-l border-t border-border bg-card"
              style={{ left: (layout?.arrowLeft ?? 24) - 7 }}
            />
          )}

          <p className="text-sm font-semibold leading-snug text-foreground">{ESTER_TOOLTIP_TITLE}</p>
          <p className="mt-2.5 hyphens-auto break-words text-justify text-[0.8125rem] leading-relaxed text-muted-foreground [text-align-last:left]">
            {ESTER_TOOLTIP_BODY}
          </p>
        </div>
      </div>
    ) : null;

  const triggerClassName = cn(
    "cursor-help border-b border-dotted font-semibold transition-colors",
    "border-foreground/35 text-foreground hover:border-foreground/60 hover:text-foreground/90",
    "dark:border-primary/50 dark:text-primary dark:hover:border-primary/70 dark:hover:text-primary/90",
    "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
    className,
  );
  const describedBy = open && ready && layout ? tooltipId : undefined;

  return (
    <>
      {isSpan ? (
        <span
          ref={triggerRef as RefObject<HTMLSpanElement>}
          className={triggerClassName}
          aria-describedby={describedBy}
          onMouseEnter={canHover ? show : undefined}
          onMouseLeave={canHover ? hide : undefined}
        >
          {ESTER_AGENT_NAME}
        </span>
      ) : (
        <button
          ref={triggerRef as RefObject<HTMLButtonElement>}
          type="button"
          className={triggerClassName}
          aria-describedby={describedBy}
          aria-expanded={canHover ? undefined : open}
          onMouseEnter={canHover ? show : undefined}
          onMouseLeave={canHover ? hide : undefined}
          onFocus={canHover ? show : undefined}
          onBlur={canHover ? hide : undefined}
          onClick={canHover ? undefined : toggle}
        >
          {ESTER_AGENT_NAME}
        </button>
      )}
      {mounted && tooltip ? createPortal(tooltip, document.body) : null}
    </>
  );
}
