import React, { useState, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { TerminalTab, TerminalTabHandle } from './TerminalTab';
import { TerminalTabItem, GuiActionPayload } from '../types';
import { Plus, X, Terminal as TerminalIcon } from 'lucide-react';

export interface TerminalPanelProps {
  onGuiAction: (payload: GuiActionPayload) => void;
}

export interface TerminalPanelHandle {
  sendToRepl: (code: string) => void;
  fitActiveTerminal: () => void;
  focusActiveTerminal: () => void;
  openBashTab: () => void;
  setActiveTab: (tabId: string) => void;
}

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(
  ({ onGuiAction }, ref) => {
    const [tabs, setTabs] = useState<TerminalTabItem[]>([
      { id: 'repl', title: 'λ REPL', cmd: 'steel', closable: false },
    ]);
    const [activeTabId, setActiveTabId] = useState<string>('repl');
    const [bashCounter, setBashCounter] = useState<number>(1);

    const tabRefs = useRef<Map<string, TerminalTabHandle>>(new Map());

    // Create new bash tab
    const handleNewBashTab = useCallback(() => {
      const newId = `bash-${bashCounter}`;
      const newTitle = `bash ${bashCounter}`;
      setBashCounter((c) => c + 1);

      const newTab: TerminalTabItem = {
        id: newId,
        title: newTitle,
        cmd: 'bash',
        closable: true,
      };

      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newId);
    }, [bashCounter]);

    // Close a bash tab (Tab 1 cannot be closed)
    const handleCloseTab = useCallback(
      (idToClose: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setTabs((prev) => {
          const tabIndex = prev.findIndex((t) => t.id === idToClose);
          const nextTabs = prev.filter((t) => t.id !== idToClose);

          if (activeTabId === idToClose) {
            const nextActiveIndex = Math.max(0, tabIndex - 1);
            setActiveTabId(nextTabs[nextActiveIndex]?.id || 'repl');
          }

          return nextTabs;
        });

        tabRefs.current.delete(idToClose);
      },
      [activeTabId]
    );

    // Send code to Tab 1 ("λ REPL")
    const handleSendToRepl = useCallback((code: string) => {
      // 1. Switch active tab to Tab 1
      setActiveTabId('repl');

      // 2. Send code + '\n', scroll to bottom (do not steal focus from code editor)
      const replTab = tabRefs.current.get('repl');
      if (replTab) {
        replTab.sendInput(code + '\n');
        replTab.scrollToBottom();
      }
    }, []);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      sendToRepl: (code: string) => {
        handleSendToRepl(code);
      },
      fitActiveTerminal: () => {
        const activeTab = tabRefs.current.get(activeTabId);
        activeTab?.fit();
      },
      focusActiveTerminal: () => {
        const activeTab = tabRefs.current.get(activeTabId);
        activeTab?.focus();
      },
      openBashTab: () => {
        handleNewBashTab();
      },
      setActiveTab: (tabId: string) => {
        setActiveTabId(tabId);
      },
    }));

    return (
      <div className="flex flex-col h-full w-full bg-[#1a1b26] overflow-hidden">
        {/* Terminal Tab Bar */}
        <div className="flex items-center justify-between bg-[#16161e] border-b border-[#24283b] h-9 px-2 select-none shrink-0">
          {/* Tabs row */}
          <div className="flex items-center space-x-1 overflow-x-auto scrollbar-none">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const isRepl = tab.id === 'repl';

              return (
                <div
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`group flex items-center space-x-1.5 px-3 py-1.5 text-xs font-mono font-medium rounded-t cursor-pointer transition-colors border-b-2 ${
                    isActive
                      ? 'bg-[#1a1b26] text-[#c0caf5] border-[#7aa2f7]'
                      : 'text-[#565f89] hover:text-[#c0caf5] hover:bg-[#1f2335]/50 border-transparent'
                  }`}
                >
                  {isRepl ? (
                    <span className="text-[#7dcfff] font-bold text-sm leading-none">λ</span>
                  ) : (
                    <TerminalIcon className="w-3.5 h-3.5 text-[#9ece6a]" />
                  )}
                  <span>{tab.title}</span>

                  {tab.closable && (
                    <button
                      onClick={(e) => handleCloseTab(tab.id, e)}
                      className="ml-1 text-[#565f89] hover:text-[#f7768e] hover:bg-[#f7768e]/15 rounded p-0.5 transition-colors"
                      title="Close terminal tab"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* New Tab Button */}
          <div className="flex items-center ml-2">
            <button
              onClick={handleNewBashTab}
              className="flex items-center justify-center w-6 h-6 rounded text-[#565f89] hover:text-[#7aa2f7] hover:bg-[#24283b] transition-colors"
              title="New bash terminal"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Terminals Container */}
        <div className="flex-1 relative overflow-hidden bg-[#1a1b26]">
          {tabs.map((tab) => {
            const isTabActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className="absolute inset-0 flex flex-col"
                style={{
                  display: isTabActive ? 'flex' : 'none',
                }}
              >
                <TerminalTab
                  ref={(el) => {
                    if (el) {
                      tabRefs.current.set(tab.id, el);
                    } else {
                      tabRefs.current.delete(tab.id);
                    }
                  }}
                  id={tab.id}
                  cmd={tab.cmd}
                  isActive={isTabActive}
                  onGuiAction={onGuiAction}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);

TerminalPanel.displayName = 'TerminalPanel';
