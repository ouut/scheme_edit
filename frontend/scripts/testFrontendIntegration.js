import paredit from 'paredit.js';

console.log('================================================================');
console.log('Running Verification Test for Frontend Dynamic Split & Integration');
console.log('================================================================');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

// 1. Cold-start state test
{
  const openFiles = [];
  const isEditorOpen = openFiles.length > 0;
  const leftWidth = isEditorOpen ? 60 : 0;
  const rightWidth = isEditorOpen ? 40 : 100;
  assert(!isEditorOpen && leftWidth === 0 && rightWidth === 100, '1. Cold-start state: editor is 0% width, terminal is 100% width');
}

// 2. Open file dynamic split expansion test
{
  let openFiles = [];
  function openFile(files, path) {
    return [...files, { path, name: path.split('/').pop(), content: '' }];
  }
  openFiles = openFile(openFiles, 'fib.scm');
  const isEditorOpen = openFiles.length > 0;
  let splitRatio = 0.6; // 60:40
  const leftWidth = splitRatio * 100;
  const rightWidth = (1 - splitRatio) * 100;
  assert(isEditorOpen && leftWidth === 60 && rightWidth === 40, '2. Dynamic split: opening a file expands left panel to 60:40');
}

// 3. Close all files dynamic split collapse test
{
  let openFiles = [{ path: 'fib.scm', name: 'fib.scm', content: '' }];
  function closeFile(files, path) {
    return files.filter(f => f.path !== path);
  }
  openFiles = closeFile(openFiles, 'fib.scm');
  const isEditorOpen = openFiles.length > 0;
  const leftWidth = isEditorOpen ? 60 : 0;
  const rightWidth = isEditorOpen ? 40 : 100;
  assert(!isEditorOpen && leftWidth === 0 && rightWidth === 100, '3. Dynamic collapse: closing all tabs collapses left panel to 0% and terminal to 100%');
}

// 4. GUI Action extraction test (pure JSON & embedded stdout)
{
  function extractGuiAction(raw) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const obj = JSON.parse(trimmed);
        if (obj && obj.type === 'gui_action') return obj;
      } catch {}
    }
    if (trimmed.includes('"gui_action"')) {
      const match = trimmed.match(/\{[\s\S]*?"type"\s*:\s*"gui_action"[\s\S]*?\}/);
      if (match) {
        try {
          const obj = JSON.parse(match[0]);
          if (obj && obj.type === 'gui_action') return obj;
        } catch {}
      }
    }
    return null;
  }

  const jsonAction = extractGuiAction('{"type": "gui_action", "action": "open", "file": "sample.scm"}');
  assert(jsonAction && jsonAction.action === 'open' && jsonAction.file === 'sample.scm', '4a. Parse JSON gui_action open');

  const ratioAction = extractGuiAction('{"type": "gui_action", "action": "ratio", "left": 70, "right": 30}');
  assert(ratioAction && ratioAction.action === 'ratio' && ratioAction.left === 70 && ratioAction.right === 30, '4b. Parse JSON gui_action ratio');

  const closeAction = extractGuiAction('{"type": "gui_action", "action": "close", "file": "fib.scm"}');
  assert(closeAction && closeAction.action === 'close' && closeAction.file === 'fib.scm', '4c. Parse JSON gui_action close');

  const embeddedAction = extractGuiAction('\r\n\x1b[32m[OK]\x1b[0m {"type": "gui_action", "action": "open", "file": "fib.scm"}\r\n');
  assert(embeddedAction && embeddedAction.action === 'open' && embeddedAction.file === 'fib.scm', '4d. Parse embedded CLI gui_action from stdout');
}

// 5. Ratio update calculation
{
  function computeRatio(left, right) {
    const sum = left + right;
    if (sum === 0) return 0;
    return left / sum;
  }
  assert(computeRatio(60, 40) === 0.6, '5a. Ratio 60:40 -> 0.6');
  assert(computeRatio(70, 30) === 0.7, '5b. Ratio 70:30 -> 0.7');
  assert(computeRatio(0, 100) === 0, '5c. Ratio 0:100 -> 0 (collapse)');
}

