export type ShortcutId =
  | 'expand'
  | 'eval_repl'
  | 'wrap_parens'
  | 'wrap_square'
  | 'slurp'
  | 'barf'
  | 'contract'
  | 'defun'
  | 'splice'
  | 'forward'
  | 'backward'
  | 'down'
  | 'up'
  | 'kill_sexp'
  | 'indent'
  | 'transpose'
  | 'split';

export interface ShortcutItem {
  id: ShortcutId;
  keys: string;
  macKeys?: string;
  name: string;
  enName: string;
  stars: number;
  percentage: string;
  mnemonic: string;
  description: string;
  category: 'core' | 'wrap_slurp' | 'navigation' | 'struct' | 'low_freq';
}

export interface ActionHistoryEntry {
  id: string;
  shortcutId: ShortcutId;
  shortcutName: string;
  shortcutKeys: string;
  timestamp: string;
  status: string;
  success: boolean;
}

export type ParinferMode = 'paren' | 'smart' | 'off';

export interface EvalResultEntry {
  id: string;
  code: string;
  result?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
  duration_ms: number;
  timestamp: string;
  status: 'success' | 'error';
}

export type ServerStatus = 'connected' | 'ready' | 'error';
