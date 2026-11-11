import React, { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import {
  registerMonacoScheme,
  SCHEME_LANGUAGE_ID,
  TOKYO_NIGHT_THEME_ID,
  isSchemeFile,
  getLanguageForPath,
} from '../lib/monacoScheme';
import {
  applyParinfer,
  isParinferLocked,
  withParinferLock,
} from '../lib/parinferService';
import { handleStrictKeyDown } from '../lib/strictPareditGuard';
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
  layout: () => void;
}

interface MonacoEditorProps {
  initialCode: string;
  filePath?: string;
  parinferMode: ParinferMode;
  strictParedit?: boolean;
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
  onSendToRepl?: (code: string) => void;
  onSave?: () => void;
}

export const MonacoEditor = forwardRef<MonacoEditorHandle, MonacoEditorProps>(
  (
    {
      initialCode,
      filePath,
      parinferMode,
      strictParedit = true,
      onCodeChange,
      onShortcutTriggered,
      onEvalResult,
      onSendToRepl,
      onSave,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const modelsMapRef = useRef<Map<string, monaco.editor.ITextModel>>(new Map());
    const viewStatesMapRef = useRef<Map<string, monaco.editor.ICodeEditorViewState | null>>(new Map());
    const previousFilePathRef = useRef<string | undefined>(undefined);

    const filePathRef = useRef<string | undefined>(filePath);
    filePathRef.current = filePath;

    const parinferModeRef = useRef<ParinferMode>(parinferMode);
    parinferModeRef.current = parinferMode;

    const strictPareditRef = useRef<boolean>(strictParedit);
    strictPareditRef.current = strictParedit;

    const onCodeChangeRef = useRef(onCodeChange);
    onCodeChangeRef.current = onCodeChange;

    const onShortcutTriggeredRef = useRef(onShortcutTriggered);
    onShortcutTriggeredRef.current = onShortcutTriggered;

    const onEvalResultRef = useRef(onEvalResult);
    onEvalResultRef.current = onEvalResult;

    const onSendToReplRef = useRef(onSendToRepl);
    onSendToReplRef.current = onSendToRepl;

    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;

    // Helper to execute shortcut and notify HUD / REPL
    const executeAction = useCallback(
      async (id: ShortcutId) => {
        const editor = editorRef.current;
        if (!editor) return;

        // Strict Paredit and REPL evaluation only apply to Scheme files!
        if (!isSchemeFile(filePathRef.current)) {
          return;
        }

        const res = await dispatchShortcut(
          id,
          editor,
          (evalData) => {
            onEvalResultRef.current?.(evalData);
          },
          (code) => {
            onSendToReplRef.current?.(code);
          }
        );

        // Keep editor focus at current cursor position after evaluation
        if (id === 'eval_repl') {
          editor.focus();
        }

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
      layout: () => {
        editorRef.current?.layout();
      },
    }));

    // Switch model and preserve view state when filePath changes
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || !filePath) return;

      const langId = getLanguageForPath(filePath);
      let model = modelsMapRef.current.get(filePath);

      if (!model || model.isDisposed()) {
        const uri = monaco.Uri.parse(`inmemory://workspace/${encodeURIComponent(filePath)}`);
        model = monaco.editor.getModel(uri) || monaco.editor.createModel(initialCode, langId, uri);
        modelsMapRef.current.set(filePath, model);
      } else {
        if (model.getLanguageId() !== langId) {
          monaco.editor.setModelLanguage(model, langId);
        }
      }

      if (editor.getModel() !== model) {
        // Save view state of previous file before switching
        if (previousFilePathRef.current && editor.getModel()) {
          viewStatesMapRef.current.set(
            previousFilePathRef.current,
            editor.saveViewState()
          );
        }
        previousFilePathRef.current = filePath;
        editor.setModel(model);

        // Restore view state if previously saved
        const savedViewState = viewStatesMapRef.current.get(filePath);
        if (savedViewState) {
          editor.restoreViewState(savedViewState);
        }
      }
    }, [filePath]);

    // Initialize Monaco instance once on mount
    useEffect(() => {
      if (!containerRef.current) return;

      let initialModel: monaco.editor.ITextModel | null = null;
      if (filePath) {
        const langId = getLanguageForPath(filePath);
        const uri = monaco.Uri.parse(`inmemory://workspace/${encodeURIComponent(filePath)}`);
        initialModel = monaco.editor.getModel(uri) || monaco.editor.createModel(initialCode, langId, uri);
        modelsMapRef.current.set(filePath, initialModel);
        previousFilePathRef.current = filePath;
      }

      const initialLang = getLanguageForPath(filePath);
      const editor = monaco.editor.create(containerRef.current, {
        model: initialModel || monaco.editor.createModel(initialCode, initialLang),
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

      // Strict Paredit key guard (intercept Backspace, Delete, Close parens, Auto-pairing)
      editor.onKeyDown((e: monaco.IKeyboardEvent) => {
        const currentPath = filePathRef.current;
        if (!isSchemeFile(currentPath)) return;

        handleStrictKeyDown(
          e,
          editor,
          strictPareditRef.current,
          (newCode) => {
            onCodeChangeRef.current?.(newCode);
          }
        );
      });

      // Handle Parinfer on content change & auto-strip macOS dead-key character leaks
      editor.onDidChangeModelContent((e) => {
        const currentPath = filePathRef.current;
        const isScheme = isSchemeFile(currentPath);

        // If NOT a Scheme file, skip all Scheme-specific behaviors (dead keys, parinfer)
        if (!isScheme) {
          const text = editor.getValue();
          onCodeChangeRef.current?.(text);
          return;
        }

        // Auto-revert and intercept stray macOS dead-key characters ('ˆ' - unicode dead circumflex)
        for (const change of e.changes) {
          if (change.text === 'ˆ') {
            setTimeout(() => {
              const model = editor.getModel();
              if (model) {
                withParinferLock(() => {
                  editor.executeEdits('revertDeadCircumflex', [
                    {
                      range: new monaco.Range(
                        change.range.startLineNumber,
                        change.range.startColumn,
                        change.range.startLineNumber,
                        change.range.startColumn + change.text.length
                      ),
                      text: '',
                    },
                  ]);
                });
                executeAction('contract');
              }
            }, 0);
            return;
          }
          if (change.text === '¨') {
            setTimeout(() => {
              const model = editor.getModel();
              if (model) {
                withParinferLock(() => {
                  editor.executeEdits('revertDeadUmlaut', [
                    {
                      range: new monaco.Range(
                        change.range.startLineNumber,
                        change.range.startColumn,
                        change.range.startLineNumber,
                        change.range.startColumn + change.text.length
                      ),
                      text: '',
                    },
                  ]);
                });
                executeAction('wrap_parens');
              }
            }, 0);
            return;
          }
        }

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
       * (Only active when active model language is 'scheme')
       * --------------------------------------------------------------------- */

      const addSchemeAction = (
        id: string,
        label: string,
        keybindings: number[],
        shortcutId: ShortcutId
      ) => {
        editor.addAction({
          id,
          label,
          keybindings,
          precondition: 'editorLangId == scheme',
          run: () => executeAction(shortcutId),
        });
      };

      // 1. Alt + K : 向外扩选 (Expand)
      addSchemeAction(
        'scheme.action.expand',
        'Strict Paredit: Expand',
        [monaco.KeyMod.Alt | monaco.KeyCode.KeyK],
        'expand'
      );

      // 2. Alt + Enter / Ctrl + Enter : 发射求值 (Eval REPL)
      addSchemeAction(
        'scheme.action.eval_repl',
        'Strict Paredit: Eval REPL',
        [
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
          monaco.KeyMod.Alt | monaco.KeyCode.Enter,
        ],
        'eval_repl'
      );

      // Ctrl + S / Cmd + S : Save file immediately for ALL files
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        () => {
          onSaveRef.current?.();
        }
      );

      // 3. Alt + H : 圆括号包裹 (Wrap Parens, 兼顾 Alt+U/P)
      addSchemeAction(
        'scheme.action.wrap_parens',
        'Strict Paredit: Wrap Parens',
        [
          monaco.KeyMod.Alt | monaco.KeyCode.KeyH,
          monaco.KeyMod.Alt | monaco.KeyCode.KeyU,
          monaco.KeyMod.Alt | monaco.KeyCode.KeyP,
        ],
        'wrap_parens'
      );

      // 4. Alt + Shift + H : 方括号包裹 (Wrap Square, 兼顾 Alt+Shift+U/P)
      addSchemeAction(
        'scheme.action.wrap_square',
        'Strict Paredit: Wrap Square',
        [
          monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyH,
          monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyU,
          monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyP,
        ],
        'wrap_square'
      );

      // 5. Alt + L : 向右吞噬 (Slurp - 右侧向右扩张)
      addSchemeAction(
        'scheme.action.slurp',
        'Strict Paredit: Slurp',
        [monaco.KeyMod.Alt | monaco.KeyCode.KeyL],
        'slurp'
      );

      // 6. Alt + J : 向左吐出 (Barf - 右侧向左收缩)
      addSchemeAction(
        'scheme.action.barf',
        'Strict Paredit: Barf',
        [monaco.KeyMod.Alt | monaco.KeyCode.KeyJ],
        'barf'
      );

      // 7. Alt + Shift + K : 向内收缩 (Contract - 方案 A 核心，兼容 Alt+I)
      addSchemeAction(
        'scheme.action.contract',
        'Strict Paredit: Contract',
        [
          monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyK,
          monaco.KeyMod.Alt | monaco.KeyCode.KeyI,
          monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyI,
        ],
        'contract'
      );

      // 8. Alt + 3 : 选中顶级函数 (Defun)
      addSchemeAction(
        'scheme.action.defun',
        'Strict Paredit: Select Top-Level Defun',
        [monaco.KeyMod.Alt | monaco.KeyCode.Digit3],
        'defun'
      );

      // 9. Alt + O : 脱壳解包 (Splice)
      addSchemeAction(
        'scheme.action.splice',
        'Strict Paredit: Splice',
        [monaco.KeyMod.Alt | monaco.KeyCode.KeyO],
        'splice'
      );

      // 10. Alt + 2 : 大步前进 (Forward sexp)
      addSchemeAction(
        'scheme.action.forward',
        'Strict Paredit: Forward Sexp',
        [monaco.KeyMod.Alt | monaco.KeyCode.Digit2],
        'forward'
      );

      // 11. Alt + 1 : 大步后退 (Backward sexp)
      addSchemeAction(
        'scheme.action.backward',
        'Strict Paredit: Backward Sexp',
        [monaco.KeyMod.Alt | monaco.KeyCode.Digit1],
        'backward'
      );

      // 12. Alt + W : 步进深入 (Step Into)
      addSchemeAction(
        'scheme.action.down',
        'Strict Paredit: Step Into',
        [monaco.KeyMod.Alt | monaco.KeyCode.KeyW],
        'down'
      );

      // 13. Alt + S : 步退跳出 (Step Out)
      addSchemeAction(
        'scheme.action.up',
        'Strict Paredit: Step Out',
        [monaco.KeyMod.Alt | monaco.KeyCode.KeyS],
        'up'
      );

      // 14. Alt + X : 向后整块删除 (Kill sexp, 避开 Chrome 地址栏抢焦)
      addSchemeAction(
        'scheme.action.kill_sexp',
        'Strict Paredit: Kill Sexp',
        [
          monaco.KeyMod.Alt | monaco.KeyCode.KeyX,
          monaco.KeyMod.Alt | monaco.KeyCode.KeyD,
        ],
        'kill_sexp'
      );

      // 15. Alt + \ / Alt + F / Shift + Alt + F : 智能格式排版 (Indent, 避开 Chrome 菜单抢焦)
      addSchemeAction(
        'scheme.action.indent',
        'Strict Paredit: Indent Sexp',
        [
          monaco.KeyMod.Alt | monaco.KeyCode.Backslash,
          monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
          monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
        ],
        'indent'
      );

      // 16. Alt + Shift + L : 相邻参数对调 (Transpose)
      addSchemeAction(
        'scheme.action.transpose',
        'Strict Paredit: Transpose',
        [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyL],
        'transpose'
      );

      // 17. Alt + Shift + J : 列表切分 (Split)
      addSchemeAction(
        'scheme.action.split',
        'Strict Paredit: Split Sexp',
        [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyJ],
        'split'
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

        // IMPORTANT: Strict Paredit shortcuts only apply to Scheme files!
        if (!isSchemeFile(filePathRef.current)) {
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
          if (
            matchKey('KeyH', 72, [], ['h', 'ó', 'Ó']) ||
            matchKey('KeyU', 85, [], ['u', '¨']) ||
            matchKey('KeyP', 80, [], ['p', 'π', '∏'])
          ) {
            // 4. Alt + Shift + H: 方括号包裹 (Wrap Square, 零死键)
            trigger('wrap_square');
            return;
          }
          if (matchKey('KeyL', 76, [], ['l', 'ò', 'Ò'])) {
            // 16. Alt + Shift + L: 相邻参数对调 (Transpose, Leap swap)
            trigger('transpose');
            return;
          }
          if (matchKey('KeyK', 75, [], ['k', ''])) {
            // 7. Alt + Shift + K: 向内收缩 (Contract - 方案 A 核心键位，彻底免疫 Mac 死键)
            trigger('contract');
            return;
          }
          if (matchKey('KeyJ', 74, [], ['j', 'ô', 'Ô'])) {
            // 17. Alt + Shift + J: 列表切分 (Split - Joint cut)
            trigger('split');
            return;
          }
          if (matchKey('KeyI', 73, [], ['i', 'ˆ', '^', 'ı'])) {
            // 7. Alt + Shift + I: 向内收缩 (Contract 别名支持)
            trigger('contract');
            return;
          }
          if (matchKey('KeyF', 70, [], ['f', 'ƒ'])) {
            // 15. Shift + Alt + F: 智能格式排版 (Indent, VS Code 通用快捷键)
            trigger('indent');
            return;
          }
        } else {
          // Alt / Option single key combinations:
          if (
            matchKey('KeyH', 72, [], ['h', '˙']) ||
            matchKey('KeyU', 85, [], ['u', '¨']) ||
            matchKey('KeyP', 80, [], ['p', 'π'])
          ) {
            // 3. Alt + H: 圆括号包裹 (Wrap Parens, Hold/Hug 零死键)
            trigger('wrap_parens');
            return;
          }
          if (matchKey('KeyK', 75, [], ['k', '˚'])) {
            // 1. Alt + K: 向外扩选 (Expand)
            trigger('expand');
            return;
          }
          if (matchKey('KeyI', 73, [], ['i', 'ˆ', '^', 'ı'])) {
            // 7. Alt + I: 向内收缩 (Contract - 兼容别名)
            trigger('contract');
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
          if (matchKey('KeyW', 87, [], ['w', '∑'])) {
            // 12. Alt + W: 步进深入 (Step Into)
            trigger('down');
            return;
          }
          if (matchKey('KeyS', 83, [], ['s', 'ß'])) {
            // 13. Alt + S: 步退跳出 (Step Out)
            trigger('up');
            return;
          }
          if (matchKey('KeyX', 88, ['KeyD'], ['x', 'd', '≈', '∂'])) {
            // 14. Alt + X: 向后整块删除 (Kill Sexp, 兼容 Alt+D)
            trigger('kill_sexp');
            return;
          }
          if (
            matchKey('Backslash', 220, ['KeyF', 'IntlBackslash'], ['\\', '|', 'f', '«', 'ƒ'])
          ) {
            // 15. Alt + \: 智能格式排版 (Indent, 兼容 Alt+F, 兼容各键盘 Backslash)
            trigger('indent');
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

      // Suppress macOS dead-key composition & beforeinput right after an Alt shortcut (Scheme files only)
      const handleCompositionStart = (e: CompositionEvent) => {
        if (!isSchemeFile(filePathRef.current)) return;
        if (Date.now() - lastAltActionTime < 350) {
          e.preventDefault();
          e.stopPropagation();
        }
      };

      const handleBeforeInput = (e: InputEvent) => {
        if (!isSchemeFile(filePathRef.current)) return;
        const inputData = (e as any).data;
        if (
          inputData === 'ˆ' ||
          inputData === '¨' ||
          Date.now() - lastAltActionTime < 500
        ) {
          e.preventDefault();
          e.stopPropagation();
          if (inputData === 'ˆ') {
            lastAltActionTime = Date.now();
            executeAction('contract');
          } else if (inputData === '¨') {
            lastAltActionTime = Date.now();
            executeAction('wrap_parens');
          }
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
    }, []); // Mount once: do not recreate or dispose editor when content changes!

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
