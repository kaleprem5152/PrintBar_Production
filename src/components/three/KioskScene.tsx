"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { PAPER_MAX, ScreenPainter, makeBrushed, makeLogoTexture, makePaperTexture, timeline } from "./textures";

/* Machine dimensions (metres) */
const W = 0.54;
const HW = W / 2;
const FZ = 0.236; // front face z of the silver section (incl. bevel)
const SLOT_Y = 1.065;
const FLOOR_Y = 0.9; // tray floor
const SHEET_W = 0.21;
const SHEET_L = 0.297;
const ROWS = 48;

const SLANT_FROM = new THREE.Vector2(0.23, 1.28);
const SLANT_TO = new THREE.Vector2(0.13, 1.7);

function bodyGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.23, 0.6);
  s.lineTo(0.23, 0.6);
  s.lineTo(SLANT_FROM.x, SLANT_FROM.y);
  s.lineTo(SLANT_TO.x, SLANT_TO.y);
  s.lineTo(-0.23, SLANT_TO.y);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: W - 0.01,
    bevelEnabled: true,
    bevelThickness: 0.005,
    bevelSize: 0.005,
    bevelSegments: 2,
  });
  g.translate(0, 0, -(W - 0.01) / 2);
  return g;
}

function sidePanelGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.218, 0.06);
  s.lineTo(0.205, 0.06);
  s.lineTo(0.205, 1.28);
  s.lineTo(0.106, 1.688);
  s.lineTo(-0.218, 1.688);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: false });
}

function trayWallGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.3, 0);
  s.lineTo(0.3, 0.05);
  s.lineTo(0, 0.115);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false });
}

function Paper({ frameRef, texture }: { frameRef: React.RefObject<ReturnType<typeof timeline>>; texture: THREE.Texture | null }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array((ROWS + 1) * 2 * 3);
    const uv = new Float32Array((ROWS + 1) * 2 * 2);
    const idx: number[] = [];
    for (let j = 0; j <= ROWS; j++) {
      for (let k = 0; k < 2; k++) {
        const i = j * 2 + k;
        uv[i * 2] = k;
        uv[i * 2 + 1] = j / ROWS;
      }
      if (j < ROWS) {
        const a = j * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }, []);

  const path = useMemo(() => ({ z: new Float32Array(120), y: new Float32Array(120) }), []);

  useFrame(() => {
    const f = frameRef.current;
    const m = mesh.current;
    if (!m) return;
    if (f.emerged < 0.002 || f.taken >= 1) {
      m.visible = false;
      return;
    }
    m.visible = true;
    const z0 = FZ + 0.012;
    const k = 7.2 + f.settle * 1.4;
    const ds = 0.005;
    let z = z0;
    let y = SLOT_Y;
    let onFloor = false;
    const n = 100;
    for (let i = 0; i < n; i++) {
      path.z[i] = z;
      path.y[i] = y;
      const s = i * ds;
      let th = THREE.MathUtils.clamp((s - 0.025) * k, 0, 1.46);
      if (onFloor) th = 0;
      z += Math.cos(th) * ds;
      y -= Math.sin(th) * ds;
      if (y <= FLOOR_Y + 0.004) {
        y = FLOOR_Y + 0.004;
        onFloor = true;
      }
    }
    const attr = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let j = 0; j <= ROWS; j++) {
      const u = (j / ROWS) * SHEET_L;
      const s = f.emerged - u;
      let pz: number;
      let py: number;
      if (s <= 0) {
        pz = z0 + s;
        py = SLOT_Y;
      } else {
        const fi = Math.min(n - 2, s / ds);
        const i0 = Math.floor(fi);
        const t = fi - i0;
        pz = path.z[i0] * (1 - t) + path.z[i0 + 1] * t;
        py = path.y[i0] * (1 - t) + path.y[i0 + 1] * t;
      }
      attr.setXYZ(j * 2, -SHEET_W / 2, py, pz);
      attr.setXYZ(j * 2 + 1, SHEET_W / 2, py, pz);
    }
    attr.needsUpdate = true;
    geo.computeVertexNormals();
    m.position.set(0, f.taken * 0.07, f.taken * 0.05);
    if (mat.current) mat.current.opacity = 1 - f.taken;
  });

  return (
    <mesh ref={mesh} geometry={geo} frustumCulled={false} visible={false}>
      <meshStandardMaterial ref={mat} map={texture} color="#ffffff" roughness={0.85} metalness={0} side={THREE.DoubleSide} transparent />
    </mesh>
  );
}

