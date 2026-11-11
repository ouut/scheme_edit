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
  const [activePane, setActivePane] = useState<'editor' | 'terminal'>('terminal');

  const containerRef = useRef<HTMLDivElement>(null);
  const editorPanelRef = useRef<EditorPanelHandle>(null);
  const terminalPanelRef = useRef<TerminalPanelHandle>(null);
  const saveTimerRef = useRef<Map<string, number>>(new Map());
  const processedActionIdsRef = useRef<Set<string | number>>(new Set());
  const lastGuiActionRef = useRef<{ key: string; time: number }>({ key: '', time: 0 });
  const openingPathsRef = useRef<Set<string>>(new Set());

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
      const cleanPath = filePath.trim();
      if (!cleanPath) return;

      // If already open or being opened, switch active tab and ensure left panel is open
      if (openingPathsRef.current.has(cleanPath)) {
        setActiveFilePath(cleanPath);
        setSplitRatio((r) => (r <= 0.05 ? 0.6 : r));
        return;
      }

      let alreadyExists = false;
      setOpenFiles((prev) => {
        if (prev.some((f) => f.path === cleanPath)) {
          alreadyExists = true;
        }
        return prev;
      });

      if (alreadyExists) {
        setActiveFilePath(cleanPath);
        setSplitRatio((r) => (r <= 0.05 ? 0.6 : r));
        return;
      }

      openingPathsRef.current.add(cleanPath);

      try {
        let content = initialContent;
        if (content === undefined) {
          try {
            const res = await fetch(`/api/file?path=${encodeURIComponent(cleanPath)}`);
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

        let finalContent = content || '';
        if (!finalContent && cleanPath.startsWith('scratch-') && cleanPath.endsWith('.scm')) {
          finalContent = ';; Scheme Scratch Buffer\n';
        }

        const newFile: OpenFile = {
          path: cleanPath,
          name: cleanPath.split('/').pop() || cleanPath,
          content: finalContent,
          savedContent: finalContent,
          isModified: false,
        };

        setOpenFiles((prev) => {
          if (prev.some((f) => f.path === cleanPath)) {
            return prev;
          }
          return [...prev, newFile];
        });

        setActiveFilePath(cleanPath);
        setSplitRatio((prev) => (prev <= 0.05 ? 0.6 : prev));
        setActivePane('editor');
        setTimeout(() => {
          editorPanelRef.current?.focus();
        }, 60);
      } finally {
        openingPathsRef.current.delete(cleanPath);
      }
    },
    []
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

        setActiveFilePath((currentActive) => {
          if (currentActive === filePath) {
            if (nextFiles.length > 0) {
              const idx = prev.findIndex((f) => f.path === filePath);
              const nextActive = nextFiles[Math.min(idx, nextFiles.length - 1)];
              return nextActive.path;
            } else {
              return null;
            }
          }
          return currentActive;
        });

        return nextFiles;
      });
    },
    []
  );

  // Create new scratch buffer (scratch-N.scm)
  const handleNewScratchFile = useCallback(() => {
    setOpenFiles((prev) => {
      let counter = 1;
      while (prev.some((f) => f.path === `scratch-${counter}.scm`)) {
        counter++;
      }
      const filename = `scratch-${counter}.scm`;
      openFile(filename, ';; Scheme Scratch Buffer\n');
      return prev;
    });
  }, [openFile]);

  // Alt+Enter / Ctrl+Enter: Send selected or current S-expression to Tab 1 ("λ REPL")
  const handleSendToRepl = useCallback((code: string) => {
    terminalPanelRef.current?.sendToRepl(code);
  }, []);

  // Listen for GUI actions from server or terminal
  const handleGuiAction = useCallback(
    (payload: GuiActionPayload) => {
      // 1. Deduplicate by unique action ID
      if (payload.id !== undefined && payload.id !== null) {
        if (processedActionIdsRef.current.has(payload.id)) {
          return;
        }
        processedActionIdsRef.current.add(payload.id);
        if (processedActionIdsRef.current.size > 200) {
          const first = processedActionIdsRef.current.values().next().value;
          if (first !== undefined) processedActionIdsRef.current.delete(first);
        }
      }

      // 2. Debounce identical action within 500ms
      const actionKey = `${payload.action}:${payload.file || ''}:${payload.left || ''}:${payload.right || ''}`;
      const now = Date.now();
      if (
        lastGuiActionRef.current.key === actionKey &&
        now - lastGuiActionRef.current.time < 500
      ) {
        return;
      }
      lastGuiActionRef.current = { key: actionKey, time: now };

      if (payload.action === 'open') {
        const target = payload.file?.trim();
        if (target) {
          openFile(target);
        } else {
          handleNewScratchFile();
        }
        setActivePane('editor');
        setTimeout(() => {
          editorPanelRef.current?.focus();
        }, 80);
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
    } else {
      const timer = setTimeout(() => {
        terminalPanelRef.current?.focusActiveTerminal();
      }, 100);
      return () => clearTimeout(timer);
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

  // Cycle backwards through open file tabs with wrap-around
  const switchPrevEditorTab = useCallback(() => {
    setOpenFiles((currentOpenFiles) => {
      if (currentOpenFiles.length <= 1) return currentOpenFiles;
      setActiveFilePath((currentActive) => {
        const idx = currentOpenFiles.findIndex((f) => f.path === currentActive);
        const prevIdx = (idx - 1 + currentOpenFiles.length) % currentOpenFiles.length;
        const nextPath = currentOpenFiles[prevIdx].path;
        setTimeout(() => {
          editorPanelRef.current?.focus();
        }, 30);
        return nextPath;
      });
      return currentOpenFiles;
    });
  }, []);

  // Cycle forwards through open file tabs with wrap-around
  const switchNextEditorTab = useCallback(() => {
    setOpenFiles((currentOpenFiles) => {
      if (currentOpenFiles.length <= 1) return currentOpenFiles;
      setActiveFilePath((currentActive) => {
        const idx = currentOpenFiles.findIndex((f) => f.path === currentActive);
        const nextIdx = (idx + 1) % currentOpenFiles.length;
        const nextPath = currentOpenFiles[nextIdx].path;
        setTimeout(() => {
          editorPanelRef.current?.focus();
        }, 30);
        return nextPath;
      });
      return currentOpenFiles;
    });
  }, []);

  // Global shortcut navigation: Alt + Shift + Arrows
  // - Alt + Shift + Up: Focus Code Editor (creates scratch file if none open)
  // - Alt + Shift + Down: Focus Shell Terminal
  // - Alt + Shift + Left: If Editor focused -> cycle Editor tabs backwards with wrap-around; If Terminal focused -> cycle Terminal tabs backwards with wrap-around
  // - Alt + Shift + Right: If Editor focused -> cycle Editor tabs forwards with wrap-around; If Terminal focused -> cycle Terminal tabs forwards with wrap-around
  useEffect(() => {
    const handleKeyDownCapture = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey) return;

      if (e.code === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActivePane('editor');
        if (openFiles.length === 0) {
          handleNewScratchFile();
        } else {
          setTimeout(() => {
            editorPanelRef.current?.focus();
          }, 30);
        }
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setActivePane('terminal');
        setTimeout(() => {
          terminalPanelRef.current?.focusActiveTerminal();
        }, 30);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        if (activePane === 'editor') {
          switchPrevEditorTab();
        } else {
          terminalPanelRef.current?.switchPrevTab();
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        if (activePane === 'editor') {
          switchNextEditorTab();
        } else {
          terminalPanelRef.current?.switchNextTab();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDownCapture, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDownCapture, { capture: true });
    };
  }, [
    activePane,
    openFiles.length,
    handleNewScratchFile,
    switchPrevEditorTab,
    switchNextEditorTab,
  ]);

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
            onFocus={() => setActivePane('editor')}
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
        onMouseDown={() => setActivePane('terminal')}
      >
        <TerminalPanel
          ref={terminalPanelRef}
          onGuiAction={handleGuiAction}
          onFocus={() => setActivePane('terminal')}
        />
      </div>
    </div>
  );
};

export default App;
