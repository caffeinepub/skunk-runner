import { useCallback, useEffect, useRef, useState } from "react";

// ─── Settings ─────────────────────────────────────────────────────────────────

type ControlLayout = "A" | "B" | "C";
type ButtonSize = "small" | "medium" | "large";

interface GameSettings {
  layout: ControlLayout;
  buttonSize: ButtonSize;
  gameSpeed: number;
  soundOn: boolean;
}

const DEFAULT_SETTINGS: GameSettings = {
  layout: "A",
  buttonSize: "medium",
  gameSpeed: 1.0,
  soundOn: true,
};

function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem("skunkrunner_settings");
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (_) {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s: GameSettings) {
  try {
    localStorage.setItem("skunkrunner_settings", JSON.stringify(s));
  } catch (_) {}
}

const BTN_SIZE_STYLES: Record<ButtonSize, React.CSSProperties> = {
  small: { padding: "6px 10px", fontSize: 16, minWidth: 52 },
  medium: { padding: "10px 14px", fontSize: 22, minWidth: 72 },
  large: { padding: "14px 20px", fontSize: 28, minWidth: 96 },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Player {
  x: number;
  y: number;
  width: number;
  height: number;
  vx: number;
  vy: number;
  onGround: boolean;
  ducking: boolean;
  lives: number;
  invincibleTimer: number;
  animFrame: number;
  animTimer: number;
  facingRight: boolean;
  wasOnGround: boolean;
}

interface Enemy {
  x: number;
  y: number;
  width: number;
  height: number;
  vx: number;
  platformLeft: number;
  platformRight: number;
  animFrame: number;
  animTimer: number;
  stomped: boolean;
  squishTimer: number;
  type: "aerosol" | "police";
}

interface PlantPot {
  worldX: number;
  y: number;
  triggered: boolean;
  gardenerVisible: boolean;
  gardenerTimer: number;
  gardenerY: number;
  stomped: boolean;
  squishTimer: number;
  retreating: boolean;
}

interface Platform {
  x: number;
  y: number;
  width: number;
  height: number;
  isGround: boolean;
  moving?: boolean;
  moveOriginX?: number;
  moveRangeX?: number;
  moveSpeed?: number;
  moveDir?: 1 | -1;
}

interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Collectible {
  x: number;
  y: number;
  type: "water" | "sun";
  collected: boolean;
  floatOffset: number;
}

type GameEvent =
  | "jump"
  | "collect_water"
  | "collect_sun"
  | "hit"
  | "death"
  | "stomp"
  | "spliff_lit";

interface GameState {
  phase: "start" | "playing" | "paused" | "gameover";
  score: number;
  hiScore: number;
  distance: number;
  worldOffset: number;
  player: Player;
  enemies: Enemy[];
  platforms: Platform[];
  obstacles: Obstacle[];
  collectibles: Collectible[];
  plantPots: PlantPot[];
  spawnTimer: number;
  platformSeed: number;
  lastFrameTime: number;
  scrollSpeed: number;
  lastGuaranteedSpawnDist: number;
  lastObstacleWorldX: number;
  lastEnemyFrame: number;
  frameCount: number;
  events: GameEvent[];
  coinsCollected: number;
  spliffTimer: number;
  spliffsSmoked: number;
  enemiesKilled: number;
  nextPotWorldX: number;
  deathFadeTimer: number;
}

// ─── Game Boy Palette ─────────────────────────────────────────────────────────

const GB = {
  darkest: "#0f380f",
  dark: "#306230",
  light: "#8bac0f",
  lightest: "#9bbc0f",
} as const;

const CANVAS_W = 480;
const CANVAS_H = 320;
const GROUND_Y = CANVAS_H - 40;
const GRAVITY = 1.4;
const JUMP_FORCE = -17.0;
const PLAYER_SPEED = 3.2;
const SCROLL_BASE = 1.8;
const PLAYER_START_X = 80;
const GUARANTEED_SPAWN_INTERVAL = 50;
const MIN_OBSTACLE_GAP = 150;
const MAX_ENEMY_INTERVAL_FRAMES = 300;
const SPLIFF_COIN_MILESTONE = 420;
const SPLIFF_DURATION_FRAMES = 300;

// ─── Sound Engine ─────────────────────────────────────────────────────────────

function createSoundEngine() {
  let ctx: AudioContext | null = null;

  function getCtx(): AudioContext {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function playTone(
    frequency: number,
    type: OscillatorType,
    duration: number,
    volume = 0.18,
    freqEnd?: number,
    delay = 0,
  ) {
    try {
      const ac = getCtx();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = type;
      const start = ac.currentTime + delay;
      osc.frequency.setValueAtTime(frequency, start);
      if (freqEnd !== undefined) {
        osc.frequency.exponentialRampToValueAtTime(freqEnd, start + duration);
      }
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.start(start);
      osc.stop(start + duration + 0.01);
    } catch (_) {}
  }

  return {
    jump() {
      playTone(280, "square", 0.12, 0.14, 560);
    },
    collectWater() {
      playTone(660, "sine", 0.1, 0.15, 880);
    },
    collectSun() {
      playTone(880, "sine", 0.08, 0.15);
      playTone(1100, "sine", 0.08, 0.12, undefined, 0.06);
    },
    hit() {
      playTone(160, "square", 0.25, 0.2, 80);
    },
    death() {
      for (let i = 0; i < 4; i++) {
        playTone(400 - i * 80, "square", 0.18, 0.18, undefined, i * 0.18);
      }
    },
    stomp() {
      playTone(200, "square", 0.06, 0.2, 80);
      playTone(600, "sine", 0.1, 0.18, 900, 0.04);
    },
    spliffLit() {
      playTone(420, "sine", 0.2, 0.18, 840, 0);
      playTone(630, "sine", 0.15, 0.14, 840, 0.1);
      playTone(840, "sine", 0.12, 0.12, 1050, 0.22);
      playTone(1050, "triangle", 0.1, 0.1, undefined, 0.34);
    },
    start() {
      playTone(440, "square", 0.1, 0.15, undefined, 0);
      playTone(550, "square", 0.1, 0.15, undefined, 0.1);
      playTone(660, "square", 0.15, 0.18, undefined, 0.2);
      playTone(880, "square", 0.2, 0.2, undefined, 0.32);
    },
  };
}

// ─── Drawing Helpers ──────────────────────────────────────────────────────────

function drawPixelRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
}

function drawCannabisLeafShape(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fillColor: string,
  strokeColor: string,
) {
  // Cannabis leaf silhouette: wide flat fan with 7 long narrow pointed fingers
  // radiating from a single central point — like a spread hand.
  // Each finger is a thin blade, widest near its middle, tapering to a sharp tip,
  // with small serrations along the edges.

  ctx.save();
  ctx.translate(cx, cy);

  // [angle (radians from straight up), length factor, half-width factor, extra-curl]
  // Wider gaps between fingers so each leaf is clearly independent
  const fingers: [number, number, number, number][] = [
    [0, 1.0, 0.11, 0], // centre — tallest
    [0.62, 0.86, 0.1, 0.06], // inner right — bigger gap
    [-0.62, 0.86, 0.1, -0.06], // inner left  — bigger gap
    [1.15, 0.74, 0.09, 0.08], // mid right — wider spread
    [-1.15, 0.74, 0.09, -0.08], // mid left  — wider spread
    [1.65, 0.58, 0.08, 0.42], // outer right — wider + drooping curl
    [-1.65, 0.58, 0.08, -0.42], // outer left  — wider + drooping curl
  ];

  function drawFinger(
    angle: number,
    lenFactor: number,
    hwFactor: number,
    curl = 0,
  ) {
    const L = r * lenFactor;
    // Narrower at base: taper starts even thinner, peak width same, giving a more finger-like silhouette
    const W = r * hwFactor;
    // Serration: small regular triangular teeth along each side
    const TEETH = 5;

    ctx.save();
    // Apply curl rotation first (droops the outer lobes downward)
    ctx.rotate(angle + curl);

    // Width profile: very narrow base tapering up, widest at ~40%, then taper to sharp tip
    function profile(t: number) {
      if (t < 0.2) return W * (t / 0.2) * 0.55; // narrow base — pinches toward stem
      if (t < 0.4) return W * (0.55 + 0.45 * ((t - 0.2) / 0.2)); // widens to full
      return W * (1 - (t - 0.4) / 0.6); // taper to tip
    }

    // Build right-side points with teeth, then left mirror
    const pts: [number, number][] = [];
    const steps = TEETH * 6;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const bw = profile(t);
      const y = -L * t;
      // Teeth: only on the blade (past base taper)
      const toothAmp =
        t > 0.12 && t < 0.95
          ? bw * 0.28 * Math.max(0, Math.sin(t * TEETH * Math.PI))
          : 0;
      pts.push([bw + toothAmp, y]);
    }

    // Outline (darker border)
    ctx.fillStyle = strokeColor;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (const [x, y] of pts) ctx.lineTo(x + 1.2, y);
    ctx.lineTo(0, -L - 1.5);
    for (let i = pts.length - 1; i >= 0; i--)
      ctx.lineTo(-pts[i][0] - 1.2, pts[i][1]);
    ctx.closePath();
    ctx.fill();

    // Fill
    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(0, -L);
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(-pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fill();

    // Central midvein
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = Math.max(0.6, r * 0.018);
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, -L * 0.1);
    ctx.lineTo(0, -L * 0.88);
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    ctx.restore();
  }

  // Draw outer fingers first so centre overlaps them at the base
  for (let i = fingers.length - 1; i >= 0; i--) {
    const [a, l, w, c] = fingers[i];
    drawFinger(a, l, w, c);
  }

  // Short petiole stem
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(1.0, r * 0.045);
  ctx.globalAlpha = 0.65;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, r * 0.2);
  ctx.stroke();
  ctx.globalAlpha = 1.0;

  ctx.restore();
}

