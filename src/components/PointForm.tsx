import { useState } from 'react';
import type { BandConfig, CalibPoint, Direction } from '../types';
import { uid } from '../lib/db';

export interface PointDraft {
  x: number;
  y: number;
}

// 新增 / 编辑标定频率点
export default function PointForm({
  band,
  dir,
  imgW,
  imgH,
  initial,
  defaultFreq,
  onSave,
  onClose,
}: {
  band: BandConfig;
  dir: Direction;
  imgW: number;
  imgH: number;
  initial?: CalibPoint;
  defaultFreq?: number;
  onSave: (p: CalibPoint) => void;
  onClose: () => void;
}) {
  const [freq, setFreq] = useState(initial?.freq ?? defaultFreq ?? band.lo);
  const [tol, setTol] = useState(initial?.tol ?? Math.max(6, Math.round((imgW + imgH) / 120)));
  const [call, setCall] = useState(initial?.stationCall ?? '');
  const [sound, setSound] = useState(initial?.sound ?? '');
  const [note, setNote] = useState(initial?.note ?? '');

  function save() {
    if (!(freq >= band.lo && freq <= band.hi)) {
      if (!confirm(`频率 ${freq} ${band.unit} 在该波段范围 ${band.lo}–${band.hi} 之外，仍要保存吗？`)) return;
    }
    const p: CalibPoint = {
      id: initial?.id ?? uid('p_'),
      radioId: initial?.radioId ?? '',
      bandId: initial?.bandId ?? band.id,
      freq: Number(freq),
      x: initial?.x ?? 0,
      y: initial?.y ?? 0,
      imgW,
      imgH,
      dir: initial?.dir ?? dir,
      tol: Math.max(2, Number(tol) || 0),
      stationCall: call.trim() || undefined,
      sound: sound.trim() || undefined,
      note: note.trim() || undefined,
      createdAt: initial?.createdAt ?? Date.now(),
    };
    onSave(p);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{initial ? '编辑标定点' : '记录标定频率点'}</h2>
        <p className="hint">
          在照片上点一下该频率刻度位置后，在这里填写频率与确认线索。
          <span className={dir === 'up' ? 'up-color' : 'down-color'}>
            当前记录方向：{dir === 'up' ? '从低端接近（频率由小往大拧）' : '从高端接近（频率由大往小拧）'}
          </span>
        </p>

        <label>
          频率读数（{band.unit}）*
        </label>
        <input type="number" step="any" value={freq} onChange={(e) => setFreq(Number(e.target.value))} autoFocus />
        <div className="row" style={{ marginTop: 6 }}>
          {quickFreqs(band).map((f) => (
            <button key={f} type="button" className="ghost narrow" onClick={() => setFreq(f)}>
              {f}
            </button>
          ))}
        </div>

        <label>位置误差：把旋钮停在该点时，指针可能偏多少（照片像素，约 {tol}）</label>
        <input type="range" min={4} max={80} value={tol} onChange={(e) => setTol(Number(e.target.value))} />
        <span className="hint">圈越小代表您对这个位置越有把握。</span>

        <label>台呼（听到的电台名字，如「中国之声」）</label>
        <input value={call} onChange={(e) => setCall(e.target.value)} />

        <label>节目声线索（报时、开始曲、主持人声、戏曲锣鼓点…）</label>
        <textarea value={sound} onChange={(e) => setSound(e.target.value)} />

        <label>其他备注</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} />

        <div className="row" style={{ marginTop: 18 }}>
          <button className="ghost" onClick={onClose}>
            取消
          </button>
          <button className="primary" onClick={save}>
            保存标定点
          </button>
        </div>
      </div>
    </div>
  );
}

function quickFreqs(band: BandConfig): number[] {
  const step = band.unit === 'kHz' ? 100 : band.unit === 'MHz' ? Math.abs(band.hi - band.lo) > 20 ? 2 : 1 : 1;
  const out: number[] = [];
  for (let f = Math.ceil(band.lo / step) * step; f <= band.hi && out.length < 5; f += step) {
    out.push(Number(f.toFixed(3)));
  }
  return out;
}
