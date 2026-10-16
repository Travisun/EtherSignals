"use client";

import { useEffect, useRef } from "react";

/**
 * iOS-style drag-to-dismiss for bottom sheets. Touch-only (desktop keeps
 * click interactions untouched): dragging the sheet down follows the finger,
 * releasing past ~110px (or a fast flick) dismisses, otherwise the sheet
 * springs back. Attach the returned ref to the sheet panel element.
 */
export function useDragToDismiss(onClose: () => void, enabled = true) {
  const ref = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let startY = 0;
    let deltaY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let dragging = false;

    const onStart = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      startY = e.clientY;
      lastY = e.clientY;
      lastT = performance.now();
      velocity = 0;
      dragging = true;
      // Take over from the entry animation while dragging.
      el.style.transition = "none";
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      deltaY = Math.max(0, e.clientY - startY);
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      velocity = (e.clientY - lastY) / dt; // px per ms
      lastY = e.clientY;
      lastT = now;
      // Rubber-band resistance past the start.
      el.style.transform = `translateY(${deltaY ** 0.9}px)`;
    };

    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      el.style.transition = "transform .35s cubic-bezier(0.32, 0.72, 0, 1)";
      if (deltaY > 110 || (velocity > 0.55 && deltaY > 24)) {
        el.style.transform = `translateY(${el.offsetHeight}px)`;
        window.setTimeout(() => onCloseRef.current(), 180);
      } else {
        el.style.transform = "translateY(0px)";
        window.setTimeout(() => {
          el.style.transition = "";
          el.style.transform = "";
        }, 380);
      }
      deltaY = 0;
      velocity = 0;
    };

    el.addEventListener("pointerdown", onStart);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      el.removeEventListener("pointerdown", onStart);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [enabled]);

  return ref;
}
