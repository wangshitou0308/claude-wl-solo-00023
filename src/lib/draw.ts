import type { Direction } from '../types';

// Canvas 绘制：标定编辑、找台向导与打印共用同一套绘制逻辑
export const DIR_COLOR: Record<Direction, string> = {
  up: '#d94841', // 低端接近：红
  down: '#2563c9', // 高端接近：蓝
};
export const DIR_LABEL: Record<Direction, string> = {
  up: '从低端接近 ↑',
  down: '从高端接近 ↓',
};

export interface Pt {
  x: number;
  y: number;
}

export type Overlay =
  | { kind: 'point'; p: Pt; dir: Direction; label: string; tol: number; selected?: boolean; dim?: boolean }
  | { kind: 'path'; pts: Pt[]; dir: Direction; active?: boolean }
  | { kind: 'zone'; low: Pt; high: Pt; center: Pt }
  | { kind: 'stage'; p: Pt; label: string }
  | { kind: 'current'; p: Pt }
  | { kind: 'pulse'; p: Pt; color: string };

export interface Layout {
  scale: number;
  ox: number;
  oy: number;
  imgW: number;
  imgH: number;
  cssW: number;
  cssH: number;
}

export function computeLayout(cssW: number, cssH: number, imgW: number, imgH: number): Layout {
  const scale = Math.min(cssW / imgW, cssH / imgH);
  const ox = (cssW - imgW * scale) / 2;
  const oy = (cssH - imgH * scale) / 2;
  return { scale, ox, oy, imgW, imgH, cssW, cssH };
}

