import paredit from 'paredit.js';
import * as monaco from 'monaco-editor';
import { withParinferLock } from './parinferService';

/**
 * Check if the offset is inside a comment node
 */
export function isInsideComment(ast: any, offset: number): boolean {
  if (!ast) return false;
  try {
    const sexps = paredit.walk.containingSexpsAt(ast, offset);
    return sexps.some((s: any) => s.type === 'comment');
  } catch {
    return false;
  }
}

/**
 * Check if the offset is inside a string literal node (between the quotes)
 */
export function isInsideString(ast: any, offset: number): boolean {
  if (!ast) return false;
  try {
    const sexps = paredit.walk.containingSexpsAt(ast, offset);
    return sexps.some((s: any) => s.type === 'string');
  } catch {
    return false;
  }
}

/**
 * Find the enclosing list (matching closeChar if provided)
 */
export function findEnclosingList(ast: any, offset: number, closeChar?: string): any | null {
  if (!ast) return null;
  try {
    const sexps = paredit.walk.containingSexpsAt(ast, offset).filter(
      (n: any) => paredit.walk.hasChildren(n) && (!closeChar || n.close === closeChar)
    );
    return sexps.length > 0 ? sexps[sexps.length - 1] : null;
  } catch {
    return null;
  }
}

/**
 * Apply paredit changes safely to a Monaco editor instance
 */
export function applyPareditChanges(
  editor: monaco.editor.IStandaloneCodeEditor,
  src: string,
  res: { changes: [string, number, number | string][]; newIndex?: number },
  onCodeChange?: (newCode: string) => void
): void {
  const model = editor.getModel();
  if (!model) return;

  withParinferLock(() => {
    // Process changes in reverse order if multiple (though paredit delete usually has 1)
    const sortedChanges = [...res.changes].sort((a, b) => b[1] - a[1]);

    for (const change of sortedChanges) {
      const type = change[0];
      const offset = change[1];

      if (type === 'remove') {
        const length = change[2] as number;
        const startPos = model.getPositionAt(offset);
        const endPos = model.getPositionAt(offset + length);
        editor.executeEdits('strict-paredit', [
          {
            range: new monaco.Range(
              startPos.lineNumber,
              startPos.column,
              endPos.lineNumber,
              endPos.column
            ),
            text: '',
          },
        ]);
      } else if (type === 'insert') {
        const textToInsert = change[2] as string;
        const pos = model.getPositionAt(offset);
        editor.executeEdits('strict-paredit', [
          {
            range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
            text: textToInsert,
          },
        ]);
      }
    }

    if (typeof res.newIndex === 'number') {
      const newPos = model.getPositionAt(res.newIndex);
      editor.setPosition(newPos);
      editor.revealPosition(newPos);
    }
  });

  if (onCodeChange) {
    onCodeChange(editor.getValue());
  }
}

/**
 * Core handler for Emacs-style Strict Paredit keystrokes.
 * Intercepts:
 *  - Backspace (blocking unbalanced deletion, deleting empty pairs together, moving into closed lists)
 *  - Delete (blocking unbalanced deletion, deleting empty pairs together)
 *  - Close delimiters: ')' and ']' and '"' (auto-skip over closing delimiter instead of inserting duplicate)
 *  - Open delimiters: '(' and '[' and '"' (auto-pairing and selection wrapping)
 *
 * Returns `true` if the event was completely handled/prevented, or `false` to let default Monaco handling proceed.
 */
