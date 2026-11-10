import * as monaco from 'monaco-editor';
import paredit from 'paredit.js';

export const SCHEME_LANGUAGE_ID = 'scheme';
export const TOKYO_NIGHT_THEME_ID = 'tokyo-night';

const keywords = [
  'define',
  'lambda',
  'let',
  'let*',
  'letrec',
  'if',
  'cond',
  'case',
  'and',
  'or',
  'begin',
  'do',
  'quote',
  'quasiquote',
  'unquote',
  'unquote-splicing',
  'set!',
  'syntax-rules',
  'define-syntax',
  'let-syntax',
  'letrec-syntax',
  'syntax-case',
  'define-macro',
  'when',
  'unless',
  'else',
  '=>',
  'cond-expand',
  'delay',
  'force',
  'parameterize',
];

const builtins = [
  'display',
  'displayln',
  'newline',
  'car',
  'cdr',
  'cons',
  'list',
  'vector',
  'string',
  'map',
  'filter',
  'foldl',
  'foldr',
  'append',
  'reverse',
  'length',
  '+',
  '-',
  '*',
  '/',
  '=',
  '<',
  '>',
  '<=',
  '>=',
  'eq?',
  'equal?',
  'eqv?',
  'null?',
  'pair?',
  'list?',
  'symbol?',
  'number?',
  'string?',
  'boolean?',
  'procedure?',
  'vector?',
  'not',
  'abs',
  'quotient',
  'remainder',
  'modulo',
  'min',
  'max',
  'error',
  'read',
  'write',
  'format',
  'eval',
  'apply',
  'void',
  'open-input-file',
  'open-output-file',
  'close-input-port',
  'close-output-port',
  'call-with-input-file',
  'call-with-output-file',
  'current-input-port',
  'current-output-port',
  'caar',
  'cadr',
  'cdar',
  'cddr',
  'caddr',
  'cadddr',
];

export const schemeTokensProvider: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.scheme',

  keywords,
  builtins,

  tokenizer: {
    root: [
      // Comments: ;.*$
      [/;.*$/, 'comment'],

      // Booleans: #t, #f, #true, #false
      [/#(t|f|true|false)\b/, 'boolean'],

      // Characters: #\space, #\newline, #\a, #\(, etc.
      [/#\\([a-zA-Z0-9]+|.)/, 'string.character'],

      // Numbers:
      [/#[xX][0-9a-fA-F]+/, 'number.hex'],
      [/#[bB][01]+/, 'number.binary'],
      [/#[oO][0-7]+/, 'number.octal'],
      [/[+-]?(?:[0-9]+\.[0-9]*|\.[0-9]+|[0-9]+)(?:[eE][+-]?[0-9]+)?\b/, 'number'],

      // Strings: "([^"\\]|\\.)*"
      [/"([^"\\]|\\.)*"/, 'string'],

      // Delimiters: (), [], {}
      [/[()[\]{}]/, '@brackets'],

      // Quoted expressions
      [/'[a-zA-Z_!$%&*+./:<=>?@^~-][a-zA-Z0-9_!$%&*+./:<=>?@^~-]*/, 'string.symbol'],
      [/['`]/, 'operator'],
      [/,@?/, 'operator'],

      // Identifiers, keywords, builtins, operators
      [
        /[a-zA-Z_!$%&*+./:<=>?@^~-][a-zA-Z0-9_!$%&*+./:<=>?@^~-]*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@builtins': 'function',
            '@default': 'identifier',
          },
        },
      ],

      // Whitespace
      { include: '@whitespace' },
    ],

    whitespace: [[/[ \t\r\n]+/, 'white']],
  },
};

export const schemeLanguageConfiguration: monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: ';',
  },
  brackets: [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '{', close: '}' },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '{', close: '}' },
    { open: '"', close: '"' },
  ],
};

export const tokyoNightTheme: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'c0caf5', background: '1a1b26' },
    { token: 'keyword', foreground: 'bb9af7', fontStyle: 'bold' },
    { token: 'string', foreground: '9ece6a' },
    { token: 'string.character', foreground: '9ece6a' },
    { token: 'string.symbol', foreground: '7dcfff' },
    { token: 'comment', foreground: '565f89', fontStyle: 'italic' },
    { token: 'number', foreground: 'ff9e64' },
    { token: 'number.hex', foreground: 'ff9e64' },
    { token: 'number.binary', foreground: 'ff9e64' },
    { token: 'number.octal', foreground: 'ff9e64' },
    { token: 'boolean', foreground: 'ff9e64', fontStyle: 'bold' },
    { token: 'function', foreground: '7aa2f7' },
    { token: 'predefined', foreground: '7aa2f7' },
    { token: 'operator', foreground: '7aa2f7' },
    { token: 'identifier', foreground: 'c0caf5' },
    { token: 'delimiter', foreground: '9aa5ce' },
    { token: 'delimiter.bracket', foreground: '9aa5ce' },
  ],
  colors: {
    'editor.background': '#1a1b26',
    'editor.foreground': '#c0caf5',
    'editorCursor.foreground': '#38bdf8',
    'editor.lineHighlightBackground': '#1f2335',
    'editorLineNumber.foreground': '#3b4261',
    'editorLineNumber.activeForeground': '#737aa2',
    'editor.selectionBackground': '#283457',
    'editor.inactiveSelectionBackground': '#283457aa',
    'editorBracketHighlight.foreground1': '#7aa2f7',
    'editorBracketHighlight.foreground2': '#bb9af7',
    'editorBracketHighlight.foreground3': '#7dcfff',
    'editorBracketHighlight.foreground4': '#e0af68',
    'editorBracketHighlight.foreground5': '#9ece6a',
    'editorBracketHighlight.foreground6': '#f7768e',
    'editorBracketHighlight.unexpectedBracket.foreground': '#db4b4b',
  },
};

