import * as monaco from 'monaco-editor';
import paredit from 'paredit.js';
import parinfer from 'parinfer';
import { withParinferLock } from './parinferService';
import { ShortcutId } from '../types';

export interface SexpNode {
  start: number;
  end: number;
  type: 'list' | 'atom' | 'string' | 'comment';
  openChar?: string;
  closeChar?: string;
  children?: SexpNode[];
}

/**
 * Selection history stack for Contract Selection (Alt + Shift + K)
 */
const selectionHistoryStack: monaco.Selection[] = [];

export function getSelectionHistoryLength(): number {
  return selectionHistoryStack.length;
}

export function clearSelectionHistory(): void {
  selectionHistoryStack.length = 0;
}

/**
 * Parse Scheme / Lisp S-expressions into structured tree
 */
export function parseSexpressions(text: string): SexpNode[] {
  const stack: { node: SexpNode; children: SexpNode[] }[] = [];
  const roots: SexpNode[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Comment: ;.*$
    if (ch === ';') {
      const start = i;
      while (i < len && text[i] !== '\n') {
        i++;
      }
      const node: SexpNode = { start, end: i, type: 'comment' };
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      } else {
        roots.push(node);
      }
      continue;
    }

    // Character literal: #\space, #\a, etc.
    if (ch === '#' && i + 1 < len && text[i + 1] === '\\') {
      const start = i;
      i += 2;
      while (i < len && !/[\s()[\]{}";]/.test(text[i])) {
        i++;
      }
      const node: SexpNode = { start, end: i, type: 'atom' };
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      } else {
        roots.push(node);
      }
      continue;
    }

    // String literal: "([^"\\]|\\.)*"
    if (ch === '"') {
      const start = i++;
      while (i < len) {
        if (text[i] === '\\' && i + 1 < len) {
          i += 2;
        } else if (text[i] === '"') {
          i++;
          break;
        } else {
          i++;
        }
      }
      const node: SexpNode = { start, end: i, type: 'string' };
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      } else {
        roots.push(node);
      }
      continue;
    }

    // Open list: (, [, {
    if (ch === '(' || ch === '[' || ch === '{') {
      const node: SexpNode = {
        start: i,
        end: i + 1,
        type: 'list',
        openChar: ch,
        closeChar: ch === '(' ? ')' : ch === '[' ? ']' : '}',
        children: [],
      };
      stack.push({ node, children: [] });
      i++;
      continue;
    }

    // Close list: ), ], }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.length > 0) {
        const top = stack.pop()!;
        top.node.end = i + 1;
        top.node.children = top.children;
        if (stack.length > 0) {
          stack[stack.length - 1].children.push(top.node);
        } else {
          roots.push(top.node);
        }
      }
      i++;
      continue;
    }

    // Atom: identifier, number, symbol
    const start = i;
    while (i < len && !/[\s()[\]{}";]/.test(text[i])) {
      i++;
    }
    const node: SexpNode = { start, end: i, type: 'atom' };
    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Gracefully close any unclosed items
  while (stack.length > 0) {
    const top = stack.pop()!;
    top.node.end = len;
    top.node.children = top.children;
    if (stack.length > 0) {
      stack[stack.length - 1].children.push(top.node);
    } else {
      roots.push(top.node);
    }
  }

  return roots;
}

export function findEnclosingWithParent(
  roots: SexpNode[],
  pos: number
): { enclosing: SexpNode | null; parent: SexpNode | null } {
  let enclosing: SexpNode | null = null;
  let parent: SexpNode | null = null;

  function traverse(nodes: SexpNode[], currentParent: SexpNode | null) {
    for (const node of nodes) {
      if (node.type === 'list' && pos > node.start && pos < node.end) {
        enclosing = node;
        parent = currentParent;
        if (node.children) {
          traverse(node.children, node);
        }
      }
    }
  }

  traverse(roots, null);
  return { enclosing, parent };
}

export function findInnermostNodeAt(roots: SexpNode[], pos: number): SexpNode | null {
  let found: SexpNode | null = null;

  function traverse(nodes: SexpNode[]) {
    for (const node of nodes) {
      if (pos >= node.start && pos <= node.end) {
        found = node;
        if (node.children) {
          traverse(node.children);
        }
      }
    }
  }

  traverse(roots);
  return found;
}

export function findTopLevelNode(roots: SexpNode[], pos: number): SexpNode | null {
  for (const node of roots) {
    if (pos >= node.start && pos <= node.end) {
      return node;
    }
  }
  return null;
}

export interface PareditEditResult {
  changes: Array<['insert', number, string] | ['remove', number, number]>;
  newIndex: number;
}

/**
 * Apply paredit.js EditResult to Monaco Editor
 */
export function applyPareditResult(
  editor: monaco.editor.IStandaloneCodeEditor,
  res: PareditEditResult | null
): boolean {
  if (!res || !res.changes || res.changes.length === 0) return false;
  const model = editor.getModel();
  if (!model) return false;

  // Sort changes by offset descending so modifications don't alter earlier offsets
  const sorted = [...res.changes].sort((a, b) => b[1] - a[1]);

  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = sorted.map((ch) => {
    const type = ch[0];
    const offset = ch[1];
    if (type === 'insert') {
      const text = ch[2] as string;
      const pos = model.getPositionAt(offset);
      return {
        range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
        text,
      };
    } else {
      const length = ch[2] as number;
      const p1 = model.getPositionAt(offset);
      const p2 = model.getPositionAt(offset + length);
      return {
        range: new monaco.Range(p1.lineNumber, p1.column, p2.lineNumber, p2.column),
        text: '',
      };
    }
  });

  withParinferLock(() => {
    editor.pushUndoStop();
    editor.executeEdits('paredit', edits);
    if (typeof res.newIndex === 'number' && !isNaN(res.newIndex)) {
      const newPos = model.getPositionAt(res.newIndex);
      editor.setPosition(newPos);
      editor.revealPosition(newPos);
    }
    editor.pushUndoStop();
  });

  return true;
}