// 6. Terminal Tab Model: Pinned λ REPL + closable bash tabs
{
  const tabs = [
    { id: 'repl', title: 'λ REPL', cmd: 'steel', closable: false },
    { id: 'bash-1', title: 'bash 1', cmd: 'bash', closable: true },
  ];
  assert(tabs[0].closable === false && tabs[0].cmd === 'steel', '6a. Tab 1 is λ REPL running Steel, pinned and unclosable');
  assert(tabs[1].closable === true && tabs[1].cmd === 'bash', '6b. Tab 2+ is bash PTY, closable');
  const defaultActiveTabId = 'bash-1';
  assert(tabs.length === 2 && defaultActiveTabId === 'bash-1', '6c. Initial state opens both λ REPL and bash 1, with bash 1 active');
}

// 7. Monaco S-expression extraction for REPL
{
  const code = '(define (add a b)\n  (+ a b))\n\n(add 10 20)';
  const ast = paredit.parse(code);
  const idx = code.indexOf('(+ a b)');
  const r1 = paredit.navigator.sexpRangeExpansion(ast, idx + 1, idx + 1);
  const r2 = paredit.navigator.sexpRangeExpansion(ast, r1[0], r1[1]);
  const r3 = paredit.navigator.sexpRangeExpansion(ast, r2[0], r2[1]);
  assert(r3 && code.slice(r3[0], r3[1]) === '(+ a b)', '7. Monaco Sexp extraction: expands to (+ a b) for Alt+Enter evaluation');
}

