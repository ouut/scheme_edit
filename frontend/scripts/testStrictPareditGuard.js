import paredit from 'paredit.js';

console.log('================================================================');
console.log('Running Verification Test for Pure Strict Paredit Guards:');
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

// 1. Backspace at start of non-empty list: (foo) with cursor right after ( (index 1)
{
  const src = '(foo)';
  const ast = paredit.parse(src);
  const res = paredit.editor.delete(ast, src, 1, { backward: true, count: 1 });
  assert(res && res.changes.length === 0, '1. Backspace after (: blocked on non-empty list');
}

// 2. Delete before closing paren: (foo) with cursor right before ) (index 4)
{
  const src = '(foo)';
  const ast = paredit.parse(src);
  const res = paredit.editor.delete(ast, src, 4, { backward: false, count: 1 });
  assert(res && res.changes.length === 0, '2. Delete before ): blocked on non-empty list');
}

// 3. Backspace in empty list: () with cursor at 1
{
  const src = '()';
  const ast = paredit.parse(src);
  const res = paredit.editor.delete(ast, src, 1, { backward: true, count: 1 });
  assert(
    res && res.changes.length === 1 && res.changes[0][0] === 'remove' && res.changes[0][2] === 2,
    '3. Backspace in empty (): deletes both parens together'
  );
}

// 4. Delete before empty list: |() at index 0
{
  const src = '()';
  const ast = paredit.parse(src);
  const res = paredit.editor.delete(ast, src, 0, { backward: false, count: 1 });
  assert(
    res && res.changes.length === 1 && res.changes[0][0] === 'remove' && res.changes[0][2] === 2,
    '4. Delete before empty (): deletes both parens together'
  );
}

// 5. Backspace after closing paren: (foo)| at index 5
{
  const src = '(foo)';
  const ast = paredit.parse(src);
  const res = paredit.editor.delete(ast, src, 5, { backward: true, count: 1 });
  assert(
    res && res.changes.length === 0 && res.newIndex === 4,
    '5. Backspace after ): moves cursor inside list without deleting paren'
  );
}

// 6. Unbalanced range selection deletion: (fo in (foo)
{
  const src = '(foo)';
  const ast = paredit.parse(src);
  const res = paredit.editor.delete(ast, src, 0, { endIdx: 3 });
  assert(res === null, '6. Unbalanced range selection deletion: blocked to prevent AST corruption');
}

// 7. Balanced range selection deletion: foo in (foo)
{
  const src = '(foo)';
  const ast = paredit.parse(src);
  const res = paredit.editor.delete(ast, src, 1, { endIdx: 4 });
  assert(
    res && res.changes.length === 1 && res.changes[0][2] === 3,
    '7. Balanced range selection deletion: allowed and preserves surrounding parens'
  );
}

// 8. Auto-skip closing paren: typing ) inside (foo bar) jumps to end of list
{
  const src = '(foo bar)';
  const ast = paredit.parse(src);
  const sexps = paredit.walk.containingSexpsAt(ast, 5).filter(
    (n) => paredit.walk.hasChildren(n) && n.close === ')'
  );
  assert(sexps.length > 0 && sexps[sexps.length - 1].end === 9, '8. Typing ): jumps past enclosing )');
}

// 9. Auto-skip closing square bracket: typing ] inside [let ((x 1))] jumps to end of square
{
  const src = '[let ((x 1))]';
  const ast = paredit.parse(src);
  const sexps = paredit.walk.containingSexpsAt(ast, 6).filter(
    (n) => paredit.walk.hasChildren(n) && n.close === ']'
  );
  assert(sexps.length > 0 && sexps[sexps.length - 1].end === 13, '9. Typing ]: jumps past enclosing ]');
}

// 10. String literal skip-over: typing " before closing quote
{
  const src = '"hello"';
  const ast = paredit.parse(src);
  const sexps = paredit.walk.containingSexpsAt(ast, 6);
  const inString = sexps.some((s) => s.type === 'string');
  assert(inString && src[6] === '"', '10. Typing ": skips over closing quote rather than duplicate quote');
}

console.log('================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}