/* =============================================================================
 * 17 STRICT PAREDIT SHORTCUT IMPLEMENTATIONS
 * ============================================================================= */

/**
 * 1. Alt + Shift + I : 向外扩选 (Expand)
 */
export function expandSelection(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const currentSelection = editor.getSelection();
  if (!currentSelection) return { success: false, detail: 'No selection' };

  const text = model.getValue();
  let from: number;
  let to: number;

  if (!currentSelection.isEmpty()) {
    const s = model.getOffsetAt({
      lineNumber: currentSelection.startLineNumber,
      column: currentSelection.startColumn,
    });
    const e = model.getOffsetAt({
      lineNumber: currentSelection.endLineNumber,
      column: currentSelection.endColumn,
    });
    from = Math.min(s, e);
    to = Math.max(s, e);
  } else {
    from = model.getOffsetAt(editor.getPosition()!);
    to = from;
  }

  // Save cloned current selection for Contract (Alt + Shift + K / Alt + I)
  selectionHistoryStack.push(
    new monaco.Selection(
      currentSelection.selectionStartLineNumber,
      currentSelection.selectionStartColumn,
      currentSelection.positionLineNumber,
      currentSelection.positionColumn
    )
  );

  // 1. Try paredit.js sexpRangeExpansion
  try {
    const ast = paredit.parse(text);
    const range = paredit.navigator.sexpRangeExpansion(ast, from, to);
    if (range && (range[0] < from || range[1] > to)) {
      const pStart = model.getPositionAt(range[0]);
      const pEnd = model.getPositionAt(range[1]);
      editor.setSelection(
        new monaco.Selection(pStart.lineNumber, pStart.column, pEnd.lineNumber, pEnd.column)
      );
      editor.revealRange(
        new monaco.Range(pStart.lineNumber, pStart.column, pEnd.lineNumber, pEnd.column)
      );
      return { success: true, detail: `Expanded to [${range[0]}, ${range[1]}]` };
    }
  } catch {}

  // 2. Fallback AST search
  const roots = parseSexpressions(text);
  let candidate: any = null;

  function check(nodes: SexpNode[]) {
    for (const node of nodes) {
      if (node.start <= from && node.end >= to && (node.start < from || node.end > to)) {
        if (!candidate || node.end - node.start < candidate.end - candidate.start) {
          candidate = node;
        }
      }
      if (node.children) check(node.children);
    }
  }

  check(roots);

  if (candidate) {
    const pStart = model.getPositionAt(candidate.start);
    const pEnd = model.getPositionAt(candidate.end);
    editor.setSelection(
      new monaco.Selection(pStart.lineNumber, pStart.column, pEnd.lineNumber, pEnd.column)
    );
    editor.revealRange(
      new monaco.Range(pStart.lineNumber, pStart.column, pEnd.lineNumber, pEnd.column)
    );
    return { success: true, detail: `Expanded to node [${candidate.start}, ${candidate.end}]` };
  }

  return { success: false, detail: 'Already at top boundary' };
}

/**
 * 2. Ctrl + Enter : 发射求值 (Eval REPL)
 */
export async function evalRepl(
  editor: monaco.editor.IStandaloneCodeEditor,
  onEvalResult?: (data: { code: string; result?: string; stdout?: string; stderr?: string; error?: string; duration_ms: number; success: boolean }) => void,
  onSendToRepl?: (code: string) => void
): Promise<{ success: boolean; detail?: string }> {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const selection = editor.getSelection();
  let code = '';
  let highlightRange: monaco.Range | null = null;

  if (selection && !selection.isEmpty()) {
    code = model.getValueInRange(selection);
    highlightRange = selection;
  } else {
    const position = editor.getPosition();
    if (!position) return { success: false, detail: 'No cursor' };

    const offset = model.getOffsetAt(position);
    const text = model.getValue();
    const roots = parseSexpressions(text);

    // Look for node ending at cursor or enclosing node
    function searchEnd(nodes: SexpNode[]): SexpNode | null {
      for (const n of nodes) {
        if (n.end === offset) return n;
        if (n.children) {
          const inner = searchEnd(n.children);
          if (inner) return inner;
        }
      }
      return null;
    }

    const endMatch = searchEnd(roots);
    const { enclosing } = findEnclosingWithParent(roots, offset);
    const innerNode = findInnermostNodeAt(roots, offset);
    const target = endMatch || enclosing || innerNode;

    if (target) {
      code = text.slice(target.start, target.end);
      const pStart = model.getPositionAt(target.start);
      const pEnd = model.getPositionAt(target.end);
      highlightRange = new monaco.Range(pStart.lineNumber, pStart.column, pEnd.lineNumber, pEnd.column);
    } else {
      const lineContent = model.getLineContent(position.lineNumber);
      code = lineContent;
      highlightRange = new monaco.Range(
        position.lineNumber,
        1,
        position.lineNumber,
        lineContent.length + 1
      );
    }
  }

  const trimmed = code.trim();
  if (!trimmed) {
    return { success: false, detail: 'Empty code' };
  }

  // Visual Flash in Monaco Editor
  if (highlightRange) {
    const collection = editor.createDecorationsCollection([
      {
        range: highlightRange,
        options: {
          isWholeLine: false,
          className: 'eval-flash',
          inlineClassName: 'eval-flash',
        },
      },
    ]);
    setTimeout(() => {
      collection.clear();
    }, 350);
  }

  // If onSendToRepl callback is provided, route directly to Terminal Tab 1 ("λ REPL")
  if (onSendToRepl) {
    onSendToRepl(trimmed);
    const preview = trimmed.length > 30 ? trimmed.slice(0, 30) + '...' : trimmed;
    return {
      success: true,
      detail: `Sent to λ REPL: ${preview}`,
    };
  }

  // Execute POST to /api/eval with code and buffer context
  const startTime = performance.now();
  try {
    const fullBuffer = model.getValue();
    const res = await fetch('/api/eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: trimmed,
        buffer: fullBuffer,
      }),
    });

    const duration = Math.round(performance.now() - startTime);

    if (res.ok) {
      const data = await res.json();
      const isSuccess = data.ok === true || data.success === true;
      onEvalResult?.({
        code: trimmed,
        result: data.result || '',
        stdout: data.stdout || '',
        stderr: data.stderr || '',
        error: isSuccess ? undefined : (data.stderr || data.error || 'Evaluation error'),
        duration_ms: data.duration_ms ?? duration,
        success: isSuccess,
      });
      return {
        success: isSuccess,
        detail: isSuccess ? `Evaluated in ${duration}ms` : (data.stderr || 'Evaluation failed'),
      };
    } else {
      const errText = await res.text();
      onEvalResult?.({
        code: trimmed,
        error: `Server HTTP ${res.status}: ${errText}`,
        duration_ms: duration,
        success: false,
      });
      return { success: false, detail: `HTTP ${res.status}` };
    }
  } catch (err: any) {
    const duration = Math.round(performance.now() - startTime);
    onEvalResult?.({
      code: trimmed,
      error: `Network/Connection Error: ${err.message || 'Cannot connect to /api/eval'}`,
      duration_ms: duration,
      success: false,
    });
    return { success: false, detail: err.message || 'Disconnected' };
  }
}

