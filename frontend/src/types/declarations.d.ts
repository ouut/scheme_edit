declare module 'paredit.js' {
  export interface ASTNode {
    type: string;
    start: number;
    end: number;
    children?: ASTNode[];
    open?: string;
    close?: string;
    errors?: any[];
    [key: string]: any;
  }

  export interface EditResult {
    changes: Array<['insert', number, string] | ['remove', number, number]>;
    newIndex: number;
  }

  export namespace reader {
    export function read(src: string): ASTNode;
  }

  export namespace navigator {
    export function forwardSexp(ast: ASTNode, idx: number): number;
    export function backwardSexp(ast: ASTNode, idx: number): number;
    export function forwardDownSexp(ast: ASTNode, idx: number): number;
    export function backwardUpSexp(ast: ASTNode, idx: number): number;
    export function closeList(ast: ASTNode, idx: number): number;
    export function sexpRange(ast: ASTNode, idx: number): [number, number] | null;
    export function sexpRangeExpansion(ast: ASTNode, start: number, end: number): [number, number] | null;
    export function rangeForDefun(ast: ASTNode, idx: number): [number, number] | null;
  }

  export namespace editor {
    export function slurpSexp(ast: ASTNode, src: string, idx: number, args?: { backward?: boolean; count?: number }): EditResult | null;
    export function barfSexp(ast: ASTNode, src: string, idx: number, args?: { backward?: boolean; count?: number }): EditResult | null;
    export function wrapAround(ast: ASTNode, src: string, idx: number, open: string, close: string, args?: { count?: number }): EditResult | null;
    export function spliceSexp(ast: ASTNode, src: string, idx: number): EditResult | null;
    export function splitSexp(ast: ASTNode, src: string, idx: number): EditResult | null;
    export function killSexp(ast: ASTNode, src: string, idx: number, args?: { backward?: boolean; count?: number }): EditResult | null;
    export function transpose(ast: ASTNode, src: string, idx: number, args?: any): EditResult | null;
    export function indentRange(ast: ASTNode, src: string, start: number, end: number): any;
  }

  export function parse(src: string): ASTNode;

  const paredit: {
    parse: typeof parse;
    navigator: typeof navigator;
    editor: typeof editor;
    [key: string]: any;
  };

  export default paredit;
}

declare module 'parinfer' {
  export interface ParinferResult {
    text: string;
    success: boolean;
    cursorX?: number;
    cursorLine?: number;
    error?: any;
    parenTrails?: any[];
  }

  export interface ParinferOptions {
    cursorX?: number;
    cursorLine?: number;
    prevCursorX?: number;
    prevCursorLine?: number;
    selectionStartLine?: number;
    forceBalance?: boolean;
    partialResult?: boolean;
  }

  export function parenMode(text: string, options?: ParinferOptions): ParinferResult;
  export function indentMode(text: string, options?: ParinferOptions): ParinferResult;
  export function smartMode(text: string, options?: ParinferOptions): ParinferResult;

  const parinfer: {
    parenMode: typeof parenMode;
    indentMode: typeof indentMode;
    smartMode: typeof smartMode;
  };

  export default parinfer;
}

declare module 'monaco-editor/editor/editor.worker?worker' {
  const worker: {
    new (): Worker;
  };
  export default worker;
}

declare module '*.css' {
  const content: string;
  export default content;
}
