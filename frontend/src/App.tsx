import React, { useState, useRef, useCallback, useEffect } from 'react';
import { EditorPanel, EditorPanelHandle } from './components/EditorPanel';
import { TerminalPanel, TerminalPanelHandle } from './components/TerminalPanel';
import { OpenFile, ParinferMode, ShortcutId, GuiActionPayload } from './types';

export const App: React.FC = () => {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [splitRatio, setSplitRatio] = useState<number>(0.6); // Default 60:40
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [parinferMode] = useState<ParinferMode>('paren');
  const [scratchCounter, setScratchCounter] = useState<number>(1);

  const containerRef = useRef<HTMLDivElement>(null);
  const editorPanelRef = useRef<EditorPanelHandle>(null);
  const terminalPanelRef = useRef<TerminalPanelHandle>(null);
  const saveTimerRef = useRef<Map<string, number>>(new Map());

  const isEditorOpen = openFiles.length > 0;

  // Auto-save file content to /api/file
  const saveFileToServer = useCallback(async (filePath: string, content: string) => {
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content }),
      });

      if (res.ok) {
        setOpenFiles((prev) =>
          prev.map((f) =>
            f.path === filePath ? { ...f, savedContent: content, isModified: false } : f
          )
        );
      }
    } catch (err) {
      console.warn(`Failed to auto-save ${filePath}:`, err);
    }
  }, []);

  // Handle content changes with debounce save
  const handleCodeChange = useCallback(
    (filePath: string, newContent: string) => {
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === filePath
            ? { ...f, content: newContent, isModified: newContent !== f.savedContent }
            : f
        )
      );

      // Debounce auto-save after 800ms
      const existingTimer = saveTimerRef.current.get(filePath);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }

      const timer = window.setTimeout(() => {
        saveFileToServer(filePath, newContent);
        saveTimerRef.current.delete(filePath);
      }, 800);

      saveTimerRef.current.set(filePath, timer);
    },
    [saveFileToServer]
  );

  // Immediate save on Ctrl+S / Cmd+S
  const handleSaveActiveFile = useCallback(() => {
    if (!activeFilePath) return;
    const file = openFiles.find((f) => f.path === activeFilePath);
    if (!file) return;

    const existingTimer = saveTimerRef.current.get(activeFilePath);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
      saveTimerRef.current.delete(activeFilePath);
    }

    saveFileToServer(activeFilePath, file.content);
  }, [activeFilePath, openFiles, saveFileToServer]);

  // Open file (from server /api/file, GUI action, or scratch)
  const openFile = useCallback(
    async (filePath: string, initialContent?: string) => {
      // If already open, switch active tab and ensure left panel is open
      const existing = openFiles.find((f) => f.path === filePath);
      if (existing) {
        setActiveFilePath(filePath);
        return;
      }

      let content = initialContent;
      if (content === undefined) {
        try {
          const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
          if (res.ok) {
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              const data = await res.json();
              content = data.content ?? data.text ?? '';
            } else {
              content = await res.text();
            }
          } else {
            content = '';
          }
        } catch {
          content = '';
        }
      }

      const newFile: OpenFile = {
        path: filePath,
        name: filePath.split('/').pop() || filePath,
        content: content || '',
        savedContent: content || '',
        isModified: false,
      };

      setOpenFiles((prev) => [...prev, newFile]);
      setActiveFilePath(filePath);

      // Restore 60:40 ratio if previously collapsed
      setSplitRatio((prev) => (prev <= 0.05 ? 0.6 : prev));
    },
    [openFiles]
  );

  // Close file tab
  const closeFile = useCallback(
    (filePath: string) => {
      // Clear pending save timer
      const timer = saveTimerRef.current.get(filePath);
      if (timer) {
        window.clearTimeout(timer);
        saveTimerRef.current.delete(filePath);
      }

      setOpenFiles((prev) => {
        const nextFiles = prev.filter((f) => f.path !== filePath);

        if (activeFilePath === filePath) {
          if (nextFiles.length > 0) {
            const idx = prev.findIndex((f) => f.path === filePath);
            const nextActive = nextFiles[Math.min(idx, nextFiles.length - 1)];
            setActiveFilePath(nextActive.path);
          } else {
            setActiveFilePath(null);
          }
        }

        return nextFiles;
      });
    },
    [activeFilePath]
  );

  // Create new scratch buffer
  const handleNewScratchFile = useCallback(() => {
    const filename = `scratch-${scratchCounter}.scm`;
    setScratchCounter((c) => c + 1);
    openFile(filename, ';; Scheme Scratch Buffer\n');
  }, [scratchCounter, openFile]);

  // Alt+Enter / Ctrl+Enter: Send selected or current S-expression to Tab 1 ("λ REPL")
  const handleSendToRepl = useCallback((code: string) => {
    terminalPanelRef.current?.sendToRepl(code);
  }, []);

  // Listen for GUI actions from server or terminal
  const handleGuiAction = useCallback(
    (payload: GuiActionPayload) => {
      if (payload.action === 'open' && payload.file) {
        openFile(payload.file);
      } else if (payload.action === 'close') {
        if (payload.file) {
          closeFile(payload.file);
        } else if (activeFilePath) {
          closeFile(activeFilePath);
        }
      } else if (payload.action === 'ratio' && payload.left !== undefined && payload.right !== undefined) {
        const sum = payload.left + payload.right;
        if (sum > 0) {
          if (payload.left === 0) {
            // Collapse left panel
            setOpenFiles([]);
            setActiveFilePath(null);
          } else {
            const newRatio = payload.left / sum;
            setSplitRatio(Math.max(0.1, Math.min(0.9, newRatio)));
          }
        }
      }
    },
    [openFile, closeFile, activeFilePath]
  );

  // Check URL params on initial mount (?open=... or ?file=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialFile = params.get('open') || params.get('file');
    if (initialFile) {
      openFile(initialFile);
    }
  }, [openFile]);

  // Draggable divider mouse handler
  const startDragging = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const newRatio = (moveEvent.clientX - rect.left) / rect.width;
        // Clamp between 15% and 85%
        setSplitRatio(Math.max(0.15, Math.min(0.85, newRatio)));
      };

      const onMouseUp = () => {
        setIsDragging(false);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);

        // Notify editor and terminal to recalculate layout
        requestAnimationFrame(() => {
          editorPanelRef.current?.layout();
          terminalPanelRef.current?.fitActiveTerminal();
        });
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    []
  );

  // Re-fit editor and terminal whenever split ratio or openFiles changes
  useEffect(() => {
    if (!isDragging) {
      const timer = setTimeout(() => {
        editorPanelRef.current?.layout();
        terminalPanelRef.current?.fitActiveTerminal();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [splitRatio, isDragging, isEditorOpen]);

  // Window resize handler
  useEffect(() => {
    const handleResize = () => {
      editorPanelRef.current?.layout();
      terminalPanelRef.current?.fitActiveTerminal();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex h-screen w-screen overflow-hidden bg-[#1a1b26] text-[#c0caf5] select-none"
    >
      {/* Full-screen mouse capture overlay while dragging divider */}
      {isDragging && (
        <div className="fixed inset-0 z-50 cursor-col-resize select-none pointer-events-auto" />
      )}

      {/* Left Code Editor Panel */}
      {isEditorOpen && (
        <div
          style={{ width: `${splitRatio * 100}%` }}
          className={`h-full overflow-hidden flex flex-col bg-[#1a1b26] shrink-0 ${
            isDragging ? 'transition-none' : 'transition-[width] duration-150 ease-out'
          }`}
        >
          <EditorPanel
            ref={editorPanelRef}
            openFiles={openFiles}
            activeFilePath={activeFilePath}
            onSelectTab={setActiveFilePath}
            onCloseTab={closeFile}
            onNewFile={handleNewScratchFile}
            onCodeChange={handleCodeChange}
            onSendToRepl={handleSendToRepl}
            onSaveActiveFile={handleSaveActiveFile}
            parinferMode={parinferMode}
          />
        </div>
      )}

      {/* Draggable Divider (visible when editor is open) */}
      {isEditorOpen && (
        <div
          onMouseDown={startDragging}
          className="w-[4px] h-full bg-[#1e2030] hover:bg-[#7aa2f7] active:bg-[#7aa2f7] cursor-col-resize transition-colors select-none z-10 shrink-0"
          title="Drag to resize split ratio"
        />
      )}

      {/* Right Terminal Panel */}
      <div
        style={{ width: isEditorOpen ? `${(1 - splitRatio) * 100}%` : '100%' }}
        className={`h-full overflow-hidden flex flex-col bg-[#1a1b26] flex-1 ${
          isDragging ? 'transition-none' : 'transition-[width] duration-150 ease-out'
        }`}
      >
        <TerminalPanel
          ref={terminalPanelRef}
          onGuiAction={handleGuiAction}
        />
      </div>
    </div>
  );
};

export default App;