/**
 * 3. Alt + H : 圆括号包裹 (Wrap Parens)
 */
export function wrapParens(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  return wrapWith(editor, '(', ')', 'Wrap Parens');
}

/**
 * 4. Alt + Shift + H : 方括号包裹 (Wrap Square)
 */
export function wrapSquare(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  return wrapWith(editor, '[', ']', 'Wrap Square');
}

/**
 * Calva-style smart affinity calculation for wrapping forms:
 * 1. Touching end of sibling form (left affinity): define| x -> wraps define -> (define|) x
 * 2. Inside sibling form: def|ine -> (def|ine)
 * 3. Touching start of sibling form: |define -> (|define)
 * 4. In whitespace before forward sibling: define | x -> define (|x)
 * 5. Empty / whitespace with no siblings: | -> (|)
 */
export function computeSmartWrap(
  text: string,
  pos: number,
  openChar: string = '(',
  closeChar: string = ')'
): {
  target: SexpNode | null;
  cursorType: 'end' | 'inside' | 'start' | 'forward' | 'empty';
  rangeStart: number;
  rangeEnd: number;
  replacementText: string;
  newOffset: number;
} {
  const roots = parseSexpressions(text);
  const { enclosing } = findEnclosingWithParent(roots, pos);
  const siblings = (enclosing ? (enclosing.children || []) : roots)
    .filter(n => n.type !== 'comment');

  let target: SexpNode | null = null;
  let cursorType: 'end' | 'inside' | 'start' | 'forward' | 'empty' = 'start';

  // 1. Touching end of sibling form (left affinity)
  const touchingEnd = siblings.find(
    s => s.end === pos && pos > 0 && !/\s/.test(text[pos - 1])
  );
  if (touchingEnd) {
    target = touchingEnd;
    cursorType = 'end';
  }

  // 2. Inside a sibling form
  if (!target) {
    const inside = siblings.find(s => s.start < pos && pos < s.end);
    if (inside) {
      target = inside;
      cursorType = 'inside';
    }
  }

  // 3. Touching start of sibling form
  if (!target) {
    const touchingStart = siblings.find(s => s.start === pos);
    if (touchingStart) {
      target = touchingStart;
      cursorType = 'start';
    }
  }

  // 4. Forward sibling in whitespace
  if (!target) {
    const forward = siblings.find(s => s.start > pos);
    if (forward) {
      target = forward;
      cursorType = 'forward';
    }
  }

  if (target) {
    const targetText = text.slice(target.start, target.end);
    let newOffset: number;
    if (cursorType === 'end') {
      newOffset = target.end + openChar.length;
    } else if (cursorType === 'inside') {
      newOffset = pos + openChar.length;
    } else {
      newOffset = target.start + openChar.length;
    }
    return {
      target,
      cursorType,
      rangeStart: target.start,
      rangeEnd: target.end,
      replacementText: `${openChar}${targetText}${closeChar}`,
      newOffset,
    };
  } else {
    return {
      target: null,
      cursorType: 'empty',
      rangeStart: pos,
      rangeEnd: pos,
      replacementText: `${openChar}${closeChar}`,
      newOffset: pos + openChar.length,
    };
  }
}

function wrapWith(
  editor: monaco.editor.IStandaloneCodeEditor,
  openChar: string,
  closeChar: string,
  actionName: string
): { success: boolean; detail?: string } {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const selection = editor.getSelection();
  const text = model.getValue();

  if (selection && !selection.isEmpty()) {
    const selectedText = model.getValueInRange(selection);
    withParinferLock(() => {
      editor.pushUndoStop();
      editor.executeEdits('paredit', [
        {
          range: selection,
          text: `${openChar}${selectedText}${closeChar}`,
        },
      ]);
      editor.pushUndoStop();
    });
    return { success: true, detail: `${actionName}: selection wrapped` };
  }

  const pos = model.getOffsetAt(editor.getPosition()!);
  const wrap = computeSmartWrap(text, pos, openChar, closeChar);

  const pStart = model.getPositionAt(wrap.rangeStart);
  const pEnd = model.getPositionAt(wrap.rangeEnd);
  const range = new monaco.Range(pStart.lineNumber, pStart.column, pEnd.lineNumber, pEnd.column);

  withParinferLock(() => {
    editor.pushUndoStop();
    editor.executeEdits('paredit', [
      {
        range,
        text: wrap.replacementText,
      },
    ]);
    const newPos = model.getPositionAt(wrap.newOffset);
    editor.setPosition(newPos);
    editor.revealPosition(newPos);
    editor.pushUndoStop();
  });

  return {
    success: true,
    detail: `${actionName}: ${wrap.target ? 'form wrapped with Calva smart affinity' : 'empty pair inserted'}`,
  };
}

