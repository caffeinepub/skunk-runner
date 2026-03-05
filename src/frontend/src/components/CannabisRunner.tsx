import { useCallback, useEffect, useRef, useState } from "react";

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
const SCROLL_BASE = 2.5;
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
  ctx.save();
  ctx.translate(cx, cy);

  const lobes = [
    [0, 1.0, 0.22],
    [0.58, 0.92, 0.2],
    [-0.58, 0.92, 0.2],
    [1.18, 0.8, 0.17],
    [-1.18, 0.8, 0.17],
    [1.72, 0.62, 0.14],
    [-1.72, 0.62, 0.14],
  ] as const;

  function drawLobe(
    angleDelta: number,
    lenFactor: number,
    hwFactor: number,
    fill: string,
    outline: string,
  ) {
    const L = r * lenFactor;
    const W = r * hwFactor;
    const N = 6;
    ctx.save();
    ctx.rotate(angleDelta);

    function serratedSide(side: 1 | -1) {
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const taper = Math.sin(t * Math.PI) * (1 - t * 0.3);
        const baseX = side * W * taper;
        const baseY = -L * t;
        const toothOut = i % 2 === 1 ? W * 0.28 * taper : 0;
        ctx.lineTo(
          baseX + side * toothOut,
          baseY - L * 0.03 * (i % 2 === 1 ? 1 : 0),
        );
      }
    }

    ctx.fillStyle = outline;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    serratedSide(1);
    ctx.lineTo(0, -L);
    serratedSide(-1);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const taper = Math.sin(t * Math.PI) * (1 - t * 0.3);
      const tooth = i % 2 === 1 ? W * 0.22 * taper : 0;
      ctx.lineTo(W * taper + tooth, -L * t - L * 0.025 * (i % 2 === 1 ? 1 : 0));
    }
    ctx.lineTo(0, -L);
    for (let i = N; i >= 0; i--) {
      const t = i / N;
      const taper = Math.sin(t * Math.PI) * (1 - t * 0.3);
      const tooth = i % 2 === 1 ? W * 0.22 * taper : 0;
      ctx.lineTo(
        -(W * taper + tooth),
        -L * t - L * 0.025 * (i % 2 === 1 ? 1 : 0),
      );
    }
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = outline;
    ctx.lineWidth = Math.max(0.8, r * 0.025);
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -L * 0.9);
    ctx.stroke();

    ctx.lineWidth = Math.max(0.5, r * 0.014);
    ctx.globalAlpha = 0.35;
    for (const s of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(0, -L * 0.3);
      ctx.quadraticCurveTo(s * W * 0.4, -L * 0.45, s * W * 0.65, -L * 0.38);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -L * 0.55);
      ctx.quadraticCurveTo(s * W * 0.35, -L * 0.68, s * W * 0.55, -L * 0.62);
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
    ctx.restore();
  }

  for (const [angle, len, hw] of lobes)
    drawLobe(angle, len, hw, fillColor, strokeColor);

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
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(eye.cx, eye.cy, eyeR, 0, Math.PI * 2);
    ctx.fill();
    const veinAngles = [0.4, 1.1, 2.0, 3.5, 4.8, 5.5];
    ctx.strokeStyle = "#cc0000";
    ctx.lineWidth = 0.7;
    for (const va of veinAngles) {
      ctx.beginPath();
      ctx.moveTo(
        eye.cx + Math.cos(va) * eyeR * 0.35,
        eye.cy + Math.sin(va) * eyeR * 0.35,
      );
      ctx.quadraticCurveTo(
        eye.cx + Math.cos(va + 0.3) * eyeR * 0.65,
        eye.cy + Math.sin(va + 0.3) * eyeR * 0.65,
        eye.cx + Math.cos(va + 0.1) * eyeR * 0.92,
        eye.cy + Math.sin(va + 0.1) * eyeR * 0.92,
      );
      ctx.stroke();
    }
    ctx.fillStyle = GB.darkest;
    ctx.beginPath();
    ctx.arc(eye.cx, eye.cy, eyeR * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(
      eye.cx - eyeR * 0.12,
      eye.cy - eyeR * 0.18,
      eyeR * 0.14,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.strokeStyle = GB.darkest;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(eye.cx, eye.cy, eyeR, 0, Math.PI * 2);
    ctx.stroke();
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
  const jointLen = size * 2.8;
  const jointW = size * 0.22;
  ctx.translate(cx + size * 0.3, my - size * 0.05);
  ctx.rotate(angle);

  ctx.fillStyle = "#f5f5dc";
  ctx.strokeStyle = GB.darkest;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.roundRect(0, -jointW / 2, jointLen * 0.8, jointW, 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#8B6914";
  ctx.beginPath();
  ctx.roundRect(-jointW * 0.2, -jointW / 2, jointLen * 0.14, jointW, 1);
  ctx.fill();
  ctx.fillStyle = "#e8e8c8";
  ctx.beginPath();
  ctx.ellipse(
    jointLen * 0.8 + 2,
    0,
    jointW * 0.4,
    jointW * 0.35,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 0.5;
  for (let i = 1; i < 4; i++) {
    const lx = jointLen * 0.12 * i;
    ctx.beginPath();
    ctx.moveTo(lx, -jointW / 2);
    ctx.lineTo(lx, jointW / 2);
    ctx.stroke();
  }

  const emberX = jointLen * 0.8 + 3;
  const grad = ctx.createRadialGradient(emberX, 0, 0, emberX, 0, jointW * 1.4);
  grad.addColorStop(0, "rgba(255, 120, 0, 0.9)");
  grad.addColorStop(0.5, "rgba(255, 60, 0, 0.5)");
  grad.addColorStop(1, "rgba(255, 0, 0, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(emberX, 0, jointW * 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff6600";
  ctx.beginPath();
  ctx.arc(emberX, 0, jointW * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffcc00";
  ctx.beginPath();
  ctx.arc(emberX, 0, jointW * 0.25, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(200,200,200,0.5)";
  ctx.lineWidth = 1;
  for (let s = 0; s < 3; s++) {
    const sx = emberX + s * 2 - 2;
    ctx.beginPath();
    ctx.moveTo(sx, -jointW);
    ctx.bezierCurveTo(
      sx + 3,
      -jointW - 5,
      sx - 3,
      -jointW - 10,
      sx + 2,
      -jointW - 16,
    );
    ctx.stroke();
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
    drawBloodshotEyes(ctx, cx - 5, top + 14, cx + 5, top + 14, 4.5);
    drawLeafMouth(ctx, cx, top + 21, 10);
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(Math.floor(cx - 20), top + 15, 5, 4);
    ctx.fillRect(Math.floor(cx + 15), top + 15, 5, 4);
    ctx.fillStyle = GB.dark;
    ctx.fillRect(Math.floor(cx - 19), top + 15, 4, 3);
    ctx.fillRect(Math.floor(cx + 16), top + 15, 4, 3);
    drawMickeyGlove(ctx, Math.floor(cx - 22), top + 17, 6, false);
    drawMickeyGlove(ctx, Math.floor(cx + 22), top + 17, 6, true);
  } else {
    const leafCX = cx;
    const leafCY = top + 16;
    const leafR = 34;
    drawCannabisLeafShape(ctx, leafCX, leafCY, leafR, GB.dark, GB.darkest);

    const eyeY = top + 16;
    drawBloodshotEyes(ctx, cx - 7, eyeY, cx + 7, eyeY, 6);
    drawLeafMouth(ctx, cx, top + 27, 13);

    if (spliffAlpha > 0) drawSpliff(ctx, cx, top + 27, 13, spliffAlpha);

    ctx.strokeStyle = GB.darkest;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 13, eyeY - 7);
    ctx.quadraticCurveTo(cx, eyeY - 10, cx + 13, eyeY - 7);
    ctx.stroke();

    const armBob = p.animFrame % 2 === 0 ? -1 : 1;
    const armY = top + 20 + armBob;
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(Math.floor(cx - 34), armY - 1, 14, 6);
    ctx.fillStyle = GB.dark;
    ctx.fillRect(Math.floor(cx - 33), armY, 12, 4);
    drawMickeyGlove(ctx, Math.floor(cx - 38), armY + 2, 8, false);
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(Math.floor(cx + 20), armY - 1, 14, 6);
    ctx.fillStyle = GB.dark;
    ctx.fillRect(Math.floor(cx + 21), armY, 12, 4);
    drawMickeyGlove(ctx, Math.floor(cx + 38), armY + 2, 8, true);

    const legBaseY = top + p.height - 11;
    const legW = 7;
    const legH = 11;
    const leftLift = p.animFrame % 2 === 0 ? -3 : 0;
    const rightLift = p.animFrame % 2 === 1 ? -3 : 0;
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(Math.floor(cx - 11), legBaseY + leftLift, legW + 2, legH + 2);
    ctx.fillRect(Math.floor(cx + 4), legBaseY + rightLift, legW + 2, legH + 2);
    ctx.fillStyle = GB.dark;
    ctx.fillRect(Math.floor(cx - 10), legBaseY + leftLift + 1, legW, legH);
    ctx.fillRect(Math.floor(cx + 5), legBaseY + rightLift + 1, legW, legH);
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(
      Math.floor(cx - 12),
      legBaseY + leftLift + legH - 1,
      legW + 6,
      4,
    );
    ctx.fillRect(
      Math.floor(cx + 3),
      legBaseY + rightLift + legH - 1,
      legW + 6,
      4,
    );
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

function drawLeafCloud(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
) {
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.translate(cx, cy);

  const lobes = [
    [0, 1.0, 0.18],
    [0.62, 0.86, 0.15],
    [-0.62, 0.86, 0.15],
    [1.22, 0.68, 0.12],
    [-1.22, 0.68, 0.12],
    [1.78, 0.48, 0.1],
    [-1.78, 0.48, 0.1],
  ] as const;

  for (const [angle, len, hw] of lobes) {
    const L = r * len;
    const W = r * hw;
    const N = 5;
    ctx.save();
    ctx.rotate(angle);
    ctx.fillStyle = GB.light;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const taper = Math.sin(t * Math.PI) * (1 - t * 0.3);
      const tooth = i % 2 === 1 ? W * 0.2 * taper : 0;
      ctx.lineTo(W * taper + tooth, -L * t);
    }
    ctx.lineTo(0, -L);
    for (let i = N; i >= 0; i--) {
      const t = i / N;
      const taper = Math.sin(t * Math.PI) * (1 - t * 0.3);
      const tooth = i % 2 === 1 ? W * 0.2 * taper : 0;
      ctx.lineTo(-(W * taper + tooth), -L * t);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

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
  const cloudOffset = worldOffset * 0.15;
  const cloudData = [
    { i: 0, baseY: 45, scale: 1.0 },
    { i: 1, baseY: 62, scale: 0.8 },
    { i: 2, baseY: 38, scale: 1.2 },
    { i: 3, baseY: 55, scale: 0.9 },
    { i: 4, baseY: 48, scale: 1.1 },
    { i: 5, baseY: 70, scale: 0.75 },
  ];
  for (const { i, baseY, scale } of cloudData) {
    const cx2 = ((i * 140 - cloudOffset + 60) % (CANVAS_W + 160)) - 80;
    drawLeafCloud(ctx, cx2, baseY, 28 * scale);
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
  ctx.fillStyle = "#f5f5dc";
  ctx.fillRect(sbX + 4, midY - 2, 10, 4);
  ctx.fillStyle = "#ff6600";
  ctx.beginPath();
  ctx.arc(sbX + 15, midY, 2, 0, Math.PI * 2);
  ctx.fill();
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

function createInitialGameState(hiScore: number): GameState {
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
    scrollSpeed: SCROLL_BASE,
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
  const newScrollSpeed = Math.min(
    SCROLL_BASE + gs.distance / 2000,
    SCROLL_BASE + difficultyLevel * 0.4,
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
  const touchRef = useRef({ left: false, jump: false });
  const soundRef = useRef<ReturnType<typeof createSoundEngine> | null>(null);

  const [phase, setPhase] = useState<
    "start" | "playing" | "paused" | "gameover"
  >("start");
  const [score, setScore] = useState(0);
  const [hiScore, setHiScore] = useState(0);
  const [_lives, setLives] = useState(3);
  const [spliffsSmoked, setSpliffsSmoked] = useState(0);
  const [enemiesKilled, setEnemiesKilled] = useState(0);

  const ensureSound = useCallback(() => {
    if (!soundRef.current) soundRef.current = createSoundEngine();
    return soundRef.current;
  }, []);

  const startGame = useCallback(() => {
    const snd = ensureSound();
    gsRef.current = createInitialGameState(hiScoreRef.current);
    setPhase("playing");
    setScore(0);
    setLives(3);
    setSpliffsSmoked(0);
    setEnemiesKilled(0);
    snd.start();
  }, [ensureSound]);

  const togglePause = useCallback(() => {
    if (!gsRef.current) return;
    if (gsRef.current.phase === "playing") {
      gsRef.current.phase = "paused";
      setPhase("paused");
    } else if (gsRef.current.phase === "paused") {
      gsRef.current.phase = "playing";
      setPhase("playing");
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    let prevTime = 0;

    function loop(time: number) {
      rafRef.current = requestAnimationFrame(loop);
      const gs = gsRef.current;
      if (!gs || gs.phase === "start") {
        drawStartScreen(ctx!);
        return;
      }
      const dt = Math.min((time - prevTime) / 16.67, 3);
      prevTime = time;
      frameCountRef.current++;
      if (gs.phase === "playing") {
        const keys = new Set(keysRef.current);
        if (touchRef.current.left) keys.add("ArrowLeft");
        if (touchRef.current.jump) keys.add("Space");
        const newGs = updateGame(gs, keys, dt, frameCountRef.current);
        gsRef.current = newGs;
        if (soundRef.current && newGs.events.length > 0) {
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
      renderFrame(ctx!, gsRef.current!);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  function drawStartScreen(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = GB.lightest;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = GB.light;
    for (let i = 0; i < 6; i++) ctx.fillRect(i * 80, 0, 40, CANVAS_H);
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(40, 55, CANVAS_W - 80, 80);
    ctx.fillStyle = GB.light;
    ctx.fillRect(44, 59, CANVAS_W - 88, 72);
    ctx.fillStyle = GB.darkest;
    ctx.font = "bold 26px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SKUNK", CANVAS_W / 2, 83);
    ctx.fillText("RUNNER", CANVAS_W / 2, 113);

    const px = CANVAS_W / 2;
    const py = 175;
    drawCannabisLeafShape(ctx, px, py - 6, 28, GB.dark, GB.darkest);
    drawBloodshotEyes(ctx, px - 7, py - 8, px + 7, py - 8, 6);
    drawLeafMouth(ctx, px, py + 4, 13);
    ctx.strokeStyle = GB.darkest;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px - 13, py - 15);
    ctx.quadraticCurveTo(px, py - 18, px + 13, py - 15);
    ctx.stroke();
    const armY2 = py - 4;
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(Math.floor(px - 34), armY2 - 1, 14, 6);
    ctx.fillStyle = GB.dark;
    ctx.fillRect(Math.floor(px - 33), armY2, 12, 4);
    drawMickeyGlove(ctx, Math.floor(px - 38), armY2 + 2, 8, false);
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(Math.floor(px + 20), armY2 - 1, 14, 6);
    ctx.fillStyle = GB.dark;
    ctx.fillRect(Math.floor(px + 21), armY2, 12, 4);
    drawMickeyGlove(ctx, Math.floor(px + 38), armY2 + 2, 8, true);
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(px - 11, py + 18, 9, 12);
    ctx.fillRect(px + 4, py + 18, 9, 12);
    ctx.fillStyle = GB.dark;
    ctx.fillRect(px - 10, py + 19, 7, 10);
    ctx.fillRect(px + 5, py + 19, 7, 10);
    ctx.fillStyle = GB.darkest;
    ctx.fillRect(px - 12, py + 28, 11, 4);
    ctx.fillRect(px + 3, py + 28, 11, 4);

    ctx.fillStyle = GB.darkest;
    ctx.font = "bold 11px 'Courier New', monospace";
    ctx.fillText("PRESS SPACE OR TAP TO START", CANVAS_W / 2, 232);
    ctx.font = "9px 'Courier New', monospace";
    ctx.fillText(
      "ARROWS/WASD: MOVE   SPACE: JUMP   P: PAUSE",
      CANVAS_W / 2,
      252,
    );
    ctx.fillText(
      "STOMP ENEMIES + GARDENERS  |  AVOID WEED KILLER!",
      CANVAS_W / 2,
      266,
    );
    ctx.fillText(
      "WATCH PLANT POTS - GARDENER LURKS INSIDE!",
      CANVAS_W / 2,
      280,
    );
    ctx.font = "8px 'Courier New', monospace";
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
      ctx.fillStyle = "rgba(15, 56, 15, 0.7)";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = GB.lightest;
      ctx.font = "bold 20px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("PAUSED", CANVAS_W / 2, CANVAS_H / 2 - 14);
      ctx.font = "11px 'Courier New', monospace";
      ctx.fillText("PRESS P TO RESUME", CANVAS_W / 2, CANVAS_H / 2 + 14);
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
        </div>
        {/* Pause overlay button - top right of canvas */}
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
          {/* JUMP button - bottom left */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              data-ocid="game.primary_button"
              onPointerDown={() => {
                ensureSound();
                keysRef.current.add("Space");
              }}
              onPointerUp={() => keysRef.current.delete("Space")}
              onPointerLeave={() => keysRef.current.delete("Space")}
              style={largeBtnStyle}
              aria-label="Jump"
            >
              JUMP
            </button>
            <button
              type="button"
              data-ocid="game.secondary_button"
              onPointerDown={() => keysRef.current.add("ArrowLeft")}
              onPointerUp={() => keysRef.current.delete("ArrowLeft")}
              onPointerLeave={() => keysRef.current.delete("ArrowLeft")}
              style={largeBtnStyle}
              aria-label="Move left"
            >
              ◀
            </button>
          </div>
          <div
            style={{
              color: GB.lightest,
              fontFamily: "monospace",
              fontSize: 10,
              textAlign: "center",
              lineHeight: 1.4,
            }}
          >
            <div>SCORE: {String(score).padStart(6, "0")}</div>
            <div>BEST: {String(hiScore).padStart(6, "0")}</div>
            {(phase === "start" || phase === "gameover") && (
              <button
                type="button"
                data-ocid="game.primary_button"
                onPointerDown={startGame}
                style={{
                  ...largeBtnStyle,
                  background: GB.darkest,
                  color: GB.lightest,
                  padding: "4px 10px",
                  marginTop: 4,
                }}
                aria-label="Start game"
              >
                START
              </button>
            )}
          </div>
          {/* Right arrow - bottom right */}
          <button
            type="button"
            data-ocid="game.secondary_button"
            onPointerDown={() => keysRef.current.add("ArrowRight")}
            onPointerUp={() => keysRef.current.delete("ArrowRight")}
            onPointerLeave={() => keysRef.current.delete("ArrowRight")}
            style={largeBtnStyle}
            aria-label="Move right"
          >
            ▶
          </button>
        </div>
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
                fontSize: 28,
                fontWeight: "bold",
                letterSpacing: 4,
                marginBottom: 8,
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

const largeBtnStyle: React.CSSProperties = {
  background: GB.dark,
  color: GB.lightest,
  border: `3px solid ${GB.darkest}`,
  borderBottom: `6px solid ${GB.darkest}`,
  padding: "10px 14px",
  fontFamily: "monospace",
  fontSize: 22,
  fontWeight: "bold",
  cursor: "pointer",
  userSelect: "none",
  WebkitUserSelect: "none",
  touchAction: "none",
  minWidth: 72,
};
