import * as monaco from 'monaco-editor';

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

  isInitialized = true;
}