/**
 * 5. Alt + Shift + H : 向右吞噬 (Slurp)
 */
export function slurpForward(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const pos = model.getOffsetAt(editor.getPosition()!);
  const text = model.getValue();

  // 1. Try paredit.js slurpSexp
  try {
    const ast = paredit.parse(text);
    const res = paredit.editor.slurpSexp(ast, text, pos, { backward: false, count: 1 });
    if (res && applyPareditResult(editor, res)) {
      return { success: true, detail: 'Slurped next sexp' };
    }
  } catch {}

  // 2. Fallback AST
  const roots = parseSexpressions(text);
  const { enclosing, parent } = findEnclosingWithParent(roots, pos);
  if (!enclosing) return { success: false, detail: 'No enclosing list' };

  const siblings = parent ? parent.children || [] : roots;
  const idx = siblings.findIndex(
    (s) => s.start === enclosing.start && s.end === enclosing.end
  );

  if (idx === -1 || idx >= siblings.length - 1) {
    return { success: false, detail: 'No next sibling to slurp' };
  }

  const nextSibling = siblings[idx + 1];
  const closeChar = enclosing.closeChar || ')';
  const closePos = enclosing.end - 1;

  const between = text.slice(enclosing.end, nextSibling.start);
  const needSpace = between.trim().length === 0 && enclosing.end === nextSibling.start;

  const p1Start = model.getPositionAt(closePos);
  const p1End = model.getPositionAt(enclosing.end);
  const p2 = model.getPositionAt(nextSibling.end);

  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [
    {
      range: new monaco.Range(p2.lineNumber, p2.column, p2.lineNumber, p2.column),
      text: closeChar,
    },
    {
      range: new monaco.Range(p1Start.lineNumber, p1Start.column, p1End.lineNumber, p1End.column),
      text: needSpace ? ' ' : '',
    },
  ];

  withParinferLock(() => {
    editor.pushUndoStop();
    editor.executeEdits('paredit', edits);
    editor.pushUndoStop();
  });

  return { success: true, detail: 'Slurped next sibling forward' };
}

/**
 * 6. Alt + Shift + J : 向左吐出 (Barf)
 */
export function barfForward(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const pos = model.getOffsetAt(editor.getPosition()!);
  const text = model.getValue();

  // 1. Try paredit.js barfSexp
  try {
    const ast = paredit.parse(text);
    const res = paredit.editor.barfSexp(ast, text, pos, { backward: false, count: 1 });
    if (res && applyPareditResult(editor, res)) {
      return { success: true, detail: 'Barfed last sexp' };
    }
  } catch {}

  // 2. Fallback AST
  const roots = parseSexpressions(text);
  const { enclosing } = findEnclosingWithParent(roots, pos);

  if (!enclosing || !enclosing.children || enclosing.children.length === 0) {
    return { success: false, detail: 'No children to barf' };
  }

  const lastChild = enclosing.children[enclosing.children.length - 1];
  const closeChar = enclosing.closeChar || ')';

  let insertOffset: number;
  let insertText = closeChar;

  if (enclosing.children.length > 1) {
    const prevChild = enclosing.children[enclosing.children.length - 2];
    insertOffset = prevChild.end;
    if (insertOffset === lastChild.start) {
      insertText = closeChar + ' ';
    }
  } else {
    insertOffset = enclosing.start + 1;
    if (insertOffset === lastChild.start) {
      insertText = closeChar + ' ';
    }
  }

  const pInsert = model.getPositionAt(insertOffset);
  const pOldStart = model.getPositionAt(enclosing.end - 1);
  const pOldEnd = model.getPositionAt(enclosing.end);

  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [
    {
      range: new monaco.Range(pOldStart.lineNumber, pOldStart.column, pOldEnd.lineNumber, pOldEnd.column),
      text: '',
    },
    {
      range: new monaco.Range(pInsert.lineNumber, pInsert.column, pInsert.lineNumber, pInsert.column),
      text: insertText,
    },
  ];

  withParinferLock(() => {
    editor.pushUndoStop();
    editor.executeEdits('paredit', edits);
    editor.pushUndoStop();
  });

  return { success: true, detail: 'Barfed last child forward' };
}

/**
 * 7. Alt + Shift + K : 向内收缩 (Contract, 兼容 Alt + I)
 */
export function contractSelection(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const currentSelection = editor.getSelection();
  if (!currentSelection) return { success: false, detail: 'No selection' };

  // 1. Try history stack first IF top of stack is strictly smaller or different from current selection
  while (selectionHistoryStack.length > 0) {
    const prev = selectionHistoryStack.pop()!;
    if (
      prev.selectionStartLineNumber !== currentSelection.selectionStartLineNumber ||
      prev.selectionStartColumn !== currentSelection.selectionStartColumn ||
      prev.positionLineNumber !== currentSelection.positionLineNumber ||
      prev.positionColumn !== currentSelection.positionColumn
    ) {
      editor.setSelection(prev);
      editor.revealRange(prev);
      return { success: true, detail: `Restored selection from stack (${selectionHistoryStack.length} remaining)` };
    }
  }

  // 2. Fallback AST-based contraction around cursor!
  const text = model.getValue();
  let ast: any;
  try {
    ast = paredit.parse(text);
  } catch {
    return { success: false, detail: 'AST parse error' };
  }

  let from: number;
  let to: number;
  const cursorOffset = model.getOffsetAt(editor.getPosition() || { lineNumber: 1, column: 1 });

  if (!currentSelection.isEmpty()) {
    const s = model.getOffsetAt({
      lineNumber: currentSelection.startLineNumber,
      column: currentSelection.startColumn,
    });
    const e = model.getOffsetAt({
      lineNumber: currentSelection.endLineNumber,
      column: currentSelection.endColumn,
    });
    from = Math.min(s, e);
    to = Math.max(s, e);
  } else {
    // If no selection, contract from the enclosing S-expression
    const enclosing = paredit.navigator.sexpRange(ast, cursorOffset);
    if (enclosing && (enclosing[0] < cursorOffset || enclosing[1] > cursorOffset)) {
      from = enclosing[0];
      to = enclosing[1];
    } else {
      return { success: false, detail: 'Already at innermost cursor position' };
    }
  }

  // Find the best child node inside [from, to] containing cursorOffset
  let best: any = null;

  function walk(node: any) {
    if (!node) return;
    if (node.children) {
      for (const child of node.children) {
        if (child.start >= from && child.end <= to && (child.start > from || child.end < to)) {
          if (!best) {
            best = child;
          } else {
            const childContains = cursorOffset >= child.start && cursorOffset <= child.end;
            const bestContains = cursorOffset >= best.start && cursorOffset <= best.end;
            if (childContains && !bestContains) {
              best = child;
            } else if (childContains === bestContains) {
              if (child.end - child.start > best.end - best.start) {
                best = child;
              }
            }
          }
        }
        walk(child);
      }
    }
  }

  walk(ast);

  if (best) {
    const pStart = model.getPositionAt(best.start);
    const pEnd = model.getPositionAt(best.end);
    const newSel = new monaco.Selection(pStart.lineNumber, pStart.column, pEnd.lineNumber, pEnd.column);
    editor.setSelection(newSel);
    editor.revealRange(newSel);
    return { success: true, detail: `Contracted to [${best.start}, ${best.end}]` };
  }

  // If already at an atom with cursor inside it, collapse to cursor
  if (!currentSelection.isEmpty()) {
    const pos = editor.getPosition() || model.getPositionAt(from);
    editor.setSelection(new monaco.Selection(pos.lineNumber, pos.column, pos.lineNumber, pos.column));
    return { success: true, detail: 'Collapsed to cursor' };
  }

  return { success: false, detail: 'Cannot contract further' };
}

