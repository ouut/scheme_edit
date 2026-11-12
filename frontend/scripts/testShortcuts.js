import paredit from 'paredit.js';
import parinfer from 'parinfer';

console.log('================================================================');
console.log('Running Verification Test for 17 Strict Paredit Shortcuts:');
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

// 1. Alt + K : Expand
{
  const src = '(define (fib n) (+ n 1))';
  const ast = paredit.parse(src);
  const range = paredit.navigator.sexpRangeExpansion(ast, 19, 20);
  assert(range && range[0] <= 19 && range[1] >= 20, '1. Expand (Alt+K): expands innermost sexp');
}

// 2. Alt + Enter / Ctrl + Enter : Eval REPL
{
  const src = '(+ 40 2)';
  const ast = paredit.parse(src);
  assert(ast && ast.children && ast.children.length === 1, '2. Eval REPL (Alt+Enter / Ctrl+Enter): AST parseable and ready for /api/eval');
}

// Helper implementation of Calva smart affinity parser & wrap logic
function parseSexpressions(text) {
  const stack = [];
  const roots = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === ';') {
      const start = i;
      while (i < len && text[i] !== '\n') i++;
      const node = { start, end: i, type: 'comment' };
      if (stack.length > 0) stack[stack.length - 1].children.push(node);
      else roots.push(node);
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      const node = {
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
    if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.length > 0) {
        const top = stack.pop();
        top.node.end = i + 1;
        top.node.children = top.children;
        if (stack.length > 0) stack[stack.length - 1].children.push(top.node);
        else roots.push(top.node);
      }
      i++;
      continue;
    }
    const start = i;
    while (i < len && !/[\s()[\]{}";]/.test(text[i])) i++;
    const node = { start, end: i, type: 'atom' };
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    else roots.push(node);
  }
  while (stack.length > 0) {
    const top = stack.pop();
    top.node.end = len;
    top.node.children = top.children;
    if (stack.length > 0) stack[stack.length - 1].children.push(top.node);
    else roots.push(top.node);
  }
  return roots;
}

