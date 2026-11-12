# Scheme Strict Paredit 快捷键算法与实现规范 (Algorithm & Implementation Spec)

> **目标**：本文档以形式化、可复现、算法级别的精度定义 Scheme Strict Paredit IDE 中全部 17 个结构化快捷键、物理按键守卫（Key Guards）及全局导航的底层算法与边界逻辑，以便在任意编辑器环境（如 Neovim、Emacs、VS Code 扩展、Web 自定义编辑器）中 100% 精确复现。

---

## 目录
- [一、 语法模型与 AST 数据结构](#一-语法模型与-ast-数据结构)
  - [1.1 节点定义 (SexpNode)](#11-节点定义-sexpnode)
  - [1.2 容错 AST 解析器算法 (parseSexpressions)](#12-容错-ast-解析器算法-parsesexpressions)
  - [1.3 核心树检索辅助函数](#13-核心树检索辅助函数)
- [二、 17 个 Strict Paredit 快捷键算法规范](#二-17-个-strict-paredit-快捷键算法规范)
  - [1. 向外扩选 Expand (Alt + K)](#1-向外扩选-expand-alt--k)
  - [2. 发射求值 Eval REPL (Alt + Enter / Ctrl + Enter)](#2-发射求值-eval-repl-alt--enter--ctrl--enter)
  - [3. 圆括号包裹 Wrap Parens - Calva 智能吸附 (Alt + H)](#3-圆括号包裹-wrap-parens---calva-智能吸附-alt--h)
  - [4. 方括号包裹 Wrap Square - Calva 智能吸附 (Alt + Shift + H)](#4-方括号包裹-wrap-square---calva-智能吸附-alt--shift--h)
  - [5. 向右吞噬 Slurp Forward (Alt + L)](#5-向右吞噬-slurp-forward-alt--l)
  - [6. 向左吐出 Barf Forward (Alt + J)](#6-向左吐出-barf-forward-alt--j)
  - [7. 向内收缩 Contract (Alt + Shift + K / Alt + I)](#7-向内收缩-contract-alt--shift--k--alt--i)
  - [8. 选中顶级函数 Select Defun (Alt + 3)](#8-选中顶级函数-select-defun-alt--3)
  - [9. 脱壳解包 Splice (Alt + O)](#9-脱壳解包-splice-alt--o)
  - [10. 大步前进 Forward Sexp (Alt + 2)](#10-大步前进-forward-sexp-alt--2)
  - [11. 大步后退 Backward Sexp (Alt + 1)](#11-大步后退-backward-sexp-alt--1)
  - [12. 步进深入 Step Into / Down (Alt + W)](#12-步进深入-step-into--down-alt--w)
  - [13. 步退跳出 Step Out / Up (Alt + S)](#13-步退跳出-step-out--up-alt--s)
  - [14. 向后整块删除 Kill Sexp (Alt + X)](#14-向后整块删除-kill-sexp-alt--x)
  - [15. 智能格式排版 Indent (Alt + \)](#15-智能格式排版-indent-alt--)
  - [16. 相邻参数对调 Transpose (Alt + Shift + L)](#16-相邻参数对调-transpose-alt--shift--l)
  - [17. 列表切分 Split (Alt + Shift + J)](#17-列表切分-split-alt--shift--j)
- [三、 Pure Strict Paredit 物理按键守卫算法](#三-pure-strict-paredit-物理按键守卫算法)
  - [3.1 退格键拦截状态机 (Backspace Guard)](#31-退格键拦截状态机-backspace-guard)
  - [3.2 删除键拦截状态机 (Delete Guard)](#32-删除键拦截状态机-delete-guard)
  - [3.3 不平衡选区删除拦截 (Unbalanced Selection Guard)](#33-不平衡选区删除拦截-unbalanced-selection-guard)
  - [3.4 闭括号穿透跳跃 (Close Delimiter Step-over)](#34-闭括号穿透跳跃-close-delimiter-step-over)
- [四、 全局窗口漫游与 Tab 轮转算法](#四-全局窗口漫游与-tab-轮转算法)
  - [4.1 焦点跳转算法 (Focus Editor / Terminal)](#41-焦点跳转算法-focus-editor--terminal)
  - [4.2 双向无缝回环切 Tab (Prev / Next Tab)](#42-双向无缝回环切-tab-prev--next-tab)
- [五、 事务原子性与并发互斥保护 (Parinfer Lock)](#五-事务原子性与并发互斥保护-parinfer-lock)

---

## 一、 语法模型与 AST 数据结构

### 1.1 节点定义 (SexpNode)
所有算法基于半开区间 `[start, end)` 进行偏移量度量（0-indexed 字符偏移量）：

```typescript
export interface SexpNode {
  start: number;       // 起始偏移量（包含该字符）
  end: number;         // 终止偏移量（不包含该字符）
  type: 'list' | 'atom' | 'string' | 'comment';
  openChar?: string;   // '(', '[', '{' (仅对 type === 'list' 有效)
  closeChar?: string;  // ')', ']', '}' (仅对 type === 'list' 有效)
  children?: SexpNode[];
}
```

### 1.2 容错 AST 解析器算法 (parseSexpressions)
为确保在用户实时键入、括号尚未完全闭合时不崩溃，解析器采用**栈式单遍有限状态机**，未闭合的括号自动在文本末尾隐式闭合。

#### 伪代码实现：
```typescript
function parseSexpressions(text: string): SexpNode[] {
  const stack: { node: SexpNode; children: SexpNode[] }[] = [];
  const roots: SexpNode[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    // 1. 跳过空白字符
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // 2. 单行注释：;.*$
    if (ch === ';') {
      const start = i;
      while (i < len && text[i] !== '\n') i++;
      const node: SexpNode = { start, end: i, type: 'comment' };
      if (stack.length > 0) stack[stack.length - 1].children.push(node);
      else roots.push(node);
      continue;
    }

    // 3. 字符字面量：#\space, #\a, #\( 等
    if (ch === '#' && i + 1 < len && text[i + 1] === '\\') {
      const start = i;
      i += 2;
      while (i < len && !/[\s()[\]{}";]/.test(text[i])) i++;
      const node: SexpNode = { start, end: i, type: 'atom' };
      if (stack.length > 0) stack[stack.length - 1].children.push(node);
      else roots.push(node);
      continue;
    }

    // 4. 字符串字面量："([^"\\]|\\.)*"
    if (ch === '"') {
      const start = i++;
      while (i < len) {
        if (text[i] === '\\' && i + 1 < len) {
          i += 2;
        } else if (text[i] === '"') {
          i++;
          break;
        } else {
          i++;
        }
      }
      const node: SexpNode = { start, end: i, type: 'string' };
      if (stack.length > 0) stack[stack.length - 1].children.push(node);
      else roots.push(node);
      continue;
    }

    // 5. 开括号：(, [, {
    if (ch === '(' || ch === '[' || ch === '{') {
      const node: SexpNode = {
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

    // 6. 闭括号：), ], }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.length > 0) {
        const top = stack.pop()!;
        top.node.end = i + 1;
        top.node.children = top.children;
        if (stack.length > 0) stack[stack.length - 1].children.push(top.node);
        else roots.push(top.node);
      }
      i++;
      continue;
    }

    // 7. 原子标识符/数字 (atom)
    const start = i;
    while (i < len && !/[\s()[\]{}";]/.test(text[i])) i++;
    const node: SexpNode = { start, end: i, type: 'atom' };
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    else roots.push(node);
  }

  // 8. 容错闭合：未配对的开括号直接延展至文本末尾
  while (stack.length > 0) {
    const top = stack.pop()!;
    top.node.end = len;
    top.node.children = top.children;
    if (stack.length > 0) stack[stack.length - 1].children.push(top.node);
    else roots.push(top.node);
  }

  return roots;
}
```

### 1.3 核心树检索辅助函数
在执行结构化操作时，需通过以下三个基础算法定位光标所处层级：

1. **`findEnclosingWithParent(roots, pos)`**：
   检索**严格包围**当前偏移量 `pos` 的最内层 `list` 节点及其直接父列表（`pos > node.start && pos < node.end`）。
2. **`findInnermostNodeAt(roots, pos)`**：
   检索覆盖 `pos` 的最小叶子节点（`pos >= node.start && pos <= node.end`）。
3. **`findTopLevelNode(roots, pos)`**：
   检索位于 `roots` 顶层且覆盖 `pos` 的最外层 S 表达式。

---

## 二、 17 个 Strict Paredit 快捷键算法规范

---

### 1. 向外扩选 Expand (Alt + K)
- **快捷键**：`Alt + K` (Win/Linux), `⌥ + K` (macOS)
- **动作目标**：在不破坏代码闭合性的前提下，将当前选区向外层 AST 节点扩散一层。
- **算法流程**：
  1. 计算当前选区在文档中的字符区间 `[from, to]`。若无选区，则 `from = to = cursorOffset`。
  2. 将当前选区压入全局撤销栈 `selectionHistoryStack.push(currentSelection)`（供收缩命令使用）。
  3. 优先调用 `paredit.navigator.sexpRangeExpansion(ast, from, to)`：
     - 若返回范围 `[r0, r1]` 满足 `r0 < from || r1 > to`，则设置选区为 `[r0, r1]`。
  4. 回退 AST 遍历法（AST Fallback）：
     - 递归遍历 `roots` 中所有节点，寻找满足 `node.start <= from && node.end >= to && (node.start < from || node.end > to)` 的候选节点中长度最小的节点 `candidate`。
     - 若找到 `candidate`，设置选区为 `[candidate.start, candidate.end]`。

---

### 2. 发射求值 Eval REPL (Alt + Enter / Ctrl + Enter)
- **快捷键**：`Alt + Enter` 或 `Ctrl + Enter` (Win/Linux), `⌥ + ↵` 或 `⌘ + ↵` (macOS)
- **动作目标**：提取当前选区或光标所在 S 表达式代码块，高亮闪烁，并立即送入 Steel REPL 求值。
- **算法流程**：
  1. **提取代码**：
     - 若选区非空，直接取选区文本 `code = text[start..end]`。
     - 若选区为空，根据光标偏移量 `offset` 匹配目标节点：
       - `target = searchNodeEndingAt(roots, offset) || enclosingList || innermostNode`
       - 若 `target` 存在，`code = text[target.start..target.end]`。
       - 否则降级取光标当前整行内容。
  2. **视觉闪烁反馈 (Visual Flash)**：
     - 在编辑器对应 Range 上挂载 `.eval-flash` CSS 装饰器，延时 350ms 自动清除。
  3. **REPL 发射分发**：
     - 若代码包含多个顶层表达式（非注释行），自动包裹 `(begin \n ... \n)` 确保原子求值。
     - 将命令字符串写入终端或通过 `/api/eval` 异步提交给 Steel 引擎。

---

### 3. 圆括号包裹 Wrap Parens - Calva 智能吸附 (Alt + H)
### 4. 方括号包裹 Wrap Square - Calva 智能吸附 (Alt + Shift + H)
- **快捷键**：
  - 圆括号：`Alt + H` (Win/Linux), `⌥ + H` (macOS)
  - 方括号：`Alt + Shift + H` (Win/Linux), `⌥ + ⇧ + H` (macOS)
- **参数**：圆括号 `openChar = '(', closeChar = ')'`；方括号 `openChar = '[', closeChar = ']'`。
- **算法原理 (Calva Smart Affinity 智能吸附)**：
  根据光标与周围 token 的相对几何贴合状态，智能判定是左吸附、右吸附还是就地插入。

```
                ┌─── selection 非空 ───> 直接包裹选中区间
                │
                ├─── 1. 贴尾吸附: pos == s.end && !isSpace(text[pos-1]) ───> 包裹左侧兄弟 (define|)
                │
siblings 匹配 ──┼─── 2. 内部吸附: s.start < pos && pos < s.end ────────────> 包裹所在符号 (def|ine)
                │
                ├─── 3. 头部吸附: s.start == pos ──────────────────────────> 包裹右侧兄弟 (|define)
                │
                ├─── 4. 空格前向: s.start > pos ───────────────────────────> 包裹下一个兄弟 define (|x)
                │
                └─── 5. 无目标: 空白行或无兄弟节点 ─────────────────────────> 就地插入空括号对 (|)
```

#### 形式化算法伪代码 (`computeSmartWrap`)：
```typescript
function computeSmartWrap(text: string, pos: number, openChar = '(', closeChar = ')') {
  // 1. 若有活动选区，直接返回包裹选区
  if (selection && !selection.isEmpty) {
    return { rangeStart: sel.start, rangeEnd: sel.end, replacement: `${openChar}${selText}${closeChar}` };
  }

  const roots = parseSexpressions(text);
  const { enclosing } = findEnclosingWithParent(roots, pos);
  const siblings = (enclosing ? (enclosing.children || []) : roots)
    .filter(n => n.type !== 'comment');

  let target: SexpNode | null = null;
  let cursorType: 'end' | 'inside' | 'start' | 'forward' | 'empty' = 'start';

  // 1. 贴尾吸附 (Left Affinity / define| x)
  const touchingEnd = siblings.find(s => s.end === pos && pos > 0 && !/\s/.test(text[pos - 1]));
  if (touchingEnd) {
    target = touchingEnd;
    cursorType = 'end';
  }

  // 2. 内部吸附 (Inside token / def|ine)
  if (!target) {
    const inside = siblings.find(s => s.start < pos && pos < s.end);
    if (inside) {
      target = inside;
      cursorType = 'inside';
    }
  }

  // 3. 头部吸附 (Touching start / |define 或 define |x)
  if (!target) {
    const touchingStart = siblings.find(s => s.start === pos);
    if (touchingStart) {
      target = touchingStart;
      cursorType = 'start';
    }
  }

  // 4. 空白处前向吸附 (Forward sibling in whitespace / define  |  x)
  if (!target) {
    const forward = siblings.find(s => s.start > pos);
    if (forward) {
      target = forward;
      cursorType = 'forward';
    }
  }

  // 计算替换内容与新光标位置
  if (target) {
    const targetText = text.slice(target.start, target.end);
    let newOffset: number;
    if (cursorType === 'end') {
      newOffset = target.end + openChar.length;       // (define|) 停在右括号内侧紧随单词
    } else if (cursorType === 'inside') {
      newOffset = pos + openChar.length;              // (def|ine) 保持相对字母位置
    } else {
      newOffset = target.start + openChar.length;     // (|define) 停在开括号右侧
    }
    return {
      rangeStart: target.start,
      rangeEnd: target.end,
      replacementText: `${openChar}${targetText}${closeChar}`,
      newOffset
    };
  } else {
    // 5. 空白行或无目标：就地插入空对
    return {
      rangeStart: pos,
      rangeEnd: pos,
      replacementText: `${openChar}${closeChar}`,
      newOffset: pos + openChar.length                // (|) 停在两个括号正中间
    };
  }
}
```

---

### 5. 向右吞噬 Slurp Forward (Alt + L)
- **快捷键**：`Alt + L` (Win/Linux), `⌥ + L` (macOS)
- **动作目标**：光标所在列表的右闭合括号向右越过右侧相邻兄弟节点：`(a b|) c` $\rightarrow$ `(a b c|)`。
- **算法流程**：
  1. 调用 `paredit.editor.slurpSexp(ast, text, pos, { backward: false, count: 1 })`。
  2. 若原生实现失败，执行 AST 回退流程：
     - `enclosing = findEnclosingWithParent(roots, pos).enclosing`。
     - 若 `!enclosing`，终止（无法向外吞噬）。
     - 取 `enclosing` 的父级兄弟列表 `siblings`，找到 `enclosing` 在列表中的索引 `idx`。
     - 若 `idx >= siblings.length - 1`，终止（右侧无下一个兄弟）。
     - `nextSibling = siblings[idx + 1]`。
     - **原子编辑集**：
       - 操作 1：在 `nextSibling.end` 处插入闭括号 `enclosing.closeChar`。
       - 操作 2：在原 `enclosing.end - 1` 到 `enclosing.end` 处删除原闭括号；若原闭括号与下一个兄弟紧密相连无空格，补充单个空格。

---

### 6. 向左吐出 Barf Forward (Alt + J)
- **快捷键**：`Alt + J` (Win/Linux), `⌥ + J` (macOS)
- **动作目标**：光标所在列表的右闭括号向左收缩，踢出末尾项：`(a b c|) ` $\rightarrow$ `(a b|) c`。
- **算法流程**：
  1. 调用 `paredit.editor.barfSexp(ast, text, pos, { backward: false, count: 1 })`。
  2. 若原生失败，执行 AST 回退流程：
     - `enclosing = findEnclosingWithParent(roots, pos).enclosing`。
     - 若 `!enclosing || enclosing.children.length === 0`，终止。
     - `lastChild = enclosing.children[enclosing.children.length - 1]`。
     - 计算新的闭括号插入点 `insertOffset`：
       - 若 `enclosing.children.length > 1`，`insertOffset = enclosing.children[last - 1].end`。
       - 否则 `insertOffset = enclosing.start + 1`。
     - **原子编辑集**：
       - 删除原末尾括号区间 `[enclosing.end - 1, enclosing.end)`。
       - 在 `insertOffset` 处插入 `enclosing.closeChar`（若与 `lastChild` 粘连，后附空格）。

---

### 7. 向内收缩 Contract (Alt + Shift + K / Alt + I)
- **快捷键**：`Alt + Shift + K` (Win/Linux), `⌥ + ⇧ + K` (macOS)
- **动作目标**：配合 `Alt + K`，将过大的选区逐级缩小撤回；若无选区，则将包围当前光标的表达式向内收缩一级。
- **算法流程**：
  1. **优先检查选区历史栈**：
     - `while (selectionHistoryStack.length > 0)`：
       - 弹出栈顶选区 `prev`。
       - 若 `prev` 严格包含于当前选区或与当前选区不同，直接恢复 `editor.setSelection(prev)` 并返回。
  2. **AST 回退收缩**：
     - 若当前选区 `[from, to]` 非空，遍历 AST 寻找位于 `[from, to]` 内部且严格小于该区间的最大子节点 `best`（优先选取包含当前光标位置的子节点）。
     - 设置新选区为 `[best.start, best.end]`。
     - 若已为不可再分的单个 atom，将选区塌缩回单点光标。

---

### 8. 选中顶级函数 Select Defun (Alt + 3)
- **快捷键**：`Alt + 3` (Win/Linux), `⌥ + 3` (macOS)
- **动作目标**：无论光标深陷在多少层嵌套括号内，一键选中最外层包含该光标的整个顶级定义（Top-level form）。
- **算法流程**：
  1. 优先调用 `paredit.navigator.rangeForDefun(ast, pos)`，获取返回区间 `[r0, r1]`。
  2. 若原生未返回，遍历 `roots` 顶层节点列表：
     - 查找满足 `pos >= root.start && pos <= root.end` 的顶层节点 `top`。
     - 设置编辑器选区为 `[top.start, top.end]`，并视口平滑滚动至该范围。

---

### 9. 脱壳解包 Splice (Alt + O)
- **快捷键**：`Alt + O` (Win/Linux), `⌥ + O` (macOS)
- **动作目标**：剥除当前所在列表的外层开闭括号，提升内部所有子项：`(let () (expr|))` $\rightarrow$ `(expr|)`。
- **算法流程**：
  1. 优先调用 `paredit.editor.spliceSexp(ast, text, pos)`。
  2. AST 回退算法：
     - `enclosing = findEnclosingWithParent(roots, pos).enclosing`。
     - 若 `!enclosing` 则终止。
     - 提取内部源码：`innerText = text.slice(enclosing.start + 1, enclosing.end - 1)`。
     - 替换目标范围 `[enclosing.start, enclosing.end)` 为 `innerText`。

---

### 10. 大步前进 Forward Sexp (Alt + 2)
- **快捷键**：`Alt + 2` (Win/Linux), `⌥ + 2` (macOS)
- **动作目标**：以「头部到头部 (Head-to-Head)」规则向右跨越整组 S 表达式，越过注释，停留在下一个兄弟节点起始处。
- **算法流程**：
  1. 尝试 `target = paredit.navigator.forwardSexp(ast, pos)`。
     - 若 `target > pos`，继续向右扫描跳过后续空白字符和注释行，直到抵达下一个 token 起始字符或外层闭括号。
  2. 若光标正位于闭括号前（`text[pos] === ')'`），步进跨过闭括号。
  3. AST 回退算法：
     - 取当前层级代码兄弟列表 `codeSiblings`（过滤注释）。
     - 寻找首个满足 `s.start > pos` 的兄弟 `next`，跳至 `next.start`。
     - 若右侧无兄弟，跳出至外层闭括号右侧 `enclosing.end`。

---

### 11. 大步后退 Backward Sexp (Alt + 1)
- **快捷键**：`Alt + 1` (Win/Linux), `⌥ + 1` (macOS)
- **动作目标**：以「头部到头部」规则向左跨越整组 S 表达式，跳过注释，停留在前一个兄弟节点起始处。
- **算法流程**：
  1. 尝试 `target = paredit.navigator.backwardSexp(ast, pos)`。
     - 若 `target < pos` 且命中注释，循环向前推导至非注释起始位。
  2. 若光标紧贴在开括号之后（`text[pos - 1] === '('`），后退一步跳至开括号前 `pos - 1`。
  3. AST 回退算法：
     - 取当前层级代码兄弟列表，筛选所有 `s.start < pos` 的候选节点。
     - 选取最靠右的一个候选节点，光标跳转至其起始偏移量 `prev.start`。
     - 若左侧无兄弟，跳出至外层开括号左侧 `enclosing.start`。

---

### 12. 步进深入 Step Into / Down (Alt + W)
- **快捷键**：`Alt + W` (Win/Linux), `⌥ + W` (macOS)
- **动作目标**：光标直接步进钻入右侧或当前第一个子列表的开括号内部：`| (a b)` $\rightarrow$ `(|a b)`。
- **算法流程**：
  1. 尝试 `target = paredit.navigator.forwardDownSexp(ast, pos)`。
  2. AST 回退：
     - 在当前 `enclosing` 内部或后续兄弟中寻找第一个类型为 `'list'` 的节点 `childList`。
     - 将光标偏移量移动到 `childList.start + 1`（紧贴开括号右侧）。

---

### 13. 步退跳出 Step Out / Up (Alt + S)
- **快捷键**：`Alt + S` (Win/Linux), `⌥ + S` (macOS)
- **动作目标**：光标向外层跳出，落在当前包围列表的开括号左侧前置位：`((|a b) c)` $\rightarrow$ `(|(a b) c)`。
- **算法流程**：
  1. 尝试 `target = paredit.navigator.backwardUpSexp(ast, pos)`。
  2. AST 回退：
     - `enclosing = findEnclosingWithParent(roots, pos).enclosing`。
     - 若光标已处于 `enclosing.start`，则跳至其父级 `parent.start`。
     - 将光标移动到目标开括号位置。

---

### 14. 向后整块删除 Kill Sexp (Alt + X)
- **快捷键**：`Alt + X` (Win/Linux), `⌥ + X` (macOS)
- **动作目标**：向右删除光标后的整个下一个完整子表达式（不破坏任何结构括号，完全避免与 Chrome 地址栏快捷键冲突）。
- **算法流程**：
  1. 优先调用 `paredit.editor.killSexp(ast, text, pos, { count: 1, backward: false })`。
  2. AST 回退：
     - 在当前层兄弟中找到第一个 `next.start >= pos` 的节点。
     - 删除区间 `[pos, next.end)` 内的文本。

---

### 15. 智能格式排版 Indent (Alt + \)
- **快捷键**：`Alt + \` (Win/Linux), `⌥ + \` (macOS)
- **动作目标**：对当前选区或光标所在 S 表达式按 Lisp 标准缩进对齐规范重新排版，**保证严格幂等性**（按多次代码绝不位移变形）。
- **算法流程**：
  1. 解析全文 AST，若存在未闭合严重语法错误则中止排版以防代码污染。
  2. 确定排版区间 `[startOffset, endOffset]`：
     - 若有选区，取选区范围；
     - 若无选区，取当前顶层节点 `top` 或外层节点 `enclosing` 的区间 `[target.start, target.end]`。
  3. 执行 `paredit.editor.indentRange(ast, text, startOffset, endOffset)`：
     - 若局域排版无变更且无活动选区，尝试对全文 `[0, text.length]` 执行统一排版。
  4. 应用文本替换后，通过 `Math.min(curPos.column, lineMaxCol)` 精确恢复光标相对位置。

---

### 16. 相邻参数对调 Transpose (Alt + Shift + L)
- **快捷键**：`Alt + Shift + L` (Win/Linux), `⌥ + ⇧ + L` (macOS)
- **动作目标**：交换光标左右两侧的两个相邻同级 S 表达式或参数：`(equal? a| b)` $\rightarrow$ `(equal? b| a)`。
- **算法流程**：
  1. 尝试 `paredit.editor.transpose(ast, text, pos, {})`。
  2. AST 回退：
     - 寻找满足 `siblings[i].end <= pos && siblings[i + 1].start >= pos` 的相邻节点对 `(prev, next)`。
     - 若光标位于某个节点内部，则选择该节点与其右侧（或左侧）相邻节点作为对调对。
     - 提取 `between = text.slice(prev.end, next.start)`。
     - 替换区间 `[prev.start, next.end)` 为 `${nextText}${between}${prevText}`。

---

### 17. 列表切分 Split (Alt + Shift + J)
- **快捷键**：`Alt + Shift + J` (Win/Linux), `⌥ + ⇧ + J` (macOS)
- **动作目标**：在当前光标位置将外层列表分裂为两个独立的相邻同类型列表：`(a b | c d)` $\rightarrow$ `(a b) (c d)`。
- **算法流程**：
  1. 尝试 `paredit.editor.splitSexp(ast, text, pos)`。
  2. AST 回退：
     - 取当前包含列表 `enclosing`。
     - 裁剪光标左右两侧的多余连续空白，确定分裂替换区间 `[splitStart, splitEnd]`。
     - 构造分裂串：`insertText = `${enclosing.closeChar} ${enclosing.openChar}``。
     - 替换 `[splitStart, splitEnd]` 为 `insertText`，光标落在新开括号后。

---

## 三、 Pure Strict Paredit 物理按键守卫算法

Strict Paredit 的精髓在于**彻底拦截可能破坏 AST 括号对称性的破坏性物理击键**。所有普通按键在 Monaco / 文本输入流的 `onKeyDown` 阶段优先经过此守卫。

```
用户敲击物理键 (Backspace / Delete / ) / ] / ")
       │
       ▼
 [文件为 .scm 且开启 Strict Paredit] ─── 否 ───> 放行 (默认 Monaco 行为)
       │ 是
       ├── 1. Backspace:
       │      ├─ 选区存在 ───> 检查选区是否破坏括号树结构 ─── 破坏则拦截，平衡则删除
       │      ├─ 光标在 '(|foo)' ───> 拦截破坏性删除
       │      ├─ 光标在 '(foo)|' ───> 跃迁步进至内部 '(foo|)' (不删括号)
       │      └─ 光标在 '(|)' ──────> 成对删除左右双括号
       │
       ├── 2. Delete:
       │      ├─ 光标在 '(foo|)' ───> 拦截破坏性删除
       │      └─ 光标在 '|()' ──────> 成对删除左右双括号
       │
       └── 3. 闭合键 ( ) / ] / " ):
              └─ 光标紧贴闭合符 ───> 直接跳过该闭合符 (不插入多余重复括号)
```

### 3.1 退格键拦截状态机 (Backspace Guard)
当按下物理退格键 `Backspace` 时：
1. **单点光标位于非空列表开括号右侧**（如 `(|foo)`）：
   - `e.preventDefault(); e.stopPropagation(); return true;`（**硬拦截**，严禁单边删除开括号破坏语法树）。
2. **单点光标位于空括号对中间**（如 `(|)` 或 `[|]`）：
   - 成对协同删除：原子性同时删除开括号和闭括号，代码变为清空状态。
3. **单点光标位于闭括号右侧**（如 `(foo)|`）：
   - 不删除闭括号，而是将光标步进跳入括号内侧 `(foo|)`。

### 3.2 删除键拦截状态机 (Delete Guard)
当按下物理删除键 `Delete` 时：
1. **单点光标位于非空列表闭括号左侧**（如 `(foo|)`）：
   - **硬拦截**，严禁单边删除闭括号。
2. **单点光标位于空括号对左侧**（如 `|()`）：
   - 成对协同删除两端括号。

### 3.3 不平衡选区删除拦截 (Unbalanced Selection Guard)
当用户通过鼠标或自由选区选中了一段代码并按下 `Backspace` 或 `Delete`：
1. 调用 `paredit.editor.delete(ast, src, startOffset, { endIdx: endOffset })` 进行试探性结构验证。
2. 若选区截断了单边未配对括号（例如仅选中了 `foo) (bar` 中的 `) (`）：
   - 该操作返回 `null`。
   - 守卫拦截该事件（阻止默认删除），并在 UI 提示 `Selection cuts across unbalanced parens!`，保护语法树不被破坏。
3. 若选区内括号自洽平衡：
   - 允许安全执行结构化剔除。

### 3.4 闭括号穿透跳跃 (Close Delimiter Step-over)
当用户键入 `)`、`]` 或 `"` 时：
- 若光标紧贴在相同类型的闭合字符前（如光标在 `(foo|)` 时敲击 `)`）：
  - 拦截默认字符插入。
  - 光标向右穿透跳过该闭合字符，避免产生语法错误的双括号 `(foo))`。

---

## 四、 全局窗口漫游与 Tab 轮转算法

为支持在纯键盘流下跨 Monaco 编辑器和 xterm.js 终端高效作业，系统定义了全局最高优先级的导航快捷键矩阵。

| 快捷键 (Linux/Win) | macOS (⌥) | 动作目标 | 算法逻辑 |
| :--- | :--- | :--- | :--- |
| **`Alt + Shift + Up`** | **`⌥ + ⇧ + ↑`** | **聚焦编辑器** | 聚焦左侧 Monaco 编辑器。若当前无打开文件，自动创建新 `scratch-*.scm` 缓冲区并激活。 |
| **`Alt + Shift + Down`** | **`⌥ + ⇧ + ↓`** | **聚焦终端** | 拦截系统转义符，立即将焦点聚焦至右侧活动终端（λ REPL 或 bash）。 |
| **`Alt + Shift + Left`** | **`⌥ + ⇧ + ←`** | **向前切 Tab (回环)** | 在当前活动分区内向左切换标签页。**若处于第 1 个 Tab，自动回环至末尾 Tab**。 |
| **`Alt + Shift + Right`** | **`⌥ + ⇧ + →`** | **向后切 Tab (回环)** | 在当前活动分区内向右切换标签页。**若处于末尾 Tab，自动回环至第 1 个 Tab**。 |

### 循环切换伪代码 (Wrap-Around Algorithm)：
```typescript
function cycleTab(tabs: Tab[], currentId: string, direction: 1 | -1): string {
  const currentIndex = tabs.findIndex(t => t.id === currentId);
  if (currentIndex === -1 || tabs.length <= 1) return currentId;
  const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
  return tabs[nextIndex].id;
}
```

---

## 五、 事务原子性与并发互斥保护 (Parinfer Lock)

在 Strict Paredit 对文档进行结构化变换时，必须防止与后台运行的 Parinfer 自动对齐或 Monaco 异步语法分析器发生写写冲突。

```typescript
let isParinferLocked = false;

export function withParinferLock<T>(fn: () => T): T {
  const wasLocked = isParinferLocked;
  isParinferLocked = true;
  try {
    return fn();
  } finally {
    isParinferLocked = wasLocked;
  }
}
```

### 事务原子性规则：
1. **单个撤销事务封装**：
   在所有 17 个快捷键的编辑动作中，统一使用：
   ```typescript
   withParinferLock(() => {
     editor.pushUndoStop();           // 开启事务边界
     editor.executeEdits('paredit', edits);
     editor.setPosition(newPosition); // 设置新光标位置
     editor.revealPosition(newPosition);
     editor.pushUndoStop();           // 闭合事务边界
   });
   ```
2. **效果**：
   用户只需按一次 `Ctrl + Z`（或 `⌘ + Z`），即可完整回滚包含括号变形与光标移动的整个原子操作，绝不遗留半括号或错乱缩进。