/**
 * 8. Alt + 3 : 选中顶级函数 (Defun)
 */
export function selectTopLevelDefun(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const pos = model.getOffsetAt(editor.getPosition()!);
  const text = model.getValue();

  // 1. Try paredit.js rangeForDefun
  try {
    const ast = paredit.parse(text);
    const range = paredit.navigator.rangeForDefun(ast, pos);
    if (range) {
      const pStart = model.getPositionAt(range[0]);
      const pEnd = model.getPositionAt(range[1]);
      editor.setSelection(
        new monaco.Selection(pStart.lineNumber, pStart.column, pEnd.lineNumber, pEnd.column)
      );
      editor.revealRange(
        new monaco.Range(pStart.lineNumber, pStart.column, pEnd.lineNumber, pEnd.column)
      );
      return { success: true, detail: `Selected defun [${range[0]}, ${range[1]}]` };
    }
  } catch {}

  // 2. Fallback AST
  const roots = parseSexpressions(text);
  const top = findTopLevelNode(roots, pos);

  if (top) {
    const pStart = model.getPositionAt(top.start);
    const pEnd = model.getPositionAt(top.end);
    editor.setSelection(
      new monaco.Selection(pStart.lineNumber, pStart.column, pEnd.lineNumber, pEnd.column)
    );
    editor.revealRange(
      new monaco.Range(pStart.lineNumber, pStart.column, pEnd.lineNumber, pEnd.column)
    );
    return { success: true, detail: `Selected top-level expression [${top.start}, ${top.end}]` };
  }

  return { success: false, detail: 'No top-level defun found' };
}

/**
 * 9. Alt + Shift + L : 脱壳解包 (Splice)
 */
export function splice(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const pos = model.getOffsetAt(editor.getPosition()!);
  const text = model.getValue();

  // 1. Try paredit.js spliceSexp
  try {
    const ast = paredit.parse(text);
    const res = paredit.editor.spliceSexp(ast, text, pos);
    if (res && applyPareditResult(editor, res)) {
      return { success: true, detail: 'Spliced enclosing sexp' };
    }
  } catch {}

  // 2. Fallback AST
  const roots = parseSexpressions(text);
  const { enclosing } = findEnclosingWithParent(roots, pos);

  if (!enclosing) return { success: false, detail: 'No enclosing list' };

  const innerText = text.slice(enclosing.start + 1, enclosing.end - 1);
  const pStart = model.getPositionAt(enclosing.start);
  const pEnd = model.getPositionAt(enclosing.end);
  const range = new monaco.Range(pStart.lineNumber, pStart.column, pEnd.lineNumber, pEnd.column);

  withParinferLock(() => {
    editor.pushUndoStop();
    editor.executeEdits('paredit', [
      {
        range,
        text: innerText,
      },
    ]);
    editor.pushUndoStop();
  });

  return { success: true, detail: 'Stripped outer parentheses' };
}

/**
 * 10. Alt + 2 : 大步前进 (Forward sexp)
 */
