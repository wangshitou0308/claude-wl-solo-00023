import { useMemo, useState } from 'react';
import type { BandConfig, CalibPoint, Direction, Finding, Radio } from '../types';
import { deleteFinding, putFinding, uid } from '../lib/db';
import { buildRuns, candidatesFor, calibVersion } from '../lib/calibration';
import { DIR_LABEL } from '../lib/draw';
import { nearestClues } from './FindingWizard';

export default function FindingsTab({
  radio,
  band,
  points,
  findings,
  onOpen,
}: {
  radio: Radio;
  band: BandConfig;
  points: CalibPoint[];
  findings: Finding[];
  onOpen: (f: Finding) => void;
}) {
  const geom = useMemo(() => buildRuns(points), [points]);
  const [freq, setFreq] = useState<number>(band.lo + (band.hi - band.lo) * 0.5);
  const [approach, setApproach] = useState<Direction>('up');
  const [call, setCall] = useState('');
  const [sound, setSound] = useState('');

  const cands = candidatesFor(geom.runs, band.id, approach);
  const usable = cands.filter((c) => c.usable);
  const bandFindings = findings
    .filter((f) => f.bandId === band.id)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const active = bandFindings.filter((f) => f.status !== 'invalid' && f.step < 4);
  const done = bandFindings.filter((f) => f.status !== 'invalid' && f.step >= 4);
  const invalidOnes = bandFindings.filter((f) => f.status === 'invalid');

  async function create() {
    if (!freq) {
      alert('请填写要找回的目标频率。');
      return;
    }
    if (!usable.length) {
      alert('该方向标定证据不足或有冲突，不能生成找台卡。请看下方说明先补齐标定。');
      return;
    }
    const cand = usable[0];
    const f: Finding = {
      id: uid('f_'),
      radioId: radio.id,
      bandId: band.id,
      targetFreq: Number(freq),
      approach,
      stationCall: call.trim() || undefined,
      sound: sound.trim() || undefined,
      runId: cand.run.id,
      calVersion: calibVersion(points.filter((p) => p.bandId === band.id)),
      status: 'active',
      step: 0,
      misses: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    await putFinding(f);
    onOpen(f);
  }

  function pickFreq(v: number) {
    setFreq(v);
    const clues = nearestClues(points.filter((p) => p.bandId === band.id && p.dir === approach), v);
    setCall(clues.stationCall ?? '');
    setSound(clues.sound ?? '');
  }

  const nearbyKnown = useMemo(() => {
    return points
      .filter((p) => p.bandId === band.id && p.dir === approach)
      .sort((a, b) => Math.abs(a.freq - freq) - Math.abs(b.freq - freq))
      .slice(0, 6);
  }, [points, band.id, approach, freq]);

  return (
    <div>
      <div className="card">
        <h2>新建找台卡</h2>
        <p className="hint">
          记下的频率找不回台，往往是回程间隙在作怪。卡片会要求先越过目标、再从指定方向单向回拧。
        </p>

        <label>最终要从哪个方向接近？</label>
        <div className="dir-switch">
          <button className={approach === 'up' ? 'active up' : ''} onClick={() => setApproach('up')}>
            ↑ 低端接近（频率由小到大）
          </button>
          <button className={approach === 'down' ? 'active down' : ''} onClick={() => setApproach('down')}>
            ↓ 高端接近（频率由大到小）
          </button>
        </div>

        <label>目标频率（{band.unit}）</label>
        <input type="number" step="any" value={freq} onChange={(e) => setFreq(Number(e.target.value))} />
        <div className="row" style={{ marginTop: 6 }}>
          {nearbyKnown.map((p) => (
            <button key={p.id} type="button" className="ghost narrow" onClick={() => pickFreq(p.freq)}>
              {p.freq}
              {p.stationCall ? ` ${p.stationCall.slice(0, 6)}` : ''}
            </button>
          ))}
        </div>

        <label>台呼（找回后用来核对，可先用附近已知台的记录）</label>
        <input value={call} onChange={(e) => setCall(e.target.value)} placeholder="如：中国之声、地方戏曲广播" />
        <label>节目声线索</label>
        <textarea value={sound} onChange={(e) => setSound(e.target.value)} placeholder="如：整点《东方红》报时、豫剧选段、男播音员…" />

        {cands.length === 0 && (
          <div className="warn">
            「{DIR_LABEL[approach]}」还没有任何标定点，请到「标定」页切换到该方向，至少标定 3 个点。
          </div>
        )}
        {cands.map((c, i) => (
          <div key={i} className={c.usable ? 'ok' : 'warn'}>
            {c.usable ? '✓ ' : '⚠ '}
            该方向 {c.run.points.length} 个标定频率点（{c.run.freqMin}–{c.run.freqMax} {band.unit}）
            {c.reasons.map((r, j) => (
              <div key={j}>· {r}</div>
            ))}
          </div>
        ))}

        <button className="primary big" style={{ marginTop: 10 }} onClick={create} disabled={!usable.length}>
          生成逐步找台卡
        </button>
      </div>

      {active.length > 0 && (
        <>
          <h2>进行中的卡</h2>
          {active.map((f) => (
            <FindingRow key={f.id} f={f} band={band} onOpen={() => onOpen(f)} onDelete={() => deleteFinding(f.id)} />
          ))}
        </>
      )}

      {done.length > 0 && (
        <>
          <h2>已找回（可刷新后继续对照、重开或打印）</h2>
          {done.map((f) => (
            <FindingRow key={f.id} f={f} band={band} onOpen={() => onOpen(f)} onDelete={() => deleteFinding(f.id)} done />
          ))}
        </>
      )}

      {invalidOnes.length > 0 && (
        <>
          <h2>已作废的旧卡（标定改动后自动失效）</h2>
          {invalidOnes.map((f) => (
            <FindingRow key={f.id} f={f} band={band} onOpen={() => onOpen(f)} onDelete={() => deleteFinding(f.id)} invalid />
          ))}
        </>
      )}
    </div>
  );
}

function FindingRow({
  f,
  band,
  onOpen,
  onDelete,
  done,
  invalid,
}: {
  f: Finding;
  band: BandConfig;
  onOpen: () => void;
  onDelete: () => void;
  done?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className={`finding-row${invalid ? ' invalid' : ''}`}>
      <div className="grow">
        <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>
          {f.targetFreq} {band.unit}
          {f.stationCall ? ` · ${f.stationCall}` : ''}
        </div>
        <div className={`hint ${f.approach === 'up' ? 'up-color' : 'down-color'}`} style={{ fontWeight: 700 }}>
          {DIR_LABEL[f.approach]} · {done ? '已找回' : invalid ? '已作废' : `停在第 ${f.step + 1} 步`}
          {f.misses > 0 ? ` · 重试 ${f.misses} 次` : ''}
        </div>
      </div>
      <button className="primary narrow" onClick={onOpen}>
        {invalid ? '查看' : done ? '重开 / 打印' : '继续'}
      </button>
      <button className="danger ghost narrow" onClick={() => {
        if (confirm('删除这张找台卡？')) onDelete();
      }}>
        删除
      </button>
    </div>
  );
}
