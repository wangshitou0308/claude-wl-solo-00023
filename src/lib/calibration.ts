import type { CalibPoint, Direction } from '../types';

// ===== 分段校准数学 =====
// 同一台机按「波段 × 调谐方向」分开标定，正反向数据绝不混算。
// 照片上的刻度多为弧线：以相邻标定点的弦长作为「位置轴」，
// 频率在相邻两点之间按弦长做分段线性插值。

export interface RunPoint {
  p: CalibPoint;
  s: number; // 沿折线的累计弦长（像素）
}

export interface Segment {
  a: RunPoint;
  b: RunPoint;
  monotone: boolean;
}

export interface Run {
  id: string; // `${bandId}:${dir}:${idx}`
  bandId: string;
  dir: Direction;
  points: RunPoint[]; // 已按频率排序
  segments: Segment[];
  conflicts: string[]; // 该方向内部非单调等冲突说明
  freqMin: number;
  freqMax: number;
}

export interface Candidate {
  run: Run;
  usable: boolean;
  reasons: string[]; // 证据不足 / 冲突提示
}

export interface Mapped {
  pos: { x: number; y: number };
  s: number;
  extrapolated: boolean;
  segIndex: number; // -1 表示外推
}

export interface RunGeom {
  runs: Run[];
  warnings: string[];
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export function buildRuns(points: CalibPoint[]): RunGeom {
  const groups = new Map<string, CalibPoint[]>();
  for (const p of points) {
    const key = `${p.bandId}|${p.dir}`;
    const arr = groups.get(key);
    if (arr) arr.push(p);
    else groups.set(key, [p]);
  }

  const runs: Run[] = [];
  const warnings: string[] = [];

  for (const [key, arr] of groups) {
    const [bandId, dir] = key.split('|') as [string, Direction];
    const sorted = [...arr].sort((a, b) => a.freq - b.freq);

    // 同频率重复点 → 位置明显不一致属于冲突
    const conflicts: string[] = [];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].freq === sorted[i - 1].freq) {
        const d = dist(sorted[i].x, sorted[i].y, sorted[i - 1].x, sorted[i - 1].y);
        if (d > Math.max(sorted[i].tol, sorted[i - 1].tol, 4)) {
          conflicts.push(
            `频率 ${sorted[i].freq} 有两个位置点，相距 ${Math.round(d)} 像素，超出位置误差，请核对。`,
          );
        }
      }
    }

    const runPts: RunPoint[] = [];
    let s = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0) s += dist(sorted[i - 1].x, sorted[i - 1].y, sorted[i].x, sorted[i].y);
      runPts.push({ p: sorted[i], s });
    }

    const segments: Segment[] = [];
    for (let i = 0; i < runPts.length - 1; i++) {
      const a = runPts[i];
      const b = runPts[i + 1];
      const dx = b.p.x - a.p.x;
      const dy = b.p.y - a.p.y;
      const chord = Math.hypot(dx, dy);
      let monotone = chord > 0.5;
      // 累计弦长只增不减，不能反映「往回走」：
      // 用本段在上一段前进方向上的有符号投影判断是否回退
      if (monotone && i > 0) {
        const prev = runPts[i - 1];
        const pdx = a.p.x - prev.p.x;
        const pdy = a.p.y - prev.p.y;
        const plen = Math.hypot(pdx, pdy) || 1;
        const signed = (dx * pdx + dy * pdy) / plen;
        const tolLimit = (a.p.tol + b.p.tol) / 2;
        if (signed < -tolLimit) monotone = false;
      }
      segments.push({ a, b, monotone });
      if (!monotone) {
        conflicts.push(
          `从 ${a.p.freq} 到 ${b.p.freq}（${dir === 'up' ? '低端接近' : '高端接近'}）刻度位置发生回退或重合，走向不单调。`,
        );
      }
    }
    if (conflicts.length) {
      warnings.push(
        `波段「${bandId}」${dir === 'up' ? '低端→高端' : '高端→低端'}方向标定存在冲突，已保留为候选，请优先核对。`,
      );
    }

    runs.push({
      id: `${bandId}:${dir}:0`,
      bandId,
      dir,
      points: runPts,
      segments,
      conflicts,
      freqMin: sorted[0].freq,
      freqMax: sorted[sorted.length - 1].freq,
    });
  }
  return { runs, warnings };
}