export function handleStrictKeyDown(
  e: monaco.IKeyboardEvent,
  editor: monaco.editor.IStandaloneCodeEditor,
  strictParedit: boolean,
  onCodeChange?: (newCode: string) => void
): boolean {
  if (!strictParedit) {
    return false;
  }

  // Only handle standard keys without Alt or CtrlCmd modifiers (which are handled by shortcuts)
  if (e.altKey || e.ctrlKey || e.metaKey) {
    return false;
  }

  const model = editor.getModel();
  if (!model) return false;

  const src = editor.getValue();
  const selection = editor.getSelection();
  if (!selection) return false;

  let ast: any;
  try {
    ast = paredit.parse(src);
  } catch {
    return false;
  }

  const hasSelection = !selection.isEmpty();
  const startOffset = model.getOffsetAt(selection.getStartPosition());
  const endOffset = model.getOffsetAt(selection.getEndPosition());
  const cursorOffset = model.getOffsetAt(editor.getPosition() || selection.getPosition());

  // 1. Backspace Key
  if (e.keyCode === monaco.KeyCode.Backspace) {
    if (hasSelection) {
      const res = (paredit.editor as any).delete(ast, src, startOffset, { endIdx: endOffset });
      if (!res) {
        // Selection cuts across unbalanced parens! Prevent deletion to protect structure.
        e.preventDefault();
        e.stopPropagation();
        return true;
      }
      e.preventDefault();
      e.stopPropagation();
      applyPareditChanges(editor, src, res, onCodeChange);
      return true;
    }

    // Single cursor Backspace
    const res = (paredit.editor as any).delete(ast, src, cursorOffset, { backward: true, count: 1 });
    if (!res) {
      e.preventDefault();
      e.stopPropagation();
      return true;
    }

    if (res.changes.length === 0) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof res.newIndex === 'number' && res.newIndex !== cursorOffset) {
        // Step cursor inside (e.g. from '(foo)|' to '(foo|)')
        const newPos = model.getPositionAt(res.newIndex);
        editor.setPosition(newPos);
        editor.revealPosition(newPos);
      }
      // Otherwise BLOCKED (e.g. at '(|foo)')
      return true;
    }

    // Pair deletion or character deletion
    e.preventDefault();
    e.stopPropagation();
    applyPareditChanges(editor, src, res, onCodeChange);
    return true;
  }

  // 2. Delete Key
  if (e.keyCode === monaco.KeyCode.Delete) {
    if (hasSelection) {
      const res = (paredit.editor as any).delete(ast, src, startOffset, { endIdx: endOffset });
      if (!res) {
        e.preventDefault();
        e.stopPropagation();
        return true;
      }
      e.preventDefault();
      e.stopPropagation();
      applyPareditChanges(editor, src, res, onCodeChange);
      return true;
    }

    // Single cursor Delete
    const res = (paredit.editor as any).delete(ast, src, cursorOffset, { backward: false, count: 1 });
    if (!res) {
      e.preventDefault();
      e.stopPropagation();
      return true;
    }

    if (res.changes.length === 0) {
      // BLOCKED (e.g. cursor at '(foo|)' before closing ')')
      e.preventDefault();
      e.stopPropagation();
      return true;
    }

    e.preventDefault();
    e.stopPropagation();
    applyPareditChanges(editor, src, res, onCodeChange);
    return true;
  }

  // Character inputs: inspect e.browserEvent.key
  const rawKey = e.browserEvent.key;

  // 3. Close Parentheses ')'
  if (rawKey === ')') {
    if (isInsideComment(ast, cursorOffset) || isInsideString(ast, cursorOffset)) {
      return false; // Type literal ')' inside string or comment
    }

    const enclosing = findEnclosingList(ast, cursorOffset, ')');
    if (enclosing) {
      e.preventDefault();
      e.stopPropagation();
      // Jump past the closing ')' of the enclosing list (paredit-close-round)
      const targetOffset = enclosing.end;
      const targetPos = model.getPositionAt(targetOffset);
      editor.setPosition(targetPos);
      editor.revealPosition(targetPos);
      return true;
    }
    return false;
  }

  // 4. Close Square Bracket ']'
  if (rawKey === ']') {
    if (isInsideComment(ast, cursorOffset) || isInsideString(ast, cursorOffset)) {
      return false;
    }

    const enclosing = findEnclosingList(ast, cursorOffset, ']');
    if (enclosing) {
      e.preventDefault();
      e.stopPropagation();
      const targetOffset = enclosing.end;
      const targetPos = model.getPositionAt(targetOffset);
      editor.setPosition(targetPos);
      editor.revealPosition(targetPos);
      return true;
    }
    return false;
  }

  // 5. Double Quote '"'
  if (rawKey === '"') {
    if (isInsideComment(ast, cursorOffset)) {
      return false;
    }

    // If inside string and cursor is immediately before the closing quote, skip over it!
    if (isInsideString(ast, cursorOffset) && src[cursorOffset] === '"') {
      e.preventDefault();
      e.stopPropagation();
      const nextPos = model.getPositionAt(cursorOffset + 1);
      editor.setPosition(nextPos);
      editor.revealPosition(nextPos);
      return true;
    }

    if (!isInsideString(ast, cursorOffset)) {
      e.preventDefault();
      e.stopPropagation();

      if (hasSelection) {
        // Wrap selected text in "..."
        const selectedText = model.getValueInRange(selection);
        editor.executeEdits('strict-paredit', [
          {
            range: selection,
            text: `"${selectedText}"`,
          },
        ]);
      } else {
        // Insert empty pair "" and position cursor between
        const pos = model.getPositionAt(cursorOffset);
        editor.executeEdits('strict-paredit', [
          {
            range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
            text: '""',
          },
        ]);
        const innerPos = model.getPositionAt(cursorOffset + 1);
        editor.setPosition(innerPos);
      }

      if (onCodeChange) onCodeChange(editor.getValue());
      return true;
    }
  }

  // 6. Open Parentheses '('
  if (rawKey === '(') {
    if (isInsideComment(ast, cursorOffset) || isInsideString(ast, cursorOffset)) {
      return false;
    }

    e.preventDefault();
    e.stopPropagation();

    if (hasSelection) {
      // Wrap selection in (...)
      const selectedText = model.getValueInRange(selection);
      editor.executeEdits('strict-paredit', [
        {
          range: selection,
          text: `(${selectedText})`,
        },
      ]);
    } else {
      // Insert () and position inside (|)
      const pos = model.getPositionAt(cursorOffset);
      editor.executeEdits('strict-paredit', [
        {
          range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
          text: '()',
        },
      ]);
      const innerPos = model.getPositionAt(cursorOffset + 1);
      editor.setPosition(innerPos);
    }

    if (onCodeChange) onCodeChange(editor.getValue());
    return true;
  }

  // 7. Open Square Bracket '['
  if (rawKey === '[') {
    if (isInsideComment(ast, cursorOffset) || isInsideString(ast, cursorOffset)) {
      return false;
    }

    e.preventDefault();
    e.stopPropagation();

    if (hasSelection) {
      // Wrap selection in [...]
      const selectedText = model.getValueInRange(selection);
      editor.executeEdits('strict-paredit', [
        {
          range: selection,
          text: `[${selectedText}]`,
        },
      ]);
    } else {
      // Insert [] and position inside [|]
      const pos = model.getPositionAt(cursorOffset);
      editor.executeEdits('strict-paredit', [
        {
          range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
          text: '[]',
        },
      ]);
      const innerPos = model.getPositionAt(cursorOffset + 1);
      editor.setPosition(innerPos);
    }

    if (onCodeChange) onCodeChange(editor.getValue());
    return true;
  }

  return false;
}
