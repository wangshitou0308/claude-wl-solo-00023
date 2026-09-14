import { useEffect, useMemo, useState } from 'react';
import type { BandConfig, CalibPoint, Direction, Finding, Radio } from '../types';
import {
  backlashPx,
  buildStage,
  sideOf,
  zoneAt,
  type Run,
} from '../lib/calibration';
import {
  DIR_COLOR,
  DIR_LABEL,
  loadPhoto,
  renderSnapshot,
  type Overlay,
  type Pt,
} from '../lib/draw';
import { useObjectUrl } from '../hooks/useObjectUrl';
import DialCanvas from './DialCanvas';

const STEP_NAMES = ['准备', '先越过', '回拧进入', '停住辨听', '完成'];

export default function FindingWizard({
  radio,
  band,
  points,
  finding,
  run,
  invalid,
  onAdvance,
  onBack,
  onMiss,
  onDone,
  onAbandon,
  onRegenerate,
}: {
  radio: Radio;
  band: BandConfig;
  points: CalibPoint[];
  finding: Finding;
  run: Run;
  invalid: boolean;
  onAdvance: (step: number) => void;
  onBack: (step: number) => void;
  onMiss: (misses: number) => void;
  onDone: () => void;
  onAbandon: () => void;
  onRegenerate: () => void;
}) {
  const url = useObjectUrl(radio.photo);
  const [imgSize, setImgSize] = useState({ w: run.points[0]?.p.imgW || 1200, h: run.points[0]?.p.imgH || 600 });
  const [current, setCurrent] = useState<Pt | null>(null);
  const [shots, setShots] = useState<string[]>([]);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!url) return;
    const img = new Image();
    img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
  }, [url]);

  const bandPts = useMemo(() => points.filter((p) => p.bandId === band.id), [points, band.id]);
  const backlash = useMemo(() => backlashPx(bandPts), [bandPts]);
  const zone = useMemo(() => zoneAt(run, finding.targetFreq), [run, finding.targetFreq]);
  const stage = useMemo(() => buildStage(run, zone, finding.approach, backlash), [run, zone, finding.approach, backlash]);

  const step = finding.step;
  const approach = finding.approach;
  const wrongDir: Direction = approach === 'up' ? 'down' : 'up';

  function currentSide() {
    if (!current) return null;
    return sideOf(zone, current);
  }

  function overlaysFor(stepIdx: number): Overlay[] {
    const list: Overlay[] = [
      { kind: 'path', pts: run.points.map((rp) => ({ x: rp.p.x, y: rp.p.y })), dir: approach, active: true },
      { kind: 'zone', low: zone.lowEdge, high: zone.highEdge, center: zone.center },
    ];
    if (stepIdx <= 2) {
      list.push({
        kind: 'stage',
        p: stage.pos,
        label: stage.landmark ? `先停在 ${stage.landmark.p.freq} 附近` : '先停在旗子处',
      });
    }
    if (current) list.push({ kind: 'current', p: current });
    // 已完成步骤打勾点
    if (stepIdx >= 2) list.push({ kind: 'pulse', p: stage.pos, color: '#1a9e57' });
    return list;
  }

  async function printCard() {
    if (!radio.photo) {
      window.print();
      return;
    }
    setPrinting(true);
    try {
      const img = await loadPhoto(radio.photo);
      const perStep: string[] = [];
      for (let i = 1; i <= 3; i++) {
        perStep.push(await renderSnapshot(img, imgSize.w, imgSize.h, overlaysFor(i)));
      }
      setShots(perStep);
      setTimeout(() => window.print(), 150);
    } finally {
      setTimeout(() => setPrinting(false), 1000);
    }
  }

  const side = currentSide();
  const stageFreq = stage.freqApprox;

  return (
    <div>
      <div className="step-dots no-print">
        {STEP_NAMES.map((n, i) => (
          <span key={n} className={step > i ? 'done' : step === i ? 'on' : ''} title={n} />
        ))}
      </div>
      <p className="hint no-print" style={{ textAlign: 'center' }}>
        第 {Math.min(step + 1, STEP_NAMES.length)} 步 / 共 {STEP_NAMES.length} 步 ·
        目标 <b>{finding.targetFreq} {band.unit}</b> ·{' '}
        <span className={approach === 'up' ? 'up-color' : 'down-color'}>{DIR_LABEL[approach]}</span>
      </p>

      {invalid && (
        <div className="error">
          本卡生成后，相关标定点被修改或删除，旧卡已作废。请不要继续按旧位置操作，可按现有标定重新生成一张卡。
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary narrow" onClick={onRegenerate}>
              用新标定重新生成
            </button>
            <button className="ghost narrow" onClick={onAbandon}>
              删除旧卡
            </button>
          </div>
        </div>
      )}

      <DialCanvas photo={radio.photo} imgW={imgSize.w} imgH={imgSize.h} overlays={overlaysFor(step)} tall
        onPick={step === 0 && !invalid ? (p) => setCurrent(p) : undefined}
      />

      <div className="step-screen no-print">
        {step === 0 && (
          <>
            <div className="big-freq">{finding.targetFreq} {band.unit}</div>
            <div className="action">先确认旋钮起点</div>
            <p>
              为了消除回程间隙，要先把指针<b style={{ color: DIR_COLOR[wrongDir] }}>
              往{wrongDir === 'down' ? '频率减小' : '频率增大'}方向</b>带过目标，再
              <b className={approach === 'up' ? 'up-color' : 'down-color'}>
                {approach === 'up' ? '从小往大' : '从大往小'}
              </b>
              慢慢回拧进来。
            </p>
            {zone.outsideCalib && (
              <div className="warn">目标频率在已标定范围之外，位置是外推估计，误差区已自动放宽，请多留余量。</div>
            )}
            <p className="hint">
              可选：在上方照片上点出<b>指针现在停的位置</b>，可判断是否已越过目标。
            </p>
            {current && side && (
              <div className={side === (approach === 'up' ? 'high' : 'low') ? 'ok' : 'warn'}>
                {side === 'inside'
                  ? '指针已在目标区间内。为保证回程间隙被消除，仍建议先按下方步骤越过再回拧。'
                  : approach === 'up'
                    ? side === 'high'
                      ? '指针已在目标高端一侧（已经越过），下一步直接慢速回拧前，仍建议先退到旗子处统一起点。'
                      : '指针在目标低端一侧：下一向频率增大方向走，正好可以先越过目标。'
                    : side === 'low'
                      ? '指针已在目标低端一侧（已经越过），下一步仍建议先进到旗子处统一起点。'
                      : '指针在目标高端一侧：下一向频率减小方向走，正好可以先越过目标。'}
              </div>
            )}
            <div className="row" style={{ maxWidth: 480, margin: '16px auto 0' }}>
              <button className="ghost" onClick={() => setCurrent(null)} disabled={!current}>
                重选当前位置
              </button>
              <button className="primary big" style={{ flex: 2 }} onClick={() => onAdvance(1)}>
                开始：带我越过目标 →
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="action" style={{ color: DIR_COLOR[wrongDir] }}>
              第 1 拧：往{wrongDir === 'down' ? '频率减小（低端）' : '频率增大（高端）'}方向拧
            </div>
            <p>
              慢慢拧，<b>路过 {finding.targetFreq} {band.unit} 时不要停</b>
              ，一直拧到照片上橙色小旗位置
              {stage.landmark ? `（参照频率 ${stage.landmark.p.freq} ${band.unit}）` : ''}再停。
            </p>
            {stage.synthetic && (
              <div className="warn">
                旗子附近没有已标定的频率点，位置按刻度走向推算（约 {stageFreq.toFixed(2)} {band.unit}），
                请拧到明显越过绿色区域后再多拧一点。
              </div>
            )}
            <p className="hint">
              这一下多走的路程包含了回程间隙{backlash !== null ? `（本机估约 ${Math.round(backlash)} 像素）` : ''}
              和安全余量，目的是让齿轮咬合方向一致。
            </p>
            <div className="row" style={{ maxWidth: 480, margin: '0 auto' }}>
              <button className="ghost" onClick={() => onBack(0)}>
                ← 上一步
              </button>
              <button className="primary big" style={{ flex: 2 }} onClick={() => onAdvance(2)}>
                已停到旗子处 →
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="action" style={{ color: DIR_COLOR[approach] }}>
              第 2 拧：{approach === 'up' ? '从小往大（频率升高）' : '从大往小（频率降低）'}慢慢回拧
            </div>
            <p>
              只朝这一个方向拧，<b>中途绝不能回头</b>。看着照片，让指针从
              {approach === 'up' ? '绿色区间的下边缘' : '绿色区间的上边缘'}进入，
              拧到区间中央的<b className="up-color">红十字</b>附近就停。
            </p>
            <p className="hint">一旦拧过了头，不要倒转修正——回到「先越过」那一步重新来。</p>
            <div className="row" style={{ maxWidth: 480, margin: '0 auto' }}>
              <button className="ghost" onClick={() => onBack(1)}>
                ← 回到越台步
              </button>
              <button className="primary big" style={{ flex: 2 }} onClick={() => onAdvance(3)}>
                指针已到红十字 →
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="action">停住旋钮，不要再碰它，安静听 10 秒</div>
            <ClueBox finding={finding} band={band} />
            {finding.misses > 0 && (
              <div className="warn">
                已重试 {finding.misses} 次仍没听到。可能原因：该台今天未播音、信号弱、或标定有偏差。
                建议核对确认线索，或回标定页检查附近的点。
              </div>
            )}
            <div className="row" style={{ maxWidth: 520, margin: '0 auto' }}>
              <button className="ghost" onClick={() => onMiss(finding.misses + 1)}>
                没听到 / 不是这个台
              </button>
              <button className="primary" onClick={() => onBack(1)}>
                拧过头了，重走一遍
              </button>
              <button className="primary big" style={{ flex: 1.4 }} onClick={onDone}>
                ✓ 听到了，对上了！
              </button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <div className="big-freq" style={{ color: 'var(--green)' }}>✓ 找回成功</div>
            <p>
              {finding.stationCall ? <b>{finding.stationCall}</b> : `${finding.targetFreq} ${band.unit}`}{' '}
              已按 {DIR_LABEL[approach]} 找回。下次找不到时可以直接重开本卡。
            </p>
            <p className="hint">
              如果实际出声位置和红十字有明显偏差，建议回到「标定」页，把这次听到的真实位置补/改成一个点，
              本卡会自动按新标定作废。
            </p>
            <div className="row" style={{ maxWidth: 480, margin: '0 auto' }}>
              <button className="ghost" onClick={printCard} disabled={printing}>
                🖨 打印本卡
              </button>
              <button className="primary" onClick={() => onBack(3)}>
                再听一次
              </button>
            </div>
          </>
        )}
      </div>

      <div className="row no-print" style={{ marginTop: 18, justifyContent: 'center' }}>
        <button className="ghost" onClick={printCard} disabled={printing || step === 4}>
          🖨 打印逐步卡
        </button>
        <button className="danger ghost" onClick={onAbandon}>
          作废 / 删除本卡
        </button>
      </div>

      {/* 打印用静态页（仅打印时可见） */}
      <div className="print-area" style={{ display: 'none' }}>
        {shots.map((src, i) => (
          <div className="print-sheet" key={i}>
            <div className="print-title">
              {radio.name} · {band.name} · 目标 {finding.targetFreq} {band.unit}（{DIR_LABEL[approach]}）
            </div>
            <div className="print-action">
              {i === 0 && `第 1 拧：往${wrongDir === 'down' ? '频率减小' : '频率增大'}方向拧，路过 ${finding.targetFreq} 不要停，拧到橙色小旗（约 ${stageFreq.toFixed(2)} ${band.unit}）。`}
              {i === 1 && `第 2 拧：${approach === 'up' ? '从小往大' : '从大往小'}慢慢回拧，中途不回头，从绿色区边缘进入到红十字。`}
              {i === 2 && '停住旋钮听 10 秒，按确认线索核对。'}
            </div>
            <img src={src} alt={`第 ${i + 1} 步示意图`} />
            <div className="print-clue">
              <b>确认线索：</b>
              {finding.stationCall ? `台呼「${finding.stationCall}」；` : '（未记台呼）'}
              {finding.sound ? `节目声：${finding.sound}` : '（未记节目声线索）'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClueBox({ finding, band }: { finding: Finding; band: BandConfig }) {
  return (
    <div className="clue-box">
      <div className="clue-title">听到下面这些，就找对了</div>
      <div>
        <b>目标：</b>
        {finding.stationCall ? `「${finding.stationCall}」 ` : ''}
        {finding.targetFreq} {band.unit}
      </div>
      {finding.sound && (
        <div style={{ marginTop: 6 }}>
          <b>节目声：</b>
          {finding.sound}
        </div>
      )}
      {!finding.stationCall && !finding.sound && (
        <div className="hint" style={{ marginTop: 6 }}>
          这张卡没记确认线索。下次标定时请顺手记下台呼或节目声，辨听更有把握。
        </div>
      )}
    </div>
  );
}

// 供新建卡时预填参考：找目标附近最近的已知点线索
export function nearestClues(points: CalibPoint[], freq: number): { stationCall?: string; sound?: string } {
  let best: CalibPoint | null = null;
  let bd = Infinity;
  for (const p of points) {
    const d = Math.abs(p.freq - freq);
    if (d < bd && (p.stationCall || p.sound)) {
      bd = d;
      best = p;
    }
  }
  return { stationCall: best?.stationCall, sound: best?.sound };
}
