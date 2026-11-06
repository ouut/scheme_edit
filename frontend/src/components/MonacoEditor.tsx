import React, { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import {
  registerMonacoScheme,
  SCHEME_LANGUAGE_ID,
  TOKYO_NIGHT_THEME_ID,
} from '../lib/monacoScheme';
import {
  applyParinfer,
  isParinferLocked,
  withParinferLock,
} from '../lib/parinferService';
import {
  dispatchShortcut,
  expandSelection,
  evalRepl,
  wrapParens,
  wrapSquare,
  slurpForward,
  barfForward,
  contractSelection,
  selectTopLevelDefun,
  splice,
  forwardSexp,
  backwardSexp,
  downIntoSexp,
  upOutOfSexp,
  killSexp,
  indent,
  transposeSexp,
  splitSexp,
} from '../lib/pareditEngine';
import { ShortcutId, ParinferMode } from '../types';

// Setup Monaco web worker environment for Vite
if (typeof window !== 'undefined' && !(window as any).MonacoEnvironment) {
  (window as any).MonacoEnvironment = {
    getWorker(_: any, _label: string) {
      return new editorWorker();
    },
  };
}

// Register Scheme grammar & Tokyo Night theme
registerMonacoScheme();

export interface MonacoEditorHandle {
  focus: () => void;
  getContent: () => string;
  setContent: (content: string) => void;
  triggerShortcut: (id: ShortcutId) => Promise<void>;
  getEditor: () => monaco.editor.IStandaloneCodeEditor | null;
}

interface MonacoEditorProps {
  initialCode: string;
  parinferMode: ParinferMode;
  onCodeChange?: (code: string) => void;
  onShortcutTriggered?: (id: ShortcutId, detail: string, success: boolean) => void;
  onEvalResult?: (data: {
    code: string;
    result?: string;
    stdout?: string;
    stderr?: string;
    error?: string;
    duration_ms: number;
    success: boolean;
  }) => void;
}

export const MonacoEditor = forwardRef<MonacoEditorHandle, MonacoEditorProps>(
  (
    {
      initialCode,
      parinferMode,
      onCodeChange,
      onShortcutTriggered,
      onEvalResult,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const parinferModeRef = useRef<ParinferMode>(parinferMode);
    parinferModeRef.current = parinferMode;

    const onCodeChangeRef = useRef(onCodeChange);
    onCodeChangeRef.current = onCodeChange;

    const onShortcutTriggeredRef = useRef(onShortcutTriggered);
    onShortcutTriggeredRef.current = onShortcutTriggered;

    const onEvalResultRef = useRef(onEvalResult);
    onEvalResultRef.current = onEvalResult;

    // Helper to execute shortcut and notify HUD
    const executeAction = useCallback(
      async (id: ShortcutId) => {
        const editor = editorRef.current;
        if (!editor) return;

        const res = await dispatchShortcut(id, editor, (evalData) => {
          onEvalResultRef.current?.(evalData);
        });

        onShortcutTriggeredRef.current?.(
          id,
          res.detail || (res.success ? 'Executed' : 'No-op'),
          res.success
        );
      },
      []
    );

    // Expose handle to parent component
    useImperativeHandle(ref, () => ({
      focus: () => {
        editorRef.current?.focus();
      },
      getContent: () => {
        return editorRef.current?.getValue() || '';
      },
      setContent: (newContent: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        const model = editor.getModel();
        if (model && model.getValue() !== newContent) {
          withParinferLock(() => {
            editor.executeEdits('resetContent', [
              {
                range: model.getFullModelRange(),
                text: newContent,
              },
            ]);
            editor.setPosition({ lineNumber: 1, column: 1 });
          });
        }
      },
      triggerShortcut: async (id: ShortcutId) => {
        await executeAction(id);
      },
      getEditor: () => editorRef.current,
    }));

    // Initialize Monaco instance
    useEffect(() => {
      if (!containerRef.current) return;

      const editor = monaco.editor.create(containerRef.current, {
        value: initialCode,
        language: SCHEME_LANGUAGE_ID,
        theme: TOKYO_NIGHT_THEME_ID,
        bracketPairColorization: {
          enabled: true,
          independentColorPoolPerBracketType: true,
        },
        guides: {
          bracketPairs: true,
          indentation: true,
        },
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 14,
        fontFamily: 'var(--font-mono, "JetBrains Mono", "Fira Code", monospace)',
        fontLigatures: true,
        lineNumbers: 'on',
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        cursorWidth: 2,
        renderLineHighlight: 'all',
        tabSize: 2,
        insertSpaces: true,
        fixedOverflowWidgets: true,
        padding: { top: 12, bottom: 12 },
      });

      editorRef.current = editor;

      // Handle Parinfer on content change
      editor.onDidChangeModelContent((e) => {
        const text = editor.getValue();
        onCodeChangeRef.current?.(text);

        if (
          isParinferLocked() ||
          e.isUndoing ||
          e.isRedoing ||
          parinferModeRef.current === 'off'
        ) {
          return;
        }

        const pos = editor.getPosition();
        if (!pos) return;

        const cursor = {
          row: pos.lineNumber - 1,
          column: pos.column - 1,
        };

        const result = applyParinfer(text, cursor, parinferModeRef.current);
        if (result.success && result.text !== text) {
          withParinferLock(() => {
            const model = editor.getModel();
            if (model) {
              editor.executeEdits('parinfer', [
                {
                  range: model.getFullModelRange(),
                  text: result.text,
                },
              ]);
              if (result.cursor) {
                editor.setPosition({
                  lineNumber: result.cursor.row + 1,
                  column: result.cursor.column + 1,
                });
              }
            }
          });
        }
      });

      /* -----------------------------------------------------------------------
       * Register all 17 Strict Paredit shortcuts in Monaco Editor
       * --------------------------------------------------------------------- */

      // 1. Alt + K : 向外扩选 (Expand)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.KeyK,
        () => executeAction('expand')
      );

      // 2. Alt + Enter / Ctrl + Enter : 发射求值 (Eval REPL)
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => executeAction('eval_repl')
      );
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.Enter,
        () => executeAction('eval_repl')
      );

      // 3. Alt + U : 圆括号包裹 (Wrap Parens)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.KeyU,
        () => executeAction('wrap_parens')
      );

      // 4. Alt + Shift + U : 方括号包裹 (Wrap Square)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyU,
        () => executeAction('wrap_square')
      );

      // 5. Alt + J : 向右吞噬 (Slurp)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.KeyJ,
        () => executeAction('slurp')
      );

      // 6. Alt + L : 向左吐出 (Barf)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.KeyL,
        () => executeAction('barf')
      );

      // 7. Alt + I : 向内收缩 (Contract)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.KeyI,
        () => executeAction('contract')
      );

      // 8. Alt + 3 : 选中顶级函数 (Defun)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.Digit3,
        () => executeAction('defun')
      );

      // 9. Alt + O : 脱壳解包 (Splice)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.KeyO,
        () => executeAction('splice')
      );

      // 10. Alt + 2 : 大步前进 (Forward sexp)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.Digit2,
        () => executeAction('forward')
      );

      // 11. Alt + 1 : 大步后退 (Backward sexp)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.Digit1,
        () => executeAction('backward')
      );

      // 12. Alt + S : 深度钻入 (Down)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.KeyS,
        () => executeAction('down')
      );

      // 13. Alt + W : 向上跳出 (Up)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.KeyW,
        () => executeAction('up')
      );

      // 14. Alt + X : 向后整块删除 (Kill sexp, 避开 Chrome 地址栏抢焦)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.KeyX,
        () => executeAction('kill_sexp')
      );
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.KeyD,
        () => executeAction('kill_sexp')
      );

      // 15. Alt + \ : 智能格式排版 (Indent, 避开 Chrome 菜单抢焦)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.Backslash,
        () => executeAction('indent')
      );
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
        () => executeAction('indent')
      );

      // 16. Alt + H : 相邻参数对调 (Transpose)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.KeyH,
        () => executeAction('transpose')
      );

      // 17. Alt + Shift + K : 列表切分 (Split)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyK,
        () => executeAction('split')
      );

      // Window / Document keydown capture listener to intercept browser conflicts
      // (Alt+1/2/3 tab switches, Alt+W window close, Alt menu focus, etc.)
      const handleGlobalKeydown = (e: KeyboardEvent) => {
        // Prevent Windows / Chrome from focusing the menu bar on single Alt press
        if (e.key === 'Alt') {
          e.preventDefault();
        }

        // Only handle when Monaco is focused or active
        if (!editor.hasTextFocus() && document.activeElement !== containerRef.current) {
          return;
        }

        const isAlt = e.altKey;
        const isShift = e.shiftKey;
        const isCtrl = e.ctrlKey || e.metaKey;
        const key = e.key;

        // Eval REPL: Alt+Enter or Ctrl+Enter
        if (((isCtrl && !isAlt && !isShift) || (isAlt && !isCtrl && !isShift)) && (key === 'Enter')) {
          e.preventDefault();
          e.stopPropagation();
          executeAction('eval_repl');
          return;
        }

        if (isAlt && isShift && !isCtrl) {
          switch (key.toLowerCase()) {
            case 'u': // Alt + Shift + U: 方括号包裹 (Wrap Square)
              e.preventDefault();
              e.stopPropagation();
              executeAction('wrap_square');
              return;
            case 'k': // Alt + Shift + K: 列表切分 (Split)
              e.preventDefault();
              e.stopPropagation();
              executeAction('split');
              return;
          }
        } else if (isAlt && !isShift && !isCtrl) {
          switch (key.toLowerCase()) {
            case 'k': // Alt + K: 向外扩选 (Expand)
              e.preventDefault();
              e.stopPropagation();
              executeAction('expand');
              return;
            case 'i': // Alt + I: 向内收缩 (Contract)
              e.preventDefault();
              e.stopPropagation();
              executeAction('contract');
              return;
            case 'u': // Alt + U: 圆括号包裹 (Wrap Parens)
              e.preventDefault();
              e.stopPropagation();
              executeAction('wrap_parens');
              return;
            case 'j': // Alt + J: 向右吞噬 (Slurp)
              e.preventDefault();
              e.stopPropagation();
              executeAction('slurp');
              return;
            case 'l': // Alt + L: 向左吐出 (Barf)
              e.preventDefault();
              e.stopPropagation();
              executeAction('barf');
              return;
            case '3': // Alt + 3: 选中顶级函数 (Defun)
              e.preventDefault();
              e.stopPropagation();
              executeAction('defun');
              return;
            case 'o': // Alt + O: 脱壳解包 (Splice)
              e.preventDefault();
              e.stopPropagation();
              executeAction('splice');
              return;
            case '2': // Alt + 2: 大步前进 (Forward)
              e.preventDefault();
              e.stopPropagation();
              executeAction('forward');
              return;
            case '1': // Alt + 1: 大步后退 (Backward)
              e.preventDefault();
              e.stopPropagation();
              executeAction('backward');
              return;
            case 's': // Alt + S: 深度钻入 (Down)
              e.preventDefault();
              e.stopPropagation();
              executeAction('down');
              return;
            case 'w': // Alt + W: 向上跳出 (Up)
              e.preventDefault();
              e.stopPropagation();
              executeAction('up');
              return;
            case 'x': // Alt + X: 向后整块删除 (Kill Sexp, 避开 Chrome 地址栏)
            case 'd': // 兼容别名
              e.preventDefault();
              e.stopPropagation();
              executeAction('kill_sexp');
              return;
            case '\\': // Alt + \: 智能格式排版 (Indent, 避开 Chrome 菜单)
            case 'f':  // 兼容别名
              e.preventDefault();
              e.stopPropagation();
              executeAction('indent');
              return;
            case 'h': // Alt + H: 相邻参数对调 (Transpose)
              e.preventDefault();
              e.stopPropagation();
              executeAction('transpose');
              return;
          }
        }
      };

      const handleGlobalKeyup = (e: KeyboardEvent) => {
        // Prevent Windows / Chrome menu activation when releasing Alt
        if (e.key === 'Alt') {
          e.preventDefault();
        }
      };

      window.addEventListener('keydown', handleGlobalKeydown, true);
      window.addEventListener('keyup', handleGlobalKeyup, true);

      // Responsive layout observer
      const resizeObserver = new ResizeObserver(() => {
        editor.layout();
      });
      resizeObserver.observe(containerRef.current);

      return () => {
        window.removeEventListener('keydown', handleGlobalKeydown, true);
        window.removeEventListener('keyup', handleGlobalKeyup, true);
        resizeObserver.disconnect();
        editor.dispose();
        editorRef.current = null;
      };
    }, [executeAction, initialCode]);

    return (
      <div className="flex-1 w-full h-full relative overflow-hidden bg-[#1a1b26]">
        <div
          ref={containerRef}
          className="w-full h-full"
          onClick={() => editorRef.current?.focus()}
        />
      </div>
    );
  }
);
