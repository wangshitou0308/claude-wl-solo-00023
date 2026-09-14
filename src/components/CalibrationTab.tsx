import { useEffect, useMemo, useState } from 'react';
import type { BandConfig, CalibPoint, Direction, Radio } from '../types';
import { deletePoint, getPoints, latestUndo, popUndo, clearUndo, putPoint } from '../lib/db';
import { backlashPx, buildRuns, candidatesFor } from '../lib/calibration';
import { DIR_COLOR, DIR_LABEL, type Overlay, type Pt } from '../lib/draw';
import { useAsync } from '../hooks/useDb';
import { useObjectUrl } from '../hooks/useObjectUrl';
import DialCanvas from './DialCanvas';
import PointForm from './PointForm';

export default function CalibrationTab({
  radio,
  band,
  dir,
  onDirChange,
  onUndoChange,
}: {
  radio: Radio;
  band: BandConfig;
  dir: Direction;
  onDirChange: (d: Direction) => void;
  onUndoChange: (n: number) => void;
}) {
  const all = useAsync(() => getPoints(radio.id), [radio.id]) ?? [];
  const points = useMemo(() => all.filter((p) => p.bandId === band.id), [all, band.id]);
  const url = useObjectUrl(radio.photo);
  const [imgSize, setImgSize] = useState<{ w: number; h: number }>({ w: 1200, h: 600 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<CalibPoint | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [toast, setToast] = useState<{ msg: string; canUndo: boolean } | null>(null);

  useEffect(() => {
    if (!url) return;
    const img = new Image();
    img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
  }, [url]);

  const geom = useMemo(() => buildRuns(points), [points]);
  const cands = useMemo(() => candidatesFor(geom.runs, band.id, dir), [geom, band.id, dir]);
  const cand = cands[0];
  const backlash = useMemo(() => backlashPx(points), [points]);

  const dirPoints = points.filter((p) => p.dir === dir);
  const otherPoints = points.filter((p) => p.dir !== dir);
  const selected = points.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    setSelectedId(null);
  }, [band.id, dir]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    if (toast) t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  function overlays(): Overlay[] {
    const list: Overlay[] = [];
    if (cand) {
      list.push({
        kind: 'path',
        pts: cand.run.points.map((rp) => ({ x: rp.p.x, y: rp.p.y })),
        dir,
        active: true,
      });
    }
    if (showOther) {
      for (const c of candidatesFor(geom.runs, band.id, dir === 'up' ? 'down' : 'up')) {
        list.push({
          kind: 'path',
          pts: c.run.points.map((rp) => ({ x: rp.p.x, y: rp.p.y })),
          dir: c.run.dir,
        });
      }
    }
    if (showOther) {
      for (const p of otherPoints) {
        list.push({
          kind: 'point',
          p: { x: p.x, y: p.y },
          dir: p.dir,
          label: `${p.freq}`,
          tol: p.tol,
          dim: true,
        });
      }
    }
    for (const p of dirPoints) {
      list.push({
        kind: 'point',
        p: { x: p.x, y: p.y },
        dir: p.dir,
        label: `${p.freq}`,
        tol: p.tol,
        selected: p.id === selectedId,
      });
    }
    return list;
  }

  function nearPoint(p: Pt, radius = 24): CalibPoint | null {
    let best: CalibPoint | null = null;
    let bd = radius;
    for (const q of points) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  async function handlePick(p: Pt) {
    const hit = nearPoint(p);
    if (hit) {
      setSelectedId(hit.id);
      return;
    }
    if (!radio.photo) {
      alert('请先在机器列表里给这台收音机添加刻度盘照片。');
      return;
    }
    setDraft(p);
  }

  async function handleDrag(p: Pt) {
    if (!selected) return;
    if (Math.hypot(p.x - selected.x, p.y - selected.y) < 2) return;
    const old = selected;
    const moved = { ...selected, x: Math.round(p.x), y: Math.round(p.y) };
    setSelectedId(moved.id);
    await putPoint(moved, { kind: 'update', point: moved, oldPoint: old });
    setToast({ msg: `已把 ${moved.freq} 标定点移到新位置`, canUndo: true });
    onUndoChange(Date.now());
  }

  async function saveNew(p: CalibPoint) {
    const full: CalibPoint = {
      ...p,
      x: Math.round(draft!.x),
      y: Math.round(draft!.y),
      radioId: radio.id,
      bandId: band.id,
      dir,
      imgW: imgSize.w,
      imgH: imgSize.h,
    };
    await putPoint(full, { kind: 'add', point: full });
    setDraft(null);
    setSelectedId(full.id);
    setToast({ msg: `已新增标定点 ${full.freq} ${band.unit}`, canUndo: true });
    onUndoChange(Date.now());
  }

  async function saveEdit(p: CalibPoint) {
    await putPoint(p, { kind: 'update', point: p, oldPoint: editing! });
    setEditing(null);
    setToast({ msg: `已修改标定点 ${p.freq} ${band.unit}`, canUndo: true });
    onUndoChange(Date.now());
  }

  async function remove(p: CalibPoint) {
    if (!confirm(`删除标定点 ${p.freq} ${band.unit}？相关旧找台卡将立即作废。`)) return;
    await deletePoint(p);
    if (selectedId === p.id) setSelectedId(null);
    setToast({ msg: `已删除标定点 ${p.freq}`, canUndo: true });
    onUndoChange(Date.now());
  }

  async function undo() {
    const entry = await latestUndo();
    if (!entry) {
      setToast(null);
      return;
    }
    await popUndo(entry);
    setToast({
      msg:
        entry.kind === 'add'
          ? `已撤销：恢复到新增「${entry.point.freq}」之前`
          : entry.kind === 'delete'
            ? `已撤销删除：恢复「${entry.point.freq}」标定点`
            : `已撤销修改：「${entry.point.freq}」恢复原位置/内容`,
      canUndo: false,
    });
    onUndoChange(Date.now());
    setTimeout(() => clearUndo(entry.id), 300);
  }

  const counts = {
    up: points.filter((p) => p.dir === 'up').length,
    down: points.filter((p) => p.dir === 'down').length,
  };

  return (
    <div>
      <div className="dir-switch">
        <button
          className={`${dir === 'up' ? 'active up' : ''}`}
          onClick={() => onDirChange('up')}
        >
          ↑ 从低端接近（{counts.up} 点）
        </button>
        <button
          className={`${dir === 'down' ? 'active down' : ''}`}
          onClick={() => onDirChange('down')}
        >
          ↓ 从高端接近（{counts.down} 点）
        </button>
      </div>

      <div className="legend">
        <span>
          <span className="dot" style={{ background: DIR_COLOR.up }} />
          低端接近点
        </span>
        <span>
          <span className="dot" style={{ background: DIR_COLOR.down }} />
          高端接近点
        </span>
        <span>
          <span className="dot" style={{ background: '#1a9e57' }} />
          目标位置区间
        </span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0, fontWeight: 400 }}>
          <input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={showOther} onChange={(e) => setShowOther(e.target.checked)} />
          淡显另一方向对照（不参与计算）
        </label>
      </div>

      <DialCanvas
        photo={radio.photo}
        imgW={imgSize.w}
        imgH={imgSize.h}
        overlays={overlays()}
        onPick={handlePick}
        onDrag={handleDrag}
      />
      <p className="hint">
        在照片上点刻度位置即可新增点；点到已有点可选中并直接拖动修正位置。当前方向：
        <b className={dir === 'up' ? 'up-color' : 'down-color'}>{DIR_LABEL[dir]}</b>，正反向始终分开计算。
      </p>

      {/* 标定状态 */}
      <div className="card" style={{ boxShadow: 'none' }}>
        <h2 style={{ fontSize: '1.1rem' }}>
          {band.name} · {DIR_LABEL[dir]} 标定状态
        </h2>
        {!cand && (
          <div className="warn">
            该方向还没有标定点。请在收音机上把旋钮{dir === 'up' ? '从小往大' : '从大往小'}缓慢拧到一个已知频率
            （电台声或已知刻度），在照片对应位置点一下并记录。至少需要 3 个点。
          </div>
        )}
        {cand && !cand.usable &&
          cand.reasons.map((r, i) => (
            <div className="warn" key={i}>
              ⚠ {r}
            </div>
          ))}
        {cand?.usable && (
          <div className="ok">
            ✓ 已有 {cand.run.points.length} 个单调标定频率点，频率覆盖 {cand.run.freqMin}–{cand.run.freqMax} {band.unit}
            {cand.run.freqMin > band.lo || cand.run.freqMax < band.hi ? '（注意：未覆盖整个波段，范围外为外推估计）' : ''}
            ，可以生成找台卡。
          </div>
        )}
        {backlash !== null && (
          <div className="ok">
            🔁 由正反两向成对频率点估得旋钮回程间隙约 <b>{Math.round(backlash)}</b> 像素，生成找台卡时会自动多越过这一段。
          </div>
        )}
        {backlash === null && (counts.up + counts.down >= 3) && (
          <p className="hint">
            提示：在同一频率附近分别从低端、高端各标定一个点后，可自动估算这台机器旋钮的回程间隙。
          </p>
        )}
        {geom.warnings.map((w, i) => (
          <div className="error" key={i}>
            {w}
          </div>
        ))}
      </div>

      {/* 点列表 */}
      <h3>本波段已记录的点（{dirPoints.length}）</h3>
      {dirPoints
        .slice()
        .sort((a, b) => a.freq - b.freq)
        .map((p) => (
          <div key={p.id} className={`point-row${p.id === selectedId ? ' selected' : ''}`}>
            <span className={`tag ${p.dir}`}>{p.freq} {band.unit}</span>
            <span className="grow">
              {p.stationCall ? <b>{p.stationCall}</b> : <span className="hint">未记台呼</span>}
              {p.sound ? <span className="hint"> · {p.sound}</span> : null}
            </span>
            <span className="hint narrow">误差≈{p.tol}px</span>
            <button className="ghost narrow" onClick={() => setSelectedId(p.id)}>
              定位
            </button>
            <button className="ghost narrow" onClick={() => setEditing(p)}>
              改
            </button>
            <button className="danger ghost narrow" onClick={() => remove(p)}>
              删
            </button>
          </div>
        ))}

      {(draft || editing) && (
        <PointForm
          band={band}
          dir={dir}
          imgW={imgSize.w}
          imgH={imgSize.h}
          initial={editing ?? undefined}
          defaultFreq={selected?.freq}
          onSave={editing ? saveEdit : saveNew}
          onClose={() => {
            setDraft(null);
            setEditing(null);
          }}
        />
      )}

      {toast && (
        <div className="toast">
          <span>{toast.msg}</span>
          {toast.canUndo && <button onClick={undo}>撤销</button>}
          <button onClick={() => setToast(null)}>知道了</button>
        </div>
      )}
    </div>
  );
}
