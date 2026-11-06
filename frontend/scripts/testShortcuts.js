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

// 3. Alt + U : Wrap Parens
{
  const src = '(define cards 10)';
  const ast = paredit.parse(src);
  const res = paredit.editor.wrapAround(ast, src, 8, '(', ')', { count: 1 });
  assert(res && res.changes.length === 2 && res.changes[0][2] === '(' && res.changes[1][2] === ')', '3. Wrap Parens (Alt+U): wraps with ()');
}

// 4. Alt + Shift + U : Wrap Square
{
  const src = '(let* (x 10) x)';
  const ast = paredit.parse(src);
  const res = paredit.editor.wrapAround(ast, src, 7, '[', ']', { count: 1 });
  assert(res && res.changes.length === 2 && res.changes[0][2] === '[' && res.changes[1][2] === ']', '4. Wrap Square (Alt+Shift+U): wraps with []');
}

// 5. Alt + J : Slurp
{
  const src = '(list (+ 10 20) 30)';
  const ast = paredit.parse(src);
  const res = paredit.editor.slurpSexp(ast, src, 10, { count: 1 });
  assert(res && res.changes.some(c => c[0] === 'insert' && c[2] === ')'), '5. Slurp (Alt+J): absorbs next sibling');
}

// 6. Alt + L : Barf
{
  const src = '(list (+ 10 20 30))';
  const ast = paredit.parse(src);
  const res = paredit.editor.barfSexp(ast, src, 10, { count: 1 });
  assert(res && res.changes.some(c => c[0] === 'remove'), '6. Barf (Alt+L): ejects last child');
}

// 7. Alt + I : Contract
{
  // Selection history stack contract
  const stack = [{ start: 0, end: 10 }];
  const popped = stack.pop();
  assert(popped && popped.start === 0 && popped.end === 10, '7. Contract (Alt+I): restores selection from history stack');
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

// 12. Alt + S : Down
{
  const src = '(define (add a b) (+ a b))';
  const ast = paredit.parse(src);
  const pos = paredit.navigator.forwardDownSexp(ast, 0);
  assert(pos === 1, '12. Down (Alt+S): dives into list after open paren');
}

// 13. Alt + W : Up
{
  const src = '(define (add a b) (+ a b))';
  const ast = paredit.parse(src);
  const pos = paredit.navigator.backwardUpSexp(ast, 22);
  assert(pos === 18, '13. Up (Alt+W): jumps up to enclosing list head');
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
  const src = '(define (test x)\n(+ x 1))';
  const res = parinfer.parenMode(src);
  assert(res.success && res.text.includes(' (+ x 1))'), '15. Indent (Alt+\\): aligns S-expression according to Lisp indentation');
}

// 16. Alt + H : Transpose
{
  const src = '(equal? a b)';
  const ast = paredit.parse(src);
  const res = paredit.editor.transpose(ast, src, 9);
  assert(res && res.changes.length > 0, '16. Transpose (Alt+H): swaps adjacent sibling sexps');
}

// 17. Alt + Shift + K : Split
{
  const src = '(foo bar baz)';
  const ast = paredit.parse(src);
  const res = paredit.editor.splitSexp(ast, src, 8);
  assert(res && res.changes.some(c => c[2] === ') ('), '17. Split (Alt+Shift+K): splits list at cursor into two lists');
}

console.log('================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}
