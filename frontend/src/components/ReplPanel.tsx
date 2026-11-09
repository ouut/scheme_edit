import React, { useRef, useEffect, useState } from 'react';
import { Terminal, Trash2, ChevronDown, ChevronUp, Clock, CheckCircle2, AlertCircle, CornerDownLeft } from 'lucide-react';
import { EvalResultEntry, ServerStatus } from '../types';

interface ReplPanelProps {
  entries: EvalResultEntry[];
  serverStatus: ServerStatus;
  onClear: () => void;
  isOpen: boolean;
  onToggle: () => void;
  onEval?: (code: string) => void;
}

export const ReplPanel: React.FC<ReplPanelProps> = ({
  entries,
  serverStatus,
  onClear,
  isOpen,
  onToggle,
  onEval,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [inputCode, setInputCode] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);

  // Auto-scroll to bottom on new evaluation results
  useEffect(() => {
    if (scrollRef.current && isOpen) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputCode.trim();
    if (!trimmed) return;
    onEval?.(trimmed);
    setCommandHistory((prev) => [...prev, trimmed]);
    setHistoryIdx(null);
    setInputCode('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const nextIdx =
        historyIdx === null
          ? commandHistory.length - 1
          : Math.max(0, historyIdx - 1);
      setHistoryIdx(nextIdx);
      setInputCode(commandHistory[nextIdx]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx === null) return;
      const nextIdx = historyIdx + 1;
      if (nextIdx >= commandHistory.length) {
        setHistoryIdx(null);
        setInputCode('');
      } else {
        setHistoryIdx(nextIdx);
        setInputCode(commandHistory[nextIdx]);
      }
    }
  };

  return (
    <div
      className={`border-t border-[#24283b] bg-[#14151f] flex flex-col transition-all duration-200 select-none ${
        isOpen ? 'h-72' : 'h-8'
      }`}
    >
      {/* Panel Header */}
      <div className="h-8 bg-[#181926] px-3 flex items-center justify-between border-b border-[#24283b] shrink-0 text-xs">
        <div className="flex items-center space-x-3 cursor-pointer" onClick={onToggle}>
          <div className="flex items-center space-x-1.5 text-neutral-300 hover:text-white transition">
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-semibold font-mono tracking-tight text-neutral-200">
              REPL Output
            </span>
          </div>

          {/* Status Badge */}
          <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-[#1e202f] border border-[#2d324b] text-[10px] font-mono">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                serverStatus === 'connected'
                  ? 'bg-emerald-400 animate-pulse'
                  : serverStatus === 'ready'
                  ? 'bg-amber-400'
                  : 'bg-rose-500'
              }`}
            />
            <span className="text-neutral-300">
              {serverStatus === 'connected'
                ? 'Rust Server: Active'
                : serverStatus === 'ready'
                ? 'Server: Standby'
                : 'Server: Offline'}
            </span>
          </div>

          {entries.length > 0 && (
            <span className="text-[10px] text-neutral-500 font-mono">
              ({entries.length} eval{entries.length > 1 ? 's' : ''})
            </span>
          )}
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center space-x-2">
          {entries.length > 0 && (
            <button
              onClick={onClear}
              className="text-neutral-400 hover:text-rose-400 p-1 rounded transition flex items-center space-x-1 text-[11px] cursor-pointer"
              title="Clear REPL output"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          )}

          <button
            onClick={onToggle}
            className="text-neutral-400 hover:text-neutral-200 p-1 transition cursor-pointer"
            title={isOpen ? 'Collapse panel' : 'Expand panel'}
          >
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Panel Body */}
      {isOpen && (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-xs select-text"
        >
          {entries.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-neutral-500 text-xs space-y-1 py-8">
              <div className="text-neutral-400 font-mono text-sm">λ Steel Scheme REPL Ready</div>
              <div className="text-neutral-600 text-[11px]">
                Type in the prompt below or place cursor at any S-expression and press{' '}
                <kbd className="px-1.5 py-0.5 bg-[#1e202f] border border-[#2d324b] rounded text-cyan-300 text-[10px]">
                  Ctrl + Enter
                </kbd>{' '}
                to evaluate.
              </div>
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className={`p-2.5 rounded-lg border text-xs space-y-1.5 transition ${
                  entry.status === 'success'
                    ? 'bg-[#181a28] border-[#292d42]'
                    : 'bg-[#22161f] border-rose-900/50'
                }`}
              >
                {/* Entry Header: Timestamp, Duration, Status */}
                <div className="flex items-center justify-between text-[11px] text-neutral-400 pb-1 border-b border-[#24283b]">
                  <div className="flex items-center space-x-2">
                    {entry.status === 'success' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                    )}
                    <span className="text-neutral-300 font-medium">
                      {entry.timestamp}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2 text-[10px]">
                    <span className="flex items-center space-x-1 text-cyan-400 bg-cyan-950/60 px-1.5 py-0.2 rounded border border-cyan-800/40">
                      <Clock className="w-3 h-3" />
                      <span>{entry.duration_ms}ms</span>
                    </span>
                    <span
                      className={`px-1.5 py-0.2 rounded font-semibold uppercase ${
                        entry.status === 'success'
                          ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/40'
                          : 'bg-rose-950/70 text-rose-300 border border-rose-800/40'
                      }`}
                    >
                      {entry.status === 'success' ? 'OK' : 'Error'}
                    </span>
                  </div>
                </div>

                {/* Input Code */}
                <div className="text-neutral-300 bg-[#12131d] p-2 rounded border border-[#23263b] overflow-x-auto">
                  <span className="text-emerald-400 select-none mr-2 font-bold">λ &gt;</span>
                  <span className="text-neutral-200 whitespace-pre">{entry.code}</span>
                </div>

                {/* Stdout Output if any */}
                {entry.stdout && (
                  <div className="text-neutral-300 bg-[#12131d]/60 p-2 rounded border border-[#23263b] overflow-x-auto">
                    <span className="text-amber-400/90 text-[10px] select-none block font-semibold mb-0.5">
                      STDOUT:
                    </span>
                    <pre className="text-neutral-300 text-[11px] whitespace-pre-wrap">
                      {entry.stdout}
                    </pre>
                  </div>
                )}

                {/* Return Value */}
                {entry.result && (
                  <div className="flex items-start space-x-2 text-cyan-300 font-semibold pl-1">
                    <span className="text-cyan-400 font-bold select-none">=&gt;</span>
                    <span className="text-cyan-200 break-all whitespace-pre-wrap">{entry.result}</span>
                  </div>
                )}

                {/* Stderr / Error Message */}
                {(entry.error || entry.stderr) && (
                  <div className="text-rose-400 bg-rose-950/30 p-2 rounded border border-rose-800/40 overflow-x-auto">
                    <span className="text-rose-400 text-[10px] select-none block font-semibold mb-0.5">
                      {entry.status === 'success' ? 'STDERR:' : 'ERROR:'}
                    </span>
                    <pre className="text-rose-300 text-[11px] whitespace-pre-wrap">
                      {entry.error || entry.stderr}
                    </pre>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Interactive REPL Prompt Input */}
      {isOpen && (
        <form
          onSubmit={handleSubmit}
          className="h-10 bg-[#12131d] px-3 flex items-center border-t border-[#24283b] shrink-0 font-mono text-xs"
        >
          <span className="text-emerald-400 font-bold select-none mr-2">λ &gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type S-expression e.g. (+ 1 2) or (fib 10) and press Enter..."
            className="flex-1 bg-transparent text-neutral-100 placeholder-neutral-500 text-xs focus:outline-none"
          />
          <button
            type="submit"
            disabled={!inputCode.trim()}
            className="ml-2 px-2.5 py-1 rounded bg-emerald-950/80 hover:bg-emerald-800/80 text-emerald-300 border border-emerald-700/50 text-[11px] flex items-center space-x-1 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            title="Evaluate (Enter)"
          >
            <span>Eval</span>
            <CornerDownLeft className="w-3 h-3 text-emerald-400" />
          </button>
        </form>
      )}
    </div>
  );
};