export function toImageCoords(l: Layout, cssX: number, cssY: number): Pt {
  return { x: (cssX - l.ox) / l.scale, y: (cssY - l.oy) / l.scale };
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const photoCache = new Map<string, Promise<HTMLImageElement>>();
export function loadPhoto(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  const existing = photoCache.get(url);
  if (existing) return existing;
  const p = loadImage(url).finally(() => setTimeout(() => URL.revokeObjectURL(url), 60000));
  photoCache.set(url, p);
  return p;
}

export function drawScene(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement | null,
  imgW: number,
  imgH: number,
  overlays: Overlay[],
): Layout {
  const ctx = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const layout = computeLayout(cssW, cssH, imgW, imgH);
  ctx.save();
  ctx.translate(layout.ox, layout.oy);
  ctx.scale(layout.scale, layout.scale);

  // 浅色底
  ctx.fillStyle = '#e8e4da';
  ctx.fillRect(0, 0, imgW, imgH);
  if (img) ctx.drawImage(img, 0, 0, imgW, imgH);

  // 先画路径与区域，后画点
  for (const o of overlays) {
    if (o.kind === 'path') drawPath(ctx, o);
    else if (o.kind === 'zone') drawZone(ctx, o);
  }
  for (const o of overlays) {
    if (o.kind === 'stage') drawStage(ctx, o);
    else if (o.kind === 'current') drawCurrent(ctx, o);
    else if (o.kind === 'pulse') drawPulse(ctx, o);
  }
  for (const o of overlays) {
    if (o.kind === 'point') drawPoint(ctx, o);
  }

  ctx.restore();
  return layout;
}

function trPts(pts: Pt[]): number[] {
  // 已是图片坐标，直接返回扁平数组
  return pts.flatMap((p) => [p.x, p.y]);
}

function drawPath(ctx: CanvasRenderingContext2D, o: Extract<Overlay, { kind: 'path' }>) {
  if (o.pts.length < 2) return;
  const flat = trPts(o.pts);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]);
  ctx.strokeStyle = DIR_COLOR[o.dir];
  ctx.globalAlpha = o.active ? 0.95 : 0.35;
  ctx.lineWidth = o.active ? 5 : 3;
  ctx.setLineDash(o.active ? [] : [8, 6]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

function drawZone(ctx: CanvasRenderingContext2D, o: Extract<Overlay, { kind: 'zone' }>) {
  const x1 = o.low.x;
  const y1 = o.low.y;
  const x2 = o.high.x;
  const y2 = o.high.y;
  ctx.save();
  // 目标可能位置区：绿色宽带
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = '#1a9e57';
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 42;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#0f7a3f';
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // 边缘横杠
  ctx.setLineDash([]);
  ctx.strokeStyle = '#0f7a3f';
  ctx.lineWidth = 4;
  for (const e of [o.low, o.high]) {
    const ang = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(e.x - Math.cos(ang) * 20, e.y - Math.sin(ang) * 20);
    ctx.lineTo(e.x + Math.cos(ang) * 20, e.y + Math.sin(ang) * 20);
    ctx.stroke();
  }
  // 中心十字
  ctx.strokeStyle = '#b3342b';
  ctx.lineWidth = 3;
  drawCross(ctx, o.center, 9);
  ctx.restore();
}

function drawStage(ctx: CanvasRenderingContext2D, o: Extract<Overlay, { kind: 'stage' }>) {
  ctx.save();
  ctx.strokeStyle = '#e08a1e';
  ctx.fillStyle = '#fff8ec';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(o.p.x, o.p.y, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 三角旗
  ctx.fillStyle = '#e08a1e';
  ctx.beginPath();
  ctx.moveTo(o.p.x, o.p.y - 6);
  ctx.lineTo(o.p.x + 9, o.p.y - 2);
  ctx.lineTo(o.p.x, o.p.y + 2);
  ctx.closePath();
  ctx.fill();
  label(ctx, o.p, o.label, '#e08a1e', -26);
  ctx.restore();
}

function drawCurrent(ctx: CanvasRenderingContext2D, o: Extract<Overlay, { kind: 'current' }>) {
  ctx.save();
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(o.p.x, o.p.y, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(o.p.x, o.p.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  label(ctx, o.p, '指针现在的位置', '#222', 22);
  ctx.restore();
}

function drawPulse(ctx: CanvasRenderingContext2D, o: Extract<Overlay, { kind: 'pulse' }>) {
  ctx.save();
  ctx.strokeStyle = o.color;
  ctx.lineWidth = 3;
  drawCross(ctx, o.p, 12);
  ctx.beginPath();
  ctx.arc(o.p.x, o.p.y, 20, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawPoint(ctx: CanvasRenderingContext2D, o: Extract<Overlay, { kind: 'point' }>) {
  const c = DIR_COLOR[o.dir];
  ctx.save();
  ctx.globalAlpha = o.dim ? 0.3 : 1;
  // 误差圈
  ctx.beginPath();
  ctx.arc(o.p.x, o.p.y, Math.max(6, o.tol), 0, Math.PI * 2);
  ctx.strokeStyle = c;
  ctx.globalAlpha = o.dim ? 0.12 : 0.35;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = o.dim ? 0.3 : 1;
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(o.p.x, o.p.y, o.selected ? 9 : 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  if (o.selected) {
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(o.p.x, o.p.y, 13, 0, Math.PI * 2);
    ctx.stroke();
  }
  label(ctx, o.p, o.label, c, -16);
  ctx.restore();
}

function drawCross(ctx: CanvasRenderingContext2D, p: Pt, r: number) {
  ctx.beginPath();
  ctx.moveTo(p.x - r, p.y);
  ctx.lineTo(p.x + r, p.y);
  ctx.moveTo(p.x, p.y - r);
  ctx.lineTo(p.x, p.y + r);
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, p: Pt, text: string, color: string, dy: number) {
  ctx.save();
  ctx.font = 'bold 20px "PingFang SC","Microsoft YaHei",sans-serif';
  const w = ctx.measureText(text).width + 14;
  // 当前处于图片坐标变换中：由变换矩阵反推图片宽高，用于边界收边
  const m = ctx.getTransform();
  const imgW = (ctx.canvas.width / (window.devicePixelRatio || 1) - m.e) / (m.a || 1);
  const imgH = (ctx.canvas.height / (window.devicePixelRatio || 1) - m.f) / (m.d || 1);
  const x = Math.min(Math.max(p.x - w / 2, 4), imgW - w - 4);
  const y = Math.min(Math.max(p.y + dy - 24, 4), imgH - 30);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  roundRect(ctx, x, y, w, 28, 6);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, 28, 6);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 7, y + 15);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 生成离屏快照（打印用），返回 dataURL
export async function renderSnapshot(
  img: HTMLImageElement | null,
  imgW: number,
  imgH: number,
  overlays: Overlay[],
  maxW = 860,
): Promise<string> {
  const scale = maxW / imgW;
  const canvas = document.createElement('canvas');
  canvas.width = maxW;
  canvas.height = Math.round(imgH * scale);
  canvas.style.width = `${maxW}px`;
  canvas.style.height = `${canvas.height}px`;
  const ctx = canvas.getContext('2d')!;
  // drawScene 依赖 clientWidth，离屏 canvas 已设置 style 尺寸
  const prev = HTMLCanvasElement.prototype;
  void prev;
  // 直接调用：临时把 canvas 挂到 body 以获得 clientWidth
  canvas.style.position = 'fixed';
  canvas.style.left = '-99999px';
  document.body.appendChild(canvas);
  drawScene(canvas, img, imgW, imgH, overlays);
  document.body.removeChild(canvas);
  const url = canvas.toDataURL('image/png');
  void ctx;
  return url;
}