export function candidatesFor(runs: Run[], bandId: string, dir: Direction): Candidate[] {
  return runs
    .filter((r) => r.bandId === bandId && r.dir === dir)
    .map((run) => {
      const reasons: string[] = [];
      let usable = true;
      if (run.points.length < 3) {
        reasons.push(`该方向只有 ${run.points.length} 个标定点，至少需要 3 个点，位置仅供参考。`);
        usable = false;
      }
      if (run.conflicts.length) {
        reasons.push(...run.conflicts);
        usable = false;
      }
      return { run, usable, reasons };
    });
}

function pointAtS(run: Run, s: number): { x: number; y: number } {
  // 折线定位；s 超出范围时沿首尾段方向外推
  if (s <= run.points[0].s) {
    const first = run.points[0];
    if (run.segments[0]) {
      const seg = run.segments[0];
      const len = Math.max(seg.b.s - seg.a.s, 0.001);
      const t = (s - first.s) / len;
      return {
        x: first.p.x + (seg.b.p.x - seg.a.p.x) * t,
        y: first.p.y + (seg.b.p.y - seg.a.p.y) * t,
      };
    }
    return { x: first.p.x, y: first.p.y };
  }
  const last = run.points[run.points.length - 1];
  if (s >= last.s) {
    const seg = run.segments[run.segments.length - 1];
    if (seg) {
      const len = Math.max(seg.b.s - seg.a.s, 0.001);
      const t = (s - seg.a.s) / len;
      return {
        x: seg.a.p.x + (seg.b.p.x - seg.a.p.x) * t,
        y: seg.a.p.y + (seg.b.p.y - seg.a.p.y) * t,
      };
    }
    return { x: last.p.x, y: last.p.y };
  }
  for (const seg of run.segments) {
    if (s >= seg.a.s && s <= seg.b.s) {
      const len = Math.max(seg.b.s - seg.a.s, 0.001);
      const t = (s - seg.a.s) / len;
      return {
        x: seg.a.p.x + (seg.b.p.x - seg.a.p.x) * t,
        y: seg.a.p.y + (seg.b.p.y - seg.a.p.y) * t,
      };
    }
  }
  return { x: last.p.x, y: last.p.y };
}

export function mapFreq(run: Run, freq: number): Mapped {
  if (run.points.length === 1) {
    const rp = run.points[0];
    return { pos: { x: rp.p.x, y: rp.p.y }, s: rp.s, extrapolated: true, segIndex: -1 };
  }
  for (let i = 0; i < run.segments.length; i++) {
    const seg = run.segments[i];
    if (freq >= seg.a.p.freq && freq <= seg.b.p.freq) {
      const span = Math.max(seg.b.p.freq - seg.a.p.freq, 1e-9);
      const t = (freq - seg.a.p.freq) / span;
      const s = seg.a.s + t * (seg.b.s - seg.a.s);
      return { pos: pointAtS(run, s), s, extrapolated: !seg.monotone, segIndex: i };
    }
  }
  // 外推：用最靠近的一段斜率
  let seg: Segment;
  if (freq < run.points[0].p.freq) seg = run.segments[0];
  else seg = run.segments[run.segments.length - 1];
  const span = Math.max(seg.b.p.freq - seg.a.p.freq, 1e-9);
  const t = (freq - seg.a.p.freq) / span;
  const s = seg.a.s + t * (seg.b.s - seg.a.s);
  return { pos: pointAtS(run, s), s, extrapolated: true, segIndex: -1 };
}

export function mapStoFreq(run: Run, s: number): number {
  if (s <= run.points[0].s) {
    const seg = run.segments[0];
    if (!seg) return run.points[0].p.freq;
    const ds = Math.max(seg.b.s - seg.a.s, 0.001);
    return seg.a.p.freq + ((s - seg.a.s) / ds) * (seg.b.p.freq - seg.a.p.freq);
  }
  const last = run.points[run.points.length - 1];
  if (s >= last.s) {
    const seg = run.segments[run.segments.length - 1];
    if (!seg) return last.p.freq;
    const ds = Math.max(seg.b.s - seg.a.s, 0.001);
    return seg.a.p.freq + ((s - seg.a.s) / ds) * (seg.b.p.freq - seg.a.p.freq);
  }
  for (const seg of run.segments) {
    if (s >= seg.a.s && s <= seg.b.s) {
      const ds = Math.max(seg.b.s - seg.a.s, 0.001);
      return seg.a.p.freq + ((s - seg.a.s) / ds) * (seg.b.p.freq - seg.a.p.freq);
    }
  }
  return last.p.freq;
}

