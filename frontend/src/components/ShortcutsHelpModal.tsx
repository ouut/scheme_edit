import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Search,
  Keyboard,
  Navigation,
  Terminal,
  Code,
  Star,
} from 'lucide-react';
import { SHORTCUTS_LIST } from '../lib/shortcuts';
import { ShortcutItem } from '../types';

export interface GlobalNavigationShortcut {
  id: string;
  keys: string;
  macKeys: string;
  name: string;
  enName: string;
  description: string;
  mnemonic: string;
}

export const GLOBAL_NAVIGATION_SHORTCUTS: GlobalNavigationShortcut[] = [
  {
    id: 'focus-editor',
    keys: 'Alt + Shift + Up',
    macKeys: '⌥ + ⇧ + ↑',
    name: '输入焦点跳转到代码编辑器',
    enName: 'Focus Editor',
    description: '快速将键盘输入焦点切换到左侧 Monaco 代码编辑器。若当前没有打开任何文件，自动新建并聚焦 scratch 临时代码缓冲区。',
    mnemonic: '向上直达左侧编辑区',
  },
  {
    id: 'focus-terminal',
    keys: 'Alt + Shift + Down',
    macKeys: '⌥ + ⇧ + ↓',
    name: '输入焦点跳转到 Shell 终端',
    enName: 'Focus Terminal',
    description: '快速将键盘输入焦点切换到右侧活动终端（Steel Scheme REPL 或 Bash 命令行），可立即键盘输入命令。',
    mnemonic: '向下直达右侧终端区',
  },
  {
    id: 'prev-tab',
    keys: 'Alt + Shift + Left',
    macKeys: '⌥ + ⇧ + ←',
    name: '循环切换上一个 Tab',
    enName: 'Prev Tab (wrap-around)',
    description: '在当前活动窗格（编辑器文件或终端）中循环向前切换标签页。到达首个 Tab 时自动无缝回绕至末尾 Tab。',
    mnemonic: '向左循环回切标签',
  },
  {
    id: 'next-tab',
    keys: 'Alt + Shift + Right',
    macKeys: '⌥ + ⇧ + →',
    name: '循环切换下一个 Tab',
    enName: 'Next Tab (wrap-around)',
    description: '在当前活动窗格（编辑器文件或终端）中循环向后切换标签页。到达末尾 Tab 时自动无缝回绕至首个 Tab。',
    mnemonic: '向右循环切进标签',
  },
];

export interface GuiCliCommand {
  cmd: string;
  syntax: string;
  name: string;
  enName: string;
  description: string;
  example: string;
}

export const GUI_CLI_COMMANDS: GuiCliCommand[] = [
  {
    cmd: 'gui open',
    syntax: 'gui open [file]',
    name: '打开文件至编辑器',
    enName: 'Open File',
    description: '在左侧代码编辑器中打开指定文件。若省略 [file] 参数，则默认新建或激活 scratch-*.scm 临时缓冲区。',
    example: 'gui open fib.scm',
  },
  {
    cmd: 'gui edit',
    syntax: 'gui edit [file]',
    name: '在编辑器中打开或新建文件',
    enName: 'Edit File',
    description: 'gui open 的同义别名，便于保持常见 Unix/终端编辑习惯。',
    example: 'gui edit sample.scm',
  },
  {
    cmd: 'gui close',
    syntax: 'gui close [file]',
    name: '关闭文件标签页',
    enName: 'Close Tab',
    description: '关闭左侧编辑器中指定的文件标签页；未传文件名则关闭当前活动的文件。所有文件关闭后左侧编辑器自动平滑折叠为 0% 宽度。',
    example: 'gui close 或 gui close scratch-1.scm',
  },
  {
    cmd: 'gui cd',
    syntax: 'gui cd [dir]',
    name: '切换当前工作目录',
    enName: 'Change Directory',
    description: '切换服务后台与终端的工作目录至指定文件夹。',
    example: 'gui cd ..',
  },
  {
    cmd: 'gui ratio',
    syntax: 'gui ratio <L:R>',
    name: '动态调整分栏比例',
    enName: 'Adjust Split Ratio',
    description: '动态调整左侧代码编辑器与右侧终端的分栏比例（如 60:40、70:30 或 0:100 全屏终端折叠左侧）。',
    example: 'gui ratio 60:40 或 gui ratio 0:100',
  },
  {
    cmd: 'gui help',
    syntax: 'gui help',
    name: '显示 GUI 命令帮助',
    enName: 'Show CLI Help',
    description: '在终端标准输出中打印彩色的 GUI 命令行子命令使用指南与说明。',
    example: 'gui help',
  },
];

