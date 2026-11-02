"use client";

import { useEffect, useRef, useState } from "react";

export const KW = 1280;
export const KH = 800;

/** Fills the viewport with the 1280×800 kiosk canvas, scaled to fit (a 10-inch landscape panel). */
export function FitStage({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState(1);
  useEffect(() => {
    const on = () => setS(Math.min(window.innerWidth / KW, window.innerHeight / KH));
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return (
    <div className="fixed inset-0 flex select-none items-center justify-center overflow-hidden bg-[#0b0c0f]" onContextMenu={(e) => e.preventDefault()}>
      <div style={{ width: KW * s, height: KH * s }} className="relative overflow-hidden bg-white">
        <div style={{ width: KW, height: KH, transform: `scale(${s})`, transformOrigin: "top left" }} className="absolute left-0 top-0">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Scales a 1280×800 kiosk screen to the width of its parent (used by the gallery and demo). */
export function Scaled({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [s, setS] = useState(0.4);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setS(e.contentRect.width / KW));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={`relative w-full overflow-hidden ${className}`} style={{ height: KH * s }}>
      <div style={{ width: KW, height: KH, transform: `scale(${s})`, transformOrigin: "top left" }} className="absolute left-0 top-0">
        {children}
      </div>
    </div>
  );
}
