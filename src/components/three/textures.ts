import * as THREE from "three";

/* ---------- Animation timeline (shared by screen, paper and camera) ---------- */

export const LOOP = 14;
export const PAPER_MAX = 0.27; // metres of the A4 sheet that leave the slot

export type SceneName = "idle" | "pin" | "accepted" | "printing" | "done";
export type Frame = {
  scene: SceneName;
  pinDigits: number;
  progress: number;
  emerged: number;
  settle: number;
  taken: number;
};

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

export function timeline(tt: number): Frame {
  const t = ((tt % LOOP) + LOOP) % LOOP;
  const f: Frame = { scene: "idle", pinDigits: 0, progress: 0, emerged: 0, settle: 0, taken: 0 };
  if (t >= 1.5 && t < 3.2) {
    f.scene = "pin";
    f.pinDigits = clamp(Math.floor((t - 1.8) / 0.4) + 1, 0, 4);
  } else if (t >= 3.2 && t < 3.7) {
    f.scene = "accepted";
    f.pinDigits = 4;
  } else if (t >= 3.7 && t < 8.7) {
    f.scene = "printing";
    const p = (t - 3.7) / 5;
    f.progress = p;
    f.emerged = PAPER_MAX * clamp(p + Math.sin(p * 70) * 0.012);
  } else if (t >= 8.7 && t < 12.4) {
    f.scene = "done";
    f.progress = 1;
    f.emerged = PAPER_MAX;
    f.settle = clamp((t - 8.7) / 1.2);
    f.taken = clamp((t - 11.7) / 0.7);
  }
  if (t >= 11.7 && t < 12.5 && f.scene !== "done") {
    f.emerged = PAPER_MAX;
    f.taken = clamp((t - 11.7) / 0.7);
  }
  return f;
}

/* ---------- Canvas helpers ---------- */

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function tex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Brushed stainless steel grain (used as bump + roughness variation). */
export function makeBrushed() {
  const c = canvas(512, 512);
  const g = c.getContext("2d")!;
  g.fillStyle = "#8a8a8a";
  g.fillRect(0, 0, 512, 512);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 5200; i++) {
    const x = rnd() * 512;
    const y = rnd() * 512;
    const len = 30 + rnd() * 240;
    const v = Math.floor(90 + rnd() * 110);
    g.strokeStyle = `rgba(${v},${v},${v},${0.1 + rnd() * 0.25})`;
    g.lineWidth = 0.5 + rnd() * 1.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y + len);
    g.stroke();
  }
  const t = tex(c, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(9, 3);
  return t;
}

export function makeLogoTexture() {
  const c = canvas(768, 160);
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 768, 160);
  g.fillStyle = "#14161a";
  // mark: rounded square with notch (document + bar)
  g.beginPath();
  g.roundRect(70, 28, 104, 104, 22);
  g.fill();
  g.fillStyle = "#c9ccd0";
  g.beginPath();
  g.roundRect(94, 50, 40, 12, 4);
  g.roundRect(94, 74, 56, 12, 4);
  g.roundRect(94, 98, 28, 12, 4);
  g.fill();
  g.fillStyle = "#14161a";
  g.font = "700 96px 'Geist Variable', system-ui, sans-serif";
  g.textBaseline = "middle";
  (g as unknown as { letterSpacing: string }).letterSpacing = "8px";
  g.fillText("PRINTBAR", 204, 84);
  return tex(c);
}

/** A printed A4 page: Semester_Notes sample. */
export function makePaperTexture() {
  const W = 595;
  const H = 842;
  const c = canvas(W, H);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fdfdfc";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#15171b";
  g.font = "700 30px 'Geist Variable', system-ui, sans-serif";
  g.fillText("Semester Notes", 48, 78);
  g.fillStyle = "#6b6f78";
  g.font = "500 13px 'Geist Variable', system-ui, sans-serif";
  g.fillText("MODULE 04 · DATA STRUCTURES · PAGE 1 OF 30", 48, 104);
  g.fillStyle = "#15171b";
  g.fillRect(48, 118, 500, 1.5);
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const para = (y: number, lines: number) => {
    for (let i = 0; i < lines; i++) {
      const w = i === lines - 1 ? 180 + rnd() * 160 : 470 + rnd() * 30;
      g.fillStyle = "#2a2d33";
      let x = 48;
      while (x < 48 + w) {
        const ww = 14 + rnd() * 38;
        g.fillRect(x, y + i * 17, Math.min(ww, 48 + w - x), 5.5);
        x += ww + 6;
      }
    }
    return y + lines * 17 + 18;
  };
  let y = 150;
  g.fillStyle = "#15171b";
  g.font = "700 18px 'Geist Variable', system-ui, sans-serif";
  g.fillText("1. Linked lists", 48, y);
  y = para(y + 22, 5);
  // diagram
  g.strokeStyle = "#15171b";
  g.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    g.strokeRect(70 + i * 118, y + 6, 80, 40);
    g.fillStyle = "#15171b";
    g.fillRect(70 + i * 118 + 54, y + 6, 2, 40);
    if (i < 3) {
      g.beginPath();
      g.moveTo(70 + i * 118 + 68, y + 26);
      g.lineTo(70 + (i + 1) * 118, y + 26);
      g.stroke();
    }
  }
  y += 78;
  g.font = "700 18px 'Geist Variable', system-ui, sans-serif";
  g.fillStyle = "#15171b";
  g.fillText("2. Stacks and queues", 48, y);
  y = para(y + 22, 6);
  g.fillText("3. Trees", 48, y);
  y = para(y + 22, 7);
  para(y, 5);
  g.fillStyle = "#8a8e96";
  g.font = "500 11px 'Geist Variable', system-ui, sans-serif";
  g.fillText("Semester_Notes.pdf", 48, H - 34);
  const t = tex(c);
  return t;
}

