"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const KioskScene = dynamic(() => import("@/components/three/KioskScene"), { ssr: false });

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function HeroScene() {
  const [gl, setGl] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Defer the heavy 3D bundle until the browser is idle so text paints first.
    const start = () => setGl(hasWebGL());
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(start, { timeout: 800 });
    else setTimeout(start, 200);
  }, []);

  return (
    <div className="relative h-full w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/kiosk-fallback.jpg"
        alt="PrintBar kiosk with a printed A4 sheet emerging from the output slot into the collection tray"
        className={`absolute inset-0 h-full w-full object-contain mix-blend-multiply transition-opacity duration-700 ${
          ready ? "opacity-0" : "opacity-100"
        }`}
        style={{ maskImage: "radial-gradient(closest-side, #000 70%, transparent 100%)" }}
      />
      {gl && <KioskScene onReady={() => setTimeout(() => setReady(true), 250)} />}
    </div>
  );
}
