import type { PrinterState } from "./types";

/** Small, accurate illustration of the PrintBar kiosk (angled head, screen, slot, tray, door). */
export function MachineSVG({
  progress = 0,
  state = "ready",
  printing = false,
  height = 520,
}: {
  progress?: number;
  state?: PrinterState;
  printing?: boolean;
  height?: number;
}) {
  const p = Math.max(0, Math.min(1, progress));
  const paperH = printing || p > 0 ? 8 + 56 * p : 0;
  const led = state === "ready" ? (printing ? "#ffb020" : "#25d17b") : "#e5392f";
  return (
    <svg viewBox="0 0 210 470" height={height} style={{ height }} role="img" aria-label="PrintBar kiosk printing">
      <defs>
        <linearGradient id="mx-steel" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#b9bec5" />
          <stop offset="0.35" stopColor="#e6e9ed" />
          <stop offset="0.7" stopColor="#c3c8ce" />
          <stop offset="1" stopColor="#aab0b8" />
        </linearGradient>
        <linearGradient id="mx-head" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f1f3f5" />
          <stop offset="1" stopColor="#c9ced4" />
        </linearGradient>
        <linearGradient id="mx-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a2d33" />
          <stop offset="0.35" stopColor="#07080a" />
          <stop offset="1" stopColor="#15171b" />
        </linearGradient>
        <linearGradient id="mx-top" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#dfe2e6" />
          <stop offset="1" stopColor="#f5f6f8" />
        </linearGradient>
        <clipPath id="mx-paper-clip">
          <rect x="60" y="197" width="72" height="75" />
        </clipPath>
        <filter id="mx-shadow" x="-30%" y="-10%" width="160%" height="130%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#000" floodOpacity="0.22" />
        </filter>
      </defs>

      {/* floor shadow */}
      <ellipse cx="108" cy="452" rx="84" ry="9" fill="#000" opacity="0.14" />

      {/* right side glass panel */}
      <polygon points="152,52 182,36 182,426 152,440" fill="url(#mx-glass)" />
      <polygon points="156,60 160,58 160,380 156,384" fill="#fff" opacity="0.07" />
      {/* top face */}
      <polygon points="34,52 152,52 182,36 66,36" fill="url(#mx-top)" />

      {/* silver body */}
      <rect x="34" y="52" width="118" height="300" fill="url(#mx-steel)" />
      <rect x="34" y="52" width="118" height="122" fill="url(#mx-head)" />
      <rect x="34" y="172" width="118" height="1.5" fill="#fff" opacity="0.65" />
      <rect x="34" y="173.5" width="118" height="1" fill="#000" opacity="0.12" />
      <rect x="150" y="52" width="3" height="388" fill="#d9dde2" />

      {/* screen */}
      <rect x="45" y="64" width="96" height="70" rx="5" fill="#08090b" />
      <rect x="50" y="69" width="86" height="60" rx="2" fill="#fff" />
      <rect x="55" y="74" width="9" height="9" rx="2.5" fill="#101216" />
      <rect x="67" y="77" width="26" height="3.4" rx="1.7" fill="#101216" />
      <rect x="55" y="92" width="48" height="5" rx="2.5" fill="#101216" />
      <rect x="55" y="103" width="76" height="4.5" rx="2.2" fill="#e8eaee" />
      <rect x="55" y="103" width={76 * (printing ? p : 0.35)} height="4.5" rx="2.2" fill="#f2542d" />
      <rect x="55" y="113" width="34" height="3.6" rx="1.8" fill="#9aa0a9" />
      <rect x="55" y="120" width="26" height="3" rx="1.5" fill="#c3c7ce" />

      {/* logo */}
      <rect x="66" y="150" width="9" height="9" rx="2.5" fill="#101216" />
      <rect x="68" y="152.2" width="4" height="1.2" rx="0.6" fill="#e6e9ed" />
      <rect x="68" y="154.6" width="5.4" height="1.2" rx="0.6" fill="#e6e9ed" />
      <text x="80" y="158" fontSize="9.5" fontWeight="700" letterSpacing="1.4" fill="#101216" fontFamily="'Geist Variable', system-ui, sans-serif">
        PRINTBAR
      </text>

      {/* slot */}
      <rect x="52" y="185" width="84" height="15" rx="3" fill="#0d0e10" />
      <rect x="58" y="191" width="72" height="3" rx="1.5" fill="#000" />
      <circle cx="44" cy="192.5" r="2.2" fill={led} />

      {/* paper */}
      <g clipPath="url(#mx-paper-clip)">
        <g filter="url(#mx-shadow)">
          <rect x="66" y={193 - 60 + paperH} width="60" height="62" fill="#fdfdfc" rx="1.5" style={{ transition: "y 0.6s linear" }} />
        </g>
        <g opacity="0.55" style={{ transition: "transform 0.6s linear" }} transform={`translate(0 ${paperH - 60})`}>
          <rect x="72" y="200" width="30" height="2.6" rx="1.3" fill="#101216" />
          <rect x="72" y="207" width="48" height="1.8" rx="0.9" fill="#9aa0a9" />
          <rect x="72" y="212" width="44" height="1.8" rx="0.9" fill="#9aa0a9" />
          <rect x="72" y="217" width="48" height="1.8" rx="0.9" fill="#9aa0a9" />
          <rect x="72" y="222" width="36" height="1.8" rx="0.9" fill="#9aa0a9" />
          <rect x="72" y="229" width="48" height="1.8" rx="0.9" fill="#9aa0a9" />
          <rect x="72" y="234" width="40" height="1.8" rx="0.9" fill="#9aa0a9" />
        </g>
      </g>

      {/* acrylic tray */}
      <path d="M48 252 L144 252 L150 276 L42 276 Z" fill="#dff0f7" opacity="0.38" stroke="#fff" strokeOpacity="0.9" strokeWidth="1" />
      <rect x="42" y="268" width="108" height="8" rx="1.5" fill="#e8f4f9" opacity="0.55" stroke="#fff" strokeOpacity="0.9" strokeWidth="1" />
      <rect x="48" y="206" width="1.4" height="46" fill="#fff" opacity="0.5" />
      <rect x="138" y="206" width="1.4" height="46" fill="#fff" opacity="0.5" />

      {/* lower service cabinet */}
      <rect x="34" y="352" width="118" height="84" fill="#14151a" />
      <rect x="43" y="360" width="100" height="70" rx="2" fill="#1d1f25" stroke="#2c2f37" strokeWidth="0.8" />
      <rect x="80" y="358" width="26" height="3" rx="1" fill="#08090a" />
      <circle cx="131" cy="395" r="3.4" fill="#cfd3d8" />
      <rect x="130.4" y="393" width="1.2" height="4" fill="#555" />
      {[40, 140].map((x) => (
        <rect key={x} x={x} y="436" width="10" height="6" rx="2" fill="#09090a" />
      ))}
    </svg>
  );
}