// ===== 位置不确定区间 =====
// 由 3 部分合成：标定点自报位置误差（沿轴传播）、分段线性的残差（实测点到插值位置）、
// 以及标定读取误差（按相邻点间距折算）。以沿弦长轴的 [sMin, sMax] 表达。

export interface Zone {
  center: { x: number; y: number };
  s: number;
  half: number; // 沿轴半宽（像素）
  sMin: number;
  sMax: number;
  lowEdge: { x: number; y: number };
  highEdge: { x: number; y: number };
  outsideCalib: boolean; // 目标频率在标定点范围之外
}

function residualOf(run: Run, rp: RunPoint): number {
  // 用其相邻两段在该点频率上的插值位置，与实测位置求距离
  const f = rp.p.freq;
  const others = run.points.filter((q) => q.p.id !== rp.p.id);
  if (others.length < 2) return 0;
  const tmpRun: Run = { ...run, points: others, segments: buildSegments(others) };
  if (f < others[0].p.freq || f > others[others.length - 1].p.freq) return 0; // 外推不评残差
  const m = mapFreq(tmpRun, f);
  return dist(m.pos.x, m.pos.y, rp.p.x, rp.p.y);
}

function buildSegments(points: RunPoint[]): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.p.x - a.p.x;
    const dy = b.p.y - a.p.y;
    const chord = Math.hypot(dx, dy);
    let monotone = chord > 0.5;
    if (monotone && i > 0) {
      const prev = points[i - 1];
      const pdx = a.p.x - prev.p.x;
      const pdy = a.p.y - prev.p.y;
      const plen = Math.hypot(pdx, pdy) || 1;
      const signed = (dx * pdx + dy * pdy) / plen;
      if (signed < -(a.p.tol + b.p.tol) / 2) monotone = false;
    }
    segs.push({ a, b, monotone });
  }
  return segs;
}

export function zoneAt(run: Run, freq: number): Zone {
  const m = mapFreq(run, freq);

  // 1) 端点自报误差，按到相邻点的弦长权重向目标传播
  let tolSum = 0;
  if (run.points.length > 1) {
    let lo = run.points[0];
    let hi = run.points[run.points.length - 1];
    for (let i = 0; i < run.points.length - 1; i++) {
      if (freq >= run.points[i].p.freq && freq <= run.points[i + 1].p.freq) {
        lo = run.points[i];
        hi = run.points[i + 1];
        break;
      }
    }
    const span = Math.max(hi.p.freq - lo.p.freq, 1e-9);
    const wHi = Math.min(1, Math.max(0, (freq - lo.p.freq) / span));
    const wLo = 1 - wHi;
    tolSum = lo.p.tol * wLo + hi.p.tol * wHi;
  } else {
    tolSum = run.points[0].p.tol;
  }

  // 2) 残差：取该段两端点留一法残差的较大者，再给 1.5 倍保守系数
  let residual = 0;
  if (m.segIndex >= 0) {
    const seg = run.segments[m.segIndex];
    residual = Math.max(residualOf(run, seg.a), residualOf(run, seg.b)) * 1.5;
  }

  // 3) 频率读数误差（旋钮微调时频率也读不准）：取相邻段像素/频率比 × 一个小读数增量
  const seg = m.segIndex >= 0 ? run.segments[m.segIndex] : run.segments[0] ?? null;
  let readErr = 0;
  if (seg) {
    const fSpan = Math.max(Math.abs(seg.b.p.freq - seg.a.p.freq), 1e-9);
    const pxPerFreq = (seg.b.s - seg.a.s) / fSpan;
    readErr = Math.abs(pxPerFreq) * Math.max(freq * 0.0005, fSpan * 0.01);
  }

  const outside = freq < run.freqMin || freq > run.freqMax;
  const half = tolSum + residual + readErr + (outside ? 12 : 0);

  return {
    center: m.pos,
    s: m.s,
    half,
    sMin: m.s - half,
    sMax: m.s + half,
    lowEdge: pointAtS(run, m.s - half),
    highEdge: pointAtS(run, m.s + half),
    outsideCalib: outside,
  };
}

