import { useEffect, useRef } from 'react';
import { drawScene, loadPhoto, type Overlay, type Pt, toImageCoords } from '../lib/draw';

// 刻度盘画布：显示照片与叠加层；可点击取点、拖动已选点
export default function DialCanvas({
  photo,
  imgW,
  imgH,
  overlays,
  onPick,
  onDrag,
  tall,
}: {
  photo?: Blob;
  imgW: number;
  imgH: number;
  overlays: Overlay[];
  onPick?: (p: Pt) => void;
  onDrag?: (p: Pt) => void;
  tall?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const layoutRef = useRef<ReturnType<typeof drawScene> | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    let raf = 0;
    async function render() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (photo) {
        const img = await loadPhoto(photo);
        if (!alive) return;
        imgRef.current = img;
      } else {
        imgRef.current = null;
      }
      const draw = () => {
        if (!canvasRef.current) return;
        layoutRef.current = drawScene(canvasRef.current, imgRef.current, imgW, imgH, overlaysRef.current);
      };
      draw();
      const ro = new ResizeObserver(() => draw());
      ro.observe(canvas);
      return () => ro.disconnect();
    }
    const cleanup = render();
    const onResize = () => schedule();
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => cleanup.then((d) => d?.()));
    };
    window.addEventListener('resize', onResize);
    return () => {
      alive = false;
      window.removeEventListener('resize', onResize);
      cleanup.then((d) => d?.());
      cancelAnimationFrame(raf);
    };
  }, [photo, imgW, imgH]);

  // overlays 频繁变化时重绘
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layoutRef.current) return;
    layoutRef.current = drawScene(canvas, imgRef.current, imgW, imgH, overlays);
  }, [overlays, imgW, imgH]);

  function eventPoint(e: React.PointerEvent): Pt {
    const rect = canvasRef.current!.getBoundingClientRect();
    const css = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    return toImageCoords(layoutRef.current!, css.x, css.y);
  }

  return (
    <div className={`canvas-wrap${tall ? ' tall' : ''}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          if (!onPick && !onDrag) return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          draggingRef.current = true;
          onPick?.(eventPoint(e));
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current || !onDrag) return;
          onDrag(eventPoint(e));
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
      />
    </div>
  );
}