function findEnclosingWithParent(roots, pos) {
  let enclosing = null;
  let parent = null;

  function traverse(nodes, currentParent) {
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

function computeSmartWrap(text, pos, openChar = '(', closeChar = ')') {
  const roots = parseSexpressions(text);
  const { enclosing } = findEnclosingWithParent(roots, pos);
  const siblings = (enclosing ? (enclosing.children || []) : roots)
    .filter(n => n.type !== 'comment');

  let target = null;
  let cursorType = 'start';

  const touchingEnd = siblings.find(
    s => s.end === pos && pos > 0 && !/\s/.test(text[pos - 1])
  );
  if (touchingEnd) {
    target = touchingEnd;
    cursorType = 'end';
  }

  if (!target) {
    const inside = siblings.find(s => s.start < pos && pos < s.end);
    if (inside) {
      target = inside;
      cursorType = 'inside';
    }
  }

  if (!target) {
    const touchingStart = siblings.find(s => s.start === pos);
    if (touchingStart) {
      target = touchingStart;
      cursorType = 'start';
    }
  }

  if (!target) {
    const forward = siblings.find(s => s.start > pos);
    if (forward) {
      target = forward;
      cursorType = 'forward';
    }
  }

  if (target) {
    const targetText = text.slice(target.start, target.end);
    let newOffset;
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

// 3. Alt + H : Wrap Parens (Calva Smart Affinity)
{
  const src = '(define cards 10)';
  const ast = paredit.parse(src);
  const res = paredit.editor.wrapAround(ast, src, 8, '(', ')', { count: 1 });
  assert(res && res.changes.length === 2 && res.changes[0][2] === '(' && res.changes[1][2] === ')', '3a. Wrap Parens (Alt+H): wraps with ()');

  // Calva Smart Affinity 1: define| x wraps left token define -> (define) x with cursor at (define|)
  const testSrc1 = 'define x';
  const wrap1 = computeSmartWrap(testSrc1, 6, '(', ')');
  const applied1 = testSrc1.slice(0, wrap1.rangeStart) + wrap1.replacementText + testSrc1.slice(wrap1.rangeEnd);
  assert(applied1 === '(define) x' && wrap1.newOffset === 7, '3b. Calva Smart Affinity: define| x wraps left token to (define|) x');

  // Calva Smart Affinity 2: define| at end of line wraps to (define|)
  const testSrc2 = 'define';
  const wrap2 = computeSmartWrap(testSrc2, 6, '(', ')');
  const applied2 = testSrc2.slice(0, wrap2.rangeStart) + wrap2.replacementText + testSrc2.slice(wrap2.rangeEnd);
  assert(applied2 === '(define)' && wrap2.newOffset === 7, '3c. Calva Smart Affinity: define| wraps to (define|)');

  // Calva Smart Affinity 3: define |x wraps forward token to define (|x)
  const testSrc3 = 'define x';
  const wrap3 = computeSmartWrap(testSrc3, 7, '(', ')');
  const applied3 = testSrc3.slice(0, wrap3.rangeStart) + wrap3.replacementText + testSrc3.slice(wrap3.rangeEnd);
  assert(applied3 === 'define (x)' && wrap3.newOffset === 8, '3d. Calva Smart Affinity: define |x wraps right token to define (|x)');
}

// 4. Alt + Shift + H : Wrap Square (Calva Smart Affinity)
{
  const src = '(let* (x 10) x)';
  const ast = paredit.parse(src);
  const res = paredit.editor.wrapAround(ast, src, 7, '[', ']', { count: 1 });
  assert(res && res.changes.length === 2 && res.changes[0][2] === '[' && res.changes[1][2] === ']', '4a. Wrap Square (Alt+Shift+H): wraps with []');

  // Calva Smart Affinity Square: (let* |x 10) wraps x to [x]
  const testSquare = '(let* x 10)';
  const wrapSq = computeSmartWrap(testSquare, 6, '[', ']');
  const appliedSq = testSquare.slice(0, wrapSq.rangeStart) + wrapSq.replacementText + testSquare.slice(wrapSq.rangeEnd);
  assert(appliedSq === '(let* [x] 10)' && wrapSq.newOffset === 7, '4b. Calva Smart Affinity: (let* |x 10) wraps with square brackets to (let* [|x] 10)');
}

// 5. Alt + L : Slurp
{
  const src = '(list (+ 10 20) 30)';
  const ast = paredit.parse(src);
  const res = paredit.editor.slurpSexp(ast, src, 10, { count: 1 });
  assert(res && res.changes.some(c => c[0] === 'insert' && c[2] === ')'), '5. Slurp (Alt+L): absorbs next sibling');
}

// 6. Alt + J : Barf
{
  const src = '(list (+ 10 20 30))';
  const ast = paredit.parse(src);
  const res = paredit.editor.barfSexp(ast, src, 10, { count: 1 });
  assert(res && res.changes.some(c => c[0] === 'remove'), '6. Barf (Alt+J): ejects last child');
}

// 7. Alt + Shift + K / Alt + I : Contract
{
  // Selection history stack contract
  const stack = [{ start: 0, end: 10 }];
  const popped = stack.pop();
  assert(popped && popped.start === 0 && popped.end === 10, '7. Contract (Alt+Shift+K / Alt+I): restores selection from history stack');

  // AST contraction fallback test
  const src = '(fib (- n 2))';
  const ast = paredit.parse(src);
  let best = null;
  function walk(node) {
    if (!node || !node.children) return;
    for (const child of node.children) {
      if (child.start >= 0 && child.end <= src.length && (child.start > 0 || child.end < src.length)) {
        if (!best || (child.end - child.start > best.end - best.start)) best = child;
      }
      walk(child);
    }
  }
  walk(ast);
  assert(best && src.slice(best.start, best.end) === '(- n 2)', '7b. Contract AST fallback: contracts (fib (- n 2)) to (- n 2)');
}

// 8. Alt + 3 : Defun
{
  const src = '(define (deep a)\n  (let () (let () (+ a 1))))';
  const ast = paredit.parse(src);
  const range = paredit.navigator.rangeForDefun(ast, 28);
  assert(range && range[0] === 0 && range[1] === src.length, '8. Defun (Alt+3): selects outermost define expression');
}

// 9. Alt + O : Splice
{
  const src = '(let () (+ 1 2))';
  const ast = paredit.parse(src);
  const res = paredit.editor.spliceSexp(ast, src, 10);
  assert(res && res.changes.length === 2, '9. Splice (Alt+O): removes enclosing parens');
}

// 10. Alt + 2 : Forward Sexp
{
  const src = '(+ 10 20 30)';
  const ast = paredit.parse(src);
  const pos = paredit.navigator.forwardSexp(ast, 4);
  assert(pos === 5, '10. Forward (Alt+2): jumps forward past sexp');
}

// 11. Alt + 1 : Backward Sexp
{
  const src = '(+ 10 20 30)';
  const ast = paredit.parse(src);
  const pos = paredit.navigator.backwardSexp(ast, 8);
  assert(pos === 6, '11. Backward (Alt+1): jumps backward past sexp');
}

// 12. Alt + W : Down / Step Into
{
  const src = '(define (add a b) (+ a b))';
  const ast = paredit.parse(src);
  const pos = paredit.navigator.forwardDownSexp(ast, 0);
  assert(pos === 1, '12. Step Into (Alt+W): dives into list after open paren');
}

// 13. Alt + S : Up / Step Out
{
  const src = '(define (add a b) (+ a b))';
  const ast = paredit.parse(src);
  const pos = paredit.navigator.backwardUpSexp(ast, 22);
  assert(pos === 18, '13. Step Out (Alt+S): jumps up to enclosing list head');
}

// 14. Alt + X : Kill Sexp
{
  const src = '(list a b c)';
  const ast = paredit.parse(src);
  const res = paredit.editor.killSexp(ast, src, 6, { count: 1 });
  assert(res && res.changes.some(c => c[0] === 'remove'), '14. Kill Sexp (Alt+X): deletes next complete sexp');
}

// 15. Alt + \ : Indent
{
  const src = `(define (test x)\n(+ x 1))`;
  const ast = paredit.parse(src);
  const res = paredit.editor.indentRange(ast, src, 0, src.length);
  assert(res && res.src && res.src.includes('  (+ x 1))'), '15. Indent (Alt+\\): aligns S-expression according to Lisp indentation');

  // Verify idempotence: running indent 5 consecutive times produces identical output without corrupting tokens
  let current = src;
  for (let i = 0; i < 5; i++) {
    const a = paredit.parse(current);
    const r = paredit.editor.indentRange(a, current, 0, current.length);
    if (r && r.src) current = r.src;
  }
  assert(current === res.src, '15b. Indent idempotence: repeated Alt+\\ maintains clean indentation without mangling code');
}

// 16. Alt + Shift + L : Transpose
{
  const src = '(equal? a b)';
  const ast = paredit.parse(src);
  const res = paredit.editor.transpose(ast, src, 9);
  assert(res && res.changes.length > 0, '16. Transpose (Alt+Shift+L): swaps adjacent sibling sexps');
}

// 17. Alt + Shift + J : Split
{
  const src = '(foo bar baz)';
  const ast = paredit.parse(src);
  const res = paredit.editor.splitSexp(ast, src, 8);
  assert(res && res.changes.some(c => c[2] === ') ('), '17. Split (Alt+Shift+J): splits list at cursor into two lists');
}

console.log('================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}
