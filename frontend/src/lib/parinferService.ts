import parinfer from 'parinfer';
import { ParinferMode } from '../types';

let lockCount = 0;
let currentMode: ParinferMode = 'paren';

export function getParinferMode(): ParinferMode {
  return currentMode;
}

export function setParinferMode(mode: ParinferMode): void {
  currentMode = mode;
}

export function isParinferLocked(): boolean {
  return lockCount > 0;
}

export function lockParinfer(): void {
  lockCount++;
}

export function unlockParinfer(): void {
  if (lockCount > 0) {
    lockCount--;
  }
}

export function withParinferLock<T>(fn: () => T): T {
  lockParinfer();
  try {
    return fn();
  } finally {
    unlockParinfer();
  }
}

export interface CursorPosition {
  row: number; // 0-based line index
  column: number; // 0-based column index
}

export interface ParinferRunResult {
  text: string;
  cursor?: CursorPosition;
  success: boolean;
}

export function applyParinfer(
  text: string,
  cursor: CursorPosition,
  modeOverride?: ParinferMode
): ParinferRunResult {
  const mode = modeOverride || currentMode;

  if (mode === 'off' || isParinferLocked()) {
    return { text, cursor, success: true };
  }

  try {
    const row = Math.max(0, cursor.row);
    const col = Math.max(0, cursor.column);

    const options = {
      cursorLine: row,
      cursorX: col,
    };

    let result: any;
    if (mode === 'paren') {
      result = parinfer.parenMode(text, options);
    } else if (mode === 'smart') {
      result = parinfer.smartMode(text, options);
    }

    if (result && result.success && typeof result.text === 'string') {
      const newCursor: CursorPosition =
        result.cursorLine !== undefined && result.cursorX !== undefined
          ? { row: result.cursorLine, column: result.cursorX }
          : cursor;

      return {
        text: result.text,
        cursor: newCursor,
        success: true,
      };
    }
  } catch (_err) {
    // Parinfer might throw on unbalanced strings/unparseable syntax; fail safely
  }

  return { text, cursor, success: false };
}
