import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Header } from './components/Header';
import { MonacoEditor, MonacoEditorHandle } from './components/MonacoEditor';
import { HudSidebar } from './components/HudSidebar';
import { ReplPanel } from './components/ReplPanel';
import { DEFAULT_SCHEME_CODE } from './lib/sampleCode';
import { SHORTCUTS_LIST } from './lib/shortcuts';
import {
  ShortcutId,
  ParinferMode,
  ActionHistoryEntry,
  EvalResultEntry,
  ServerStatus,
} from './types';

export const App: React.FC = () => {
  const editorRef = useRef<MonacoEditorHandle>(null);

  const [parinferMode, setParinferMode] = useState<ParinferMode>('paren');
  const [serverStatus, setServerStatus] = useState<ServerStatus>('ready');
  const [activeFlashId, setActiveFlashId] = useState<ShortcutId | null>(null);
  const [history, setHistory] = useState<ActionHistoryEntry[]>([]);
  const [replEntries, setReplEntries] = useState<EvalResultEntry[]>([]);
  const [isReplOpen, setIsReplOpen] = useState<boolean>(true);
  const [showHud, setShowHud] = useState<boolean>(true);

  const flashTimerRef = useRef<number | null>(null);

  // Probe server connection on mount
  useEffect(() => {
    let isMounted = true;
    async function checkServer() {
      try {
        const res = await fetch('/api/eval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: '(+ 1 1)' }),
        });
        if (isMounted) {
          if (res.ok) {
            setServerStatus('connected');
          } else {
            setServerStatus('ready');
          }
        }
      } catch {
        if (isMounted) {
          setServerStatus('ready');
        }
      }
    }
    checkServer();
    return () => {
      isMounted = false;
    };
  }, []);

  // Format timestamp helper: HH:MM:SS.mmm
  const getFormattedTime = () => {
    const d = new Date();
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(
      d.getMilliseconds(),
      3
    )}`;
  };

  // Handle shortcut triggered from keyboard or HUD click
  const handleShortcutTriggered = useCallback(
    (id: ShortcutId, detail: string, success: boolean) => {
      // 1. Trigger HUD real-time glowing flash
      setActiveFlashId(id);
      if (flashTimerRef.current) {
        window.clearTimeout(flashTimerRef.current);
      }
      flashTimerRef.current = window.setTimeout(() => {
        setActiveFlashId(null);
      }, 500);

      // 2. Prepend to action history log
      const info = SHORTCUTS_LIST.find((s) => s.id === id);
      const newEntry: ActionHistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
        shortcutId: id,
        shortcutName: info ? `${info.name} (${info.enName})` : id,
        shortcutKeys: info ? info.keys : id,
        timestamp: getFormattedTime(),
        status: detail,
        success,
      };

      setHistory((prev) => [newEntry, ...prev.slice(0, 49)]);
    },
    []
  );

  // Handle evaluation result from /api/eval
  const handleEvalResult = useCallback((data: {
    code: string;
    result?: string;
    stdout?: string;
    stderr?: string;
    error?: string;
    duration_ms: number;
    success: boolean;
  }) => {
    if (data.success) {
      setServerStatus('connected');
    } else if (data.error && data.error.includes('Cannot connect')) {
      setServerStatus('error');
    }

    const newResult: EvalResultEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      code: data.code,
      result: data.result,
      stdout: data.stdout,
      stderr: data.stderr,
      error: data.error,
      duration_ms: data.duration_ms,
      timestamp: getFormattedTime(),
      status: data.success ? 'success' : 'error',
    };

    setReplEntries((prev) => [...prev, newResult]);
    setIsReplOpen(true);
  }, []);

  // Toolbar action handlers
  const handleRunEval = useCallback(() => {
    editorRef.current?.triggerShortcut('eval_repl');
  }, []);

  const handleResetCode = useCallback(() => {
    if (window.confirm('Reset editor to default Scheme sample code?')) {
      editorRef.current?.setContent(DEFAULT_SCHEME_CODE);
    }
  }, []);

  const handleIndent = useCallback(() => {
    editorRef.current?.triggerShortcut('indent');
  }, []);

  const handleTriggerFromHud = useCallback((id: ShortcutId) => {
    editorRef.current?.triggerShortcut(id);
    editorRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#1a1b26] text-[#c0caf5]">
      {/* Top Header */}
      <Header
        parinferMode={parinferMode}
        onParinferModeChange={setParinferMode}
        serverStatus={serverStatus}
        onRunEval={handleRunEval}
        onResetCode={handleResetCode}
        onIndent={handleIndent}
        showHud={showHud}
        onToggleHud={() => setShowHud((v) => !v)}
      />

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left / Center Area: Monaco Editor + Bottom REPL */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Monaco Editor Container */}
          <div className="flex-1 relative overflow-hidden">
            <MonacoEditor
              ref={editorRef}
              initialCode={DEFAULT_SCHEME_CODE}
              parinferMode={parinferMode}
              onShortcutTriggered={handleShortcutTriggered}
              onEvalResult={handleEvalResult}
            />
          </div>

          {/* Bottom REPL Panel */}
          <ReplPanel
            entries={replEntries}
            serverStatus={serverStatus}
            onClear={() => setReplEntries([])}
            isOpen={isReplOpen}
            onToggle={() => setIsReplOpen((v) => !v)}
          />
        </div>

        {/* Right Sidebar: Interactive HUD CheatSheet */}
        {showHud && (
          <HudSidebar
            activeFlashId={activeFlashId}
            history={history}
            onTriggerShortcut={handleTriggerFromHud}
            onClearHistory={() => setHistory([])}
          />
        )}
      </div>
    </div>
  );
};
export default App;