export function forwardSexp(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const pos = model.getOffsetAt(editor.getPosition()!);
  const text = model.getValue();

  // 1. Try paredit.js forwardSexp
  try {
    const ast = paredit.parse(text);
    const end = paredit.navigator.forwardSexp(ast, pos);
    if (end !== null && end !== undefined && end > pos) {
      let target = end;
      let i = end;
      while (i < text.length) {
        if (/\s/.test(text[i])) {
          i++;
          continue;
        }
        if (text[i] === ';') {
          while (i < text.length && text[i] !== '\n') {
            i++;
          }
          continue;
        }
        break;
      }
      if (i < text.length && !/[)\]}]/.test(text[i])) {
        target = i;
      }

      const p = model.getPositionAt(target);
      editor.setPosition(p);
      editor.revealPosition(p);
      return { success: true, detail: `Forward to offset ${target}` };
    }
  } catch {}

  // 2. If at or right before a closing delimiter, step past it
  if (pos < text.length && /[)\]}]/.test(text[pos])) {
    let nextPos = pos + 1;
    while (nextPos < text.length && /\s/.test(text[nextPos]) && text[nextPos] !== '\n') {
      nextPos++;
    }
    const p = model.getPositionAt(nextPos);
    editor.setPosition(p);
    editor.revealPosition(p);
    return { success: true, detail: `Stepped past delimiter to ${nextPos}` };
  }

  // 3. Fallback AST: search next sibling or step outward to enclosing end
  const roots = parseSexpressions(text);
  const { enclosing } = findEnclosingWithParent(roots, pos);
  const siblings = enclosing ? enclosing.children || [] : roots;
  const codeSiblings = siblings.filter((s) => s.type !== 'comment');
  const next = codeSiblings.find((s) => s.start > pos);

  let targetOffset: number | null = null;
  if (next) {
    targetOffset = next.start;
  } else if (enclosing && enclosing.end > pos) {
    targetOffset = enclosing.end;
  } else {
    // Look for ancestor whose end > pos
    function findAncestorEnd(nodes: SexpNode[]): number | null {
      let bestEnd: number | null = null;
      function walk(list: SexpNode[]) {
        for (const node of list) {
          if (pos >= node.start && pos <= node.end) {
            if (node.end > pos) {
              if (bestEnd === null || node.end < bestEnd) {
                bestEnd = node.end;
              }
            }
            if (node.children) walk(node.children);
          }
        }
      }
      walk(roots);
      return bestEnd;
    }
    targetOffset = findAncestorEnd(roots);
  }

  if (targetOffset !== null && targetOffset > pos) {
    const targetPos = model.getPositionAt(targetOffset);
    editor.setPosition(targetPos);
    editor.revealPosition(targetPos);
    return { success: true, detail: `Jumped forward to ${targetOffset}` };
  }

  return { success: false, detail: 'End of buffer' };
}

/**
 * 11. Alt + 1 : 大步后退 (Backward sexp)
 */