// ===== 回程间隙估计 =====
// 正反两个方向都在（近似）同一频率留下点时，两点间距离即回程间隙的直接证据。
export function backlashPx(points: CalibPoint[], freqTolRatio = 0.005): number | null {
  const ups = points.filter((p) => p.dir === 'up');
  const downs = points.filter((p) => p.dir === 'down');
  const samples: number[] = [];
  for (const u of ups) {
    let best: CalibPoint | null = null;
    let bestDiff = Infinity;
    for (const d of downs) {
      const diff = Math.abs(d.freq - u.freq);
      const rel = diff / Math.max(Math.abs(u.freq), 1e-9);
      if (rel <= freqTolRatio && diff < bestDiff) {
        best = d;
        bestDiff = diff;
      }
    }
    if (best) samples.push(dist(u.x, u.y, best.x, best.y));
  }
  if (!samples.length) return null;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]; // 中位数
}

// ===== 越台准备位置 =====
// 先沿「错误方向」越过目标，到目标区外侧 (回程间隙 + 安全余量) 处，再回拧。
const STAGE_MARGIN = 26; // 像素，安全余量

export interface StageInfo {
  pos: { x: number; y: number };
  s: number;
  landmark?: RunPoint; // 可作为参照的已知标定频率点
  landmarkName: string;
  synthetic: boolean; // 没有真实参照点，仅几何估计
  freqApprox: number; // 该位置大约对应的频率，供提示
}

export function buildStage(run: Run, zone: Zone, approach: Direction, backlash: number | null): StageInfo {
  const kick = (backlash ?? 0) + STAGE_MARGIN + zone.half;
  const sStage = approach === 'up' ? zone.sMin - kick : zone.sMax + kick;
  const pos = pointAtS(run, sStage);

  // 参照点：在准备位置更外侧（越过方向那侧）找一个真实标定频率点
  const sorted = run.points;
  let landmark: RunPoint | undefined;
  if (approach === 'up') {
    const beyond = sorted.filter((rp) => rp.s <= sStage + zone.half);
    landmark = beyond[beyond.length - 1];
  } else {
    const beyond = sorted.filter((rp) => rp.s >= sStage - zone.half);
    landmark = beyond[0];
  }

  return {
    pos,
    s: sStage,
    landmark,
    landmarkName: landmark ? `${landmark.p.freq}` : '估计位置（附近没有已标定频率点）',
    synthetic: !landmark,
    freqApprox: mapStoFreq(run, sStage),
  };
}

export function sideOf(zone: Zone, pos: { x: number; y: number }): 'low' | 'inside' | 'high' {
  // 用指针点到折线的投影弦长判断在目标区哪一侧
  // 简化：比较到 lowEdge / highEdge 的沿轴近似投影
  const s = projectS(zone, pos);
  if (s < zone.sMin) return 'low';
  if (s > zone.sMax) return 'high';
  return 'inside';
}

function projectS(zone: Zone, pos: { x: number; y: number }): number {
  // 以 low->high 方向为局部轴投影
  const ax = zone.highEdge.x - zone.lowEdge.x;
  const ay = zone.highEdge.y - zone.lowEdge.y;
  const len2 = ax * ax + ay * ay || 1;
  const t = ((pos.x - zone.lowEdge.x) * ax + (pos.y - zone.lowEdge.y) * ay) / len2;
  return zone.sMin + t * (zone.sMax - zone.sMin || 1);
}

// 标定数据版本：任何相关点改动都会改变 → 旧卡立即作废
export function calibVersion(pts: CalibPoint[]): string {
  const sig = pts
    .map((p) => `${p.id}:${p.freq}:${Math.round(p.x)},${Math.round(p.y)}:${p.dir}:${p.tol}`)
    .sort()
    .join('|');
  let h = 0;
  for (let i = 0; i < sig.length; i++) {
    h = (h * 31 + sig.charCodeAt(i)) | 0;
  }
  return 'v' + (h >>> 0).toString(36);
}