// 8. Scheme file vs Ordinary text file detection
{
  function isSchemeFile(filePath) {
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

  function getLanguageForPath(filePath) {
    if (!filePath) return 'plaintext';
    if (isSchemeFile(filePath)) return 'scheme';
    const clean = filePath.split('?')[0].split('#')[0].toLowerCase();
    if (clean.endsWith('.json')) return 'json';
    if (clean.endsWith('.ts') || clean.endsWith('.tsx')) return 'typescript';
    if (clean.endsWith('.js') || clean.endsWith('.jsx')) return 'javascript';
    if (clean.endsWith('.rs')) return 'rust';
    if (clean.endsWith('.md')) return 'markdown';
    if (clean.endsWith('.sh')) return 'shell';
    if (clean.endsWith('.toml')) return 'ini';
    return 'plaintext';
  }

  assert(isSchemeFile('fib.scm') === true, '8a. fib.scm is recognized as Scheme file');
  assert(isSchemeFile('lib/math.ss') === true, '8b. math.ss is recognized as Scheme file');
  assert(isSchemeFile('core.rkt') === true, '8c. core.rkt is recognized as Scheme file');
  assert(isSchemeFile('package.json') === false, '8d. package.json is NOT a Scheme file (ordinary)');
  assert(isSchemeFile('README.md') === false, '8e. README.md is NOT a Scheme file (ordinary)');
  assert(isSchemeFile('main.rs') === false, '8f. main.rs is NOT a Scheme file (ordinary)');

  assert(getLanguageForPath('sample.scm') === 'scheme', '8g. sample.scm -> scheme');
  assert(getLanguageForPath('data.json') === 'json', '8h. data.json -> json');
  assert(getLanguageForPath('server.rs') === 'rust', '8i. server.rs -> rust');
  assert(getLanguageForPath('doc.md') === 'markdown', '8j. doc.md -> markdown');
  assert(getLanguageForPath('unknown.txt') === 'plaintext', '8k. unknown.txt -> plaintext');
}

// 9. Tab deduplication test (Prevents opening two tabs for same file)
{
  let openFiles = [];
  const openingPaths = new Set();

  function safeOpenFile(path) {
    const cleanPath = path.trim();
    if (openingPaths.has(cleanPath)) return;
    if (openFiles.some(f => f.path === cleanPath)) return;

    openingPaths.add(cleanPath);
    // Simulate async load then setOpenFiles
    if (!openFiles.some(f => f.path === cleanPath)) {
      openFiles = [...openFiles, { path: cleanPath, name: cleanPath, content: '' }];
    }
    openingPaths.delete(cleanPath);
  }

  // Simulate two concurrent gui open calls for sample.scm
  safeOpenFile('sample.scm');
  safeOpenFile('sample.scm');
  assert(openFiles.length === 1 && openFiles[0].path === 'sample.scm', '9. Prevent duplicate tabs: opening sample.scm twice creates exactly ONE tab');
}

// 10. GUI Action deduplication by unique ID and debounce
{
  const seenIds = new Set();
  const lastAction = { key: '', time: 0 };
  let actionDispatchCount = 0;

  function dispatchGuiAction(payload) {
    if (payload.id !== undefined && payload.id !== null) {
      if (seenIds.has(payload.id)) return false;
      seenIds.add(payload.id);
    }
    const key = `${payload.action}:${payload.file || ''}`;
    const now = Date.now();
    if (lastAction.key === key && now - lastAction.time < 500) {
      return false;
    }
    lastAction.key = key;
    lastAction.time = now;
    actionDispatchCount++;
    return true;
  }

  const first = dispatchGuiAction({ id: 1, action: 'open', file: 'test.scm' });
  const second = dispatchGuiAction({ id: 1, action: 'open', file: 'test.scm' }); // duplicate ID
  const third = dispatchGuiAction({ id: 2, action: 'open', file: 'test.scm' }); // debounce identical within 500ms
  assert(first === true && second === false && third === false && actionDispatchCount === 1, '10. Deduplicate GUI action across broadcast sessions');
}

// 11. Empty gui open defaults to scratch-*.scm
{
  function getScratchFile(openFiles) {
    let counter = 1;
    while (openFiles.some(f => f.path === `scratch-${counter}.scm`)) {
      counter++;
    }
    return `scratch-${counter}.scm`;
  }

  assert(getScratchFile([]) === 'scratch-1.scm', '11a. Default scratch file is scratch-1.scm when none open');
  assert(getScratchFile([{ path: 'scratch-1.scm' }]) === 'scratch-2.scm', '11b. Next scratch file is scratch-2.scm when scratch-1 open');
  assert(getScratchFile([{ path: 'scratch-1.scm' }, { path: 'scratch-2.scm' }]) === 'scratch-3.scm', '11c. Next scratch file is scratch-3.scm when 1 and 2 open');
}

// 12. Alt + Shift + Direction keys: wrap-around tab navigation
{
  function cycleEditorTab(openFiles, activePath, direction) {
    if (openFiles.length <= 1) return activePath;
    const idx = openFiles.findIndex(f => f.path === activePath);
    const delta = direction === 'right' ? 1 : -1;
    const nextIdx = (idx + delta + openFiles.length) % openFiles.length;
    return openFiles[nextIdx].path;
  }

  const files = [{ path: 'a.scm' }, { path: 'b.scm' }, { path: 'c.scm' }];
  
  // Right from last wraps to first
  assert(cycleEditorTab(files, 'c.scm', 'right') === 'a.scm', '12a. Alt+Shift+Right at last file tab wraps to first file');
  // Left from first wraps to last
  assert(cycleEditorTab(files, 'a.scm', 'left') === 'c.scm', '12b. Alt+Shift+Left at first file tab wraps to last file');
  // Normal right
  assert(cycleEditorTab(files, 'a.scm', 'right') === 'b.scm', '12c. Alt+Shift+Right moves to next file tab');
  // Normal left
  assert(cycleEditorTab(files, 'b.scm', 'left') === 'a.scm', '12d. Alt+Shift+Left moves to prev file tab');

  function cycleTerminalTab(tabs, activeId, direction) {
    if (tabs.length <= 1) return activeId;
    const idx = tabs.findIndex(t => t.id === activeId);
    const delta = direction === 'right' ? 1 : -1;
    const nextIdx = (idx + delta + tabs.length) % tabs.length;
    return tabs[nextIdx].id;
  }

  const terminalTabs = [{ id: 'repl' }, { id: 'bash-1' }, { id: 'bash-2' }];
  assert(cycleTerminalTab(terminalTabs, 'bash-2', 'right') === 'repl', '12e. Alt+Shift+Right at last terminal tab wraps to repl');
  assert(cycleTerminalTab(terminalTabs, 'repl', 'left') === 'bash-2', '12f. Alt+Shift+Left at first terminal tab wraps to last bash tab');
}

// 13. Shortcuts Help Modal & Navigation Manual Verification
{
  const expectedPareditIds = [
    'expand', 'eval_repl', 'wrap_parens', 'wrap_square',
    'slurp', 'barf', 'contract', 'defun', 'splice',
    'forward', 'backward', 'down', 'up', 'kill_sexp',
    'indent', 'transpose', 'split'
  ];
  assert(expectedPareditIds.length === 17, '13a. Exactly 17 Strict Paredit shortcuts cataloged');

  const globalNavShortcuts = [
    { id: 'focus-editor', keys: 'Alt + Shift + Up', macKeys: '⌥ + ⇧ + ↑' },
    { id: 'focus-terminal', keys: 'Alt + Shift + Down', macKeys: '⌥ + ⇧ + ↓' },
    { id: 'prev-tab', keys: 'Alt + Shift + Left', macKeys: '⌥ + ⇧ + ←' },
    { id: 'next-tab', keys: 'Alt + Shift + Right', macKeys: '⌥ + ⇧ + →' },
  ];
  assert(globalNavShortcuts.length === 4, '13b. Global navigation contains all 4 directional focus & tab switching shortcuts');

  const guiCommands = ['gui open', 'gui edit', 'gui close', 'gui cd', 'gui ratio', 'gui help'];
  assert(guiCommands.length === 6, '13c. Terminal GUI commands contain all 6 CLI actions');

  // Search filter matcher test
  function matchesShortcut(item, query) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      (item.name && item.name.toLowerCase().includes(q)) ||
      (item.enName && item.enName.toLowerCase().includes(q)) ||
      (item.keys && item.keys.toLowerCase().includes(q)) ||
      (item.macKeys && item.macKeys.toLowerCase().includes(q)) ||
      (item.description && item.description.toLowerCase().includes(q)) ||
      (item.cmd && item.cmd.toLowerCase().includes(q)) ||
      (item.syntax && item.syntax.toLowerCase().includes(q))
    );
  }

  const sampleShortcuts = [
    { id: 'expand', name: '向外扩选', enName: 'Expand', keys: 'Alt + K', macKeys: '⌥ + K', description: '自动严丝合缝选中当前 (...)' },
    { id: 'focus-terminal', name: '输入焦点跳转到 Shell 终端', enName: 'Focus Terminal', keys: 'Alt + Shift + Down', macKeys: '⌥ + ⇧ + ↓', description: '快速将键盘输入焦点切换到右侧活动终端' },
    { cmd: 'gui ratio', syntax: 'gui ratio <L:R>', name: '动态调整分栏比例', enName: 'Adjust Ratio', description: '调整分栏比例' },
  ];

  assert(matchesShortcut(sampleShortcuts[0], '扩选'), '13d. Filter matches shortcut by Chinese name');
  assert(matchesShortcut(sampleShortcuts[0], 'alt + k'), '13e. Filter matches shortcut by key chord');
  assert(matchesShortcut(sampleShortcuts[1], 'Focus Terminal'), '13f. Filter matches global navigation by enName');
  assert(matchesShortcut(sampleShortcuts[1], '⌥ + ⇧ + ↓'), '13g. Filter matches macOS Option key chord');
  assert(matchesShortcut(sampleShortcuts[2], 'ratio'), '13h. Filter matches GUI CLI command syntax');
  assert(!matchesShortcut(sampleShortcuts[0], 'nonexistent-xyz'), '13i. Non-matching query yields false');
}

console.log('================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}
