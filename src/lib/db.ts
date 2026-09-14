import type { CalibPoint, Finding, Radio, UndoEntry } from '../types';

// 极简 IndexedDB 封装：照片以 Blob 保存，数据不出本机
const DB_NAME = 'kedu-huizhao';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;
const listeners = new Set<() => void>();

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('radios')) {
        db.createObjectStore('radios', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('points')) {
        const s = db.createObjectStore('points', { keyPath: 'id' });
        s.createIndex('radioId', 'radioId', { unique: false });
        s.createIndex('radioBand', ['radioId', 'bandId'], { unique: false });
      }
      if (!db.objectStoreNames.contains('findings')) {
        const s = db.createObjectStore('findings', { keyPath: 'id' });
        s.createIndex('radioId', 'radioId', { unique: false });
      }
      if (!db.objectStoreNames.contains('undo')) {
        db.createObjectStore('undo', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

function emit() {
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function uid(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---- radios ----
export async function putRadio(r: Radio): Promise<void> {
  await tx('radios', 'readwrite', (s) => s.put(r));
  emit();
}
export async function deleteRadio(id: string): Promise<void> {
  await tx('radios', 'readwrite', (s) => s.delete(id));
  const pts = await tx('points', 'readonly', (s) =>
    s.index('radioId').getAllKeys(id),
  ) as unknown as IDBValidKey[];
  const t = (await openDb()).transaction(['points', 'findings'], 'readwrite');
  for (const k of pts) t.objectStore('points').delete(k);
  const fkeys = (await new Promise<IDBValidKey[]>((res, rej) => {
    const rq = t.objectStore('findings').index('radioId').getAllKeys(id);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }));
  for (const k of fkeys) t.objectStore('findings').delete(k);
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
  emit();
}
export function getAllRadios(): Promise<Radio[]> {
  return tx('radios', 'readonly', (s) => s.getAll() as IDBRequest<Radio[]>);
}

// ---- points ----
export async function putPoint(p: CalibPoint, undo?: Omit<UndoEntry, 'id' | 'at'>): Promise<void> {
  const db = await openDb();
  const stores = undo ? ['points', 'undo'] : ['points'];
  const t = db.transaction(stores, 'readwrite');
  t.objectStore('points').put(p);
  if (undo) {
    const entry: UndoEntry = { id: uid('u_'), at: Date.now(), ...undo };
    t.objectStore('undo').put(entry);
  }
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
  emit();
}
export async function deletePoint(p: CalibPoint): Promise<void> {
  const db = await openDb();
  const t = db.transaction(['points', 'undo'], 'readwrite');
  t.objectStore('points').delete(p.id);
  const entry: UndoEntry = { id: uid('u_'), kind: 'delete', point: p, at: Date.now() };
  t.objectStore('undo').put(entry);
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
  emit();
}
export async function getPoints(radioId: string): Promise<CalibPoint[]> {
  return tx('points', 'readonly', (s) =>
    s.index('radioId').getAll(radioId) as IDBRequest<CalibPoint[]>,
  );
}

// ---- undo ----只保留最近一条误标可撤销
export async function latestUndo(): Promise<UndoEntry | undefined> {
  const all = await tx('undo', 'readonly', (s) => s.getAll() as IDBRequest<UndoEntry[]>);
  return all.sort((a, b) => b.at - a.at)[0];
}
export async function popUndo(entry: UndoEntry): Promise<void> {
  const db = await openDb();
  const t = db.transaction(['points', 'undo'], 'readwrite');
  if (entry.kind === 'add') t.objectStore('points').delete(entry.point.id);
  else t.objectStore('points').put(entry.oldPoint ?? entry.point);
  t.objectStore('undo').delete(entry.id);
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
  emit();
}
export async function clearUndo(id: string): Promise<void> {
  await tx('undo', 'readwrite', (s) => s.delete(id));
  emit();
}

// ---- findings ----
export async function putFinding(f: Finding): Promise<void> {
  await tx('findings', 'readwrite', (s) => s.put(f));
  emit();
}
export async function deleteFinding(id: string): Promise<void> {
  await tx('findings', 'readwrite', (s) => s.delete(id));
  emit();
}
export function getAllFindings(): Promise<Finding[]> {
  return tx('findings', 'readonly', (s) => s.getAll() as IDBRequest<Finding[]>);
}