const STAR_GROUPS = [5, 4, 3, 2, 1] as const;

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

export const KeyBadge: React.FC<{ keys: string }> = ({ keys }) => {
  const parts = keys.split(' / ');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {parts.map((part, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && <span className="text-[11px] text-[#565f89] font-mono">/</span>}
          <kbd className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[#13141f] border border-[#2f354f] text-[#7dcfff] shadow-inner tracking-tight">
            {part}
          </kbd>
        </React.Fragment>
      ))}
    </div>
  );
};

export interface ShortcutsHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsHelpModal: React.FC<ShortcutsHelpModalProps> = ({ isOpen, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'paredit' | 'navigation' | 'gui'>('all');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const isMac =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent);

  // Keyboard shortcut listener (Esc to close)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isOpen, onClose]);

  // Focus search input on open & clear state on close
  useEffect(() => {
    if (isOpen) {
      const timer = window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => window.clearTimeout(timer);
    } else {
      setSearchQuery('');
      setSelectedCategory('all');
    }
  }, [isOpen]);

  // Filter calculations
  const query = searchQuery.trim().toLowerCase();

  const filteredParedit = useMemo(() => {
    if (!query) return SHORTCUTS_LIST;
    return SHORTCUTS_LIST.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.enName.toLowerCase().includes(query) ||
        item.keys.toLowerCase().includes(query) ||
        (item.macKeys && item.macKeys.toLowerCase().includes(query)) ||
        item.description.toLowerCase().includes(query) ||
        item.mnemonic.toLowerCase().includes(query) ||
        item.percentage.toLowerCase().includes(query)
    );
  }, [query]);

  const filteredNav = useMemo(() => {
    if (!query) return GLOBAL_NAVIGATION_SHORTCUTS;
    return GLOBAL_NAVIGATION_SHORTCUTS.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.enName.toLowerCase().includes(query) ||
        item.keys.toLowerCase().includes(query) ||
        item.macKeys.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.mnemonic.toLowerCase().includes(query)
    );
  }, [query]);

  const filteredGui = useMemo(() => {
    if (!query) return GUI_CLI_COMMANDS;
    return GUI_CLI_COMMANDS.filter(
      (item) =>
        item.cmd.toLowerCase().includes(query) ||
        item.syntax.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        item.enName.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.example.toLowerCase().includes(query)
    );
  }, [query]);

  const totalCount = useMemo(() => {
    let count = 0;
    if (selectedCategory === 'all' || selectedCategory === 'paredit') {
      count += filteredParedit.length;
    }
    if (selectedCategory === 'all' || selectedCategory === 'navigation') {
      count += filteredNav.length;
    }
    if (selectedCategory === 'all' || selectedCategory === 'gui') {
      count += filteredGui.length;
    }
    return count;
  }, [selectedCategory, filteredParedit.length, filteredNav.length, filteredGui.length]);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === backdropRef.current) {
      onClose();
    }
  };

  return createPortal(
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 sm:p-6 overflow-hidden select-none"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl bg-[#1a1b26] border border-[#24283b] shadow-2xl text-[#c0caf5] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#16161e] border-b border-[#24283b] shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#24283b]/60 border border-[#2f354f] text-[#7aa2f7]">
              <Keyboard className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="shortcuts-modal-title"
                className="text-sm font-semibold text-[#c0caf5] flex items-center space-x-2"
              >
                <span>快捷键指南 (Shortcuts Manual)</span>
                <span className="text-[11px] font-mono font-normal px-2 py-0.5 rounded-full bg-[#24283b] text-[#7aa2f7] border border-[#2f354f]">
                  {isMac ? '⌥ Option (macOS)' : 'Alt (Win / Linux)'}
                </span>
              </h2>
              <p className="text-[11px] text-[#565f89] mt-0.5">
                Strict Paredit 结构化编辑 · 全局焦点导航 · 终端 GUI 交互命令
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-[#565f89] hover:text-[#f7768e] hover:bg-[#24283b] transition-colors cursor-pointer"
            title="关闭 (Esc)"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Category Filter Bar */}
        <div className="px-5 py-3 bg-[#181924] border-b border-[#24283b] shrink-0 space-y-2.5">
          {/* Search Input */}
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-[#565f89] absolute left-3 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索快捷键、按键、助记词或功能描述 (如 Alt+K、扩选、ratio、Tab)..."
              className="w-full bg-[#13141f] border border-[#24283b] focus:border-[#7aa2f7] focus:ring-1 focus:ring-[#7aa2f7] rounded-lg pl-9 pr-8 py-1.5 text-xs text-[#c0caf5] placeholder-[#565f89] outline-none font-sans transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 text-[#565f89] hover:text-[#c0caf5] transition-colors p-0.5"
                title="清空搜索"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none py-0.5">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  selectedCategory === 'all'
                    ? 'bg-[#7aa2f7]/20 text-[#7aa2f7] border border-[#7aa2f7]/40'
                    : 'text-[#565f89] hover:text-[#c0caf5] hover:bg-[#24283b]/60 border border-transparent'
                }`}
              >
                全部 (All)
              </button>
              <button
                onClick={() => setSelectedCategory('paredit')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  selectedCategory === 'paredit'
                    ? 'bg-[#7aa2f7]/20 text-[#7aa2f7] border border-[#7aa2f7]/40'
                    : 'text-[#565f89] hover:text-[#c0caf5] hover:bg-[#24283b]/60 border border-transparent'
                }`}
              >
                Strict Paredit (17)
              </button>
              <button
                onClick={() => setSelectedCategory('navigation')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  selectedCategory === 'navigation'
                    ? 'bg-[#7aa2f7]/20 text-[#7aa2f7] border border-[#7aa2f7]/40'
                    : 'text-[#565f89] hover:text-[#c0caf5] hover:bg-[#24283b]/60 border border-transparent'
                }`}
              >
                全局导航 (4)
              </button>
              <button
                onClick={() => setSelectedCategory('gui')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  selectedCategory === 'gui'
                    ? 'bg-[#7aa2f7]/20 text-[#7aa2f7] border border-[#7aa2f7]/40'
                    : 'text-[#565f89] hover:text-[#c0caf5] hover:bg-[#24283b]/60 border border-transparent'
                }`}
              >
                终端 CLI (6)
              </button>
            </div>

            <span className="text-[11px] font-mono text-[#565f89] shrink-0 ml-2">
              {totalCount} 个快捷项
            </span>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6 text-xs">
          {/* Empty search state */}
          {totalCount === 0 && (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <Search className="w-8 h-8 text-[#565f89] mb-2 stroke-[1.5]" />
              <p className="text-sm text-[#7aa2f7] font-medium">未找到匹配项</p>
              <p className="text-xs text-[#565f89] mt-1 max-w-sm">
                没有找到与 &ldquo;{searchQuery}&rdquo; 匹配的快捷键或命令。请尝试更换搜索词或重置筛选类别。
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('all');
                }}
                className="mt-3 px-3 py-1 rounded-md bg-[#24283b] text-[#7aa2f7] hover:bg-[#2f354f] transition-colors font-medium cursor-pointer"
              >
                清空搜索条件
              </button>
            </div>
          )}

          {/* 1. Strict Paredit Section */}
          {(selectedCategory === 'all' || selectedCategory === 'paredit') && filteredParedit.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#24283b] pb-2">
                <div className="flex items-center space-x-2">
                  <Code className="w-4 h-4 text-[#7aa2f7]" />
                  <h3 className="text-xs font-semibold text-[#c0caf5] uppercase tracking-wider font-mono">
                    Strict Paredit 结构化编辑 (17 个快捷键)
                  </h3>
                </div>
                <span className="text-[11px] text-[#565f89]">单键直达 · 零死键干扰</span>
              </div>

              {/* Grouped by stars 5 down to 1 */}
              {STAR_GROUPS.map((stars) => {
                const items = filteredParedit.filter((s) => s.stars === stars);
                if (items.length === 0) return null;

                return (
                  <div key={stars} className="space-y-2">
                    <div className="flex items-center space-x-1.5 text-[11px] text-[#565f89] px-1">
                      <div className="flex">
                        {Array.from({ length: stars }).map((_, i) => (
                          <Star key={i} className={`w-3 h-3 fill-current ${getStarColor(stars)}`} />
                        ))}
                      </div>
                      <span className="font-semibold text-[#a9b1d6]">{getStarLabel(stars)}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className="p-3 rounded-lg bg-[#16161e]/70 border border-[#24283b] hover:border-[#384060] hover:bg-[#1f2335]/50 transition-all flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <KeyBadge keys={isMac && item.macKeys ? item.macKeys : item.keys} />
                              <div className="flex items-center space-x-1.5">
                                <span className="text-xs font-medium text-[#c0caf5]">{item.name}</span>
                                <span className="text-[10px] text-[#565f89] font-mono">({item.enName})</span>
                                <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-[#24283b] text-amber-300/90">
                                  {item.percentage}
                                </span>
                              </div>
                            </div>
                            <p className="text-[11px] text-[#9aa5ce] leading-relaxed mb-2">
                              {item.description}
                            </p>
                          </div>

                          <div className="text-[10px] font-mono text-[#7aa2f7]/80 flex items-center space-x-1 pt-1.5 border-t border-[#24283b]/60">
                            <span className="opacity-70">💡 助记:</span>
                            <span>{item.mnemonic}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 2. Global Navigation Section */}
          {(selectedCategory === 'all' || selectedCategory === 'navigation') && filteredNav.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-[#24283b] pb-2">
                <div className="flex items-center space-x-2">
                  <Navigation className="w-4 h-4 text-[#7dcfff]" />
                  <h3 className="text-xs font-semibold text-[#c0caf5] uppercase tracking-wider font-mono">
                    全局焦点与 Tab 导航
                  </h3>
                </div>
                <span className="text-[11px] text-[#565f89]">编辑器/终端跨区无死角调度</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {filteredNav.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-lg bg-[#16161e]/70 border border-[#24283b] hover:border-[#384060] hover:bg-[#1f2335]/50 transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <KeyBadge keys={isMac && item.macKeys ? item.macKeys : item.keys} />
                        <div className="flex items-center space-x-1.5">
                          <span className="text-xs font-medium text-[#c0caf5]">{item.name}</span>
                          <span className="text-[10px] text-[#565f89] font-mono">({item.enName})</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-[#9aa5ce] leading-relaxed mb-2">
                        {item.description}
                      </p>
                    </div>

                    <div className="text-[10px] font-mono text-[#7dcfff]/80 flex items-center space-x-1 pt-1.5 border-t border-[#24283b]/60">
                      <span className="opacity-70">💡 助记:</span>
                      <span>{item.mnemonic}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. Terminal GUI CLI Commands Section */}
          {(selectedCategory === 'all' || selectedCategory === 'gui') && filteredGui.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-[#24283b] pb-2">
                <div className="flex items-center space-x-2">
                  <Terminal className="w-4 h-4 text-[#9ece6a]" />
                  <h3 className="text-xs font-semibold text-[#c0caf5] uppercase tracking-wider font-mono">
                    终端 GUI CLI 控制命令
                  </h3>
                </div>
                <span className="text-[11px] text-[#565f89]">Shell 终端反向控制 IDE 界面</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {filteredGui.map((item) => (
                  <div
                    key={item.cmd}
                    className="p-3 rounded-lg bg-[#16161e]/70 border border-[#24283b] hover:border-[#384060] hover:bg-[#1f2335]/50 transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <kbd className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[#13141f] border border-[#2f354f] text-[#9ece6a] shadow-inner tracking-tight">
                          {item.syntax}
                        </kbd>
                        <div className="flex items-center space-x-1.5">
                          <span className="text-xs font-medium text-[#c0caf5]">{item.name}</span>
                          <span className="text-[10px] text-[#565f89] font-mono">({item.enName})</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-[#9aa5ce] leading-relaxed mb-2">
                        {item.description}
                      </p>
                    </div>

                    <div className="text-[10px] font-mono text-[#9ece6a]/90 flex items-center space-x-1 pt-1.5 border-t border-[#24283b]/60">
                      <span className="opacity-70">💡 示例:</span>
                      <span>{item.example}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#16161e] border-t border-[#24283b] flex items-center justify-between text-[11px] text-[#565f89] shrink-0">
          <div className="flex items-center space-x-2">
            <span>
              按 <kbd className="px-1.5 py-0.5 rounded bg-[#13141f] border border-[#24283b] text-[#c0caf5] font-mono text-[10px]">Esc</kbd> 或点击弹窗外部退出
            </span>
            <span>•</span>
            <span>全部 Strict Paredit 快捷键均具备原子撤销保护</span>
          </div>
          <div className="text-[#7aa2f7]/80 font-mono text-[10px]">
            Scheme Strict Paredit IDE
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};