function Machine({ reduced }: { reduced: boolean }) {
  const frameRef = useRef(timeline(0));
  const [fontsReady, setFontsReady] = useState(false);

  const body = useMemo(bodyGeometry, []);
  const panel = useMemo(sidePanelGeometry, []);
  const wall = useMemo(trayWallGeometry, []);
  const brushed = useMemo(makeBrushed, []);
  const painter = useMemo(() => new ScreenPainter(), []);
  const logo = useMemo(() => (fontsReady ? makeLogoTexture() : makeLogoTexture()), [fontsReady]);
  const paperTex = useMemo(() => (fontsReady ? makePaperTexture() : null), [fontsReady]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      document.fonts.load("700 24px 'Geist Variable'"),
      document.fonts.load("500 20px 'Geist Variable'"),
      document.fonts.load("600 20px 'Geist Variable'"),
    ])
      .catch(() => {})
      .then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (fontsReady) painter.reset();
  }, [fontsReady, painter]);

  const led = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    const t = reduced ? 10 : clock.elapsedTime;
    const f = timeline(t);
    frameRef.current = f;
    painter.paint(f);
    if (led.current) {
      const printing = f.scene === "printing";
      led.current.color.set(printing ? "#ffb020" : "#25d17b");
      led.current.opacity = printing ? 0.6 + 0.4 * Math.sin(t * 9) : 1;
    }
  });

  const slantLen = SLANT_FROM.distanceTo(SLANT_TO);
  const phi = Math.atan2(SLANT_FROM.x - SLANT_TO.x, SLANT_TO.y - SLANT_FROM.y);
  const nz = (SLANT_TO.y - SLANT_FROM.y) / slantLen;
  const ny = (SLANT_FROM.x - SLANT_TO.x) / slantLen;
  const tc = 0.55;
  const cz = SLANT_FROM.x + (SLANT_TO.x - SLANT_FROM.x) * tc + nz * 0.006;
  const cy = SLANT_FROM.y + (SLANT_TO.y - SLANT_FROM.y) * tc + ny * 0.006;

  return (
    <group>
      {/* silver upper body */}
      <mesh geometry={body} rotation={[0, -Math.PI / 2, 0]}>
        <meshPhysicalMaterial
          color="#c9ccd1"
          metalness={1}
          roughness={0.4}
          roughnessMap={brushed}
          bumpMap={brushed}
          bumpScale={0.35}
          envMapIntensity={1.15}
        />
      </mesh>

      {/* glossy black side glass */}
      {[1, -1].map((side) => (
        <mesh
          key={side}
          geometry={panel}
          rotation={[0, -Math.PI / 2, 0]}
          position={[side === 1 ? HW + 0.006 : -HW, 0, 0]}
        >
          <meshPhysicalMaterial color="#050607" metalness={0.35} roughness={0.07} clearcoat={1} clearcoatRoughness={0.04} envMapIntensity={1.6} />
        </mesh>
      ))}

      {/* silver corner posts on the lower cabinet */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * (HW - 0.004), 0.325, 0.232]}>
          <boxGeometry args={[0.012, 0.55, 0.012]} />
          <meshPhysicalMaterial color="#c9ccd1" metalness={1} roughness={0.35} />
        </mesh>
      ))}

      {/* lower service cabinet */}
      <mesh position={[0, 0.325, 0]}>
        <boxGeometry args={[W - 0.004, 0.55, 0.468]} />
        <meshStandardMaterial color="#101114" roughness={0.78} metalness={0.15} />
      </mesh>
      <RoundedBox args={[0.44, 0.49, 0.01]} radius={0.004} smoothness={3} position={[0, 0.322, 0.2375]}>
        <meshStandardMaterial color="#1a1b1f" roughness={0.55} metalness={0.2} />
      </RoundedBox>
      <mesh position={[0, 0.558, 0.2445]}>
        <boxGeometry args={[0.09, 0.012, 0.01]} />
        <meshStandardMaterial color="#08090a" roughness={0.6} />
      </mesh>
      <mesh position={[0.165, 0.32, 0.244]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.008, 24]} />
        <meshPhysicalMaterial color="#d3d6da" metalness={1} roughness={0.25} />
      </mesh>
      {[
        [-0.22, -0.17],
        [0.22, -0.17],
        [-0.22, 0.17],
        [0.22, 0.17],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.025, z]}>
          <cylinderGeometry args={[0.02, 0.024, 0.05, 20]} />
          <meshStandardMaterial color="#09090a" roughness={0.9} />
        </mesh>
      ))}

      {/* touchscreen on the angled control section */}
      <group position={[0, cy, cz]} rotation={[-phi, 0, 0]}>
        <RoundedBox args={[0.43, 0.282, 0.016]} radius={0.012} smoothness={4} position={[0, 0, 0.004]}>
          <meshPhysicalMaterial color="#07080a" roughness={0.35} metalness={0.4} clearcoat={0.6} />
        </RoundedBox>
        <mesh position={[0, 0, 0.0125]}>
          <planeGeometry args={[0.386, 0.2413]} />
          <meshBasicMaterial map={painter.texture} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, 0.0128]}>
          <planeGeometry args={[0.386, 0.2413]} />
          <meshPhysicalMaterial transparent opacity={0.07} color="#ffffff" roughness={0.03} metalness={0} envMapIntensity={1.6} depthWrite={false} />
        </mesh>
      </group>

      {/* branding */}
      <mesh position={[0, 1.195, FZ + 0.0012]}>
        <planeGeometry args={[0.2, 0.0417]} />
        <meshBasicMaterial map={logo} transparent toneMapped={false} opacity={0.92} />
      </mesh>

      {/* paper output slot */}
      <RoundedBox args={[0.35, 0.05, 0.026]} radius={0.006} smoothness={3} position={[0, SLOT_Y, FZ + 0.007]}>
        <meshPhysicalMaterial color="#0a0b0d" roughness={0.45} metalness={0.5} clearcoat={0.4} />
      </RoundedBox>
      <mesh position={[0, SLOT_Y, FZ + 0.0205]}>
        <boxGeometry args={[0.31, 0.011, 0.002]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      <mesh position={[-0.222, SLOT_Y, FZ + 0.002]}>
        <boxGeometry args={[0.012, 0.03, 0.004]} />
        <meshBasicMaterial ref={led} color="#25d17b" transparent />
      </mesh>

      {/* acrylic collection tray */}
      <group position={[0, FLOOR_Y, 0]}>
        {(() => {
          const acrylic = (
            <meshPhysicalMaterial
              color="#e8f1f5"
              transparent
              opacity={0.3}
              roughness={0.03}
              metalness={0}
              clearcoat={1}
              envMapIntensity={2.2}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          );
          return (
            <>
              <mesh position={[0, 0, FZ + 0.15]}>
                <boxGeometry args={[0.37, 0.004, 0.3]} />
                {acrylic}
              </mesh>
              <mesh position={[0, 0.055, FZ + 0.0035]}>
                <boxGeometry args={[0.37, 0.11, 0.004]} />
                {acrylic}
              </mesh>
              <mesh position={[0, 0.025, FZ + 0.298]}>
                <boxGeometry args={[0.37, 0.05, 0.004]} />
                {acrylic}
              </mesh>
              {[1, -1].map((s) => (
                <mesh key={s} geometry={wall} rotation={[0, -Math.PI / 2, 0]} position={[s * 0.1875 + (s === 1 ? 0.002 : -0.002), 0, FZ]}>
                  {acrylic}
                </mesh>
              ))}
            </>
          );
        })()}
      </group>

      <Paper frameRef={frameRef} texture={paperTex} />
    </group>
  );
}