export function backwardSexp(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const pos = model.getOffsetAt(editor.getPosition()!);
  const text = model.getValue();

  // 1. Try paredit.js backwardSexp
  try {
    const ast = paredit.parse(text);
    let target = paredit.navigator.backwardSexp(ast, pos);
    if (target !== null && target !== undefined && target < pos) {
      while (target !== null && target !== undefined) {
        if (text[target] === ';') {
          const prev = paredit.navigator.backwardSexp(ast, target);
          if (prev !== null && prev !== undefined && prev < target) {
            target = prev;
            continue;
          }
        }
        break;
      }

      const p = model.getPositionAt(target);
      editor.setPosition(p);
      editor.revealPosition(p);
      return { success: true, detail: `Backward to offset ${target}` };
    }
  } catch {}

  // 2. If at or right after an opening delimiter, step before it
  if (pos > 0 && /[(\[{]/.test(text[pos - 1])) {
    const targetPos = model.getPositionAt(pos - 1);
    editor.setPosition(targetPos);
    editor.revealPosition(targetPos);
    return { success: true, detail: `Stepped before delimiter to ${pos - 1}` };
  }

  // 3. Fallback AST
  const roots = parseSexpressions(text);
  const { enclosing } = findEnclosingWithParent(roots, pos);
  const siblings = enclosing ? enclosing.children || [] : roots;
  const codeSiblings = siblings.filter((s) => s.type !== 'comment');
  const candidates = codeSiblings.filter((s) => s.start < pos);

  let targetOffset: number | null = null;
  if (candidates.length > 0) {
    const prev = candidates[candidates.length - 1];
    targetOffset = prev.start;
  } else if (enclosing && enclosing.start < pos) {
    targetOffset = enclosing.start;
  } else {
    function findAncestorStart(nodes: SexpNode[]): number | null {
      let bestStart: number | null = null;
      function walk(list: SexpNode[]) {
        for (const node of list) {
          if (pos >= node.start && pos <= node.end) {
            if (node.start < pos) {
              if (bestStart === null || node.start > bestStart) {
                bestStart = node.start;
              }
            }
            if (node.children) walk(node.children);
          }
        }
      }
      walk(roots);
      return bestStart;
    }
    targetOffset = findAncestorStart(roots);
  }

  if (targetOffset !== null && targetOffset < pos) {
    const targetPos = model.getPositionAt(targetOffset);
    editor.setPosition(targetPos);
    editor.revealPosition(targetPos);
    return { success: true, detail: `Jumped backward to ${targetOffset}` };
  }

  return { success: false, detail: 'Start of buffer' };
}

/**
 * 12. Alt + Q : 深度钻入 (Down)
 */
export function downIntoSexp(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const pos = model.getOffsetAt(editor.getPosition()!);
  const text = model.getValue();

  // 1. Try paredit.js forwardDownSexp
  try {
    const ast = paredit.parse(text);
    const target = paredit.navigator.forwardDownSexp(ast, pos);
    if (target !== null && target !== undefined && target !== pos) {
      const p = model.getPositionAt(target);
      editor.setPosition(p);
      editor.revealPosition(p);
      return { success: true, detail: `Dived down to offset ${target}` };
    }
  } catch {}

  // 2. Fallback AST
  const roots = parseSexpressions(text);
  const { enclosing } = findEnclosingWithParent(roots, pos);

  let targetOffset: number | null = null;

  if (enclosing && enclosing.children) {
    const childList =
      enclosing.children.find((c) => c.type === 'list' && c.start >= pos) ||
      enclosing.children.find((c) => c.type === 'list');
    if (childList) {
      targetOffset = childList.start + 1;
    }
  }

  if (targetOffset === null) {
    function findNextList(nodes: SexpNode[]): SexpNode | null {
      for (const n of nodes) {
        if (n.type === 'list' && n.start >= pos) {
          return n;
        }
        if (n.children) {
          const inner = findNextList(n.children);
          if (inner) return inner;
        }
      }
      return null;
    }
    const nextList = findNextList(roots);
    if (nextList) {
      targetOffset = nextList.start + 1;
    }
  }

  if (targetOffset !== null) {
    const targetPos = model.getPositionAt(targetOffset);
    editor.setPosition(targetPos);
    editor.revealPosition(targetPos);
    return { success: true, detail: `Dived into list at ${targetOffset}` };
  }

  return { success: false, detail: 'No list to dive into' };
}

/**
 * 13. Alt + W : 向上跳出 (Up)
 */
export function upOutOfSexp(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const pos = model.getOffsetAt(editor.getPosition()!);
  const text = model.getValue();

  // 1. Try paredit.js backwardUpSexp
  try {
    const ast = paredit.parse(text);
    const target = paredit.navigator.backwardUpSexp(ast, pos);
    if (target !== null && target !== undefined) {
      const p = model.getPositionAt(target);
      editor.setPosition(p);
      editor.revealPosition(p);
      return { success: true, detail: `Hopped up to offset ${target}` };
    }
  } catch {}

  // 2. Fallback AST
  const roots = parseSexpressions(text);
  const { enclosing, parent } = findEnclosingWithParent(roots, pos);

  if (!enclosing) return { success: false, detail: 'Already at root' };

  let targetOffset = enclosing.start;
  if (pos === enclosing.start && parent) {
    targetOffset = parent.start;
  }

  const targetPos = model.getPositionAt(targetOffset);
  editor.setPosition(targetPos);
  editor.revealPosition(targetPos);
  return { success: true, detail: `Hopped up to start of list at ${targetOffset}` };
}

/**
 * 14. Alt + U : 向后整块删除 (Kill sexp)
 */
export function killSexp(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const pos = model.getOffsetAt(editor.getPosition()!);
  const text = model.getValue();

  // 1. Try paredit.js killSexp
  try {
    const ast = paredit.parse(text);
    const res = paredit.editor.killSexp(ast, text, pos, { count: 1, backward: false });
    if (res && applyPareditResult(editor, res)) {
      return { success: true, detail: 'Killed forward sexp' };
    }
  } catch {}

  // 2. Fallback AST
  const roots = parseSexpressions(text);
  const { enclosing } = findEnclosingWithParent(roots, pos);
  const siblings = enclosing ? enclosing.children || [] : roots;
  const next = siblings.find((s) => s.start >= pos);

  if (next) {
    const pStart = model.getPositionAt(pos);
    const pEnd = model.getPositionAt(next.end);
    const range = new monaco.Range(pStart.lineNumber, pStart.column, pEnd.lineNumber, pEnd.column);

    withParinferLock(() => {
      editor.pushUndoStop();
      editor.executeEdits('paredit', [{ range, text: '' }]);
      editor.pushUndoStop();
    });
    return { success: true, detail: `Deleted sexp [${pos}, ${next.end}]` };
  }

  return { success: false, detail: 'Nothing to kill' };
}

/**
 * 15. Alt + \ : 智能格式排版 (Indent)
 */
export function indent(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const pos = model.getOffsetAt(editor.getPosition()!);
  const text = model.getValue();
  const selection = editor.getSelection();
  const hasSelection = selection && !selection.isEmpty();

  // 1. First try paredit.editor.indentRange
  try {
    const ast = paredit.parse(text);
    if (ast && (!ast.errors || ast.errors.length === 0)) {
      let startOffset = 0;
      let endOffset = text.length;

      if (hasSelection) {
        startOffset = model.getOffsetAt(selection.getStartPosition());
        endOffset = model.getOffsetAt(selection.getEndPosition());
      } else {
        const roots = parseSexpressions(text);
        const top = findTopLevelNode(roots, pos);
        const { enclosing } = findEnclosingWithParent(roots, pos);
        const target = top || enclosing;
        if (target) {
          startOffset = target.start;
          endOffset = target.end;
        }
      }

      // Try formatting targeted expression range first
      let res = paredit.editor.indentRange(ast, text, startOffset, endOffset);
      let newSrc = res && typeof res.src === 'string' ? res.src : text;

      // If targeted range had no changes and no selection was active, format entire document
      if (newSrc === text && !hasSelection && (startOffset !== 0 || endOffset !== text.length)) {
        res = paredit.editor.indentRange(ast, text, 0, text.length);
        if (res && typeof res.src === 'string') {
          newSrc = res.src;
        }
      }

      if (newSrc !== text) {
        const curPos = editor.getPosition();
        const range = model.getFullModelRange();
        withParinferLock(() => {
          editor.pushUndoStop();
          editor.executeEdits('paredit', [{ range, text: newSrc }]);
          editor.pushUndoStop();
          if (curPos) {
            const maxCol = model.getLineMaxColumn(curPos.lineNumber);
            editor.setPosition({
              lineNumber: curPos.lineNumber,
              column: Math.min(curPos.column, maxCol),
            });
          }
        });
        return { success: true, detail: 'Code indented cleanly' };
      }
      return { success: true, detail: 'Already properly indented' };
    }
  } catch (err) {
    console.warn('Paredit indent failed:', err);
  }

  return { success: true, detail: 'Already properly indented' };
}

/**
 * 16. Alt + H : 相邻参数对调 (Transpose)
 */
export function transposeSexp(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const pos = model.getOffsetAt(editor.getPosition()!);
  const text = model.getValue();

  // 1. Try paredit.js transpose
  try {
    const ast = paredit.parse(text);
    const res = paredit.editor.transpose(ast, text, pos, {});
    if (res && applyPareditResult(editor, res)) {
      return { success: true, detail: 'Transposed adjacent parameters' };
    }
  } catch {}

  // 2. Fallback AST
  const roots = parseSexpressions(text);
  const { enclosing } = findEnclosingWithParent(roots, pos);
  const siblings = enclosing ? enclosing.children || [] : roots;
  let prev: SexpNode | null = null;
  let next: SexpNode | null = null;

  for (let i = 0; i < siblings.length - 1; i++) {
    if (siblings[i].end <= pos && siblings[i + 1].start >= pos) {
      prev = siblings[i];
      next = siblings[i + 1];
      break;
    }
  }

  if (!prev || !next) {
    for (let i = 0; i < siblings.length; i++) {
      if (pos >= siblings[i].start && pos <= siblings[i].end) {
        if (i < siblings.length - 1) {
          prev = siblings[i];
          next = siblings[i + 1];
        } else if (i > 0) {
          prev = siblings[i - 1];
          next = siblings[i];
        }
        break;
      }
    }
  }

  if (prev && next) {
    const prevText = text.slice(prev.start, prev.end);
    const nextText = text.slice(next.start, next.end);
    const between = text.slice(prev.end, next.start);

    const pStart = model.getPositionAt(prev.start);
    const pEnd = model.getPositionAt(next.end);
    const range = new monaco.Range(pStart.lineNumber, pStart.column, pEnd.lineNumber, pEnd.column);

    withParinferLock(() => {
      editor.pushUndoStop();
      editor.executeEdits('paredit', [
        {
          range,
          text: `${nextText}${between}${prevText}`,
        },
      ]);
      editor.pushUndoStop();
    });
    return { success: true, detail: 'Swapped adjacent sexps' };
  }

  return { success: false, detail: 'No pair to transpose' };
}

/**
 * 17. Alt + J : 列表切分 (Split)
 */
export function splitSexp(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const pos = model.getOffsetAt(editor.getPosition()!);
  const text = model.getValue();

  // 1. Try paredit.js splitSexp
  try {
    const ast = paredit.parse(text);
    const res = paredit.editor.splitSexp(ast, text, pos);
    if (res && applyPareditResult(editor, res)) {
      return { success: true, detail: 'Split list into two' };
    }
  } catch {}

  // 2. Fallback AST
  const roots = parseSexpressions(text);
  const { enclosing } = findEnclosingWithParent(roots, pos);

  if (enclosing && enclosing.type === 'list') {
    if (pos > enclosing.start && pos < enclosing.end) {
      const closeChar = enclosing.closeChar || ')';
      const openChar = enclosing.openChar || '(';

      let splitStart = pos;
      let splitEnd = pos;
      while (splitStart > enclosing.start + 1 && /\s/.test(text[splitStart - 1])) {
        splitStart--;
      }
      while (splitEnd < enclosing.end - 1 && /\s/.test(text[splitEnd])) {
        splitEnd++;
      }

      const pStart = model.getPositionAt(splitStart);
      const pEnd = model.getPositionAt(splitEnd);
      const range = new monaco.Range(pStart.lineNumber, pStart.column, pEnd.lineNumber, pEnd.column);
      const insertText = `${closeChar} ${openChar}`;

      withParinferLock(() => {
        editor.pushUndoStop();
        editor.executeEdits('paredit', [
          {
            range,
            text: insertText,
          },
        ]);
        const newPos = model.getPositionAt(splitStart + insertText.length);
        editor.setPosition(newPos);
        editor.pushUndoStop();
      });
      return { success: true, detail: 'Split list at cursor' };
    }
  }

  return { success: false, detail: 'Not inside a list' };
}

/**
 * Shift + Enter : 在顶层 S 表达式尾部智能开辟新行 (Open Line Below Top-Level)
 */
export function openLineBelowTopLevel(editor: monaco.editor.IStandaloneCodeEditor): { success: boolean; detail?: string } {
  const model = editor.getModel();
  if (!model) return { success: false, detail: 'No model' };

  const pos = model.getOffsetAt(editor.getPosition()!);
  const text = model.getValue();
  const roots = parseSexpressions(text);
  const top = findTopLevelNode(roots, pos);

  if (top) {
    const endPos = model.getPositionAt(top.end);
    editor.setPosition(endPos);
    withParinferLock(() => {
      editor.pushUndoStop();
      editor.executeEdits('paredit', [
        {
          range: new monaco.Range(endPos.lineNumber, endPos.column, endPos.lineNumber, endPos.column),
          text: '\n\n',
        },
      ]);
      editor.pushUndoStop();
    });
    const newPos = new monaco.Position(endPos.lineNumber + 2, 1);
    editor.setPosition(newPos);
    editor.revealPosition(newPos);
    return { success: true, detail: 'Opened new line below top-level S-expression' };
  } else {
    const position = editor.getPosition()!;
    const lineLen = model.getLineLength(position.lineNumber);
    const endOfLine = new monaco.Position(position.lineNumber, lineLen + 1);
    editor.setPosition(endOfLine);
    withParinferLock(() => {
      editor.pushUndoStop();
      editor.executeEdits('paredit', [
        {
          range: new monaco.Range(endOfLine.lineNumber, endOfLine.column, endOfLine.lineNumber, endOfLine.column),
          text: '\n',
        },
      ]);
      editor.pushUndoStop();
    });
    const newPos = new monaco.Position(endOfLine.lineNumber + 1, 1);
    editor.setPosition(newPos);
    editor.revealPosition(newPos);
    return { success: true, detail: 'Inserted newline below line' };
  }
}

/**
 * Dispatcher mapping shortcut ID to implementation
 */
export async function dispatchShortcut(
  id: ShortcutId,
  editor: monaco.editor.IStandaloneCodeEditor,
  onEvalResult?: (data: any) => void,
  onSendToRepl?: (code: string) => void
): Promise<{ success: boolean; detail?: string }> {
  switch (id) {
    case 'expand':
      return expandSelection(editor);
    case 'eval_repl':
      return evalRepl(editor, onEvalResult, onSendToRepl);
    case 'wrap_parens':
      return wrapParens(editor);
    case 'wrap_square':
      return wrapSquare(editor);
    case 'slurp':
      return slurpForward(editor);
    case 'barf':
      return barfForward(editor);
    case 'contract':
      return contractSelection(editor);
    case 'defun':
      return selectTopLevelDefun(editor);
    case 'splice':
      return splice(editor);
    case 'forward':
      return forwardSexp(editor);
    case 'backward':
      return backwardSexp(editor);
    case 'down':
      return downIntoSexp(editor);
    case 'up':
      return upOutOfSexp(editor);
    case 'kill_sexp':
      return killSexp(editor);
    case 'indent':
      return indent(editor);
    case 'transpose':
      return transposeSexp(editor);
    case 'split':
      return splitSexp(editor);
    default:
      return { success: false, detail: 'Unknown shortcut' };
  }
}
