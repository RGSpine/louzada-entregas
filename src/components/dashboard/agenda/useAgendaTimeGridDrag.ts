"use client";

import { useCallback, useRef, useState } from "react";
import {
  appointmentAllowsGridDrag,
  computeRescheduleFromDrag,
} from "@/lib/agenda/grid-drag";

const DRAG_THRESHOLD_PX = 6;

type Args = {
  appointmentId: string;
  startAt: Date | string | undefined;
  endAt: Date | string | undefined;
  status: string | undefined;
  timeZone: string;
  onReschedule: (input: {
    appointmentId: string;
    startAt: Date;
    endAt: Date;
  }) => Promise<boolean>;
};

export function useAgendaTimeGridDrag({
  appointmentId,
  startAt,
  endAt,
  status,
  timeZone,
  onReschedule,
}: Args) {
  const [dragging, setDragging] = useState(false);
  const pointerIdRef = useRef<number | null>(null);
  const originRef = useRef({ x: 0, y: 0 });
  const deltaRef = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const shellRef = useRef<HTMLElement | null>(null);

  const draggable = appointmentAllowsGridDrag(status) && startAt && endAt;

  const resetShellTransform = useCallback(() => {
    const shell = shellRef.current?.closest(".sx__time-grid-event") as HTMLElement | null;
    if (shell) {
      shell.style.transform = "";
      shell.style.zIndex = "";
      shell.style.pointerEvents = "";
    }
  }, []);

  const applyShellTransform = useCallback((dx: number, dy: number) => {
    const shell = shellRef.current?.closest(".sx__time-grid-event") as HTMLElement | null;
    if (!shell) return;
    shell.style.transform = `translate(${dx}px, ${dy}px)`;
    shell.style.zIndex = "40";
  }, []);

  const finishDrag = useCallback(async () => {
    const shell = shellRef.current;
    if (!shell || !startAt || !endAt) {
      resetShellTransform();
      return;
    }

    const dayColumn = shell.closest(".sx__time-grid-day") as HTMLElement | null;
    if (!dayColumn) {
      resetShellTransform();
      return;
    }

    const { x: dx, y: dy } = deltaRef.current;
    resetShellTransform();

    if (!movedRef.current) return;

    const startDate = startAt instanceof Date ? startAt : new Date(startAt);
    const endDate = endAt instanceof Date ? endAt : new Date(endAt);

    const next = computeRescheduleFromDrag(
      startDate,
      endDate,
      timeZone,
      dx,
      dy,
      dayColumn.clientWidth,
      dayColumn.clientHeight,
    );

    if (next.minutesDelta === 0 && next.dayColumnDelta === 0) return;

    await onReschedule({
      appointmentId,
      startAt: next.startAtUtc,
      endAt: next.endAtUtc,
    });
  }, [appointmentId, endAt, onReschedule, resetShellTransform, startAt, timeZone]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggable || e.button !== 0) return;
      pointerIdRef.current = e.pointerId;
      originRef.current = { x: e.clientX, y: e.clientY };
      deltaRef.current = { x: 0, y: 0 };
      movedRef.current = false;
      shellRef.current = e.currentTarget;
    },
    [draggable],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current !== e.pointerId || !draggable) return;

      const dx = e.clientX - originRef.current.x;
      const dy = e.clientY - originRef.current.y;

      if (!movedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

      if (!movedRef.current) {
        movedRef.current = true;
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
        e.stopPropagation();
        e.preventDefault();
      }

      deltaRef.current = { x: dx, y: dy };
      applyShellTransform(dx, dy);
    },
    [applyShellTransform, draggable],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current !== e.pointerId) return;
      pointerIdRef.current = null;

      if (movedRef.current) {
        suppressClickRef.current = true;
        e.stopPropagation();
        e.preventDefault();
        void finishDrag();
      }

      setDragging(false);
      movedRef.current = false;
      deltaRef.current = { x: 0, y: 0 };

      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* já liberado */
      }
    },
    [finishDrag],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current !== e.pointerId) return;
      pointerIdRef.current = null;
      movedRef.current = false;
      setDragging(false);
      resetShellTransform();
    },
    [resetShellTransform],
  );

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }, []);

  return {
    draggable,
    dragging,
    shellRef,
    pointerHandlers: draggable
      ? {
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel,
          onClickCapture,
        }
      : {},
  };
}