/* ---------- Kiosk touchscreen painter ---------- */

const INK = "#0f1217";
const MUTE = "#6b717c";
const ACCENT = "#f2542d";
const GREEN = "#14925f";
const FONT = "'Geist Variable', system-ui, -apple-system, sans-serif";

export class ScreenPainter {
  canvas = canvas(768, 480);
  texture: THREE.CanvasTexture;
  private key = "";
  reset() {
    this.key = "";
  }
  constructor() {
    this.texture = tex(this.canvas);
    this.texture.anisotropy = 8;
    this.paint(timeline(0));
  }

  paint(f: Frame) {
    const key = `${f.scene}|${f.pinDigits}|${Math.round(f.progress * 30)}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.canvas.getContext("2d")!;
    const W = 768;
    const H = 480;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, W, H);

    // header
    g.fillStyle = INK;
    g.beginPath();
    g.roundRect(28, 24, 34, 34, 9);
    g.fill();
    g.fillStyle = "#fff";
    g.fillRect(36, 33, 12, 4);
    g.fillRect(36, 41, 18, 4);
    g.fillRect(36, 49, 8, 4);
    g.fillStyle = INK;
    g.font = `700 24px ${FONT}`;
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillText("PrintBar", 74, 42);
    g.fillStyle = GREEN;
    g.beginPath();
    g.arc(W - 160, 42, 6, 0, 7);
    g.fill();
    g.fillStyle = MUTE;
    g.font = `600 16px ${FONT}`;
    g.fillText("Printer ready", W - 146, 43);
    g.fillStyle = "#eceae4";
    g.fillRect(28, 78, W - 56, 2);

    g.textAlign = "left";
    if (f.scene === "idle") this.idle(g, W, H);
    else if (f.scene === "pin") this.pin(g, W, H, f.pinDigits);
    else if (f.scene === "accepted") this.accepted(g, W, H);
    else if (f.scene === "printing") this.printing(g, W, H, f.progress);
    else this.done(g, W, H);
    this.texture.needsUpdate = true;
  }

  private btn(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string) {
    g.fillStyle = INK;
    g.beginPath();
    g.roundRect(x, y, w, h, 16);
    g.fill();
    g.fillStyle = "#fff";
    g.font = `700 26px ${FONT}`;
    g.textAlign = "center";
    g.fillText(label, x + w / 2, y + h / 2 + 1);
    g.textAlign = "left";
  }

  private idle(g: CanvasRenderingContext2D, W: number, H: number) {
    g.fillStyle = MUTE;
    g.font = `600 17px ${FONT}`;
    g.fillText("SELF-SERVICE PRINTING", 40, 150);
    g.fillStyle = INK;
    g.font = `700 56px ${FONT}`;
    g.fillText("Welcome to", 40, 212);
    g.fillText("PrintBar", 40, 274);
    g.fillStyle = MUTE;
    g.font = `500 21px ${FONT}`;
    g.fillText("Already paid online? Enter your", 40, 322);
    g.fillText("collection PIN.", 40, 350);
    this.btn(g, 40, 376, 300, 72, "Start Printing");
    // QR concept
    const qx = W - 250;
    const qy = 120;
    g.fillStyle = "#f6f4ef";
    g.beginPath();
    g.roundRect(qx - 18, qy - 18, 236, 300, 24);
    g.fill();
    let s = 5;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const n = 21;
    const cell = 200 / n;
    g.fillStyle = INK;
    const finder = (cx: number, cy: number) => {
      g.fillRect(qx + cx * cell, qy + cy * cell, 7 * cell, 7 * cell);
      g.fillStyle = "#f6f4ef";
      g.fillRect(qx + (cx + 1) * cell, qy + (cy + 1) * cell, 5 * cell, 5 * cell);
      g.fillStyle = INK;
      g.fillRect(qx + (cx + 2) * cell, qy + (cy + 2) * cell, 3 * cell, 3 * cell);
    };
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const inF = (i < 8 && j < 8) || (i > n - 9 && j < 8) || (i < 8 && j > n - 9);
        if (!inF && rnd() > 0.5) g.fillRect(qx + i * cell, qy + j * cell, cell + 0.4, cell + 0.4);
      }
    finder(0, 0);
    finder(n - 7, 0);
    finder(0, n - 7);
    g.fillStyle = INK;
    g.font = `700 19px ${FONT}`;
    g.textAlign = "center";
    g.fillText("Scan to upload", qx + 100, qy + 236);
    g.fillStyle = MUTE;
    g.font = `500 15px ${FONT}`;
    g.fillText("B&W ₹2 · Colour ₹8 per page", qx + 100, qy + 262);
    g.textAlign = "left";
  }

  private pin(g: CanvasRenderingContext2D, W: number, H: number, digits: number) {
    g.fillStyle = INK;
    g.font = `700 40px ${FONT}`;
    g.fillText("Enter Your Collection PIN", 40, 140);
    const pin = "4827";
    for (let i = 0; i < 4; i++) {
      const x = 40 + i * 92;
      g.fillStyle = i === digits ? "#fff7f3" : "#f6f4ef";
      g.strokeStyle = i === digits ? ACCENT : "#e0dcd2";
      g.lineWidth = i === digits ? 3 : 2;
      g.beginPath();
      g.roundRect(x, 180, 78, 100, 16);
      g.fill();
      g.stroke();
      if (i < digits) {
        g.fillStyle = INK;
        g.beginPath();
        g.arc(x + 39, 230, 11, 0, 7);
        g.fill();
      }
    }
    void pin;
    // keypad
    const kx = W - 330;
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 3; c++) {
        const label = r < 3 ? String(r * 3 + c + 1) : ["C", "0", "⌫"][c];
        g.fillStyle = "#f6f4ef";
        g.beginPath();
        g.roundRect(kx + c * 104, 110 + r * 84, 94, 74, 14);
        g.fill();
        g.fillStyle = INK;
        g.font = `600 30px ${FONT}`;
        g.textAlign = "center";
        g.fillText(label, kx + c * 104 + 47, 110 + r * 84 + 38);
        g.textAlign = "left";
      }
    g.fillStyle = MUTE;
    g.font = `500 20px ${FONT}`;
    g.fillText("Your PIN was shown after payment.", 40, 330);
  }

  private accepted(g: CanvasRenderingContext2D, W: number, H: number) {
    g.fillStyle = "#e6f6ee";
    g.beginPath();
    g.arc(W / 2, 205, 62, 0, 7);
    g.fill();
    g.strokeStyle = GREEN;
    g.lineWidth = 12;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(W / 2 - 26, 207);
    g.lineTo(W / 2 - 6, 228);
    g.lineTo(W / 2 + 30, 184);
    g.stroke();
    g.fillStyle = INK;
    g.font = `700 40px ${FONT}`;
    g.textAlign = "center";
    g.fillText("PIN accepted", W / 2, 322);
    g.fillStyle = MUTE;
    g.font = `500 22px ${FONT}`;
    g.fillText("Order PB-2026-00142 · Semester_Notes.pdf", W / 2, 366);
    g.textAlign = "left";
  }

  private printing(g: CanvasRenderingContext2D, W: number, H: number, p: number) {
    const done = Math.round(p * 30);
    g.fillStyle = MUTE;
    g.font = `600 17px ${FONT}`;
    g.fillText("PRINTING · PB-2026-00142", 40, 130);
    g.fillStyle = INK;
    g.font = `700 36px ${FONT}`;
    g.fillText("Semester_Notes.pdf", 40, 176);
    g.font = `700 120px ${FONT}`;
    g.fillText(`${Math.round(p * 100)}`, 40, 296);
    const w = g.measureText(`${Math.round(p * 100)}`).width;
    g.font = `700 48px ${FONT}`;
    g.fillStyle = MUTE;
    g.fillText("%", 48 + w, 296);
    g.fillStyle = "#eceae4";
    g.beginPath();
    g.roundRect(40, 340, W - 80, 22, 11);
    g.fill();
    g.fillStyle = ACCENT;
    g.beginPath();
    g.roundRect(40, 340, Math.max(22, (W - 80) * p), 22, 11);
    g.fill();
    g.fillStyle = INK;
    g.font = `700 26px ${FONT}`;
    g.fillText(`${done} / 30 pages printed`, 40, 408);
    g.fillStyle = MUTE;
    g.font = `500 22px ${FONT}`;
    g.fillText(`${30 - done} pages remaining`, 40, 442);
  }

  private done(g: CanvasRenderingContext2D, W: number, H: number) {
    g.fillStyle = GREEN;
    g.beginPath();
    g.arc(W / 2, 200, 62, 0, 7);
    g.fill();
    g.strokeStyle = "#fff";
    g.lineWidth = 12;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(W / 2 - 26, 202);
    g.lineTo(W / 2 - 6, 224);
    g.lineTo(W / 2 + 30, 178);
    g.stroke();
    g.fillStyle = INK;
    g.font = `700 40px ${FONT}`;
    g.textAlign = "center";
    g.fillText("Your documents are ready!", W / 2, 316);
    g.fillStyle = MUTE;
    g.font = `500 22px ${FONT}`;
    g.fillText("Please collect your prints from the output tray.", W / 2, 360);
    this.btn(g, W / 2 - 90, 392, 180, 56, "Done");
    g.textAlign = "left";
  }
}
