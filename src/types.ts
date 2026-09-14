// 全局数据类型：所有照片与记录仅保存在本机浏览器 IndexedDB

export type Direction = 'up' | 'down';
// up = 旋钮从低端接近（频率由小到大）；down = 从高端接近（频率由大到小）

export type BandUnit = 'MHz' | 'kHz' | 'm';

export interface BandConfig {
  id: string;
  name: string; // 如「中波 MW」「调频 FM」「短波 SW1」
  unit: BandUnit;
  lo: number;
  hi: number;
}

export interface Radio {
  id: string;
  name: string; // 机型称呼，如「红灯 753」
  photo?: Blob;
  photoType?: string;
  note?: string;
  bands: BandConfig[];
  createdAt: number;
}

export interface CalibPoint {
  id: string;
  radioId: string;
  bandId: string;
  freq: number; // 标定时的频率读数
  x: number; // 照片上的刻度位置（像素坐标，按原始图片尺寸）
  y: number;
  imgW: number;
  imgH: number;
  dir: Direction; // 该点是从哪个方向拧到后记录的
  tol: number; // 位置误差（像素，照片原始尺寸下的估计）
  stationCall?: string; // 台呼，如「中央人民广播电台中国之声」
  sound?: string; // 节目声线索，如「整点报时后男声」
  note?: string;
  createdAt: number;
}

export type FindingStatus = 'active' | 'done' | 'invalid';

export interface Finding {
  id: string;
  radioId: string;
  bandId: string;
  targetFreq: number;
  approach: Direction; // 最终回拧方向
  stationCall?: string;
  sound?: string;
  runId: string; // 采用的候选标定段 id
  calVersion: string; // 生成时标定数据的版本，点改动后用于作废
  status: FindingStatus;
  step: number; // 当前停留在第几步
  misses: number; // 「没听到」次数
  startedAt: number;
  updatedAt: number;
}

export interface UndoEntry {
  id: string;
  kind: 'add' | 'update' | 'delete';
  point: CalibPoint;
  oldPoint?: CalibPoint;
  at: number;
}