function Rig({ reduced }: { reduced: boolean }) {
  const { camera, size } = useThree();
  useFrame(({ clock }) => {
    const aspect = size.width / size.height;
    const cam = camera as THREE.PerspectiveCamera;
    const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
    const needH = 1.98;
    const needW = aspect < 0.85 ? 1.35 : 1.5;
    const d = Math.max(needH / (2 * tanHalf), needW / aspect / (2 * tanHalf));
    const t = reduced ? 0 : clock.elapsedTime;
    const az = 0.62 + Math.sin(t * 0.28) * 0.09;
    const el = 0.1 + Math.sin(t * 0.21) * 0.015;
    cam.position.set(Math.sin(az) * d * Math.cos(el), 0.9 + Math.sin(el) * d, Math.cos(az) * d * Math.cos(el) + 0.1);
    cam.lookAt(0.0, 0.86, 0.1);
  });
  return null;
}

export default function KioskScene({ onReady }: { onReady?: () => void }) {
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const [settled, setSettled] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [mobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const h = () => setReduced(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  useEffect(() => {
    if (!wrap.current) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.01 });
    io.observe(wrap.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!reduced) return setSettled(false);
    const id = setTimeout(() => setSettled(true), 1800);
    return () => clearTimeout(id);
  }, [reduced]);

  const loop = !visible ? "never" : reduced && settled ? "demand" : "always";

  return (
    <div ref={wrap} className="absolute inset-0" role="img" aria-label="Animated 3D view of the PrintBar kiosk printing a document">
      <Canvas
        frameloop={loop}
        dpr={mobile ? [1, 1.5] : [1, 2]}
        camera={{ fov: 30, position: [2, 1.4, 4], near: 0.1, far: 30 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={() => onReady?.()}
      >
        <Rig reduced={reduced} />
        <hemisphereLight args={["#ffffff", "#bdb7ab", 0.35]} />
        <directionalLight position={[2.5, 4, 3]} intensity={0.9} />
        <Environment resolution={256} frames={1}>
          <color attach="background" args={["#6a6c72"]} />
          <Lightformer form="rect" intensity={5} position={[3, 5, 4]} scale={[7, 3.5, 1]} />
          <Lightformer form="rect" intensity={3} position={[-5, 2, 3]} scale={[1.6, 6, 1]} />
          <Lightformer form="rect" intensity={3.5} position={[6, 2.5, 0]} scale={[1.4, 6, 1]} />
          <Lightformer form="rect" intensity={2.5} position={[0, 3, -6]} scale={[9, 2.5, 1]} />
          <Lightformer form="rect" intensity={1.2} position={[0, -2, 4]} scale={[9, 1.5, 1]} color="#fff3e0" />
          <Lightformer form="rect" intensity={2} position={[0, 7, 0]} scale={[6, 6, 1]} />
        </Environment>
        <Machine reduced={reduced} />
        <ContactShadows position={[0, 0.001, 0.14]} opacity={0.55} scale={1.9} blur={1.8} far={0.45} resolution={mobile ? 512 : 1024} frames={1} />
      </Canvas>
    </div>
  );
}

export { PAPER_MAX };
