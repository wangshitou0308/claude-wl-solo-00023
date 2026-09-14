import { useState } from 'react';
import type { BandConfig, Radio } from '../types';
import { putRadio, uid } from '../lib/db';

export default function BandManager({ radio, onClose }: { radio: Radio; onClose: () => void }) {
  const [bands, setBands] = useState<BandConfig[]>(radio.bands);
  const [photo, setPhoto] = useState<Blob | undefined>(radio.photo);
  const [photoType, setPhotoType] = useState(radio.photoType ?? 'image/jpeg');

  async function save() {
    if (!bands.length) {
      alert('至少保留一个波段。');
      return;
    }
    for (const b of bands) {
      if (!(b.hi > b.lo)) {
        alert(`「${b.name}」范围无效：高端必须大于低端。`);
        return;
      }
    }
    await putRadio({ ...radio, bands, photo: photo ?? radio.photo, photoType });
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>波段与照片设置</h2>

        <label>更换刻度盘照片</label>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setPhoto(f);
              setPhotoType(f.type || 'image/jpeg');
            }
          }}
        />
        <p className="warn">
          更换照片后，原有标定点是按旧照片像素记录的，画面若对不齐需要重新标定。
        </p>

        <h3>波段</h3>
        {bands.map((b, i) => (
          <div key={b.id} className="point-row">
            <div className="grow">
              <input value={b.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="波段名称" />
            </div>
            <select
              className="narrow"
              style={{ width: 90 }}
              value={b.unit}
              onChange={(e) => upd(i, { unit: e.target.value as BandConfig['unit'] })}
            >
              <option value="MHz">MHz</option>
              <option value="kHz">kHz</option>
              <option value="m">米(m)</option>
            </select>
            <input className="narrow" style={{ width: 84 }} type="number" value={b.lo}
              onChange={(e) => upd(i, { lo: Number(e.target.value) })} />
            <span>～</span>
            <input className="narrow" style={{ width: 84 }} type="number" value={b.hi}
              onChange={(e) => upd(i, { hi: Number(e.target.value) })} />
            <button className="danger ghost narrow" disabled={bands.length <= 1}
              onClick={() => setBands(bands.filter((x) => x.id !== b.id))}>
              删
            </button>
          </div>
        ))}
        <button className="ghost" onClick={() =>
          setBands([...bands, { id: uid('b_'), name: '新波段', unit: 'MHz', lo: 0, hi: 10 }])}>
          ＋ 添加波段
        </button>

        <div className="row" style={{ marginTop: 18 }}>
          <button className="ghost" onClick={onClose}>取消</button>
          <button className="primary" onClick={save}>保存设置</button>
        </div>
      </div>
    </div>
  );

  function upd(i: number, patch: Partial<BandConfig>) {
    setBands(bands.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }
}
