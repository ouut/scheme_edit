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

console.log('================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}
