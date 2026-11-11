import React, { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import { MonacoEditor, MonacoEditorHandle } from './MonacoEditor';
import { OpenFile, ParinferMode, ShortcutId } from '../types';
import { X, FileCode, FileText, Plus, HelpCircle } from 'lucide-react';
import { isSchemeFile } from '../lib/monacoScheme';
import { ShortcutsHelpModal } from './ShortcutsHelpModal';

export interface EditorPanelProps {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onNewFile?: () => void;
  onOpenHelp?: () => void;
  onCodeChange: (path: string, content: string) => void;
  onSendToRepl: (code: string) => void;
  onSaveActiveFile?: () => void;
  parinferMode: ParinferMode;
  onShortcutTriggered?: (id: ShortcutId, detail: string, success: boolean) => void;
  onFocus?: () => void;
}

export interface EditorPanelHandle {
  focus: () => void;
  layout: () => void;
  triggerShortcut: (id: ShortcutId) => Promise<void>;
  openHelpModal?: () => void;
}

export const EditorPanel = forwardRef<EditorPanelHandle, EditorPanelProps>(
  (
    {
      openFiles,
      activeFilePath,
      onSelectTab,
      onCloseTab,
      onNewFile,
      onOpenHelp,
      onCodeChange,
      onSendToRepl,
      onSaveActiveFile,
      parinferMode,
      onShortcutTriggered,
      onFocus,
    },
    ref
  ) => {
    const monacoRef = useRef<MonacoEditorHandle>(null);
    const [isHelpOpen, setIsHelpOpen] = useState(false);

    const activeFile = openFiles.find((f) => f.path === activeFilePath) || openFiles[0];

    useImperativeHandle(ref, () => ({
      focus: () => {
        monacoRef.current?.focus();
      },
      layout: () => {
        monacoRef.current?.layout();
      },
      triggerShortcut: async (id: ShortcutId) => {
        await monacoRef.current?.triggerShortcut(id);
      },
      openHelpModal: () => {
        setIsHelpOpen(true);
      },
    }));

    if (!activeFile) {
      return null;
    }

    return (
      <div
        className="flex flex-col h-full w-full bg-[#1a1b26] overflow-hidden"
        onMouseDown={onFocus}
      >
        {/* Editor Tab Bar */}
        <div className="flex items-center justify-between bg-[#16161e] border-b border-[#24283b] h-9 px-2 select-none shrink-0">
          {/* File tabs */}
          <div className="flex items-center space-x-1 overflow-x-auto scrollbar-none">
            {openFiles.map((file) => {
              const isActive = file.path === activeFilePath;
              const isScheme = isSchemeFile(file.path);

              return (
                <div
                  key={file.path}
                  onClick={() => onSelectTab(file.path)}
                  className={`group flex items-center space-x-1.5 px-3 py-1.5 text-xs font-mono font-medium rounded-t cursor-pointer transition-colors border-t-2 ${
                    isActive
                      ? 'bg-[#1a1b26] text-[#c0caf5] border-[#7aa2f7]'
                      : 'text-[#565f89] hover:text-[#c0caf5] hover:bg-[#1f2335]/50 border-transparent'
                  }`}
                  title={file.path}
                >
                  {isScheme ? (
                    <FileCode className="w-3.5 h-3.5 text-[#7aa2f7]" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-[#a9b1d6]" />
                  )}
                  <span>{file.name}</span>

                  {file.isModified && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#e0af68] ml-0.5" title="Unsaved changes" />
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(file.path);
                    }}
                    className="ml-1 text-[#565f89] hover:text-[#f7768e] hover:bg-[#f7768e]/15 rounded p-0.5 transition-colors"
                    title="Close file"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Tab Bar Action Buttons: Help (?) and New Scratch File (+) */}
          <div className="flex items-center space-x-1 ml-2">
            <button
              onClick={() => {
                if (onOpenHelp) {
                  onOpenHelp();
                } else {
                  setIsHelpOpen(true);
                }
              }}
              className="flex items-center justify-center w-6 h-6 rounded text-[#565f89] hover:text-[#7aa2f7] hover:bg-[#24283b] transition-colors cursor-pointer"
              title="快捷键指南 (Shortcuts Manual)"
              aria-label="快捷键指南 (Shortcuts Manual)"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>

            {onNewFile && (
              <button
                onClick={onNewFile}
                className="flex items-center justify-center w-6 h-6 rounded text-[#565f89] hover:text-[#7aa2f7] hover:bg-[#24283b] transition-colors cursor-pointer"
                title="New scratch buffer"
                aria-label="New scratch buffer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Monaco Editor Container */}
        <div className="flex-1 relative overflow-hidden bg-[#1a1b26]">
          <MonacoEditor
            ref={monacoRef}
            initialCode={activeFile.content}
            filePath={activeFile.path}
            parinferMode={parinferMode}
            onCodeChange={(newCode) => {
              onCodeChange(activeFile.path, newCode);
            }}
            onSendToRepl={onSendToRepl}
            onSave={onSaveActiveFile}
            onShortcutTriggered={onShortcutTriggered}
          />
        </div>

        {/* Shortcuts Help Modal Dialog */}
        <ShortcutsHelpModal
          isOpen={isHelpOpen}
          onClose={() => setIsHelpOpen(false)}
        />
      </div>
    );
  }
);

EditorPanel.displayName = 'EditorPanel';
