import React, { useState } from 'react';
import { Zap, Clock, Star, Trash2 } from 'lucide-react';
import { SHORTCUTS_LIST } from '../lib/shortcuts';
import { ShortcutId, ActionHistoryEntry } from '../types';

interface HudSidebarProps {
  activeFlashId: ShortcutId | null;
  history: ActionHistoryEntry[];
  onTriggerShortcut: (id: ShortcutId) => void;
  onClearHistory: () => void;
}

export const HudSidebar: React.FC<HudSidebarProps> = ({
  activeFlashId,
  history,
  onTriggerShortcut,
  onClearHistory,
}) => {
  const [tab, setTab] = useState<'shortcuts' | 'log'>('shortcuts');
  const isMac =
    typeof navigator !== 'undefined' &&
    /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent);

  // Group shortcuts by stars (5 down to 1)
  const groupedByStars = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    items: SHORTCUTS_LIST.filter((s) => s.stars === stars),
  }));

  const getStarLabel = (stars: number) => {
    switch (stars) {
      case 5:
        return '最高频核心操作 (45%)';
      case 4:
        return '高频包裹与吞吐 (20% ~ 25%)';
      case 3:
        return '结构调整与定点导航 (10% ~ 15%)';
      case 2:
        return '精准钻入与排版对齐 (5%)';
      case 1:
        return '微调与切分 (2%)';
      default:
        return '';
    }
  };

  const getStarColor = (stars: number) => {
    switch (stars) {
      case 5:
        return 'text-amber-400';
      case 4:
        return 'text-cyan-400';
      case 3:
        return 'text-indigo-400';
      case 2:
        return 'text-purple-400';
      case 1:
        return 'text-slate-400';
      default:
        return 'text-neutral-400';
    }
  };

  return (
    <aside className="w-84 xl:w-96 bg-[#16161e] border-l border-[#24283b] flex flex-col h-full select-none shrink-0 z-10">
      {/* Header & Tabs */}
      <div className="p-3 border-b border-[#24283b] bg-[#1a1b26]/70">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center space-x-2">
            <Zap className="w-4 h-4 text-cyan-400" />
            <h2 className="font-semibold text-xs tracking-wide text-neutral-200 uppercase font-mono">
              Strict Paredit HUD
            </h2>
          </div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/70 text-cyan-400 border border-cyan-800/40">
            {isMac ? '⌥ Option (Mac)' : 'One-Shot 17 Keys'}
          </span>
        </div>

        {/* Tab switch */}
        <div className="flex bg-[#13141c] p-0.5 rounded border border-[#232638] text-xs">
          <button
            onClick={() => setTab('shortcuts')}
            className={`flex-1 py-1 rounded transition text-[11px] font-medium ${
              tab === 'shortcuts'
                ? 'bg-[#24283b] text-neutral-100 shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Shortcuts ({SHORTCUTS_LIST.length})
          </button>
          <button
            onClick={() => setTab('log')}
            className={`flex-1 py-1 rounded transition text-[11px] font-medium flex items-center justify-center space-x-1 ${
              tab === 'log'
                ? 'bg-[#24283b] text-neutral-100 shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <span>Action Log</span>
            {history.length > 0 && (
              <span className="text-[10px] px-1 py-0.2 rounded-full bg-indigo-600 text-white font-mono">
                {history.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {tab === 'shortcuts' ? (
          /* Shortcuts List sorted by frequency 5 stars down to 1 star */
          groupedByStars.map(({ stars, items }) => (
            <div key={stars} className="space-y-1.5">
              {/* Group Header */}
              <div className="flex items-center justify-between text-[11px] px-1 text-neutral-400">
                <div className="flex items-center space-x-1">
                  <div className="flex">
                    {Array.from({ length: stars }).map((_, i) => (
                      <Star
                        key={i}
                        className={`w-3 h-3 fill-current ${getStarColor(stars)}`}
                      />
                    ))}
                  </div>
                  <span className="font-semibold text-neutral-300 ml-1">
                    {getStarLabel(stars)}
                  </span>
                </div>
              </div>

              {/* Items in group */}
              <div className="space-y-1.5">
                {items.map((item) => {
                  const isFlashing = activeFlashId === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => onTriggerShortcut(item.id)}
                      className={`p-2 rounded-lg border transition-all duration-150 cursor-pointer ${
                        isFlashing
                          ? 'hud-flash-active'
                          : 'bg-[#1a1b26] border-[#252839] hover:border-[#384060] hover:bg-[#1e202f]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        {/* Key combination badge */}
                        <kbd className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[#13141f] border border-[#2f354f] text-cyan-300 shadow-inner tracking-tight">
                          {isMac && item.macKeys ? item.macKeys : item.keys}
                        </kbd>

                        {/* Name & Percentage */}
                        <div className="flex items-center space-x-1.5">
                          <span className="text-xs font-medium text-neutral-200">
                            {item.name}
                          </span>
                          <span className="text-[10px] text-neutral-500 font-mono">
                            ({item.enName})
                          </span>
                          <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-[#212437] text-amber-300/80">
                            {item.percentage}
                          </span>
                        </div>
                      </div>

                      {/* Mnemonic and description */}
                      <p className="text-[11px] text-neutral-400 leading-tight">
                        {item.description}
                      </p>
                      <div className="mt-1 text-[10px] font-mono text-indigo-400/90 flex items-center space-x-1">
                        <span className="opacity-70">💡 助记:</span>
                        <span>{item.mnemonic}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        ) : (
          /* Real-time Action History Log */
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-neutral-400 px-1 pb-1 border-b border-[#24283b]">
              <span className="flex items-center space-x-1">
                <Clock className="w-3.5 h-3.5" />
                <span>Recent Triggered Actions</span>
              </span>
              {history.length > 0 && (
                <button
                  onClick={onClearHistory}
                  className="text-neutral-500 hover:text-rose-400 transition flex items-center space-x-1 cursor-pointer text-[11px]"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="py-8 text-center text-neutral-500 text-xs">
                No shortcut actions triggered yet.
                <div className="mt-1 text-[11px] text-neutral-600">
                  Press any of the 17 shortcuts to see real-time updates!
                </div>
              </div>
            ) : (
              history.map((entry) => (
                <div
                  key={entry.id}
                  className="p-2 rounded bg-[#1a1b26] border border-[#24283b] text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-cyan-300 font-semibold text-[11px] px-1.5 py-0.2 rounded bg-[#13141f] border border-[#2a2e42]">
                      {entry.shortcutKeys}
                    </span>
                    <span className="text-[10px] text-neutral-500 font-mono">
                      {entry.timestamp}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-neutral-300 font-medium">
                      {entry.shortcutName}
                    </span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                        entry.success
                          ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/40'
                          : 'bg-rose-950/80 text-rose-400 border border-rose-800/40'
                      }`}
                    >
                      {entry.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Footer Mnemonic Tip */}
      <div className="p-2.5 border-t border-[#24283b] bg-[#13141c] text-[10px] text-neutral-400 font-mono">
        <div className="flex items-center justify-between">
          <span>左手大拇指锚定 Alt 键</span>
          <span className="text-cyan-400">Zero Vim Modes</span>
        </div>
      </div>
    </aside>
  );
};
