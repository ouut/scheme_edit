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

      // 5. Alt + L : 向右吞噬 (Slurp - 右侧向右扩张)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.KeyL,
        () => executeAction('slurp')
      );

      // 6. Alt + J : 向左吐出 (Barf - 右侧向左收缩)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.KeyJ,
        () => executeAction('barf')
      );

      // 7. Alt + I / Alt + Shift + I : 向内收缩 (Contract)
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyCode.KeyI,
        () => executeAction('contract')
      );
      editor.addCommand(
        monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyI,
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

      // Timestamp of last triggered Alt shortcut to suppress macOS dead-key compositions
      let lastAltActionTime = 0;

      // Window keydown capture listener to intercept browser / macOS conflicts
      // (Option+U dead key, Option+I circumflex, Alt+1/2/3 tab switches, Alt+W window close, etc.)
      const handleGlobalKeydown = (e: KeyboardEvent) => {
        // Prevent Windows / Chrome from focusing the menu bar on single Alt press
        if (e.key === 'Alt') {
          e.preventDefault();
        }

        // Avoid stealing keystrokes if focused inside an external input/textarea
        const target = e.target as HTMLElement | null;
        const isExternalInput =
          target &&
          target !== document.body &&
          (target.tagName === 'INPUT' ||
            (target.tagName === 'TEXTAREA' && !target.classList.contains('inputarea')));

        if (isExternalInput) {
          return;
        }

        const isAlt = e.altKey;
        const isShift = e.shiftKey;
        const isCtrl = e.ctrlKey || e.metaKey;
        const code = e.code;
        const key = e.key;

        // Eval REPL: Alt+Enter or Ctrl+Enter (or Cmd+Enter on macOS)
        if (
          ((isCtrl && !isAlt && !isShift) || (isAlt && !isCtrl && !isShift)) &&
          (code === 'Enter' || code === 'NumpadEnter' || key === 'Enter')
        ) {
          e.preventDefault();
          e.stopPropagation();
          lastAltActionTime = Date.now();
          editor.focus();
          executeAction('eval_repl');
          return;
        }

        // Only process Alt/Option shortcuts from here
        if (!isAlt || isCtrl) {
          return;
        }

        // Robust matching helper using physical e.code + keyCode + characters
        const matchKey = (
          targetCode: string,
          targetKeyCode: number,
          altCodes: string[] = [],
          targetKeys: string[] = []
        ) => {
          if (code === targetCode || altCodes.includes(code)) return true;
          if (e.keyCode === targetKeyCode || e.which === targetKeyCode) return true;
          const lowerKey = key.toLowerCase();
          if (targetKeys.includes(lowerKey)) return true;
          // Dead-key fallback on macOS: when key is 'Dead', match by physical keyCode or code
          if (lowerKey === 'dead' && (e.keyCode === targetKeyCode || code === targetCode)) return true;
          return false;
        };

        const trigger = (id: ShortcutId) => {
          e.preventDefault();
          e.stopPropagation();
          lastAltActionTime = Date.now();
          editor.focus();
          executeAction(id);
        };

        if (isShift) {
          // Alt + Shift combinations:
          if (matchKey('KeyU', 85, [], ['u', '¨'])) {
            // 4. Alt + Shift + U: 方括号包裹 (Wrap Square)
            trigger('wrap_square');
            return;
          }
          if (matchKey('KeyK', 75, [], ['k', ''])) {
            // 17. Alt + Shift + K: 列表切分 (Split)
            trigger('split');
            return;
          }
          if (matchKey('KeyI', 73, [], ['i', 'ˆ', '^', 'ı'])) {
            // 7. Alt + Shift + I: 向内收缩 (Contract 别名支持)
            trigger('contract');
            return;
          }
        } else {
          // Alt / Option single key combinations:
          if (matchKey('KeyK', 75, [], ['k', '˚'])) {
            // 1. Alt + K: 向外扩选 (Expand)
            trigger('expand');
            return;
          }
          if (matchKey('KeyI', 73, [], ['i', 'ˆ', '^', 'ı'])) {
            // 7. Alt + I: 向内收缩 (Contract) - Note: Option+I is macOS circumflex dead key
            trigger('contract');
            return;
          }
          if (matchKey('KeyU', 85, [], ['u', '¨'])) {
            // 3. Alt + U: 圆括号包裹 (Wrap Parens) - Note: Option+U is macOS umlaut dead key
            trigger('wrap_parens');
            return;
          }
          if (matchKey('KeyL', 76, [], ['l', '¬'])) {
            // 5. Alt + L: 向右吞噬 (Slurp) - 右侧向右扩张
            trigger('slurp');
            return;
          }
          if (matchKey('KeyJ', 74, [], ['j', '∆'])) {
            // 6. Alt + J: 向左吐出 (Barf) - 右侧向左收缩
            trigger('barf');
            return;
          }
          if (matchKey('Digit3', 51, ['Numpad3'], ['3', '£'])) {
            // 8. Alt + 3: 选中顶级函数 (Defun)
            trigger('defun');
            return;
          }
          if (matchKey('KeyO', 79, [], ['o', 'ø'])) {
            // 9. Alt + O: 脱壳解包 (Splice)
            trigger('splice');
            return;
          }
          if (matchKey('Digit2', 50, ['Numpad2'], ['2', '™'])) {
            // 10. Alt + 2: 大步前进 (Forward)
            trigger('forward');
            return;
          }
          if (matchKey('Digit1', 49, ['Numpad1'], ['1', '¡'])) {
            // 11. Alt + 1: 大步后退 (Backward)
            trigger('backward');
            return;
          }
          if (matchKey('KeyS', 83, [], ['s', 'ß'])) {
            // 12. Alt + S: 深度钻入 (Down)
            trigger('down');
            return;
          }
          if (matchKey('KeyW', 87, [], ['w', '∑'])) {
            // 13. Alt + W: 向上跳出 (Up)
            trigger('up');
            return;
          }
          if (matchKey('KeyX', 88, ['KeyD'], ['x', 'd', '≈', '∂'])) {
            // 14. Alt + X: 向后整块删除 (Kill Sexp, 兼容 Alt+D)
            trigger('kill_sexp');
            return;
          }
          if (matchKey('Backslash', 220, ['KeyF'], ['\\', 'f', '«', 'ƒ'])) {
            // 15. Alt + \: 智能格式排版 (Indent, 兼容 Alt+F)
            trigger('indent');
            return;
          }
          if (matchKey('KeyH', 72, [], ['h', '˙'])) {
            // 16. Alt + H: 相邻参数对调 (Transpose)
            trigger('transpose');
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

      // Suppress macOS dead-key composition & beforeinput right after an Alt shortcut
      const handleCompositionStart = (e: CompositionEvent) => {
        if (Date.now() - lastAltActionTime < 350) {
          e.preventDefault();
          e.stopPropagation();
        }
      };

      const handleBeforeInput = (e: InputEvent) => {
        if (Date.now() - lastAltActionTime < 350) {
          e.preventDefault();
          e.stopPropagation();
        }
      };

      window.addEventListener('keydown', handleGlobalKeydown, true);
      window.addEventListener('keyup', handleGlobalKeyup, true);
      window.addEventListener('compositionstart', handleCompositionStart as EventListener, true);
      window.addEventListener('beforeinput', handleBeforeInput as EventListener, true);

      // Responsive layout observer
      const resizeObserver = new ResizeObserver(() => {
        editor.layout();
      });
      resizeObserver.observe(containerRef.current);

      return () => {
        window.removeEventListener('keydown', handleGlobalKeydown, true);
        window.removeEventListener('keyup', handleGlobalKeyup, true);
        window.removeEventListener('compositionstart', handleCompositionStart as EventListener, true);
        window.removeEventListener('beforeinput', handleBeforeInput as EventListener, true);
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
