import { useEffect, useMemo, useState } from 'react';
import type { Direction, Finding, Radio } from '../types';
import { deleteFinding, getAllFindings, getAllRadios, getPoints, putFinding } from '../lib/db';
import { useAsync } from '../hooks/useDb';
import { buildRuns, calibVersion } from '../lib/calibration';
import CalibrationTab from '../components/CalibrationTab';
import FindingsTab from '../components/FindingsTab';
import FindingWizard from '../components/FindingWizard';
import BandManager from '../components/BandManager';

type Tab = 'calib' | 'find';

export default function RadioPage({ radioId, onBack }: { radioId: string; onBack: () => void }) {
  const radios = useAsync(() => getAllRadios(), []) ?? [];
  const radio: Radio | undefined = radios.find((r) => r.id === radioId);
  const points = useAsync(() => getPoints(radioId), [radioId]) ?? [];
  const findings = useAsync(() => getAllFindings(), []) ?? [];

  const [bandId, setBandId] = useState<string>('');
  const [dir, setDir] = useState<Direction>('up');
  const [tab, setTab] = useState<Tab>('calib');
  const [openFindingId, setOpenFindingId] = useState<string | null>(null);
  const [editBands, setEditBands] = useState(false);
  const [undoPulse, setUndoPulse] = useState(0);

  useEffect(() => {
    if (radio && (!bandId || !radio.bands.some((b) => b.id === bandId))) {
      setBandId(radio.bands[0]?.id ?? '');
    }
  }, [radio, bandId]);

  const band = radio?.bands.find((b) => b.id === bandId);
  const bandPts = useMemo(() => points.filter((p) => p.bandId === bandId), [points, bandId]);

  // 标定点一改动：相关旧卡立即作废（每台机 × 波段独立版本）
  const currentVersion = useMemo(() => calibVersion(bandPts), [bandPts, undoPulse]);
  useEffect(() => {
    for (const f of findings) {
      if (f.radioId !== radioId || f.status === 'invalid') continue;
      const pts = points.filter((p) => p.bandId === f.bandId);
      const v = calibVersion(pts);
      if (v !== f.calVersion) {
        void putFinding({ ...f, status: 'invalid' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVersion, findings.length, radioId, points]);

  if (!radio) {
    return (
      <div className="card">
        <p>正在载入或该收音机已被删除。</p>
        <button onClick={onBack}>返回列表</button>
      </div>
    );
  }
  if (!band) return null;

  const geom = buildRuns(points.filter((p) => p.bandId === band.id));
  const openFinding = openFindingId ? findings.find((f) => f.id === openFindingId) : undefined;
  const openRun = openFinding
    ? geom.runs.find((r) => r.bandId === openFinding.bandId && r.dir === openFinding.approach)
    : undefined;

  async function updateFinding(patch: Partial<Finding>) {
    if (!openFinding) return;
    await putFinding({ ...openFinding, ...patch, updatedAt: Date.now() });
  }

  async function regenerate(f: Finding) {
    const run = geom.runs.find((r) => r.bandId === f.bandId && r.dir === f.approach);
    if (!run || run.points.length < 3 || run.conflicts.length) {
      alert('该方向当前标定仍不足或有冲突，无法重建，请先补好标定。');
      return;
    }
    const pts = points.filter((p) => p.bandId === f.bandId);
    await putFinding({
      ...f,
      runId: run.id,
      calVersion: calibVersion(pts),
      status: 'active',
      step: 0,
      misses: 0,
      updatedAt: Date.now(),
    });
  }

  return (
    <div>
      <div className="card no-print">
        <div className="row" style={{ alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{radio.name}</h2>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="ghost narrow" onClick={() => setEditBands(true)}>
            波段设置
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          {radio.bands.map((b) => (
            <span
              key={b.id}
              className={`band-chip${b.id === bandId ? ' active' : ''}`}
              onClick={() => {
                setBandId(b.id);
                setOpenFindingId(null);
              }}
            >
              {b.name}
            </span>
          ))}
        </div>
      </div>

      {openFinding && openRun ? (
        <div className="card">
          <button className="back-link no-print" onClick={() => setOpenFindingId(null)}>
            ← 返回卡片列表
          </button>
          <FindingWizard
            radio={radio}
            band={radio.bands.find((b) => b.id === openFinding.bandId)!}
            points={points}
            finding={openFinding}
            run={openRun}
            invalid={openFinding.status === 'invalid'}
            onAdvance={(step) => updateFinding({ step, status: 'active' })}
            onBack={(step) => updateFinding({ step })}
            onMiss={(misses) => updateFinding({ misses, step: 1 })}
            onDone={() => updateFinding({ step: 4, status: 'done' })}
            onAbandon={async () => {
              await deleteFinding(openFinding.id);
              setOpenFindingId(null);
            }}
            onRegenerate={() => regenerate(openFinding)}
          />
        </div>
      ) : (
        <>
          {openFinding && !openRun && (
            <div className="error">
              该卡所属方向的标定数据已不存在（可能整个方向的点都被删除）。
              <div className="row" style={{ marginTop: 8 }}>
                <button className="danger ghost narrow" onClick={async () => {
                  await deleteFinding(openFinding.id);
                  setOpenFindingId(null);
                }}>
                  删除旧卡
                </button>
                <button className="ghost narrow" onClick={() => setOpenFindingId(null)}>
                  返回
                </button>
              </div>
            </div>
          )}

          <div className="tabs no-print">
            <button className={tab === 'calib' ? 'active' : ''} onClick={() => setTab('calib')}>
              ① 标定刻度
            </button>
            <button className={tab === 'find' ? 'active' : ''} onClick={() => setTab('find')}>
              ② 找回电台
            </button>
          </div>

          {tab === 'calib' && (
            <div className="card">
              <details className="help">
                <summary>怎么标定？（第一次使用请展开）</summary>
                <ol>
                  <li>打开收音机，选定当前波段；先约定方向：{dir === 'up' ? '从低端（小频率）缓慢往大拧' : '从高端（大频率）缓慢往小拧'}，单向拧到一个能确认的频率/电台，停住。</li>
                  <li>在下方照片上点指针所在刻度位置，填频率读数、位置误差圈、台呼和节目声线索。</li>
                  <li>同一方向至少标 3 个点（分散在低、中、高）。需要时切到另一方向，<b>从相反方向重新拧到同一些频率再各标一次</b>——正反数据始终分开算。</li>
                  <li>标错可点选后拖动，或用「改 / 删 / 撤销」。改动后旧找台卡自动作废。</li>
                </ol>
              </details>
              <CalibrationTab
                radio={radio}
                band={band}
                dir={dir}
                onDirChange={setDir}
                onUndoChange={setUndoPulse}
              />
            </div>
          )}

          {tab === 'find' && (
            <FindingsTab
              radio={radio}
              band={band}
              points={points}
              findings={findings.filter((f) => f.radioId === radioId)}
              onOpen={(f) => {
                if (f.bandId !== bandId) setBandId(f.bandId);
                setOpenFindingId(f.id);
              }}
            />
          )}
        </>
      )}

      {editBands && <BandManager radio={radio} onClose={() => setEditBands(false)} />}
    </div>
  );
}