function drawMickeyGlove(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  facingRight: boolean,
) {
  ctx.save();
  ctx.translate(cx, cy);
  if (!facingRight) ctx.scale(-1, 1);

  ctx.fillStyle = GB.darkest;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.55, r * 0.62, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#555555";
  ctx.beginPath();
  ctx.ellipse(0, r * 0.5, r * 0.52, r * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = GB.darkest;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.72, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.65, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  const fingerOffsets = [-r * 0.32, 0, r * 0.32];
  for (const fx of fingerOffsets) {
    ctx.fillStyle = GB.darkest;
    ctx.beginPath();
    ctx.ellipse(fx, -r * 0.45, r * 0.24, r * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(fx, -r * 0.44, r * 0.2, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "#cccccc";
  ctx.lineWidth = 0.7;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.arc(r * 0.1, r * 0.05, r * 0.25, Math.PI * 0.8, Math.PI * 1.9);
  ctx.stroke();
  ctx.globalAlpha = 1.0;
  ctx.restore();
}

function drawBloodshotEyes(
  ctx: CanvasRenderingContext2D,
  lx: number,
  ly: number,
  rx: number,
  ry: number,
  eyeR: number,
) {
  const eyes = [
    { cx: lx, cy: ly },
    { cx: rx, cy: ry },
  ];
  for (const eye of eyes) {
    // Stoned eye: wide ellipse (wider than tall) — not round
    const ew = eyeR * 1.35;
    const eh = eyeR * 0.72;

    // White of eye (wide, squashed ellipse)
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(eye.cx, eye.cy, ew, eh, 0, 0, Math.PI * 2);
    ctx.fill();

    // Bloodshot veins
    const veinAngles = [0.3, 1.0, 1.9, 3.4, 4.7, 5.4];
    ctx.strokeStyle = "#cc0000";
    ctx.lineWidth = 0.6;
    for (const va of veinAngles) {
      const vx0 = eye.cx + Math.cos(va) * ew * 0.3;
      const vy0 = eye.cy + Math.sin(va) * eh * 0.3;
      const vx1 = eye.cx + Math.cos(va + 0.3) * ew * 0.7;
      const vy1 = eye.cy + Math.sin(va + 0.3) * eh * 0.7;
      const vx2 = eye.cx + Math.cos(va + 0.1) * ew * 0.95;
      const vy2 = eye.cy + Math.sin(va + 0.1) * eh * 0.95;
      ctx.beginPath();
      ctx.moveTo(vx0, vy0);
      ctx.quadraticCurveTo(vx1, vy1, vx2, vy2);
      ctx.stroke();
    }

    // Pupil (small squashed ellipse)
    ctx.fillStyle = GB.darkest;
    ctx.beginPath();
    ctx.ellipse(eye.cx, eye.cy, ew * 0.32, eh * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();

    // Highlight
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(
      eye.cx - ew * 0.12,
      eye.cy - eh * 0.22,
      ew * 0.1,
      eh * 0.16,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Outline of eye shape
    ctx.strokeStyle = GB.darkest;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(eye.cx, eye.cy, ew, eh, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Droopy heavy upper eyelid — slightly open (covers top ~30% of the eye)
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(eye.cx, eye.cy, ew + 1, eh + 1, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = GB.dark;
    ctx.beginPath();
    // Lid droops down: starts above eye, curves down to cover top portion
    ctx.moveTo(eye.cx - ew - 2, eye.cy - eh * 2);
    ctx.lineTo(eye.cx + ew + 2, eye.cy - eh * 2);
    ctx.lineTo(eye.cx + ew + 2, eye.cy - eh * 0.55);
    ctx.quadraticCurveTo(
      eye.cx,
      eye.cy - eh * 0.1,
      eye.cx - ew - 2,
      eye.cy - eh * 0.55,
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawLeafMouth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  my: number,
  size: number,
) {
  ctx.strokeStyle = GB.darkest;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, my - size * 0.3, size * 0.6, 0.2, Math.PI - 0.2);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(cx - size * 0.22, my - size * 0.1, size * 0.18, size * 0.12);
  ctx.fillRect(cx + size * 0.04, my - size * 0.1, size * 0.18, size * 0.12);
  ctx.strokeStyle = GB.darkest;
  ctx.lineWidth = 0.6;
  ctx.strokeRect(cx - size * 0.22, my - size * 0.1, size * 0.18, size * 0.12);
  ctx.strokeRect(cx + size * 0.04, my - size * 0.1, size * 0.18, size * 0.12);
}

function drawSpliff(
  ctx: CanvasRenderingContext2D,
  cx: number,
  my: number,
  size: number,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const angle = -0.5;
  const jointLen = size * 3.2;
  const jointW = size * 0.22;
  // Narrow at mouth end (left), wide at lit/ember end (right)
  const mouthW = jointW * 0.3; // narrow filter/mouth side
  const emberW = jointW * 1.1; // wide burning end

  ctx.translate(cx + size * 0.3, my - size * 0.05);
  ctx.rotate(angle);

  // ── Cone body (trapezoid): narrow left (mouth), wide right (lit end) ──
  ctx.fillStyle = "#f5f5dc";
  ctx.strokeStyle = GB.darkest;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, -mouthW / 2);
  ctx.lineTo(jointLen * 0.82, -emberW / 2);
  ctx.lineTo(jointLen * 0.82, emberW / 2);
  ctx.lineTo(0, mouthW / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // ── Filter tip (brown narrow end at mouth) ──
  ctx.fillStyle = "#8B6914";
  ctx.beginPath();
  ctx.moveTo(-mouthW * 0.3, -mouthW / 2);
  ctx.lineTo(jointLen * 0.13, -mouthW / 2);
  ctx.lineTo(jointLen * 0.13, mouthW / 2);
  ctx.lineTo(-mouthW * 0.3, mouthW / 2);
  ctx.closePath();
  ctx.fill();

  // ── Diagonal roll lines on paper body ──
  ctx.strokeStyle = "rgba(0,0,0,0.13)";
  ctx.lineWidth = 0.5;
  for (let i = 1; i < 5; i++) {
    const tx = jointLen * 0.14 * i;
    const wAtT = mouthW + (emberW - mouthW) * (tx / (jointLen * 0.82));
    ctx.beginPath();
    ctx.moveTo(tx, -wAtT / 2);
    ctx.lineTo(tx, wAtT / 2);
    ctx.stroke();
  }

  // ── Ember glow at wide end ──
  const emberX = jointLen * 0.82 + 2;
  const grad = ctx.createRadialGradient(emberX, 0, 0, emberX, 0, emberW * 1.6);
  grad.addColorStop(0, "rgba(255, 180, 0, 0.95)");
  grad.addColorStop(0.4, "rgba(255, 70, 0, 0.6)");
  grad.addColorStop(1, "rgba(255, 0, 0, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(emberX, 0, emberW * 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff6600";
  ctx.beginPath();
  ctx.arc(emberX, 0, emberW * 0.65, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffdd00";
  ctx.beginPath();
  ctx.arc(emberX, 0, emberW * 0.32, 0, Math.PI * 2);
  ctx.fill();

  // ── Smoke wisps ──
  ctx.strokeStyle = "rgba(200,200,200,0.45)";
  ctx.lineWidth = 1;
  for (let s = 0; s < 3; s++) {
    const sx = emberX + s * 2 - 2;
    ctx.beginPath();
    ctx.moveTo(sx, -emberW);
    ctx.bezierCurveTo(
      sx + 3,
      -emberW - 5,
      sx - 3,
      -emberW - 10,
      sx + 2,
      -emberW - 16,
    );
    ctx.stroke();
  }
  ctx.restore();
}

// ── Small HUD spliff icon (cone-shaped) ──────────────────────────────────────
function drawHudSpliffIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
) {
  // Tiny cone spliff: narrow at left (mouth), wide at right (ember)
  const len = 14;
  const mW = 1.5;
  const eW = 4.5;
  ctx.save();
  ctx.fillStyle = "#f5f5dc";
  ctx.strokeStyle = GB.darkest;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(x, y - mW / 2);
  ctx.lineTo(x + len, y - eW / 2);
  ctx.lineTo(x + len, y + eW / 2);
  ctx.lineTo(x, y + mW / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Filter tip
  ctx.fillStyle = "#8B6914";
  ctx.fillRect(x - 1, y - mW / 2, 3, mW);
  // Ember glow
  const grad = ctx.createRadialGradient(x + len + 1, y, 0, x + len + 1, y, eW);
  grad.addColorStop(0, "rgba(255,150,0,0.95)");
  grad.addColorStop(1, "rgba(255,0,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x + len + 1, y, eW, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff6600";
  ctx.beginPath();
  ctx.arc(x + len + 1, y, eW * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Draws a small curled leaf shape as a foot — like a little cannabis leaf curling outward
function drawCurledLeafFoot(
  ctx: CanvasRenderingContext2D,
  cx: number,
  topY: number,
  r: number,
  facingRight: boolean,
) {
  ctx.save();
  ctx.translate(cx, topY);
  // Mirror for left/right foot
  if (!facingRight) ctx.scale(-1, 1);

  // The foot is a small 3-finger mini leaf curled to the side
  // Centre finger points forward (right), two side fingers curl up and down
  const footFingers: [number, number, number, number][] = [
    [-Math.PI / 2, 1.0, 0.28, 0], // main toe — points right (forward)
    [-Math.PI / 2 + 0.55, 0.72, 0.2, 0.15], // upper curl — angled slightly up
    [-Math.PI / 2 - 0.55, 0.72, 0.2, -0.15], // lower curl — angled slightly down
  ];

  for (const [angle, lenFactor, hwFactor, curl] of footFingers) {
    const L = r * lenFactor;
    const W = r * hwFactor;
    const TEETH = 3;
    const steps = TEETH * 5;
    ctx.save();
    ctx.rotate(angle + curl);
    // Outline
    ctx.fillStyle = GB.darkest;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const bw =
        t < 0.25
          ? W * (t / 0.25) * 0.5
          : t < 0.5
            ? W * (0.5 + 0.5 * ((t - 0.25) / 0.25))
            : W * (1 - (t - 0.5) / 0.5);
      const toothAmp =
        t > 0.15 && t < 0.9
          ? bw * 0.22 * Math.max(0, Math.sin(t * TEETH * Math.PI))
          : 0;
      ctx.lineTo(bw + toothAmp + 1.0, -L * t);
    }
    ctx.lineTo(0, -L - 1.2);
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const bw =
        t < 0.25
          ? W * (t / 0.25) * 0.5
          : t < 0.5
            ? W * (0.5 + 0.5 * ((t - 0.25) / 0.25))
            : W * (1 - (t - 0.5) / 0.5);
      const toothAmp =
        t > 0.15 && t < 0.9
          ? bw * 0.22 * Math.max(0, Math.sin(t * TEETH * Math.PI))
          : 0;
      ctx.lineTo(-(bw + toothAmp + 1.0), -L * t);
    }
    ctx.closePath();
    ctx.fill();
    // Fill
    ctx.fillStyle = GB.dark;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const bw =
        t < 0.25
          ? W * (t / 0.25) * 0.5
          : t < 0.5
            ? W * (0.5 + 0.5 * ((t - 0.25) / 0.25))
            : W * (1 - (t - 0.5) / 0.5);
      const toothAmp =
        t > 0.15 && t < 0.9
          ? bw * 0.22 * Math.max(0, Math.sin(t * TEETH * Math.PI))
          : 0;
      ctx.lineTo(bw + toothAmp, -L * t);
    }
    ctx.lineTo(0, -L);
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const bw =
        t < 0.25
          ? W * (t / 0.25) * 0.5
          : t < 0.5
            ? W * (0.5 + 0.5 * ((t - 0.25) / 0.25))
            : W * (1 - (t - 0.5) / 0.5);
      const toothAmp =
        t > 0.15 && t < 0.9
          ? bw * 0.22 * Math.max(0, Math.sin(t * TEETH * Math.PI))
          : 0;
      ctx.lineTo(-(bw + toothAmp), -L * t);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  p: Player,
  screenX: number,
  spliffAlpha = 0,
) {
  const flash =
    p.invincibleTimer > 0 && Math.floor(p.invincibleTimer / 4) % 2 === 0;
  if (flash) return;

  const cx = Math.floor(screenX) + p.width / 2;
  const top = Math.floor(p.y);

  ctx.save();
  if (!p.facingRight) {
    ctx.scale(-1, 1);
    ctx.translate(-2 * cx, 0);
  }

  if (p.ducking) {
    const leafCX = cx;
    const leafCY = top + 18;
    const leafR = 16;
    ctx.save();
    ctx.scale(1, 0.65);
    ctx.translate(0, leafCY / 0.65 - leafCY);
    drawCannabisLeafShape(ctx, leafCX, leafCY, leafR, GB.dark, GB.darkest);
    ctx.restore();
    drawBloodshotEyes(ctx, cx - 5, top + 11, cx + 5, top + 11, 4.5);
    drawLeafMouth(ctx, cx, top + 19, 10);
    // Ducking: stick arms folded outward
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Left arm
    ctx.beginPath();
    ctx.moveTo(cx - 6, top + 16);
    ctx.lineTo(cx - 14, top + 14);
    ctx.lineTo(cx - 20, top + 17);
    ctx.stroke();
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(cx - 14, top + 14, 2.5, 0, Math.PI * 2);
    ctx.fill();
    drawMickeyGlove(ctx, Math.floor(cx - 22), top + 17, 6, false);
    // Right arm
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx + 6, top + 16);
    ctx.lineTo(cx + 14, top + 14);
    ctx.lineTo(cx + 20, top + 17);
    ctx.stroke();
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(cx + 14, top + 14, 2.5, 0, Math.PI * 2);
    ctx.fill();
    drawMickeyGlove(ctx, Math.floor(cx + 22), top + 17, 6, true);
  } else {
    // ── Pluto-style swagger sway (only on ground, not ducking) ──
    const isMoving = Math.abs(p.vx) > 0.3;
    const swayX = p.onGround && isMoving ? (p.animFrame % 2 === 0 ? -2 : 2) : 0;
    const swayAngle =
      p.onGround && isMoving ? (p.animFrame % 2 === 0 ? -0.08 : 0.08) : 0;

    ctx.save();
    ctx.translate(cx + swayX, top + p.height / 2);
    ctx.rotate(swayAngle);
    ctx.translate(-cx - swayX, -top - p.height / 2);

    const leafCX = cx + swayX;
    // Bigger leaf radius so more leaf is visible below the face
    const leafR = 40;
    // Leaf centre raised slightly so lower lobes extend further down, giving more exposed bottom leaf
    const leafCY = top + 14;
    drawCannabisLeafShape(ctx, leafCX, leafCY, leafR, GB.dark, GB.darkest);

    // Eyes sit higher up on the leaf face
    const eyeY = top + 10;
    drawBloodshotEyes(ctx, leafCX - 8, eyeY, leafCX + 8, eyeY, 6);
    drawLeafMouth(ctx, leafCX, top + 22, 13);

    if (spliffAlpha > 0) drawSpliff(ctx, leafCX, top + 22, 13, spliffAlpha);

    // Two separate thicker eyebrows (not a single arc)
    ctx.strokeStyle = GB.darkest;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    // Left eyebrow — short thick arc above left eye
    ctx.beginPath();
    ctx.moveTo(leafCX - 14, eyeY - 7);
    ctx.quadraticCurveTo(leafCX - 8, eyeY - 11, leafCX - 2, eyeY - 8);
    ctx.stroke();
    // Right eyebrow — short thick arc above right eye
    ctx.beginPath();
    ctx.moveTo(leafCX + 2, eyeY - 8);
    ctx.quadraticCurveTo(leafCX + 8, eyeY - 11, leafCX + 14, eyeY - 7);
    ctx.stroke();
    ctx.lineCap = "butt";

    // ── Stick-thin arms, anchored to leaf body centre ──────────────────────────
    const armBob = p.animFrame % 2 === 0 ? -1 : 1;
    const leftArmBob = isMoving && p.onGround ? -armBob * 3 : armBob;
    const rightArmBob = isMoving && p.onGround ? armBob * 3 : armBob;
    // Shoulder anchor: emerges from leaf stem (leafCX, leafCY + small offset)
    const shoulderY = leafCY + 12; // attached to lower part of main leaf body
    const shoulderOffsetX = 8; // slight x offset left/right of centre

    // Upper arm length and elbow position
    const uArmLen = 14;
    const fArmLen = 13;

    // Left arm: shoulder → elbow → glove
    const lShX = leafCX - shoulderOffsetX;
    const lShY = shoulderY;
    const lElbX = lShX - uArmLen + leftArmBob * 0.5;
    const lElbY = lShY + 8 + leftArmBob;
    const lGlvX = lElbX - fArmLen + leftArmBob * 0.4;
    const lGlvY = lElbY - 4 + leftArmBob;

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(lShX, lShY);
    ctx.lineTo(lElbX, lElbY);
    ctx.lineTo(lGlvX, lGlvY);
    ctx.stroke();
    // Elbow joint dot
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(lElbX, lElbY, 3, 0, Math.PI * 2);
    ctx.fill();
    drawMickeyGlove(ctx, Math.floor(lGlvX), Math.floor(lGlvY), 8, false);

    // Right arm: shoulder → elbow → glove
    const rShX = leafCX + shoulderOffsetX;
    const rShY = shoulderY;
    const rElbX = rShX + uArmLen - rightArmBob * 0.5;
    const rElbY = rShY + 8 + rightArmBob;
    const rGlvX = rElbX + fArmLen - rightArmBob * 0.4;
    const rGlvY = rElbY - 4 + rightArmBob;

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(rShX, rShY);
    ctx.lineTo(rElbX, rElbY);
    ctx.lineTo(rGlvX, rGlvY);
    ctx.stroke();
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(rElbX, rElbY, 3, 0, Math.PI * 2);
    ctx.fill();
    drawMickeyGlove(ctx, Math.floor(rGlvX), Math.floor(rGlvY), 8, true);

    ctx.restore();

    // ── Stick-thin legs, anchored to bottom of leaf body ──────────────────────
    // Hip anchors emerge from the bottom of the leaf (leafCY + leafR-ish area)
    const hipY = leafCY + 30; // bottom of leaf body
    const hipOffsetX = 7;
    const thighLen = 14;
    const shinLen = 14;

    const leftLift = p.animFrame % 2 === 0 ? -3 : 0;
    const rightLift = p.animFrame % 2 === 1 ? -3 : 0;
    const leftBendX = p.animFrame % 2 === 0 ? -4 : 2;
    const rightBendX = p.animFrame % 2 === 1 ? -4 : 2;

    // ─ Left leg ─
    const lHipX = leafCX - hipOffsetX;
    const lHipY = hipY + leftLift;
    const lKneeX = lHipX + leftBendX;
    const lKneeY = lHipY + thighLen;
    const lFootX = lKneeX - 2;
    const lFootY = lKneeY + shinLen;

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(lHipX, lHipY);
    ctx.lineTo(lKneeX, lKneeY);
    ctx.lineTo(lFootX, lFootY);
    ctx.stroke();
    // Knee joint dot
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(lKneeX, lKneeY, 3, 0, Math.PI * 2);
    ctx.fill();
    // Curled leaf foot (left)
    drawCurledLeafFoot(ctx, lFootX, lFootY, 9, false);

    // ─ Right leg ─
    const rHipX = leafCX + hipOffsetX;
    const rHipY = hipY + rightLift;
    const rKneeX = rHipX + rightBendX;
    const rKneeY = rHipY + thighLen;
    const rFootX = rKneeX + 2;
    const rFootY = rKneeY + shinLen;

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(rHipX, rHipY);
    ctx.lineTo(rKneeX, rKneeY);
    ctx.lineTo(rFootX, rFootY);
    ctx.stroke();
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(rKneeX, rKneeY, 3, 0, Math.PI * 2);
    ctx.fill();
    // Curled leaf foot (right)
    drawCurledLeafFoot(ctx, rFootX, rFootY, 9, true);
  }

  ctx.restore();
}

// ─── Enemy: Red aerosol can ───────────────────────────────────────────────────

function drawAerosolEnemy(
  ctx: CanvasRenderingContext2D,
  e: Enemy,
  screenX: number,
) {
  const x = Math.floor(screenX);
  const y = Math.floor(e.y);
  const w = e.width;
  const bodyH = 26;
  const legAreaY = y + bodyH;

  drawPixelRect(ctx, x + 2, y + 4, w - 4, bodyH - 4, "#cc2200");
  drawPixelRect(ctx, x + 2, y + 4, w - 4, 4, "#991a00");
  drawPixelRect(ctx, x + 2, y + bodyH - 8, w - 4, 4, "#991a00");
  drawPixelRect(ctx, x + 3, y + 10, w - 6, bodyH - 18, "#ff4422");
  drawPixelRect(ctx, x + 3, y + 12, w - 6, 6, "#ffffff");
  ctx.fillStyle = "#cc2200";
  ctx.font = "bold 5px monospace";
  ctx.textAlign = "center";
  ctx.fillText("KILL", x + w / 2, y + 17);

  const eyeCY = y + 14;
  const ex1 = x + Math.floor(w * 0.3);
  const ex2 = x + Math.floor(w * 0.7);
  const eyeR = 3;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(ex1, eyeCY, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ex2, eyeCY, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = GB.darkest;
  ctx.beginPath();
  ctx.arc(ex1 + 1, eyeCY, eyeR * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ex2 - 1, eyeCY, eyeR * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(ex1, eyeCY - 1, eyeR * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ex2, eyeCY - 1, eyeR * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = GB.darkest;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.arc(ex1, eyeCY, eyeR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(ex2, eyeCY, eyeR, 0, Math.PI * 2);
  ctx.stroke();

  drawPixelRect(ctx, x + Math.floor(w / 2) - 2, y, 4, 5, GB.darkest);

  const armY = y + 10;
  const armBob = e.animFrame === 0 ? -1 : 1;
  ctx.fillStyle = GB.darkest;
  ctx.fillRect(x - 7, armY + armBob - 1, 8, 5);
  ctx.fillStyle = "#991a00";
  ctx.fillRect(x - 6, armY + armBob, 6, 3);
  ctx.fillStyle = GB.darkest;
  ctx.beginPath();
  ctx.arc(x - 6, armY + armBob + 1, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#cc2200";
  ctx.beginPath();
  ctx.arc(x - 6, armY + armBob + 1, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = GB.darkest;
  ctx.fillRect(x + w - 1, armY - armBob - 1, 8, 5);
  ctx.fillStyle = "#991a00";
  ctx.fillRect(x + w, armY - armBob, 6, 3);
  ctx.fillStyle = GB.darkest;
  ctx.beginPath();
  ctx.arc(x + w + 6, armY - armBob + 1, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#cc2200";
  ctx.beginPath();
  ctx.arc(x + w + 6, armY - armBob + 1, 2, 0, Math.PI * 2);
  ctx.fill();

  const legW2 = 5;
  const legH2 = 10;
  const leftLegLift = e.animFrame === 0 ? -3 : 0;
  const rightLegLift = e.animFrame === 1 ? -3 : 0;
  ctx.fillStyle = GB.darkest;
  ctx.fillRect(x + 2, legAreaY + leftLegLift - 1, legW2 + 2, legH2 + 2);
  ctx.fillStyle = "#991a00";
  ctx.fillRect(x + 3, legAreaY + leftLegLift, legW2, legH2);
  ctx.fillStyle = GB.darkest;
  ctx.fillRect(x + 1, legAreaY + leftLegLift + legH2 - 1, legW2 + 4, 4);
  ctx.fillStyle = GB.darkest;
  ctx.fillRect(
    x + w - legW2 - 3,
    legAreaY + rightLegLift - 1,
    legW2 + 2,
    legH2 + 2,
  );
  ctx.fillStyle = "#991a00";
  ctx.fillRect(x + w - legW2 - 2, legAreaY + rightLegLift, legW2, legH2);
  ctx.fillStyle = GB.darkest;
  ctx.fillRect(
    x + w - legW2 - 4,
    legAreaY + rightLegLift + legH2 - 1,
    legW2 + 4,
    4,
  );

  if (Math.abs(e.vx) > 0) {
    const dir = e.vx > 0 ? 1 : -1;
    ctx.fillStyle = "#ff6600";
    for (let i = 0; i < 3; i++) {
      const px = x + (dir > 0 ? w - 2 : 2) + dir * (i * 5 + 3);
      const py2 = y + 6 + (i % 2) * 4;
      ctx.beginPath();
      ctx.arc(px, py2, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ─── Enemy: Policeman ────────────────────────────────────────────────────────

function drawPolicemanEnemy(
  ctx: CanvasRenderingContext2D,
  e: Enemy,
  screenX: number,
) {
  const x = Math.floor(screenX);
  const y = Math.floor(e.y);
  const w = e.width;
  const bodyH = 22;
  const legAreaY = y + bodyH + 6;
  const armBob = e.animFrame === 0 ? -1 : 1;
  const leftLegLift = e.animFrame === 0 ? -3 : 0;
  const rightLegLift = e.animFrame === 1 ? -3 : 0;
  const legW = 5;
  const legH = 10;

  // Legs
  ctx.fillStyle = "#1a237e";
  ctx.fillRect(x + 2, legAreaY + leftLegLift, legW + 2, legH + 2);
  ctx.fillRect(x + w - legW - 4, legAreaY + rightLegLift, legW + 2, legH + 2);
  ctx.fillStyle = "#283593";
  ctx.fillRect(x + 3, legAreaY + leftLegLift + 1, legW, legH);
  ctx.fillRect(x + w - legW - 3, legAreaY + rightLegLift + 1, legW, legH);
  ctx.fillStyle = "#111111";
  ctx.fillRect(x + 1, legAreaY + leftLegLift + legH, legW + 4, 4);
  ctx.fillRect(x + w - legW - 5, legAreaY + rightLegLift + legH, legW + 4, 4);

  // Body
  drawPixelRect(ctx, x + 1, y + 8, w - 2, bodyH, "#1a237e");
  drawPixelRect(ctx, x + 2, y + 9, w - 4, bodyH - 2, "#283593");
  drawPixelRect(ctx, x + w / 2 - 3, y + 8, 6, 5, "#ffffff");
  drawPixelRect(ctx, x + 1, y + 8 + bodyH - 6, w - 2, 4, "#4a2c00");
  drawPixelRect(ctx, x + w / 2 - 2, y + 8 + bodyH - 6, 4, 4, "#d4a017");

  // Arms
  ctx.fillStyle = "#1a237e";
  ctx.fillRect(x - 6, y + 10 + armBob, 8, 5);
  ctx.fillRect(x + w - 2, y + 10 - armBob, 8, 5);
  ctx.fillStyle = "#f5cba7";
  ctx.beginPath();
  ctx.arc(x - 5, y + 12 + armBob, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + w + 6, y + 12 - armBob, 3, 0, Math.PI * 2);
  ctx.fill();

  // Head
  drawPixelRect(ctx, x + 3, y + 1, w - 6, 10, "#f5cba7");
  ctx.fillStyle = GB.darkest;
  ctx.fillRect(x + 5, y + 4, 3, 2);
  ctx.fillRect(x + w - 8, y + 4, 3, 2);
  ctx.strokeStyle = GB.darkest;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 3);
  ctx.lineTo(x + 9, y + 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + w - 4, y + 3);
  ctx.lineTo(x + w - 9, y + 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + w / 2, y + 10, 3, 0.3, Math.PI - 0.3, true);
  ctx.stroke();

  // Hat
  drawPixelRect(ctx, x + 2, y - 5, w - 4, 6, "#1a237e");
  drawPixelRect(ctx, x + 1, y - 2, w - 2, 3, "#0d1557");
  drawPixelRect(ctx, x - 1, y + 1, w + 2, 2, "#0d1557");
  ctx.fillStyle = "#ffd700";
  ctx.beginPath();
  ctx.arc(x + w / 2, y - 3, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a237e";
  ctx.beginPath();
  ctx.arc(x + w / 2, y - 3, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

// ─── Plant pot + gardener drawing ────────────────────────────────────────────

function drawPlantPot(
  ctx: CanvasRenderingContext2D,
  pot: PlantPot,
  screenX: number,
) {
  const x = Math.floor(screenX);
  const potY = Math.floor(pot.y);
  const potW = 28;
  const potH = 24;

  ctx.fillStyle = "#c1440e";
  ctx.beginPath();
  ctx.moveTo(x + 4, potY);
  ctx.lineTo(x + potW - 4, potY);
  ctx.lineTo(x + potW, potY + potH);
  ctx.lineTo(x, potY + potH);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#e05a1a";
  ctx.beginPath();
  ctx.moveTo(x + 5, potY + 2);
  ctx.lineTo(x + 9, potY + 2);
  ctx.lineTo(x + 11, potY + potH - 2);
  ctx.lineTo(x + 7, potY + potH - 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#8b2500";
  ctx.fillRect(x + 2, potY - 3, potW - 4, 5);
  ctx.fillStyle = "#c1440e";
  ctx.fillRect(x + 3, potY - 2, potW - 6, 3);
  ctx.fillStyle = "#3d1c02";
  ctx.fillRect(x + 3, potY - 1, potW - 6, 3);
  ctx.fillStyle = GB.dark;
  ctx.beginPath();
  ctx.arc(x + potW / 2, potY - 5, 4, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + potW / 2 - 5, potY - 3, 3, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + potW / 2 + 5, potY - 3, 3, Math.PI, 0);
  ctx.fill();

  if ((pot.gardenerVisible || pot.gardenerTimer > 0) && !pot.stomped) {
    const gx = x + potW / 2;
    const gy = Math.floor(pot.gardenerY);
    const alpha = Math.min(1, pot.gardenerTimer / 10);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.rect(x - 10, potY - 65, potW + 20, 65);
    ctx.clip();

    drawPixelRect(ctx, gx - 7, gy, 14, 18, "#2d5a1b");
    drawPixelRect(ctx, gx - 6, gy + 1, 12, 16, "#3d7a28");
    drawPixelRect(ctx, gx - 5, gy - 10, 10, 10, "#f5cba7");
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(gx - 4, gy - 8, 2, 2);
    ctx.fillRect(gx + 2, gy - 8, 2, 2);
    drawPixelRect(ctx, gx - 7, gy - 13, 14, 3, "#c8a000");
    drawPixelRect(ctx, gx - 5, gy - 16, 10, 4, "#c8a000");
    ctx.fillStyle = "#2d5a1b";
    ctx.fillRect(gx - 16, gy + 2, 10, 4);
    ctx.fillRect(gx + 6, gy + 2, 10, 4);
    ctx.strokeStyle = "#aaaaaa";
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(gx - 22, gy - 5);
    ctx.lineTo(gx - 8, gy + 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gx - 22, gy + 10);
    ctx.lineTo(gx - 8, gy - 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gx + 8, gy - 5);
    ctx.lineTo(gx + 22, gy + 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gx + 8, gy + 10);
    ctx.lineTo(gx + 22, gy - 5);
    ctx.stroke();
    ctx.restore();
  }

  if (pot.stomped && pot.squishTimer > 0) {
    const ratio = pot.squishTimer / 18;
    ctx.globalAlpha = ratio;
    ctx.fillStyle = "#3d7a28";
    ctx.fillRect(x - 4, potY - 4, potW + 8, 6);
    ctx.globalAlpha = 1.0;
  }
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, screenX: number) {
  if (e.type === "police") drawPolicemanEnemy(ctx, e, screenX);
  else drawAerosolEnemy(ctx, e, screenX);
}

// ─── Obstacle drawing ─────────────────────────────────────────────────────────

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  obs: Obstacle,
  worldOffset: number,
) {
  const sx = obs.x - worldOffset;
  if (sx + obs.width < -10 || sx > CANVAS_W + 10) return;
  const brickW = 12;
  const brickH = 8;
  const rows = Math.ceil(obs.height / brickH);
  const cols = Math.ceil(obs.width / brickW);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const offset = row % 2 === 0 ? 0 : brickW / 2;
      const bx = Math.floor(sx + col * brickW - offset);
      const by = Math.floor(obs.y + row * brickH);
      const bwActual = Math.min(brickW, obs.width - (col * brickW - offset));
      if (bwActual < 2) continue;
      drawPixelRect(ctx, bx + 1, by + 1, bwActual - 2, brickH - 2, GB.dark);
      drawPixelRect(ctx, bx, by, bwActual, 1, GB.darkest);
      drawPixelRect(ctx, bx, by, 1, brickH, GB.darkest);
    }
  }
  drawPixelRect(ctx, sx, obs.y, obs.width, 2, GB.light);
  drawPixelRect(ctx, sx, obs.y, 2, obs.height, GB.darkest);
  drawPixelRect(ctx, sx + obs.width - 2, obs.y, 2, obs.height, GB.darkest);
}

function drawPlatform(
  ctx: CanvasRenderingContext2D,
  p: Platform,
  worldOffset: number,
) {
  const sx = p.x - worldOffset;
  if (sx + p.width < -10 || sx > CANVAS_W + 10) return;

  if (p.moving) {
    ctx.save();
    ctx.shadowColor = "#8bac0f";
    ctx.shadowBlur = 6;
    drawPixelRect(ctx, sx, p.y, p.width, p.height, GB.dark);
    ctx.restore();
    drawPixelRect(ctx, sx, p.y, p.width, 3, GB.lightest);
    drawPixelRect(ctx, sx, p.y + p.height - 2, p.width, 2, GB.darkest);
    drawPixelRect(ctx, sx, p.y, 3, p.height, GB.darkest);
    drawPixelRect(ctx, sx + p.width - 3, p.y, 3, p.height, GB.darkest);
    const mid = sx + p.width / 2;
    const arrowY = p.y + p.height / 2 - 1;
    ctx.fillStyle = GB.lightest;
    ctx.beginPath();
    ctx.moveTo(mid - 14, arrowY);
    ctx.lineTo(mid - 8, arrowY - 3);
    ctx.lineTo(mid - 8, arrowY + 3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(mid + 14, arrowY);
    ctx.lineTo(mid + 8, arrowY - 3);
    ctx.lineTo(mid + 8, arrowY + 3);
    ctx.closePath();
    ctx.fill();
    return;
  }

  const brickW = 20;
  const brickH = 10;
  const rows = Math.ceil(p.height / brickH);
  const cols = Math.ceil(p.width / brickW);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const offset = row % 2 === 0 ? 0 : brickW / 2;
      const bx = Math.floor(sx + col * brickW - offset);
      const by = Math.floor(p.y + row * brickH);
      const bwActual = Math.min(brickW, p.width - (col * brickW - offset));
      if (bwActual < 2) continue;
      drawPixelRect(ctx, bx + 1, by + 1, bwActual - 2, brickH - 2, GB.dark);
      drawPixelRect(ctx, bx, by, bwActual, 1, GB.darkest);
      drawPixelRect(ctx, bx, by, 1, brickH, GB.darkest);
    }
  }
  drawPixelRect(ctx, sx, p.y, p.width, 2, GB.light);
}

function drawRouteArrow(ctx: CanvasRenderingContext2D, sx: number) {
  const ax = sx;
  const ay = GROUND_Y - 18;
  ctx.fillStyle = GB.lightest;
  ctx.fillRect(ax - 1, ay, 3, 16);
  ctx.beginPath();
  ctx.moveTo(ax + 1, ay - 6);
  ctx.lineTo(ax - 5, ay + 4);
  ctx.lineTo(ax + 7, ay + 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = GB.darkest;
  ctx.lineWidth = 0.8;
  ctx.strokeRect(ax - 8, ay - 8, 18, 26);
}

function drawLeafCloudCutout(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
) {
  // Matching fan silhouette — wider gaps so fingers are clearly independent
  const fingers: [number, number, number, number][] = [
    [0, 1.0, 0.13, 0],
    [0.62, 0.86, 0.12, 0.06],
    [-0.62, 0.86, 0.12, -0.06],
    [1.15, 0.74, 0.11, 0.08],
    [-1.15, 0.74, 0.11, -0.08],
    [1.65, 0.58, 0.09, 0.42],
    [-1.65, 0.58, 0.09, -0.42],
  ];

  ctx.save();
  ctx.translate(cx, cy);

  for (const [angle, lenFactor, hwFactor, curl] of fingers) {
    const L = r * lenFactor;
    const W = r * hwFactor;
    const TEETH = 4;
    const steps = TEETH * 6;

    ctx.save();
    ctx.rotate(angle + curl);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const bw =
        t < 0.2
          ? W * (t / 0.2) * 0.55
          : t < 0.4
            ? W * (0.55 + 0.45 * ((t - 0.2) / 0.2))
            : W * (1 - (t - 0.4) / 0.6);
      const toothAmp =
        t > 0.12 && t < 0.95
          ? bw * 0.25 * Math.max(0, Math.sin(t * TEETH * Math.PI))
          : 0;
      ctx.lineTo(bw + toothAmp, -L * t);
    }
    ctx.lineTo(0, -L);
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const bw =
        t < 0.2
          ? W * (t / 0.2) * 0.55
          : t < 0.4
            ? W * (0.55 + 0.45 * ((t - 0.2) / 0.2))
            : W * (1 - (t - 0.4) / 0.6);
      const toothAmp =
        t > 0.12 && t < 0.95
          ? bw * 0.25 * Math.max(0, Math.sin(t * TEETH * Math.PI))
          : 0;
      ctx.lineTo(-(bw + toothAmp), -L * t);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Stem
  const stemW = Math.max(1.5, r * 0.1);
  ctx.fillRect(-stemW / 2, 0, stemW, r * 0.22);
  ctx.restore();
}

function drawLeafCloud(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
) {
  // Each cloud is drawn onto an offscreen canvas so destination-out works
  // without affecting the main canvas composite mode
  const pad = r * 2.8;
  const offW = Math.ceil(r * 3.4 + pad);
  const offH = Math.ceil(r * 3.2 + pad);
  const offCanvas = document.createElement("canvas");
  offCanvas.width = offW;
  offCanvas.height = offH;
  const oc = offCanvas.getContext("2d");
  if (!oc) return;

  // Local origin inside the offscreen canvas
  const ox = offW / 2;
  const oy = offH / 2 + r * 0.3;

  // ── Step 1: Draw fluffy cloud blob (multiple overlapping circles) ──────────
  const grad = oc.createLinearGradient(ox, oy - r * 1.1, ox, oy + r * 0.7);
  grad.addColorStop(0, "#c8eebc"); // pale mint top
  grad.addColorStop(0.55, "#a8d898"); // mid sage
  grad.addColorStop(1, "#5aab52"); // darker green underside

  oc.fillStyle = grad;

  // Central body blob
  const blobs: [number, number, number][] = [
    [0, 0, r * 1.1],
    [-r * 0.75, -r * 0.18, r * 0.72],
    [r * 0.75, -r * 0.18, r * 0.72],
    [-r * 0.38, -r * 0.55, r * 0.58],
    [r * 0.38, -r * 0.55, r * 0.58],
    [0, -r * 0.7, r * 0.52],
    [-r * 1.15, r * 0.08, r * 0.52],
    [r * 1.15, r * 0.08, r * 0.52],
    [-r * 0.6, r * 0.35, r * 0.62],
    [r * 0.6, r * 0.35, r * 0.62],
    [0, r * 0.42, r * 0.55],
  ];
  for (const [bx, by, br] of blobs) {
    oc.beginPath();
    oc.arc(ox + bx, oy + by, br, 0, Math.PI * 2);
    oc.fill();
  }

  // ── Step 2: Cut out cannabis leaf from centre ───────────────────────────────
  oc.globalCompositeOperation = "destination-out";
  // Bigger cutout (0.92×r) centred slightly above cloud centre for a clear leaf shape
  drawLeafCloudCutout(oc, ox, oy - r * 0.18, r * 0.92);

  // ── Step 3: Stamp the offscreen cloud onto the main canvas ─────────────────
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.drawImage(offCanvas, cx - offW / 2, cy - offH / 2);
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, worldOffset: number) {
  ctx.fillStyle = GB.lightest;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  const hillOffset = worldOffset * 0.2;
  ctx.fillStyle = GB.light;
  for (let i = 0; i < 8; i++) {
    const hx = ((i * 120 - hillOffset) % (CANVAS_W + 120)) - 60;
    ctx.beginPath();
    ctx.arc(hx + 50, GROUND_Y - 18, 50, Math.PI, 0);
    ctx.fill();
  }
  const bushOffset = worldOffset * 0.5;
  ctx.fillStyle = GB.dark;
  for (let i = 0; i < 10; i++) {
    const bx = ((i * 90 - bushOffset + 30) % (CANVAS_W + 90)) - 45;
    ctx.beginPath();
    ctx.arc(bx + 15, GROUND_Y, 18, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx + 30, GROUND_Y - 4, 14, Math.PI, 0);
    ctx.fill();
  }
  const cloudOffset = worldOffset * 0.12;
  // More randomly spread: vary spacing, Y positions spread across full sky (22–110), varied sizes
  const cloudData = [
    { i: 0, baseY: 38, scale: 1.0, spacing: 115 },
    { i: 1, baseY: 82, scale: 0.68, spacing: 95 },
    { i: 2, baseY: 28, scale: 1.35, spacing: 145 },
    { i: 3, baseY: 65, scale: 0.85, spacing: 105 },
    { i: 4, baseY: 100, scale: 0.58, spacing: 80 },
    { i: 5, baseY: 48, scale: 1.15, spacing: 130 },
    { i: 6, baseY: 20, scale: 0.92, spacing: 120 },
    { i: 7, baseY: 75, scale: 1.25, spacing: 155 },
    { i: 8, baseY: 55, scale: 0.72, spacing: 90 },
  ];
  for (const { i, baseY, scale, spacing } of cloudData) {
    const cx2 =
      ((i * spacing - cloudOffset * (0.08 + i * 0.01) + 60) %
        (CANVAS_W + 200)) -
      100;
    drawLeafCloud(ctx, cx2, baseY, 36 * scale);
  }
}

function drawHUD(ctx: CanvasRenderingContext2D, gs: GameState) {
  const difficultyLevel = Math.min(Math.floor(gs.distance / 600) + 1, 10);
  drawPixelRect(ctx, 0, 0, CANVAS_W, 22, GB.darkest);
  drawPixelRect(ctx, 0, 22, CANVAS_W, 2, GB.dark);
  ctx.fillStyle = GB.lightest;
  ctx.font = "bold 10px 'Courier New', monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(`SCORE:${String(gs.score).padStart(6, "0")}`, 8, 12);
  ctx.fillText(`HI:${String(gs.hiScore).padStart(6, "0")}`, 148, 12);
  ctx.fillText(
    `DIST:${String(Math.floor(gs.distance)).padStart(5, "0")}m`,
    278,
    12,
  );
  ctx.fillText(`LVL:${String(difficultyLevel).padStart(2, "0")}`, 400, 12);
  for (let i = 0; i < gs.player.lives; i++) {
    const lx = CANVAS_W - 14 - i * 16;
    drawCannabisLeafShape(ctx, lx, 11, 5, GB.light, GB.darkest);
  }

  const sbW = 200;
  const sbH = 18;
  const sbX = CANVAS_W - sbW - 4;
  const sbY = CANVAS_H - sbH - 4;
  drawPixelRect(ctx, sbX - 2, sbY - 2, sbW + 4, sbH + 4, GB.darkest);
  drawPixelRect(ctx, sbX - 1, sbY - 1, sbW + 2, sbH + 2, GB.dark);
  drawPixelRect(ctx, sbX, sbY, sbW, sbH, GB.darkest);
  ctx.font = "bold 9px 'Courier New', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const midY = sbY + sbH / 2;
  drawHudSpliffIcon(ctx, sbX + 2, midY);
  ctx.fillStyle = GB.lightest;
  ctx.fillText(
    `SPLIFFS:${String(gs.spliffsSmoked).padStart(3, "0")}`,
    sbX + 20,
    midY,
  );
  ctx.fillStyle = GB.dark;
  ctx.fillRect(sbX + 98, sbY + 2, 2, sbH - 4);
  ctx.fillStyle = GB.light;
  ctx.font = "bold 10px 'Courier New', monospace";
  ctx.fillText("X", sbX + 105, midY - 1);
  ctx.fillStyle = GB.lightest;
  ctx.font = "bold 9px 'Courier New', monospace";
  ctx.fillText(
    `KILLS:${String(gs.enemiesKilled).padStart(3, "0")}`,
    sbX + 116,
    midY,
  );

  const progress =
    (gs.coinsCollected % SPLIFF_COIN_MILESTONE) / SPLIFF_COIN_MILESTONE;
  const barW = 100;
  const barH = 8;
  const barX = 6;
  const barY2 = CANVAS_H - barH - 6;
  drawPixelRect(ctx, barX - 1, barY2 - 1, barW + 2, barH + 2, GB.darkest);
  drawPixelRect(ctx, barX, barY2, barW, barH, GB.dark);
  if (progress > 0) {
    const r = Math.floor(155 + progress * 100);
    const g = Math.floor(188 + progress * 40);
    drawPixelRect(
      ctx,
      barX,
      barY2,
      Math.floor(barW * progress),
      barH,
      `rgb(${r},${g},15)`,
    );
  }
  ctx.font = "bold 8px 'Courier New', monospace";
  ctx.fillStyle = GB.lightest;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `420:${gs.coinsCollected % SPLIFF_COIN_MILESTONE}`,
    barX + barW + 5,
    barY2 + barH / 2,
  );
  if (gs.spliffTimer > 0) {
    const flashOn = Math.floor(gs.spliffTimer / 8) % 2 === 0;
    if (flashOn) {
      ctx.fillStyle = "#ff9900";
      ctx.font = "bold 9px 'Courier New', monospace";
      ctx.textAlign = "left";
      ctx.fillText("~BLAZIN~", barX, barY2 - 10);
    }
  }
}

function drawWaterDrop(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  offset: number,
) {
  const cy = y + Math.sin(offset * 0.05) * 3;
  ctx.fillStyle = GB.dark;
  ctx.beginPath();
  ctx.moveTo(x + 5, cy);
  ctx.bezierCurveTo(x + 9, cy + 4, x + 9, cy + 10, x + 5, cy + 12);
  ctx.bezierCurveTo(x + 1, cy + 10, x + 1, cy + 4, x + 5, cy);
  ctx.fill();
  ctx.fillStyle = GB.light;
  ctx.beginPath();
  ctx.arc(x + 4, cy + 5, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawSunRay(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  offset: number,
) {
  const cy = y + Math.sin(offset * 0.05) * 3;
  const cx = x + 6;
  ctx.fillStyle = GB.darkest;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + offset * 0.02;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(angle) * 9,
      cy + Math.sin(angle) * 9,
      2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.fillStyle = GB.light;
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = GB.lightest;
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();
}

// ─── Pseudo-random ────────────────────────────────────────────────────────────

function pseudoRandom(seed: number): number {
  const s = ((seed * 1664525 + 1013904223) & 0xffffffff) >>> 0;
  return s / 0xffffffff;
}

// ─── Spawning helpers ─────────────────────────────────────────────────────────

function trySpawnObstacle(
  gs: GameState,
  worldX: number,
  seed: number,
  difficultyLevel: number,
): boolean {
  if (worldX - gs.lastObstacleWorldX < MIN_OBSTACLE_GAP) return false;
  const wallW = 10 + Math.floor(pseudoRandom(seed) * 14);
  const baseH = 15 + Math.floor(pseudoRandom(seed + 1) * 55);
  const wallH = Math.min(baseH + difficultyLevel * 2, 70);
  gs.obstacles.push({
    x: worldX,
    y: GROUND_Y - wallH,
    width: wallW,
    height: wallH,
  });
  gs.lastObstacleWorldX = worldX;
  return true;
}

function spawnEnemy(
  gs: GameState,
  worldX: number,
  seed: number,
  platLeft: number,
  platRight: number,
  forceType?: "aerosol" | "police",
) {
  const type: "aerosol" | "police" =
    forceType ?? (pseudoRandom(seed + 99) > 0.5 ? "police" : "aerosol");
  gs.enemies.push({
    x: worldX,
    y: GROUND_Y - 36,
    width: 22,
    height: 36,
    vx: pseudoRandom(seed) > 0.5 ? 1.4 : -1.4,
    platformLeft: platLeft,
    platformRight: platRight,
    animFrame: 0,
    animTimer: 0,
    stomped: false,
    squishTimer: 0,
    type,
  });
  gs.lastEnemyFrame = gs.frameCount;
}

// ─── Chunk spawner ────────────────────────────────────────────────────────────

function spawnNewChunk(gs: GameState, chunkX: number) {
  const seed = gs.platformSeed++;
  const difficultyLevel = Math.min(Math.floor(gs.distance / 600) + 1, 10);
  const routeType =
    pseudoRandom(seed + 50) > 0.4 ? (pseudoRandom(seed + 51) > 0.5 ? 2 : 1) : 0;

  // HIGH ROUTE platforms
  if (routeType >= 1) {
    const numHighPlatforms = 1 + Math.floor(pseudoRandom(seed + 60) * 3);
    for (let pi = 0; pi < numHighPlatforms; pi++) {
      const pw = 40 + Math.floor(pseudoRandom(seed + 61 + pi) * 160);
      const platformY =
        GROUND_Y - 70 - Math.floor(pseudoRandom(seed + 62 + pi) * 60);
      const offsetX =
        pi * (pw + 20 + Math.floor(pseudoRandom(seed + 63 + pi) * 30));
      gs.platforms.push({
        x: chunkX + offsetX,
        y: platformY,
        width: pw,
        height: 12 + Math.floor(pseudoRandom(seed + 64 + pi) * 8),
        isGround: false,
      });

      const numC = 2 + Math.floor(pseudoRandom(seed + 65 + pi) * 4);
      for (let i = 0; i < numC; i++) {
        gs.collectibles.push({
          x: chunkX + offsetX + 8 + i * 18,
          y: platformY - 26,
          type: pseudoRandom(seed + 66 + pi + i) > 0.5 ? "sun" : "water",
          collected: false,
          floatOffset: Math.floor(pseudoRandom(seed + 67 + pi + i) * 60),
        });
      }

      if (pseudoRandom(seed + 68 + pi) < 0.33) {
        const etype: "aerosol" | "police" =
          pseudoRandom(seed + 69 + pi) > 0.5 ? "police" : "aerosol";
        gs.enemies.push({
          x: chunkX + offsetX + pw * 0.3,
          y: platformY - 36,
          width: 22,
          height: 36,
          vx: pseudoRandom(seed + 70 + pi) > 0.5 ? 1.2 : -1.2,
          platformLeft: chunkX + offsetX,
          platformRight: chunkX + offsetX + pw - 22,
          animFrame: 0,
          animTimer: 0,
          stomped: false,
          squishTimer: 0,
          type: etype,
        });
        gs.lastEnemyFrame = gs.frameCount;
      }
    }

    // Staircase variant
    if (pseudoRandom(seed + 80) > 0.6) {
      for (let step = 0; step < 3; step++) {
        const stepW = 35 + Math.floor(pseudoRandom(seed + 81 + step) * 25);
        const stepY = GROUND_Y - 50 - step * 28;
        gs.platforms.push({
          x: chunkX + 80 + step * (stepW + 8),
          y: stepY,
          width: stepW,
          height: 10,
          isGround: false,
        });
        gs.collectibles.push({
          x: chunkX + 85 + step * (stepW + 8),
          y: stepY - 22,
          type: "sun",
          collected: false,
          floatOffset: step * 20,
        });
      }
    }
  }

  // LOW ROUTE
  if (routeType === 0 || routeType === 2) {
    const obstacleChance = 0.55 + difficultyLevel * 0.04;
    if (pseudoRandom(seed + 10) < obstacleChance) {
      const wallX1 = chunkX + 20;
      const spawned1 = trySpawnObstacle(gs, wallX1, seed + 12, difficultyLevel);
      if (spawned1 && pseudoRandom(seed + 11) > 0.5)
        trySpawnObstacle(
          gs,
          wallX1 + MIN_OBSTACLE_GAP + 10,
          seed + 15,
          difficultyLevel,
        );
    }
    const gcCount = 2 + Math.floor(pseudoRandom(seed + 20) * 3);
    for (let i = 0; i < gcCount; i++) {
      gs.collectibles.push({
        x: chunkX + 15 + i * 18,
        y: GROUND_Y - 35,
        type: pseudoRandom(seed + 21 + i) > 0.6 ? "sun" : "water",
        collected: false,
        floatOffset: Math.floor(pseudoRandom(seed + 22 + i) * 60),
      });
    }
  }

  // Mid-height platform
  if (pseudoRandom(seed + 90) > 0.5) {
    const pw = 50 + Math.floor(pseudoRandom(seed + 91) * 80);
    const platY = GROUND_Y - 45 - Math.floor(pseudoRandom(seed + 92) * 30);
    gs.platforms.push({
      x: chunkX + 40,
      y: platY,
      width: pw,
      height: 10,
      isGround: false,
    });
    for (let i = 0; i < 3; i++) {
      gs.collectibles.push({
        x: chunkX + 44 + i * 16,
        y: platY - 22,
        type: i % 2 === 0 ? "sun" : "water",
        collected: false,
        floatOffset: i * 15,
      });
    }
  }
}

function spawnGuaranteedBatch(gs: GameState, worldX: number) {
  const seed = gs.platformSeed++;
  const difficultyLevel = Math.min(Math.floor(gs.distance / 600) + 1, 10);
  trySpawnObstacle(gs, worldX, seed + 1, difficultyLevel);
  const framesSinceEnemy = gs.frameCount - gs.lastEnemyFrame;
  if (
    framesSinceEnemy >= MAX_ENEMY_INTERVAL_FRAMES ||
    pseudoRandom(seed + 5) < 0.33
  )
    spawnEnemy(gs, worldX + 60, seed + 6, worldX + 30, worldX + 120);
  const gcCount = 3 + Math.floor(pseudoRandom(seed + 10) * 3);
  for (let i = 0; i < gcCount; i++) {
    gs.collectibles.push({
      x: worldX + 90 + i * 20,
      y: GROUND_Y - 45 - Math.floor(pseudoRandom(seed + 12 + i) * 30),
      type: pseudoRandom(seed + 11 + i) > 0.5 ? "sun" : "water",
      collected: false,
      floatOffset: Math.floor(pseudoRandom(seed + 13 + i) * 60),
    });
  }
}

// ─── Moving platforms — 6 total with large move ranges ───────────────────────

const MOVING_PLATFORMS: Platform[] = [
  {
    x: 900,
    y: GROUND_Y - 90,
    width: 70,
    height: 14,
    isGround: false,
    moving: true,
    moveOriginX: 900,
    moveRangeX: 240,
    moveSpeed: 0.9,
    moveDir: 1,
  },
  {
    x: 1600,
    y: GROUND_Y - 80,
    width: 65,
    height: 14,
    isGround: false,
    moving: true,
    moveOriginX: 1600,
    moveRangeX: 220,
    moveSpeed: 1.0,
    moveDir: -1,
  },
  {
    x: 2400,
    y: GROUND_Y - 110,
    width: 70,
    height: 14,
    isGround: false,
    moving: true,
    moveOriginX: 2400,
    moveRangeX: 260,
    moveSpeed: 1.2,
    moveDir: -1,
  },
  {
    x: 3200,
    y: GROUND_Y - 95,
    width: 65,
    height: 14,
    isGround: false,
    moving: true,
    moveOriginX: 3200,
    moveRangeX: 250,
    moveSpeed: 1.1,
    moveDir: 1,
  },
  {
    x: 4500,
    y: GROUND_Y - 100,
    width: 60,
    height: 14,
    isGround: false,
    moving: true,
    moveOriginX: 4500,
    moveRangeX: 270,
    moveSpeed: 1.3,
    moveDir: -1,
  },
  {
    x: 6000,
    y: GROUND_Y - 105,
    width: 60,
    height: 14,
    isGround: false,
    moving: true,
    moveOriginX: 6000,
    moveRangeX: 280,
    moveSpeed: 1.4,
    moveDir: 1,
  },
];

const ROUTE_ARROW_WORLD_POSITIONS: number[] = [
  600, 1200, 1900, 2700, 3600, 4800,
];

// ─── Initial state ────────────────────────────────────────────────────────────

function createInitialGameState(hiScore: number, gameSpeed = 1.0): GameState {
  const gs: GameState = {
    phase: "playing",
    score: 0,
    hiScore,
    distance: 0,
    worldOffset: 0,
    player: {
      x: PLAYER_START_X,
      y: GROUND_Y - 46,
      width: 34,
      height: 46,
      vx: 0,
      vy: 0,
      onGround: true,
      ducking: false,
      lives: 3,
      invincibleTimer: 0,
      animFrame: 0,
      animTimer: 0,
      facingRight: true,
      wasOnGround: true,
    },
    enemies: [],
    platforms: [
      { x: -100, y: GROUND_Y, width: 20000, height: 40, isGround: true },
      ...MOVING_PLATFORMS.map((mp) => ({ ...mp })),
    ],
    obstacles: [],
    collectibles: [],
    plantPots: [],
    spawnTimer: 0,
    platformSeed: 42,
    lastFrameTime: 0,
    scrollSpeed: SCROLL_BASE * gameSpeed,
    lastGuaranteedSpawnDist: 0,
    lastObstacleWorldX: -MIN_OBSTACLE_GAP * 2,
    lastEnemyFrame: -MAX_ENEMY_INTERVAL_FRAMES,
    frameCount: 0,
    events: [],
    coinsCollected: 0,
    spliffTimer: 0,
    spliffsSmoked: 0,
    enemiesKilled: 0,
    nextPotWorldX: 350,
    deathFadeTimer: 0,
  };
  for (let i = 0; i < 10; i++) spawnNewChunk(gs, CANVAS_W + i * 110);
  return gs;
}

// ─── Game Logic ───────────────────────────────────────────────────────────────

function updateGame(
  gs: GameState,
  keys: Set<string>,
  _dt: number,
  _frameCount: number,
): GameState {
  if (gs.phase !== "playing") return gs;

  const difficultyLevel = Math.min(Math.floor(gs.distance / 600) + 1, 10);
  const events: GameEvent[] = [];
  const currentFrame = gs.frameCount + 1;

  const p = { ...gs.player };
  const wasOnGround = p.onGround;

  const moveRight = keys.has("ArrowRight") || keys.has("KeyD");
  const moveLeft = keys.has("ArrowLeft") || keys.has("KeyA");
  const jumpKey = keys.has("ArrowUp") || keys.has("KeyW") || keys.has("Space");
  const duckKey = keys.has("ArrowDown") || keys.has("KeyS");

  p.ducking = duckKey;
  if (moveRight) {
    p.vx = PLAYER_SPEED;
    p.facingRight = true;
  } else if (moveLeft) {
    p.vx = -PLAYER_SPEED * 0.6;
    p.facingRight = false;
  } else {
    p.vx *= 0.75;
  }

  if (jumpKey && p.onGround && !p.ducking) {
    p.vy = JUMP_FORCE;
    p.onGround = false;
    events.push("jump");
  }

  p.vy += GRAVITY;
  p.y += p.vy;
  p.x += p.vx;
  if (p.x < 20) p.x = 20;
  if (p.x > CANVAS_W * 0.5) p.x = CANVAS_W * 0.5;

  let newWorldOffset = gs.worldOffset;
  if (p.x > PLAYER_START_X) {
    newWorldOffset += p.x - PLAYER_START_X + gs.scrollSpeed;
    p.x = PLAYER_START_X;
  }
  if (moveRight) newWorldOffset += gs.scrollSpeed;

  p.onGround = false;

  for (const plat of gs.platforms) {
    const sx = plat.x - newWorldOffset;
    if (sx > CANVAS_W + 20 || sx + plat.width < -20) continue;
    const pLeft = p.x;
    const pRight = p.x + p.width;
    const pBottom = p.y + p.height;
    const pTop = p.y;
    const platRight = sx + plat.width;
    const overlapX = pRight > sx && pLeft < platRight;
    if (
      overlapX &&
      p.vy >= 0 &&
      pBottom >= plat.y &&
      pBottom <= plat.y + plat.height + p.vy + 4
    ) {
      p.y = plat.y - p.height;
      p.vy = 0;
      p.onGround = true;
    } else if (
      !plat.isGround &&
      overlapX &&
      p.vy < 0 &&
      pTop <= plat.y + plat.height &&
      pTop >= plat.y
    ) {
      p.y = plat.y + plat.height;
      p.vy = 1;
    }
  }

  let newScore = gs.score;
  let newEnemiesKilled = gs.enemiesKilled;

  const newObstacles: Obstacle[] = [];
  for (const obs of gs.obstacles) {
    const sx = obs.x - newWorldOffset;
    if (sx + obs.width < -50 || sx > CANVAS_W + 100) continue;
    const pLeft = p.x;
    const pRight = p.x + p.width;
    const pBottom = p.y + p.height;
    const pTop = p.y;
    const obsRight = sx + obs.width;
    const overlapX = pRight > sx + 2 && pLeft < obsRight - 2;
    const overlapY = pBottom > obs.y + 2 && pTop < obs.y + obs.height;
    if (overlapX && overlapY) {
      if (
        p.vy >= 0 &&
        pBottom >= obs.y &&
        pBottom <= obs.y + 12 + Math.abs(p.vy)
      ) {
        p.y = obs.y - p.height;
        p.vy = 0;
        p.onGround = true;
      } else if (
        p.vy < 0 &&
        pTop <= obs.y + obs.height &&
        pTop >= obs.y + obs.height - 8
      ) {
        p.y = obs.y + obs.height;
        p.vy = 1;
      } else {
        const overlapFromLeft = pRight - sx;
        const overlapFromRight = obsRight - pLeft;
        if (overlapFromLeft < overlapFromRight) {
          p.x = sx - p.width;
          if (p.vx > 0) p.vx = 0;
        } else {
          p.x = obsRight;
          if (p.vx < 0) p.vx = 0;
        }
      }
    }
    newObstacles.push(obs);
  }

  if (p.y > CANVAS_H + 50) {
    p.lives -= 1;
    p.y = GROUND_Y - 46;
    p.vy = 0;
    p.invincibleTimer = 120;
    if (p.lives <= 0) {
      events.push("death");
      return {
        ...gs,
        player: p,
        phase: "gameover",
        hiScore: Math.max(gs.score, gs.hiScore),
        events,
        coinsCollected: gs.coinsCollected,
        spliffTimer: 0,
        spliffsSmoked: gs.spliffsSmoked,
        enemiesKilled: newEnemiesKilled,
        deathFadeTimer: 18,
      };
    }
    events.push("hit");
  }

  if (p.invincibleTimer > 0) p.invincibleTimer--;
  p.animTimer++;
  if (p.animTimer > 8) {
    p.animTimer = 0;
    p.animFrame = (p.animFrame + 1) % 4;
  }
  p.wasOnGround = wasOnGround;

  const newEnemies: Enemy[] = [];
  for (const e of gs.enemies) {
    const ne = { ...e };
    const screenX = ne.x - newWorldOffset;
    if (screenX < -100 || screenX > CANVAS_W + 200) continue;
    if (ne.stomped) {
      ne.squishTimer--;
      if (ne.squishTimer <= 0) continue;
      newEnemies.push(ne);
      continue;
    }
    ne.x += ne.vx;
    if (ne.x < ne.platformLeft) {
      ne.x = ne.platformLeft;
      ne.vx = Math.abs(ne.vx);
    }
    if (ne.x > ne.platformRight) {
      ne.x = ne.platformRight;
      ne.vx = -Math.abs(ne.vx);
    }
    ne.animTimer++;
    if (ne.animTimer > 10) {
      ne.animTimer = 0;
      ne.animFrame = (ne.animFrame + 1) % 2;
    }
    const eScreenX = ne.x - newWorldOffset;
    const hitX =
      Math.abs(p.x + p.width / 2 - (eScreenX + ne.width / 2)) <
      p.width / 2 + ne.width / 2 - 4;
    const stompCheck =
      hitX &&
      p.vy > 0 &&
      p.y + p.height >= ne.y &&
      p.y + p.height <= ne.y + ne.height * 0.5 &&
      !wasOnGround;
    if (stompCheck) {
      ne.stomped = true;
      ne.squishTimer = 18;
      p.vy = -7;
      newScore += 50;
      newEnemiesKilled++;
      events.push("stomp");
      newEnemies.push(ne);
      continue;
    }
    if (p.invincibleTimer <= 0) {
      const hitY =
        Math.abs(p.y + p.height / 2 - (ne.y + ne.height / 2)) <
        p.height / 2 + ne.height / 2 - 4;
      if (hitX && hitY) {
        p.lives -= 1;
        p.invincibleTimer = 120;
        if (p.lives <= 0) {
          events.push("death");
          return {
            ...gs,
            player: { ...p, lives: 0 },
            enemies: gs.enemies,
            phase: "gameover",
            hiScore: Math.max(gs.score, gs.hiScore),
            events,
            coinsCollected: gs.coinsCollected,
            spliffTimer: 0,
            spliffsSmoked: gs.spliffsSmoked,
            enemiesKilled: newEnemiesKilled,
            deathFadeTimer: 18,
          };
        }
        events.push("hit");
      }
    }
    newEnemies.push(ne);
  }

  // Plant pots
  const newPlantPots: PlantPot[] = [];
  let potWorldX = gs.nextPotWorldX;
  const tempPots = [...gs.plantPots];
  while (potWorldX < newWorldOffset + CANVAS_W + 400) {
    if (pseudoRandom(potWorldX) > 0.3) {
      tempPots.push({
        worldX: potWorldX,
        y: GROUND_Y - 24,
        triggered: false,
        gardenerVisible: false,
        gardenerTimer: 0,
        gardenerY: GROUND_Y - 24,
        stomped: false,
        squishTimer: 0,
        retreating: false,
      });
    }
    potWorldX += 300 + Math.floor(pseudoRandom(potWorldX + 1) * 200);
  }
  const potW = 28;
  for (const pot of tempPots) {
    const np = { ...pot };
    const screenX = np.worldX - newWorldOffset;
    if (screenX < -200 || screenX > CANVAS_W + 200) {
      newPlantPots.push(np);
      continue;
    }
    if (np.stomped) {
      np.squishTimer--;
      if (np.squishTimer > 0) newPlantPots.push(np);
      continue;
    }
    const potMidX = screenX + potW / 2;
    const playerMidX = p.x + p.width / 2;
    const dist = Math.abs(playerMidX - potMidX);
    if (dist < 120 && !np.triggered) {
      np.triggered = true;
      np.gardenerVisible = true;
      np.retreating = false;
    }
    if (dist > 200 && np.triggered && !np.gardenerVisible) np.triggered = false;
    const fullUpY = np.y - 28;
    if (np.gardenerVisible && !np.retreating) {
      np.gardenerY = Math.max(fullUpY, np.gardenerY - 2.5);
      np.gardenerTimer = Math.min(20, np.gardenerTimer + 2);
    } else if (np.retreating) {
      np.gardenerY = Math.min(np.y, np.gardenerY + 2.5);
      np.gardenerTimer = Math.max(0, np.gardenerTimer - 2);
      if (np.gardenerY >= np.y) {
        np.gardenerVisible = false;
        np.retreating = false;
        np.triggered = false;
      }
    }
    if (np.gardenerVisible && np.gardenerTimer > 5) {
      const gardenTop = np.gardenerY - 10;
      const gardenLeft = screenX + potW / 2 - 10;
      const gardenRight = screenX + potW / 2 + 10;
      const pRight = p.x + p.width;
      const pLeft2 = p.x;
      const pBottom = p.y + p.height;
      const hitX2 = pRight > gardenLeft && pLeft2 < gardenRight;
      const stompG =
        hitX2 &&
        p.vy > 0 &&
        pBottom >= gardenTop &&
        pBottom <= gardenTop + 14 &&
        !wasOnGround;
      if (stompG) {
        np.stomped = true;
        np.squishTimer = 18;
        p.vy = -7;
        newScore += 50;
        newEnemiesKilled++;
        events.push("stomp");
        newPlantPots.push(np);
        continue;
      }
      if (p.invincibleTimer <= 0) {
        const gardenBottom = np.gardenerY + 18;
        const hitY2 = pBottom > gardenTop + 4 && p.y < gardenBottom;
        if (hitX2 && hitY2 && !stompG) {
          p.lives -= 1;
          p.invincibleTimer = 120;
          if (p.lives <= 0) {
            events.push("death");
            return {
              ...gs,
              player: { ...p, lives: 0 },
              phase: "gameover",
              hiScore: Math.max(gs.score, gs.hiScore),
              events,
              coinsCollected: gs.coinsCollected,
              spliffTimer: 0,
              spliffsSmoked: gs.spliffsSmoked,
              enemiesKilled: newEnemiesKilled,
              deathFadeTimer: 18,
            };
          }
          events.push("hit");
          np.retreating = true;
        }
      }
    }
    newPlantPots.push(np);
  }

  let newCoinsCollected = gs.coinsCollected;
  let newSpliffTimer = gs.spliffTimer > 0 ? gs.spliffTimer - 1 : 0;
  let newSpliffsSmoked = gs.spliffsSmoked;

  const newCollectibles = gs.collectibles.map((c) => {
    if (c.collected) return c;
    const cScreenX = c.x - newWorldOffset;
    if (cScreenX < -50 || cScreenX > CANVAS_W + 50) return c;
    const nc = { ...c, floatOffset: c.floatOffset + 1 };
    const cy = c.y + Math.sin(nc.floatOffset * 0.05) * 3;
    const hitX = Math.abs(p.x + p.width / 2 - (cScreenX + 5)) < p.width / 2 + 8;
    const hitY = Math.abs(p.y + p.height / 2 - cy) < p.height / 2 + 8;
    if (hitX && hitY) {
      if (c.type === "sun") {
        newScore += 25;
        events.push("collect_sun");
      } else {
        newScore += 10;
        events.push("collect_water");
      }
      newCoinsCollected++;
      if (newCoinsCollected % SPLIFF_COIN_MILESTONE === 0) {
        newSpliffTimer = SPLIFF_DURATION_FRAMES;
        newSpliffsSmoked++;
        events.push("spliff_lit");
      }
      return { ...nc, collected: true };
    }
    return nc;
  });

  const updatedPlatforms = gs.platforms.map((pl) => {
    if (!pl.moving) return pl;
    const np = { ...pl };
    np.x += (np.moveSpeed ?? 1) * (np.moveDir ?? 1);
    const origin = np.moveOriginX ?? np.x;
    const range = np.moveRangeX ?? 100;
    if (np.x > origin + range) {
      np.x = origin + range;
      np.moveDir = -1;
    } else if (np.x < origin - range) {
      np.x = origin - range;
      np.moveDir = 1;
    }
    return np;
  });

  const spawnEdge = newWorldOffset + CANVAS_W + 100;
  let lastPlatformX = Math.max(
    ...gs.platforms.map((p2) => p2.x + p2.width),
    spawnEdge - 200,
  );
  const newPlatforms = [...updatedPlatforms];
  let newPlatformSeed = gs.platformSeed;
  const tempGs = {
    ...gs,
    platforms: newPlatforms,
    enemies: newEnemies,
    obstacles: newObstacles,
    collectibles: newCollectibles,
    plantPots: newPlantPots,
    platformSeed: newPlatformSeed,
    frameCount: currentFrame,
    events,
  };

  while (lastPlatformX < spawnEdge + 200) {
    const gap = 45 + Math.floor(pseudoRandom(newPlatformSeed) * 60);
    spawnNewChunk(tempGs, lastPlatformX + gap);
    newPlatformSeed = tempGs.platformSeed;
    lastPlatformX += gap + 90;
  }

  const newDistance = gs.distance + (newWorldOffset - gs.worldOffset);
  let lastGuaranteedSpawnDist = gs.lastGuaranteedSpawnDist;
  while (newDistance - lastGuaranteedSpawnDist >= GUARANTEED_SPAWN_INTERVAL) {
    lastGuaranteedSpawnDist += GUARANTEED_SPAWN_INTERVAL;
    spawnGuaranteedBatch(tempGs, newWorldOffset + CANVAS_W + 60);
    newPlatformSeed = tempGs.platformSeed;
  }

  const liveEnemiesOnScreen = tempGs.enemies.filter(
    (e) =>
      !e.stomped &&
      e.x - newWorldOffset > -50 &&
      e.x - newWorldOffset < CANVAS_W + 100,
  ).length;
  if (
    currentFrame - tempGs.lastEnemyFrame >= MAX_ENEMY_INTERVAL_FRAMES &&
    liveEnemiesOnScreen < 2
  ) {
    const enemyWorldX = newWorldOffset + CANVAS_W + 80;
    spawnEnemy(
      tempGs,
      enemyWorldX,
      tempGs.platformSeed++,
      enemyWorldX - 50,
      enemyWorldX + 100,
    );
    newPlatformSeed = tempGs.platformSeed;
  }

  let liveCount = 0;
  const cappedEnemies = tempGs.enemies.filter((e) => {
    if (e.stomped) return true;
    liveCount++;
    return liveCount <= 2;
  });
  tempGs.enemies.length = 0;
  for (const e of cappedEnemies) tempGs.enemies.push(e);

  const culledPlatforms = tempGs.platforms.filter(
    (pl) => pl.moving || pl.x + pl.width > newWorldOffset - 200,
  );
  // The gameSpeed multiplier is preserved by basing ramp on current scrollSpeed's ratio to SCROLL_BASE
  // Approximate the initial multiplier from the current state
  const gsMultiplier =
    gs.distance < 50
      ? gs.scrollSpeed / SCROLL_BASE
      : Math.max(
          0.5,
          gs.scrollSpeed /
            (SCROLL_BASE + Math.min(gs.distance / 3000, difficultyLevel * 0.3)),
        );
  const newScrollSpeed = Math.min(
    SCROLL_BASE * gsMultiplier + gs.distance / 3000,
    SCROLL_BASE * gsMultiplier + difficultyLevel * 0.3,
  );

  return {
    ...gs,
    player: p,
    enemies: tempGs.enemies,
    platforms: culledPlatforms,
    obstacles: tempGs.obstacles.filter((o) => o.x > newWorldOffset - 100),
    collectibles: tempGs.collectibles.filter((c) => c.x > newWorldOffset - 100),
    plantPots: tempGs.plantPots.filter(
      (pt) => pt.worldX > newWorldOffset - 200,
    ),
    worldOffset: newWorldOffset,
    score: newScore + Math.floor(newScrollSpeed * 0.1),
    hiScore: Math.max(newScore, gs.hiScore),
    distance: newDistance,
    platformSeed: newPlatformSeed,
    scrollSpeed: newScrollSpeed,
    lastGuaranteedSpawnDist,
    lastObstacleWorldX: tempGs.lastObstacleWorldX,
    lastEnemyFrame: tempGs.lastEnemyFrame,
    frameCount: currentFrame,
    events,
    coinsCollected: newCoinsCollected,
    spliffTimer: newSpliffTimer,
    spliffsSmoked: newSpliffsSmoked,
    enemiesKilled: newEnemiesKilled,
    nextPotWorldX: potWorldX,
    deathFadeTimer: gs.deathFadeTimer,
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SkunkRunner() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gsRef = useRef<GameState | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number>(0);
  const frameCountRef = useRef(0);
  const hiScoreRef = useRef(0);
  const touchRef = useRef({ left: false, jump: false, right: false });
  const soundRef = useRef<ReturnType<typeof createSoundEngine> | null>(null);
  const soundOnRef = useRef(true);
  const gameSpeedRef = useRef(1.0);
  const phaseRef = useRef<
    "start" | "settings" | "playing" | "paused" | "gameover"
  >("start");
  const settingsReturnPhaseRef = useRef<"start" | "paused">("start");

  // Load Press Start 2P retro pixel font
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap";
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  const [phase, setPhaseState] = useState<
    "start" | "settings" | "playing" | "paused" | "gameover"
  >("start");

  const setPhase = useCallback(
    (p: "start" | "settings" | "playing" | "paused" | "gameover") => {
      phaseRef.current = p;
      setPhaseState(p);
    },
    [],
  );
  const [score, setScore] = useState(0);
  const [hiScore, setHiScore] = useState(0);
  const [_lives, setLives] = useState(3);
  const [spliffsSmoked, setSpliffsSmoked] = useState(0);
  const [enemiesKilled, setEnemiesKilled] = useState(0);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);

  // Sync refs with settings state
  useEffect(() => {
    soundOnRef.current = settings.soundOn;
    gameSpeedRef.current = settings.gameSpeed;
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<GameSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      soundOnRef.current = next.soundOn;
      gameSpeedRef.current = next.gameSpeed;
      return next;
    });
  }, []);

  const ensureSound = useCallback(() => {
    if (!soundRef.current) soundRef.current = createSoundEngine();
    return soundRef.current;
  }, []);

  const startGame = useCallback(() => {
    const snd = ensureSound();
    gsRef.current = createInitialGameState(
      hiScoreRef.current,
      gameSpeedRef.current,
    );
    setPhase("playing");
    setScore(0);
    setLives(3);
    setSpliffsSmoked(0);
    setEnemiesKilled(0);
    if (soundOnRef.current) snd.start();
  }, [ensureSound, setPhase]);

  const togglePause = useCallback(() => {
    if (!gsRef.current) return;
    if (gsRef.current.phase === "playing") {
      gsRef.current.phase = "paused";
      setPhase("paused");
    } else if (gsRef.current.phase === "paused") {
      gsRef.current.phase = "playing";
      setPhase("playing");
    }
  }, [setPhase]);

  const goToMainMenu = useCallback(() => {
    if (gsRef.current) gsRef.current.phase = "paused"; // keep paused while transitioning
    gsRef.current = null;
    setPhase("start");
  }, [setPhase]);

  const openSettingsFromPause = useCallback(() => {
    if (gsRef.current) gsRef.current.phase = "paused";
    settingsReturnPhaseRef.current = "paused";
    setPhase("settings");
  }, [setPhase]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    let prevTime = -1;

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        prevTime = -1; // reset so next frame doesn't get a massive dt
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    function loop(time: number) {
      rafRef.current = requestAnimationFrame(loop);
      const gs = gsRef.current;
      const currentPhase = phaseRef.current;
      // Render start animation for start/settings phases
      if (!gs || currentPhase === "settings" || currentPhase === "start") {
        prevTime = time;
        // Never suppress the "PRESS SPACE" prompt - settings panel is an overlay, not a phase replacement
        drawStartScreen(ctx!, false);
        return;
      }
      if (prevTime < 0) prevTime = time;
      const dt = Math.min((time - prevTime) / 16.67, 1);
      prevTime = time;
      frameCountRef.current++;
      if (gs.phase === "playing") {
        const keys = new Set(keysRef.current);
        if (touchRef.current.left) keys.add("ArrowLeft");
        if (touchRef.current.jump) keys.add("Space");
        if (touchRef.current.right) keys.add("ArrowRight");
        const newGs = updateGame(gs, keys, dt, frameCountRef.current);
        gsRef.current = newGs;
        if (soundRef.current && soundOnRef.current && newGs.events.length > 0) {
          const snd = soundRef.current;
          for (const ev of newGs.events) {
            if (ev === "jump") snd.jump();
            else if (ev === "collect_water") snd.collectWater();
            else if (ev === "collect_sun") snd.collectSun();
            else if (ev === "hit") snd.hit();
            else if (ev === "death") snd.death();
            else if (ev === "stomp") snd.stomp();
            else if (ev === "spliff_lit") snd.spliffLit();
          }
        }
        if (newGs.phase === "gameover") {
          hiScoreRef.current = Math.max(hiScoreRef.current, newGs.score);
          setHiScore(hiScoreRef.current);
          setScore(newGs.score);
          setSpliffsSmoked(newGs.spliffsSmoked);
          setEnemiesKilled(newGs.enemiesKilled);
          setPhase("gameover");
        } else {
          setScore(newGs.score);
          setLives(newGs.player.lives);
        }
      }
      // Tick down death fade timer when in gameover
      if (
        gsRef.current?.phase === "gameover" &&
        gsRef.current.deathFadeTimer > 0
      ) {
        gsRef.current = {
          ...gsRef.current,
          deathFadeTimer: gsRef.current.deathFadeTimer - 1,
        };
      }
      renderFrame(ctx!, gsRef.current!);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [setPhase]);

  function drawStartScreen(
    ctx: CanvasRenderingContext2D,
    suppressPrompt = false,
  ) {
    const now = Date.now();

    // ── Background ──────────────────────────────────────────────────────────────
    ctx.fillStyle = GB.lightest;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    // Retro stripe background
    ctx.fillStyle = GB.light;
    for (let i = 0; i < 6; i++) ctx.fillRect(i * 80, 0, 40, CANVAS_H);

    // ── Drifting cannabis-leaf clouds ────────────────────────────────────────────
    const cloudT = now * 0.00008;
    const introClouds = [
      { baseX: 60, cy: 32, r: 28, speed: 1.0 },
      { baseX: 280, cy: 22, r: 22, speed: 0.7 },
      { baseX: 420, cy: 42, r: 32, speed: 1.2 },
    ];
    for (const { baseX, cy, r, speed } of introClouds) {
      const cx2 = ((baseX + cloudT * speed * 60) % (CANVAS_W + 120)) - 60;
      drawLeafCloud(ctx, cx2, cy, r);
    }

    // ── Title block ──────────────────────────────────────────────────────────────
    const PIXEL_FONT = "'Press Start 2P', 'Courier New', monospace";
    const titleY1 = 52;
    const titleY2 = 86;

    // Shadow layers for blocky outline effect (draw 3 times offset)
    const shadowOffsets = [
      [3, 3],
      [2, 2],
      [1, 1],
    ];
    for (const [ox, oy] of shadowOffsets) {
      ctx.font = `32px ${PIXEL_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = GB.darkest;
      ctx.fillText("SKUNK", CANVAS_W / 2 + ox, titleY1 + oy);
      ctx.fillText("RUNNER", CANVAS_W / 2 + ox, titleY2 + oy);
    }
    // Main title text
    ctx.font = `32px ${PIXEL_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = GB.lightest;
    ctx.fillText("SKUNK", CANVAS_W / 2, titleY1);
    ctx.fillStyle = GB.light;
    ctx.fillText("RUNNER", CANVAS_W / 2, titleY2);

    // ── Dancing character ─────────────────────────────────────────────────────────
    const px = CANVAS_W / 2;
    const leafR = 52;
    // Dance frame: 6-frame cycle at 200ms each
    const danceFrame = Math.floor(now / 200) % 6;
    // Body bounce: frame 4 = up, frame 5 = down (squash), else neutral
    const bodyBounce = danceFrame === 4 ? -4 : danceFrame === 5 ? 3 : 0;
    // Body lean angle
    const bodyLean = danceFrame === 1 ? 0.15 : danceFrame === 3 ? -0.15 : 0;
    // Arm angles:
    // frame 0: left arm up, right down
    // frame 1: both at sides
    // frame 2: right arm up, left down
    // frame 3: both at sides
    // frame 4: both raised
    // frame 5: both lowered
    const leftArmUp =
      danceFrame === 0
        ? -18
        : danceFrame === 4
          ? -14
          : danceFrame === 5
            ? 6
            : 2;
    const rightArmUp =
      danceFrame === 2
        ? -18
        : danceFrame === 4
          ? -14
          : danceFrame === 5
            ? 6
            : 2;

    const py = 165 + bodyBounce;

    ctx.save();
    ctx.translate(px, py + leafR * 0.5);
    ctx.rotate(bodyLean);
    ctx.translate(-px, -py - leafR * 0.5);

    // Leaf body
    drawCannabisLeafShape(ctx, px, py, leafR, GB.dark, GB.darkest);

    // Eyes
    const eyeY = py + 2;
    drawBloodshotEyes(ctx, px - 13, eyeY, px + 13, eyeY, 11);

    // Mouth + spliff always visible on intro
    drawLeafMouth(ctx, px, py + 20, 22);
    drawSpliff(ctx, px, py + 20, 22, 1.0);

    // Eyebrow arch
    ctx.strokeStyle = GB.darkest;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(px - 22, eyeY - 12);
    ctx.quadraticCurveTo(px, eyeY - 16, px + 22, eyeY - 12);
    ctx.stroke();

    // Arms
    const armBaseY = py + 10;
    const armLen = 22;
    // Left arm
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(
      Math.floor(px - armLen - 38),
      armBaseY + leftArmUp - 1,
      armLen + 2,
      9,
    );
    ctx.fillStyle = GB.dark;
    ctx.fillRect(Math.floor(px - armLen - 37), armBaseY + leftArmUp, armLen, 7);
    drawMickeyGlove(
      ctx,
      Math.floor(px - armLen - 40),
      armBaseY + leftArmUp + 3,
      12,
      false,
    );
    // Right arm
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(Math.floor(px + 36), armBaseY + rightArmUp - 1, armLen + 2, 9);
    ctx.fillStyle = GB.dark;
    ctx.fillRect(Math.floor(px + 37), armBaseY + rightArmUp, armLen, 7);
    drawMickeyGlove(
      ctx,
      Math.floor(px + 58),
      armBaseY + rightArmUp + 3,
      12,
      true,
    );

    ctx.restore();

    // Legs (outside lean for natural feel)
    const legBaseY = py + leafR * 0.9 + 10;
    const legW2 = 10;
    const thighH2 = 12;
    const shinH2 = 13;
    // Dance leg bob
    const legBob = danceFrame % 2 === 0 ? -4 : 0;
    const legBob2 = danceFrame % 2 === 1 ? -4 : 0;
    const lBend = danceFrame % 2 === 0 ? -4 : 3;
    const rBend = danceFrame % 2 === 1 ? -4 : 3;

    // Left leg
    const llX = Math.floor(px - 19);
    const llKneeX = llX + lBend;
    const llKneeY = legBaseY + legBob + thighH2;
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(llX - 1, legBaseY + legBob - 1, legW2 + 2, thighH2 + 2);
    ctx.fillStyle = GB.dark;
    ctx.fillRect(llX, legBaseY + legBob, legW2, thighH2);
    ctx.fillStyle = GB.darkest;
    ctx.beginPath();
    ctx.arc(llKneeX + legW2 / 2, llKneeY, legW2 * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = GB.light;
    ctx.beginPath();
    ctx.arc(llKneeX + legW2 / 2, llKneeY, legW2 * 0.44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(llKneeX - 1, llKneeY, legW2 + 2, shinH2 + 1);
    ctx.fillStyle = GB.dark;
    ctx.fillRect(llKneeX, llKneeY, legW2, shinH2);
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(llKneeX - 3, llKneeY + shinH2 - 1, legW2 + 8, 5);

    // Right leg
    const rlX = Math.floor(px + 9);
    const rlKneeX = rlX + rBend;
    const rlKneeY = legBaseY + legBob2 + thighH2;
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(rlX - 1, legBaseY + legBob2 - 1, legW2 + 2, thighH2 + 2);
    ctx.fillStyle = GB.dark;
    ctx.fillRect(rlX, legBaseY + legBob2, legW2, thighH2);
    ctx.fillStyle = GB.darkest;
    ctx.beginPath();
    ctx.arc(rlKneeX + legW2 / 2, rlKneeY, legW2 * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = GB.light;
    ctx.beginPath();
    ctx.arc(rlKneeX + legW2 / 2, rlKneeY, legW2 * 0.44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(rlKneeX - 1, rlKneeY, legW2 + 2, shinH2 + 1);
    ctx.fillStyle = GB.dark;
    ctx.fillRect(rlKneeX, rlKneeY, legW2, shinH2);
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(rlKneeX - 3, rlKneeY + shinH2 - 1, legW2 + 8, 5);

    // ── Instructions (only shown when NOT suppressed by menu overlay) ──────────
    if (!suppressPrompt) {
      ctx.fillStyle = GB.darkest;
      ctx.font = `bold 8px ${PIXEL_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("PRESS SPACE OR TAP TO START", CANVAS_W / 2, 258);
      ctx.font = `7px 'Courier New', monospace`;
      ctx.fillText(
        "ARROWS: MOVE  |  SPACE: JUMP  |  P: PAUSE",
        CANVAS_W / 2,
        274,
      );
      ctx.fillText(
        "STOMP ENEMIES + GARDENERS — AVOID WEED KILLER!",
        CANVAS_W / 2,
        287,
      );
    }

    ctx.font = "7px 'Courier New', monospace";
    ctx.fillStyle = GB.dark;
    ctx.fillText(
      `© ${new Date().getFullYear()} SKUNK RUNNER  |  BUILT WITH CAFFEINE.AI`,
      CANVAS_W / 2,
      308,
    );
  }

  function renderFrame(ctx: CanvasRenderingContext2D, gs: GameState) {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = GB.lightest;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawBackground(ctx, gs.worldOffset);
    const gp = gs.platforms.find((p2) => p2.isGround);
    if (gp) {
      drawPixelRect(ctx, 0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y, GB.dark);
      drawPixelRect(ctx, 0, GROUND_Y, CANVAS_W, 4, GB.darkest);
    }

    for (const plat of gs.platforms) {
      if (!plat.isGround) drawPlatform(ctx, plat, gs.worldOffset);
    }

    for (const arrowWorldX of ROUTE_ARROW_WORLD_POSITIONS) {
      const sx = arrowWorldX - gs.worldOffset;
      if (sx > -20 && sx < CANVAS_W + 20) drawRouteArrow(ctx, sx);
    }

    for (const obs of gs.obstacles) drawObstacle(ctx, obs, gs.worldOffset);

    for (const pot of gs.plantPots) {
      const sx = pot.worldX - gs.worldOffset;
      if (sx < -50 || sx > CANVAS_W + 50) continue;
      drawPlantPot(ctx, pot, sx);
    }

    for (const c of gs.collectibles) {
      if (c.collected) continue;
      const cx = c.x - gs.worldOffset;
      if (cx < -20 || cx > CANVAS_W + 20) continue;
      if (c.type === "water")
        drawWaterDrop(
          ctx,
          cx,
          c.y + Math.sin(c.floatOffset * 0.05) * 3,
          c.floatOffset,
        );
      else
        drawSunRay(
          ctx,
          cx,
          c.y + Math.sin(c.floatOffset * 0.05) * 3,
          c.floatOffset,
        );
    }

    for (const e of gs.enemies) {
      const ex = e.x - gs.worldOffset;
      if (ex < -50 || ex > CANVAS_W + 50) continue;
      if (e.stomped) {
        const squishRatio = e.squishTimer / 18;
        const flatH = Math.max(4, e.height * 0.18 * squishRatio);
        const flatW = e.width * (1 + (1 - squishRatio) * 0.6);
        ctx.globalAlpha = squishRatio;
        drawPixelRect(
          ctx,
          ex - (flatW - e.width) / 2,
          e.y + e.height - flatH,
          flatW,
          flatH,
          e.type === "police" ? "#1a237e" : "#cc2200",
        );
        drawPixelRect(
          ctx,
          ex - (flatW - e.width) / 2,
          e.y + e.height - flatH,
          flatW,
          2,
          GB.darkest,
        );
        ctx.fillStyle = GB.lightest;
        for (let s = 0; s < 5; s++) {
          const sa = (s / 5) * Math.PI * 2;
          const sr = 6 + (1 - squishRatio) * 8;
          ctx.beginPath();
          ctx.arc(
            ex + e.width / 2 + Math.cos(sa) * sr,
            e.y + e.height - flatH - Math.sin(sa) * sr * 0.6,
            2,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.globalAlpha = 1.0;
      } else {
        drawEnemy(ctx, e, ex);
      }
    }

    const spliffAlpha =
      gs.spliffTimer > 0
        ? Math.min(1, gs.spliffTimer / (SPLIFF_DURATION_FRAMES * 0.2))
        : 0;
    drawPlayer(ctx, gs.player, gs.player.x, spliffAlpha);
    drawHUD(ctx, gs);

    if (gs.phase === "paused") {
      ctx.fillStyle = "rgba(15, 56, 15, 0.72)";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = GB.lightest;
      ctx.font = "bold 20px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("PAUSED", CANVAS_W / 2, CANVAS_H / 2 - 38);
      ctx.font = "11px 'Courier New', monospace";
      ctx.fillText("PRESS P TO RESUME", CANVAS_W / 2, CANVAS_H / 2 - 14);
    }

    // Fast death fade overlay
    if (gs.phase === "gameover" && gs.deathFadeTimer > 0) {
      const alpha = (gs.deathFadeTimer / 18) * 0.92;
      ctx.fillStyle = `rgba(15,56,15,${alpha})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const relevant = [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "KeyA",
        "KeyD",
        "KeyW",
        "KeyS",
        "Space",
        "KeyP",
      ];
      if (relevant.includes(e.code)) e.preventDefault();
      keysRef.current.add(e.code);
      if (e.code === "KeyP") togglePause();
      if (
        (e.code === "Space" || e.code === "Enter") &&
        (phase === "start" || phase === "gameover")
      )
        startGame();
    }
    function onKeyUp(e: KeyboardEvent) {
      keysRef.current.delete(e.code);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [phase, startGame, togglePause]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function onTouchStart(e: TouchEvent) {
      e.preventDefault();
      if (phase === "start" || phase === "gameover") {
        startGame();
        return;
      }
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        const rect = canvas!.getBoundingClientRect();
        const tx = t.clientX - rect.left;
        const scaleX = CANVAS_W / rect.width;
        const cx = tx * scaleX;
        if (cx < CANVAS_W / 2) touchRef.current.left = true;
        else touchRef.current.jump = true;
      }
    }
    function onTouchEnd(e: TouchEvent) {
      e.preventDefault();
      touchRef.current.left = false;
      touchRef.current.jump = false;
    }
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [phase, startGame]);

  const btnSz = BTN_SIZE_STYLES[settings.buttonSize];
  const mobileBtnStyle: React.CSSProperties = {
    background: GB.dark,
    color: GB.lightest,
    border: `3px solid ${GB.darkest}`,
    borderBottom: `6px solid ${GB.darkest}`,
    fontFamily: "monospace",
    fontWeight: "bold",
    cursor: "pointer",
    userSelect: "none",
    WebkitUserSelect: "none",
    touchAction: "none",
    ...btnSz,
  };

  const jumpBtn = (
    <button
      type="button"
      data-ocid="game.primary_button"
      onPointerDown={() => {
        ensureSound();
        touchRef.current.jump = true;
        keysRef.current.add("Space");
      }}
      onPointerUp={() => {
        touchRef.current.jump = false;
        keysRef.current.delete("Space");
      }}
      onPointerLeave={() => {
        touchRef.current.jump = false;
        keysRef.current.delete("Space");
      }}
      style={mobileBtnStyle}
      aria-label="Jump"
    >
      JUMP
    </button>
  );

  const leftBtn = (
    <button
      type="button"
      data-ocid="game.secondary_button"
      onPointerDown={() => {
        touchRef.current.left = true;
        keysRef.current.add("ArrowLeft");
      }}
      onPointerUp={() => {
        touchRef.current.left = false;
        keysRef.current.delete("ArrowLeft");
      }}
      onPointerLeave={() => {
        touchRef.current.left = false;
        keysRef.current.delete("ArrowLeft");
      }}
      style={mobileBtnStyle}
      aria-label="Move left"
    >
      ◀
    </button>
  );

  const rightBtn = (
    <button
      type="button"
      data-ocid="game.secondary_button"
      onPointerDown={() => {
        touchRef.current.right = true;
        keysRef.current.add("ArrowRight");
      }}
      onPointerUp={() => {
        touchRef.current.right = false;
        keysRef.current.delete("ArrowRight");
      }}
      onPointerLeave={() => {
        touchRef.current.right = false;
        keysRef.current.delete("ArrowRight");
      }}
      style={mobileBtnStyle}
      aria-label="Move right"
    >
      ▶
    </button>
  );

  // Layout A (default): JUMP + ◀ on left | ▶ on right
  // Layout B: ◀ + ▶ on left | JUMP on right
  // Layout C: JUMP on right | ◀ + ▶ on right (both right)
  const controlLeft =
    settings.layout === "A" ? (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {jumpBtn}
        {leftBtn}
      </div>
    ) : settings.layout === "B" ? (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {leftBtn}
        {rightBtn}
      </div>
    ) : (
      // Layout C: nothing on left
      <div style={{ display: "flex", gap: 8, alignItems: "center" }} />
    );

  const controlRight =
    settings.layout === "A" ? (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {rightBtn}
      </div>
    ) : settings.layout === "B" ? (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {jumpBtn}
      </div>
    ) : (
      // Layout C: JUMP + ▶ on right; ◀ on right too
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {leftBtn}
        {jumpBtn}
        {rightBtn}
      </div>
    );

  const PIXEL_FONT = "'Press Start 2P', 'Courier New', monospace";

  const overlayPanelStyle: React.CSSProperties = {
    background: "rgba(15, 56, 15, 0.92)",
    border: `4px solid ${GB.light}`,
    boxShadow: `6px 6px 0 ${GB.darkest}`,
    padding: "24px 28px",
    textAlign: "center",
    maxWidth: 360,
    width: "90%",
    fontFamily: PIXEL_FONT,
    color: GB.lightest,
  };

  const overlayBtnBase: React.CSSProperties = {
    fontFamily: PIXEL_FONT,
    cursor: "pointer",
    userSelect: "none",
    WebkitUserSelect: "none",
    touchAction: "none",
    border: `2px solid ${GB.light}`,
    padding: "10px 18px",
    fontSize: 11,
    letterSpacing: 1,
  };

  const activeBtnStyle: React.CSSProperties = {
    ...overlayBtnBase,
    background: GB.light,
    color: GB.darkest,
  };

  const inactiveBtnStyle: React.CSSProperties = {
    ...overlayBtnBase,
    background: GB.dark,
    color: GB.lightest,
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: GB.darkest,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0,
        }}
      >
        <div
          style={{
            border: `6px solid ${GB.darkest}`,
            outline: `4px solid ${GB.dark}`,
            boxShadow: `0 0 0 2px ${GB.darkest}, 8px 8px 0 ${GB.darkest}`,
            background: GB.darkest,
            lineHeight: 0,
            position: "relative",
          }}
        >
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            data-ocid="game.canvas_target"
            tabIndex={0}
            style={{
              display: "block",
              imageRendering: "pixelated",
              maxWidth: "min(100vw - 20px, 720px)",
              maxHeight: "min(calc(100vh - 140px), 480px)",
              width: "100%",
              height: "auto",
              cursor: "none",
            }}
          />

          {/* ── PAUSE OVERLAY BUTTONS ────────────────────────────────────── */}
          {phase === "paused" && (
            <div
              data-ocid="pause.panel"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "all",
                gap: 10,
                // Push buttons below the "PAUSED" text which is at ~canvas centre-38
                paddingTop: "52%",
              }}
            >
              <button
                type="button"
                data-ocid="pause.resume.button"
                onClick={togglePause}
                style={{
                  fontFamily: PIXEL_FONT,
                  background: GB.light,
                  color: GB.darkest,
                  border: `3px solid ${GB.darkest}`,
                  borderBottom: `5px solid ${GB.darkest}`,
                  padding: "9px 22px",
                  fontSize: 10,
                  letterSpacing: 1,
                  cursor: "pointer",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  width: 180,
                }}
                aria-label="Resume game"
              >
                ▶ RESUME
              </button>
              <button
                type="button"
                data-ocid="pause.settings.button"
                onClick={openSettingsFromPause}
                style={{
                  fontFamily: PIXEL_FONT,
                  background: GB.dark,
                  color: GB.lightest,
                  border: `3px solid ${GB.darkest}`,
                  borderBottom: `5px solid ${GB.darkest}`,
                  padding: "9px 22px",
                  fontSize: 10,
                  letterSpacing: 1,
                  cursor: "pointer",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  width: 180,
                }}
                aria-label="Settings"
              >
                ⚙ SETTINGS
              </button>
              <button
                type="button"
                data-ocid="pause.mainmenu.button"
                onClick={goToMainMenu}
                style={{
                  fontFamily: PIXEL_FONT,
                  background: GB.darkest,
                  color: GB.light,
                  border: `3px solid ${GB.dark}`,
                  borderBottom: `5px solid ${GB.darkest}`,
                  padding: "9px 22px",
                  fontSize: 10,
                  letterSpacing: 1,
                  cursor: "pointer",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  width: 180,
                }}
                aria-label="Main menu"
              >
                ⌂ MAIN MENU
              </button>
            </div>
          )}

          {/* ── SETTINGS OVERLAY ─────────────────────────────────────────── */}
          {phase === "settings" && (
            <div
              data-ocid="settings.panel"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "all",
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  ...overlayPanelStyle,
                  maxHeight: "95%",
                  overflowY: "auto",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    letterSpacing: 2,
                    marginBottom: 20,
                    textShadow: `2px 2px 0 ${GB.darkest}`,
                  }}
                >
                  SETTINGS
                </div>

                {/* Control Layout */}
                <div style={{ marginBottom: 16, textAlign: "left" }}>
                  <div
                    style={{
                      fontSize: 7,
                      color: GB.light,
                      marginBottom: 8,
                      fontFamily: "monospace",
                      letterSpacing: 1,
                    }}
                  >
                    CONTROL LAYOUT
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      justifyContent: "center",
                    }}
                  >
                    <button
                      type="button"
                      data-ocid="settings.layout_a.button"
                      onClick={() => updateSettings({ layout: "A" })}
                      style={
                        settings.layout === "A"
                          ? activeBtnStyle
                          : inactiveBtnStyle
                      }
                      title="JUMP+◀ on left, ▶ on right"
                    >
                      A
                    </button>
                    <button
                      type="button"
                      data-ocid="settings.layout_b.button"
                      onClick={() => updateSettings({ layout: "B" })}
                      style={
                        settings.layout === "B"
                          ? activeBtnStyle
                          : inactiveBtnStyle
                      }
                      title="◀+▶ on left, JUMP on right"
                    >
                      B
                    </button>
                    <button
                      type="button"
                      data-ocid="settings.layout_c.button"
                      onClick={() => updateSettings({ layout: "C" })}
                      style={
                        settings.layout === "C"
                          ? activeBtnStyle
                          : inactiveBtnStyle
                      }
                      title="All buttons on right"
                    >
                      C
                    </button>
                  </div>
                  <div
                    style={{
                      fontSize: 6,
                      color: GB.light,
                      marginTop: 6,
                      fontFamily: "monospace",
                      lineHeight: 1.8,
                      textAlign: "center",
                    }}
                  >
                    {settings.layout === "A" && "JUMP+◀ LEFT  |  ▶ RIGHT"}
                    {settings.layout === "B" && "◀+▶ LEFT  |  JUMP RIGHT"}
                    {settings.layout === "C" && "◀+JUMP+▶ ALL RIGHT"}
                  </div>
                </div>

                {/* Button Size */}
                <div style={{ marginBottom: 16, textAlign: "left" }}>
                  <div
                    style={{
                      fontSize: 7,
                      color: GB.light,
                      marginBottom: 8,
                      fontFamily: "monospace",
                      letterSpacing: 1,
                    }}
                  >
                    BUTTON SIZE
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      justifyContent: "center",
                    }}
                  >
                    <button
                      type="button"
                      data-ocid="settings.size_s.button"
                      onClick={() => updateSettings({ buttonSize: "small" })}
                      style={
                        settings.buttonSize === "small"
                          ? activeBtnStyle
                          : inactiveBtnStyle
                      }
                    >
                      S
                    </button>
                    <button
                      type="button"
                      data-ocid="settings.size_m.button"
                      onClick={() => updateSettings({ buttonSize: "medium" })}
                      style={
                        settings.buttonSize === "medium"
                          ? activeBtnStyle
                          : inactiveBtnStyle
                      }
                    >
                      M
                    </button>
                    <button
                      type="button"
                      data-ocid="settings.size_l.button"
                      onClick={() => updateSettings({ buttonSize: "large" })}
                      style={
                        settings.buttonSize === "large"
                          ? activeBtnStyle
                          : inactiveBtnStyle
                      }
                    >
                      L
                    </button>
                  </div>
                </div>

                {/* Game Speed */}
                <div style={{ marginBottom: 16, textAlign: "left" }}>
                  <div
                    style={{
                      fontSize: 7,
                      color: GB.light,
                      marginBottom: 8,
                      fontFamily: "monospace",
                      letterSpacing: 1,
                    }}
                  >
                    GAME SPEED
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      justifyContent: "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 6,
                        color: GB.light,
                        fontFamily: "monospace",
                      }}
                    >
                      SLOW
                    </span>
                    <input
                      type="range"
                      data-ocid="settings.speed.input"
                      min={0.5}
                      max={2.0}
                      step={0.1}
                      value={settings.gameSpeed}
                      onChange={(e) =>
                        updateSettings({
                          gameSpeed: Number.parseFloat(e.target.value),
                        })
                      }
                      style={{
                        flex: 1,
                        accentColor: GB.light,
                        cursor: "pointer",
                        height: 4,
                      }}
                      aria-label="Game speed"
                    />
                    <span
                      style={{
                        fontSize: 6,
                        color: GB.light,
                        fontFamily: "monospace",
                      }}
                    >
                      FAST
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 7,
                      color: GB.lightest,
                      marginTop: 4,
                      fontFamily: "monospace",
                      textAlign: "center",
                    }}
                  >
                    {settings.gameSpeed.toFixed(1)}x
                  </div>
                </div>

                {/* Sound */}
                <div style={{ marginBottom: 20, textAlign: "left" }}>
                  <div
                    style={{
                      fontSize: 7,
                      color: GB.light,
                      marginBottom: 8,
                      fontFamily: "monospace",
                      letterSpacing: 1,
                    }}
                  >
                    SOUND
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      justifyContent: "center",
                    }}
                  >
                    <button
                      type="button"
                      data-ocid="settings.sound.toggle"
                      onClick={() =>
                        updateSettings({ soundOn: !settings.soundOn })
                      }
                      style={
                        settings.soundOn ? activeBtnStyle : inactiveBtnStyle
                      }
                      aria-label={settings.soundOn ? "Sound on" : "Sound off"}
                    >
                      {settings.soundOn ? "♪ ON" : "✕ OFF"}
                    </button>
                  </div>
                </div>

                {/* Back button */}
                <button
                  type="button"
                  data-ocid="settings.back.button"
                  onClick={() => {
                    const returnPhase = settingsReturnPhaseRef.current;
                    settingsReturnPhaseRef.current = "start";
                    if (returnPhase === "paused" && gsRef.current) {
                      gsRef.current.phase = "paused";
                      setPhase("paused");
                    } else {
                      setPhase("start");
                    }
                  }}
                  style={{
                    ...inactiveBtnStyle,
                    width: "100%",
                    fontSize: 10,
                    padding: "10px 18px",
                  }}
                  aria-label="Back to menu"
                >
                  ← BACK
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Pause button - top right of canvas during gameplay */}
        {(phase === "playing" || phase === "paused") && (
          <button
            type="button"
            data-ocid="game.toggle"
            onPointerDown={togglePause}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              background: "rgba(15,56,15,0.75)",
              color: GB.lightest,
              border: `2px solid ${GB.dark}`,
              borderRadius: 4,
              padding: "4px 8px",
              fontFamily: "monospace",
              fontSize: 16,
              fontWeight: "bold",
              cursor: "pointer",
              userSelect: "none",
              WebkitUserSelect: "none",
              touchAction: "none",
              zIndex: 10,
              lineHeight: 1,
            }}
            aria-label="Pause"
          >
            ⏸
          </button>
        )}

        {/* Settings button - top right on start screen */}
        {(phase === "start" || phase === "settings") && (
          <button
            type="button"
            data-ocid="menu.settings_btn.button"
            onClick={() => {
              if (phase === "settings") {
                setPhase("start");
              } else {
                settingsReturnPhaseRef.current = "start";
                setPhase("settings");
              }
            }}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              background: "rgba(15,56,15,0.75)",
              color: GB.lightest,
              border: `2px solid ${GB.dark}`,
              borderRadius: 4,
              padding: "4px 10px",
              fontFamily: "monospace",
              fontSize: 14,
              fontWeight: "bold",
              cursor: "pointer",
              userSelect: "none",
              WebkitUserSelect: "none",
              touchAction: "none",
              zIndex: 10,
              lineHeight: 1,
            }}
            aria-label="Settings"
          >
            ⚙
          </button>
        )}

        {/* Mobile controls bar - only shown during gameplay */}
        {(phase === "playing" || phase === "paused") && (
          <div
            style={{
              background: GB.dark,
              border: `4px solid ${GB.darkest}`,
              borderTop: "none",
              padding: "8px 16px",
              display: "flex",
              gap: 12,
              alignItems: "center",
              width: "100%",
              justifyContent: "space-between",
              boxSizing: "border-box",
            }}
          >
            {controlLeft}
            <div style={{ flex: 1 }} />
            {controlRight}
          </div>
        )}
      </div>

      {phase === "gameover" && (
        <div
          data-ocid="game.modal"
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(15,56,15,0.85)",
            zIndex: 100,
            fontFamily: "monospace",
          }}
        >
          <div
            style={{
              background: GB.dark,
              border: `6px solid ${GB.darkest}`,
              padding: "32px 40px",
              textAlign: "center",
              boxShadow: `8px 8px 0 ${GB.darkest}`,
            }}
          >
            <div
              style={{
                color: GB.lightest,
                fontSize: 22,
                fontFamily: PIXEL_FONT,
                fontWeight: "bold",
                letterSpacing: 2,
                marginBottom: 12,
                textShadow: `3px 3px 0 ${GB.darkest}`,
              }}
            >
              GAME OVER
            </div>
            <div style={{ color: GB.lightest, fontSize: 14, marginBottom: 4 }}>
              SCORE: {String(score).padStart(6, "0")}
            </div>
            <div style={{ color: GB.light, fontSize: 12, marginBottom: 8 }}>
              BEST: {String(hiScore).padStart(6, "0")}
            </div>
            <div style={{ color: GB.lightest, fontSize: 11, marginBottom: 4 }}>
              SPLIFFS SMOKED: {String(spliffsSmoked).padStart(3, "0")}
            </div>
            <div style={{ color: GB.lightest, fontSize: 11, marginBottom: 20 }}>
              ENEMIES KILLED: {String(enemiesKilled).padStart(3, "0")}
            </div>
            <button
              type="button"
              data-ocid="game.primary_button"
              onClick={startGame}
              style={{
                background: GB.darkest,
                color: GB.lightest,
                border: `3px solid ${GB.lightest}`,
                padding: "10px 28px",
                fontFamily: "monospace",
                fontSize: 14,
                fontWeight: "bold",
                letterSpacing: 2,
                cursor: "pointer",
              }}
            >
              PLAY AGAIN
            </button>
            <div style={{ color: GB.light, fontSize: 9, marginTop: 16 }}>
              PRESS SPACE TO RESTART
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