let isInitialized = false;

export function registerMonacoScheme(): void {
  if (isInitialized) return;

  if (!monaco.languages.getLanguages().some((l) => l.id === SCHEME_LANGUAGE_ID)) {
    monaco.languages.register({ id: SCHEME_LANGUAGE_ID });
  }

  monaco.languages.setMonarchTokensProvider(SCHEME_LANGUAGE_ID, schemeTokensProvider);
  monaco.languages.setLanguageConfiguration(SCHEME_LANGUAGE_ID, schemeLanguageConfiguration);
  monaco.editor.defineTheme(TOKYO_NIGHT_THEME_ID, tokyoNightTheme);

  monaco.languages.registerDocumentFormattingEditProvider(SCHEME_LANGUAGE_ID, {
    provideDocumentFormattingEdits(model) {
      const text = model.getValue();
      try {
        const ast = paredit.parse(text);
        if (ast) {
          const res = paredit.editor.indentRange(ast, text, 0, text.length);
          if (res && res.changes && res.changes.length > 0) {
            const sorted = [...res.changes].sort((a: any, b: any) => b[1] - a[1]);
            return sorted.map((ch: any) => {
              if (ch[0] === 'insert') {
                const pos = model.getPositionAt(ch[1]);
                return {
                  range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
                  text: ch[2] as string,
                };
              } else {
                const posStart = model.getPositionAt(ch[1]);
                const posEnd = model.getPositionAt(ch[1] + (ch[2] as number));
                return {
                  range: new monaco.Range(posStart.lineNumber, posStart.column, posEnd.lineNumber, posEnd.column),
                  text: '',
                };
              }
            });
          }
        }
      } catch {}
      return [];
    },
  });

  isInitialized = true;
}

/**
 * Determine if a given file path is a Scheme file (.scm, .ss, .scheme, .sld, .rkt)
 */
export function isSchemeFile(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  const clean = filePath.split('?')[0].split('#')[0].toLowerCase();
  return (
    clean.endsWith('.scm') ||
    clean.endsWith('.ss') ||
    clean.endsWith('.scheme') ||
    clean.endsWith('.sld') ||
    clean.endsWith('.rkt')
  );
}

/**
 * Detect Monaco language identifier from file extension
 */
export function getLanguageForPath(filePath: string | null | undefined): string {
  if (!filePath) return 'plaintext';
  if (isSchemeFile(filePath)) return SCHEME_LANGUAGE_ID;

  const clean = filePath.split('?')[0].split('#')[0].toLowerCase();
  if (clean.endsWith('.json')) return 'json';
  if (clean.endsWith('.ts') || clean.endsWith('.tsx')) return 'typescript';
  if (clean.endsWith('.js') || clean.endsWith('.jsx') || clean.endsWith('.mjs') || clean.endsWith('.cjs')) return 'javascript';
  if (clean.endsWith('.rs')) return 'rust';
  if (clean.endsWith('.md') || clean.endsWith('.markdown')) return 'markdown';
  if (clean.endsWith('.sh') || clean.endsWith('.bash') || clean.endsWith('.zsh')) return 'shell';
  if (clean.endsWith('.html') || clean.endsWith('.htm')) return 'html';
  if (clean.endsWith('.css') || clean.endsWith('.scss') || clean.endsWith('.less')) return 'css';
  if (clean.endsWith('.yml') || clean.endsWith('.yaml')) return 'yaml';
  if (clean.endsWith('.toml') || clean.endsWith('.ini')) return 'ini';
  if (clean.endsWith('.py')) return 'python';
  if (clean.endsWith('.c') || clean.endsWith('.h')) return 'c';
  if (clean.endsWith('.cpp') || clean.endsWith('.hpp') || clean.endsWith('.cc')) return 'cpp';
  if (clean.endsWith('.sql')) return 'sql';
  if (clean.endsWith('.xml') || clean.endsWith('.svg')) return 'xml';
  return 'plaintext';
}
