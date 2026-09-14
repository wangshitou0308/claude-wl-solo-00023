import { useState } from 'react';
import HomePage from './pages/HomePage';
import RadioPage from './pages/RadioPage';

// 轻量页面路由：首页（机器列表）↔ 单台机详情
export default function App() {
  const [radioId, setRadioId] = useState<string | null>(null);

  return (
    <div className="app">
      <header className="app-header">
        <h1>📻 刻度回找</h1>
        <span className="sub">老收音机找台助手：照片标定 · 消除旋钮回程间隙 · 逐卡回拧</span>
        <div className="spacer" />
        {radioId && (
          <button className="back-link no-print" onClick={() => setRadioId(null)}>
            ← 返回机器列表
          </button>
        )}
      </header>

      {radioId ? (
        <RadioPage radioId={radioId} onBack={() => setRadioId(null)} />
      ) : (
        <HomePage onOpen={setRadioId} />
      )}

      <p className="privacy-note">照片与所有记录只保存在本机浏览器（IndexedDB），不上传、不外传。清理浏览器数据会一并删除。</p>
    </div>
  );
}
