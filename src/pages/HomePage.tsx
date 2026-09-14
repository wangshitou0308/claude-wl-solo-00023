import { useRef, useState } from 'react';
import type { BandConfig, Radio } from '../types';
import { deleteRadio, getAllRadios, putRadio, uid } from '../lib/db';
import { useAsync } from '../hooks/useDb';
import { useObjectUrl } from '../hooks/useObjectUrl';

const PRESET_BANDS: { name: string; unit: BandConfig['unit']; lo: number; hi: number }[] = [
  { name: '调频 FM', unit: 'MHz', lo: 87, hi: 108 },
  { name: '中波 MW', unit: 'kHz', lo: 530, hi: 1600 },
  { name: '短波 SW1', unit: 'MHz', lo: 5.9, hi: 9.8 },
  { name: '短波 SW2', unit: 'MHz', lo: 11.6, hi: 18.0 },
];

export default function HomePage({ onOpen }: { onOpen: (id: string) => void }) {
  const radios = useAsync(() => getAllRadios(), []);
  const [editing, setEditing] = useState<Radio | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="card no-print">
        <div className="row" style={{ alignItems: 'center' }}>
          <div className="grow" style={{ flex: 1 }}>
            <h2 style={{ margin: 0 }}>我的收音机</h2>
            <p className="hint" style={{ margin: '4px 0 0' }}>
              每台机器分别导入刻度盘照片、标定频率位置。换机不混数据。
            </p>
          </div>
          <button className="primary narrow" onClick={() => setCreating(true)}>
            ＋ 添加收音机
          </button>
        </div>
      </div>

      {radios && radios.length === 0 && (
        <div className="card">
          <p>还没有收音机。点右上角「添加收音机」，先给机器起个名字，并拍一张刻度盘的清晰照片。</p>
          <details className="help">
            <summary>拍照小建议（点开看）</summary>
            <ul>
              <li>正对刻度盘拍摄，避免反光、歪斜；指针和数字尽量清楚。</li>
              <li>每次标定最好在同一角度、同一焦距，照片只需拍一次。</li>
              <li>找不到台时就在收音机旁对照本网页操作，手机、平板、电脑均可。</li>
            </ul>
          </details>
        </div>
      )}

      <div className="radio-grid">
        {radios?.map((r) => (
          <RadioCard key={r.id} radio={r} onOpen={() => onOpen(r.id)} onEdit={() => setEditing(r)} onDelete={async () => {
            if (confirm(`确定删除「${r.name}」及其全部标定和找台记录？此操作不可恢复。`)) {
              await deleteRadio(r.id);
            }
          }} />
        ))}
      </div>

      {(creating || editing) && (
        <RadioEditor
          radio={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function RadioCard({
  radio,
  onOpen,
  onEdit,
  onDelete,
}: {
  radio: Radio;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const url = useObjectUrl(radio.photo);
  return (
    <div className="radio-item" onClick={onOpen} role="button">
      <div className="thumb">
        {url ? <img src={url} alt={radio.name} /> : <span className="hint">（暂无刻度盘照片）</span>}
      </div>
      <div className="meta">
        <div className="name">{radio.name}</div>
        <div className="hint">{radio.bands.map((b) => b.name).join(' · ') || '未设波段'}</div>
        <div className="row" style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
          <button className="ghost narrow" onClick={onEdit}>
            编辑
          </button>
          <button className="danger ghost narrow" onClick={onDelete}>
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

function RadioEditor({ radio, onClose }: { radio: Radio | null; onClose: () => void }) {
  const [name, setName] = useState(radio?.name ?? '');
  const [note, setNote] = useState(radio?.note ?? '');
  const [photo, setPhoto] = useState<Blob | undefined>(radio?.photo);
  const [photoType, setPhotoType] = useState(radio?.photoType ?? 'image/jpeg');
  const [bands, setBands] = useState<BandConfig[]>(
    radio?.bands ?? [{ id: uid('b_'), ...PRESET_BANDS[0] }],
  );
  const fileRef = useRef<HTMLInputElement>(null);

  async function save() {
    if (!name.trim()) {
      alert('请先填写机器称呼，例如「红灯 753」。');
      return;
    }
    const r: Radio = {
      id: radio?.id ?? uid('r_'),
      name: name.trim(),
      note: note.trim() || undefined,
      photo: photo ?? radio?.photo,
      photoType,
      bands: bands.length ? bands : [{ id: uid('b_'), ...PRESET_BANDS[0] }],
      createdAt: radio?.createdAt ?? Date.now(),
    };
    await putRadio(r);
    onClose();
  }

  function onFile(f: File | null) {
    if (!f) return;
    setPhoto(f);
    setPhotoType(f.type || 'image/jpeg');
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{radio ? '编辑收音机' : '添加收音机'}</h2>
        <label>机器称呼 *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：红灯 753、德生 PL-380" />

        <label>刻度盘照片 {radio ? '' : '（建议现在就拍/选）'}</label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        {photo && <PhotoPreview blob={photo} />}

        <h3>波段</h3>
        <p className="hint">按机器上的波段开关分别建立；短波机可按米波段添加。</p>
        {bands.map((b, i) => (
          <div key={b.id} className="point-row">
            <div className="grow">
              <input
                value={b.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="波段名称"
              />
            </div>
            <select
              className="narrow"
              style={{ width: 90 }}
              value={b.unit}
              onChange={(e) => update(i, { unit: e.target.value as BandConfig['unit'] })}
            >
              <option value="MHz">MHz</option>
              <option value="kHz">kHz</option>
              <option value="m">米(m)</option>
            </select>
            <input
              className="narrow"
              style={{ width: 86 }}
              type="number"
              value={b.lo}
              onChange={(e) => update(i, { lo: Number(e.target.value) })}
              title="低端"
            />
            <span>～</span>
            <input
              className="narrow"
              style={{ width: 86 }}
              type="number"
              value={b.hi}
              onChange={(e) => update(i, { hi: Number(e.target.value) })}
              title="高端"
            />
            <button
              className="danger ghost narrow"
              disabled={bands.length <= 1}
              onClick={() => setBands(bands.filter((x) => x.id !== b.id))}
            >
              删
            </button>
          </div>
        ))}
        <div className="row">
          {PRESET_BANDS.map((p) => (
            <button
              key={p.name}
              type="button"
              className="ghost narrow"
              onClick={() => setBands([...bands, { id: uid('b_'), ...p }])}
            >
              ＋ {p.name}
            </button>
          ))}
        </div>

        <label>备注（可选）</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：调谐旋钮偏紧、指针左端起点…" />

        <div className="row" style={{ marginTop: 18 }}>
          <button className="ghost" onClick={onClose}>
            取消
          </button>
          <button className="primary" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  );

  function update(i: number, patch: Partial<BandConfig>) {
    setBands(bands.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }
}

function PhotoPreview({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob);
  if (!url) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <img src={url} alt="刻度盘预览" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8 }} />
    </div>
  );
}
