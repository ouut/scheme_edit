import React, { useState, useEffect } from 'react';
import { Play, RotateCcw, Sparkles, BookOpen, Layers, Maximize2, Minimize2 } from 'lucide-react';
import { ParinferMode, ServerStatus } from '../types';

interface HeaderProps {
  parinferMode: ParinferMode;
  onParinferModeChange: (mode: ParinferMode) => void;
  serverStatus: ServerStatus;
  onRunEval: () => void;
  onResetCode: () => void;
  onIndent: () => void;
  showHud: boolean;
  onToggleHud: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  parinferMode,
  onParinferModeChange,
  serverStatus,
  onRunEval,
  onResetCode,
  onIndent,
  showHud,
  onToggleHud,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
        if ('keyboard' in navigator && (navigator as any).keyboard?.lock) {
          await (navigator as any).keyboard.lock();
        }
      } catch (err) {
        console.warn('Fullscreen/Keyboard lock:', err);
      }
    } else {
      try {
        await document.exitFullscreen();
        if ('keyboard' in navigator && (navigator as any).keyboard?.unlock) {
          (navigator as any).keyboard.unlock();
        }
      } catch (err) {
        console.warn('Exit fullscreen:', err);
      }
    }
  };
  return (
    <header className="h-12 bg-[#16161e] border-b border-[#24283b] flex items-center justify-between px-4 select-none shrink-0 z-20">
      {/* Left: Brand & File info */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md">
            <span className="font-bold text-white text-base font-mono">λ</span>
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="font-bold text-sm tracking-tight text-neutral-100">
                Scheme Strict Paredit
              </span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 bg-indigo-950/80 text-indigo-300 rounded border border-indigo-700/50">
                Steel Engine
              </span>
            </div>
          </div>
        </div>

        <div className="hidden md:flex items-center text-xs text-neutral-400 pl-3 border-l border-[#2e3146] space-x-2">
          <span className="font-mono text-neutral-300">playground.scm</span>
          <span className="text-[11px] text-neutral-500">• 17 Shortcuts Active</span>
        </div>
      </div>

      {/* Center: Parinfer Mode Switcher & Server Status */}
      <div className="flex items-center space-x-4">
        {/* Parinfer Mode Selector */}
        <div className="flex items-center space-x-2 bg-[#1a1b26] border border-[#2a2e42] rounded-md px-2 py-1 text-xs">
          <div className="flex items-center space-x-1 text-neutral-400">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-medium text-neutral-300">Parinfer:</span>
          </div>
          <select
            value={parinferMode}
            onChange={(e) => onParinferModeChange(e.target.value as ParinferMode)}
            className="bg-transparent text-cyan-300 font-mono text-xs focus:outline-none cursor-pointer pr-1"
          >
            <option value="paren" className="bg-[#1a1b26] text-neutral-200">
              Paren Mode (Default)
            </option>
            <option value="smart" className="bg-[#1a1b26] text-neutral-200">
              Smart Mode
            </option>
            <option value="off" className="bg-[#1a1b26] text-neutral-400">
              Off
            </option>
          </select>
          <div
            className={`w-2 h-2 rounded-full ${
              parinferMode === 'paren'
                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                : parinferMode === 'smart'
                ? 'bg-cyan-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]'
                : 'bg-neutral-600'
            }`}
            title={`Parinfer: ${parinferMode}`}
          />
        </div>

        {/* Server Connection Status Badge */}
        <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-[#1a1b26] border border-[#2a2e42] text-[11px]">
          <span
            className={`w-2 h-2 rounded-full inline-block ${
              serverStatus === 'connected'
                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse'
                : serverStatus === 'ready'
                ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]'
                : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)]'
            }`}
          />
          <span className="font-mono text-neutral-300">
            {serverStatus === 'connected'
              ? 'Rust Server: Connected'
              : serverStatus === 'ready'
              ? 'Rust Server: Standby'
              : 'Rust Server: Offline (/api/eval)'}
          </span>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center space-x-2">
        <button
          onClick={onIndent}
          className="px-2.5 py-1 text-xs rounded bg-[#24283b] hover:bg-[#2f354f] text-neutral-300 hover:text-white flex items-center space-x-1 transition border border-[#3b4261]/50 cursor-pointer"
          title="Auto Indent (Alt+\)"
        >
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span className="hidden lg:inline">Format</span>
        </button>

        <button
          onClick={onResetCode}
          className="px-2.5 py-1 text-xs rounded bg-[#24283b] hover:bg-[#2f354f] text-neutral-300 hover:text-white flex items-center space-x-1 transition border border-[#3b4261]/50 cursor-pointer"
          title="Reset to default Scheme sample code"
        >
          <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden lg:inline">Reset Code</span>
        </button>

        <button
          onClick={onRunEval}
          className="px-3 py-1 text-xs font-semibold rounded bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white flex items-center space-x-1.5 transition shadow-sm cursor-pointer"
          title="Eval selection or current S-expression (Alt+Enter or Ctrl+Enter)"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Eval (Alt/Ctrl+Enter)</span>
        </button>

        {/* Fullscreen & Keyboard Lock Toggle */}
        <button
          onClick={toggleFullscreen}
          className={`p-1.5 rounded transition cursor-pointer border ${
            isFullscreen
              ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
              : 'bg-[#24283b] border-[#3b4261]/50 text-neutral-400 hover:text-white'
          }`}
          title={
            isFullscreen
              ? 'Exit Fullscreen / Release Keyboard Lock'
              : 'Enter Fullscreen & Lock Keyboard (完全释放所有系统按键，防浏览器冲突)'
          }
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>

        <button
          onClick={onToggleHud}
          className={`p-1.5 rounded transition cursor-pointer border ${
            showHud
              ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300 shadow-[0_0_10px_rgba(99,102,241,0.3)]'
              : 'bg-[#24283b] border-[#3b4261]/50 text-neutral-400 hover:text-white'
          }`}
          title="Toggle HUD / CheatSheet"
        >
          <BookOpen className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
