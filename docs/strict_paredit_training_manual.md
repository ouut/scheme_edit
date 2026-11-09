# Scheme Strict Paredit 现代实战开发与肌肉记忆训练手册

> 本指南配合本地编辑器（`http://localhost:3000`）内置的互动靶场，系统性拆解如何彻底摆脱低效的字符/光标编辑，运用 17 个专属快捷键以 **S 表达式（AST 树节点）** 为单位流畅构思与重构代码。

---

## 🧠 核心心智模型（The Strict Paredit Mindset）

在传统编辑器中，写 Lisp/Scheme 最痛苦的莫过于“括号地狱”：数括号、删错括号、缩进混乱。而在 Strict Paredit 哲学下：

1. **括号结构是神圣不可侵犯的实体**：括号永远平衡，代码只能在合法树结构间变形。
2. **永远不要手工键入或删除单边括号**：
   * 想把代码套进括号？用 **`Alt + H`**（圆括号）或 **`Alt + Shift + H`**（方括号）。
   * 想把外部代码纳入现有括号？用 **`Alt + L`**（Mac: `⌥ L`，向右吞噬 Slurp）。
   * 想把括号内末尾项踢出去？用 **`Alt + J`**（Mac: `⌥ J`，向左吐出 Barf）。
   * 想去掉一层外壳括号？用 **`Alt + O`**（Mac: `⌥ O`，脱壳解包 Splice）。
3. **手指定位基准（右手 H-J-K-L 四轴八态主键矩阵）**：
   * `H`（圆括号 `Alt + H` / 方括号 `Alt + Shift + H`） $\rightarrow$ Hold/Hug 包裹
   * `J`（左吐出 `Alt + J` / 切分 `Alt + Shift + J`） $\rightarrow$ 向左收缩与切分
   * `K`（外扩 `Alt + K` / 内缩 `Alt + Shift + K`） $\rightarrow$ 纵向呼吸
   * `L`（右吸入 `Alt + L` / 对调 `Alt + Shift + L`） $\rightarrow$ 向右吞入与对调

---

## 🥋 六大实战训练场景与代码变形演练

---

### 场景 1：探针式交互求值流（The Probe REPL Loop）

在 Lisp/Scheme 核心开发循环中，最强大的能力是**不需要重启程序，任意探测深层局部逻辑并验证**。

#### 🎯 训练目标：
定位深层递归项 `(- n 2)`，验证其值，收缩微调，最后选中并重新编译整个外层函数。

```scheme
;; 原始代码
(define (fib n)
  (cond
    [(= n 0) 0]
    [(= n 1) 1]
    [else (+ (fib (- n 1))
             (fib (- n 2)))]))
```

#### 🛠️ 实战步骤：

| 步骤 | 操作 | 按键 | 代码视觉效果 | 心理预期 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 光标停在 `2` 上 | 无 | `(- n \|2)` | 准备探测局部运算 |
| 2 | 向外扩选一层 | **`Alt + K`** | 选中 `2` | 激活当前叶子节点 |
| 3 | 连按向外扩选 | **`Alt + K`** | 严格选中 `(- n 2)` | 圈定完整子树 |
| 4 | 发射求值 | **`Alt + Enter`** | 右下角 REPL 吐出局部结果 | 验证该局部表达式逻辑正确 |
| 5 | 继续向外扩选 | **`Alt + K`** | 扩展选中 `(fib (- n 2))` | 向上推演一级 |
| 6 | 发现选过头了，收缩回一级 | **`Alt + Shift + K`** | 恢复选中 `(- n 2)` | 随时反悔，加按 Shift 极速回退（兼容 `Alt+I`） |
| 7 | 选中最外层函数 | **`Alt + 3`** | 一键整块高亮整个 `(define (fib n) ...)` | 定点直达顶层，无需手动滑动鼠标 |
| 8 | 编译函数入 REPL | **`Alt + Enter`** | 整个函数编译进 Steel 解释器 | 准备好供后续代码调用 |

---

### 场景 2：变量提升与快速包裹术（Wrap & Promote Pattern）

#### 🎯 训练目标：
将裸变量快速转化为函数调用，以及将局部变量绑定转换为 `let*` 规范的方括号形式。

```scheme
;; [阶段 A 初始]: 只有单个变量 cards
cards

;; [阶段 A 动作]: 光标停在 cards 上，按 [Alt + H] -> 瞬间包裹
(cards)

;; [阶段 A 完成]: 直接键入 shuffle 空格，单键完成函数化封装！
(shuffle cards)

;; [阶段 B 初始]: let* 局部变量初始键值对裸露
(let* (x 100)
  (+ x 1))

;; [阶段 B 动作]: 光标选中 x 100，按 [Alt + Shift + H] -> 规范方括号
(let* ([x 100])
  (+ x 1))
```

* **最佳实践心得**：
  * **`Alt + H`（圆括号包裹）**：当你写完参数才想起来需要套一层函数时，绝对不需要跳到行首打 `(`，只需原地按 `Alt + H`，立刻变成函数调用！
  * **`Alt + Shift + H`（方括号包裹）**：编写 `cond` 条件分支、`let*` 局部绑定的利器。

---

### 场景 3：树形左右边界吞吐（Slurp & Barf Stream）

这是 Lisp 开发者使用最频繁的“空间伸缩”绝技。

#### 🎯 训练目标：
修正布尔逻辑判定——将漏在外面的参数吸入 `and` 列表；若吸错了立即吐出。

```scheme
;; 错误代码：has-permission? 漏在 and 括号外面！
(if (and (user-logged-in? u) (user-admin? u)) has-permission?
    "Access Denied"
    "Access Granted")
```

#### 🛠️ 变形步骤：

1. **吞入（Slurp）**：
   * 将光标停留在 `(user-admin? u)` 内部任意位置。
   * 按下 **`Alt + L`**（Mac: `⌥ L`，向右吞噬）：
   ```scheme
   (if (and (user-logged-in? u) (user-admin? u) has-permission?)
       "Access Denied"
       "Access Granted")
   ```
   * *原理解释*：`and` 的右闭合括号 `)` 自动向右跨越一个完整的 S 表达式 `has-permission?`，将其吸入腹中！

2. **吐出（Barf）**：
   * 假设此时发现逻辑不对，`has-permission?` 不该在 `and` 里。
   * 光标仍然留在 `and` 内部，按一下 **`Alt + J`**（Mac: `⌥ J`，向左吐出）：
   ```scheme
   (if (and (user-logged-in? u) (user-admin? u)) has-permission?
       "Access Denied"
       "Access Granted")
   ```
   * *原理解释*：`and` 的右括号向左收缩，踢出末尾项，恢复原状！

---

### 场景 4：结构脱壳与无伤清理（Splice & Kill Pattern）

#### 🎯 训练目标：
解开冗余的包装层，或者抹除整棵子语法树，保证闭合结构 100% 完好。

#### 练习 A：脱壳解包（Splice）
```scheme
;; 原始代码：存在冗余的 (begin ...) 包装
(define (unnecessary-wrapper)
  (begin
    (displayln "Pure Action")
    (+ 10 20)))
```
* **操作**：将光标放在 `begin` 单词上或紧靠其右侧，按下 **`Alt + O`**（Open/Splice）。
* **变形后**：
```scheme
(define (unnecessary-wrapper)
  (displayln "Pure Action")
  (+ 10 20))
```
* *原理解释*：外层的括号和 `begin` 像蛋壳一样碎裂剥离，内部代码全部完整保留！

#### 练习 B：向后整块删除（Kill Sexp）
```scheme
;; 原始代码：包含一个超长的废弃嵌套表达式需要删除
(list 10 20 (useless-garbage-expression (+ 1 2) "drop me") 30 40)
```
* **操作**：将光标停在 `(useless...` 最左侧的 `(` 前面，按下 **`Alt + X`**（eXterminate 删词，完全避开 Chrome 地址栏抢焦）。
* **变形后**：
```scheme
(list 10 20 30 40)
```
* *原理解释*：光标右侧无论嵌套了多少层子树，一键彻底蒸发，不留悬空括号！

---

### 场景 5：纯键盘三维空间漫游（Navigation Traversal）

彻底扔掉鼠标，在深层 AST 树中像打电竞一样高速走位。

```scheme
(pipeline
  (step-one x)
  (step-two (inner-detail (deep-leaf x)))
  (step-three x))
```

#### 🧭 走位罗盘对照表：

| 动作 | 快捷键 | 视觉感受与逻辑 |
| :--- | :--- | :--- |
| **步进深入 (Step Into)** | **`Alt + W`** | 类似前进深入，瞬间跳进当前括号内部最左侧第一个参数前（深入深层） |
| **步退跳出 (Step Out)** | **`Alt + S`** | 类似后退撤出，瞬间跳出当前层，回到外层父括号前（撤出外层） |
| **大步前进 (Forward)** | **`Alt + 2`** | 跨过右侧整组完整 S 表达式（数字 2 向右） |
| **大步后退 (Backward)** | **`Alt + 1`** | 倒退跨过左侧整组完整 S 表达式（数字 1 向左） |

* **走位实战连招**：
  在 `(pipeline ...)` 最左侧：
  `Alt + W`（深入第一层） $\rightarrow$ `Alt + 2`（跨过 step-one 进入 step-two） $\rightarrow$ `Alt + W`（深入 step-two 内部） $\rightarrow$ 瞬间抵达核心逻辑！

---

### 场景 6：高阶重组（Transpose, Split & Indent）

#### 练习 A：相邻参数对调（Transpose）
```scheme
;; 参数顺序写反了：
(equal? expected actual)
```
* **操作**：将光标放在两个参数之间，按 **`Alt + Shift + L`**（Leap swap 横向对调）。
* **变形后**：`(equal? actual expected)`，两项瞬间对调！

#### 练习 B：列表切分（Split）
```scheme
;; 单个列表太长，想在 30 后面切分为两段：
(list 10 20 30 | 40 50 60)
```
* **操作**：将光标停在 30 与 40 之间的空格处，按 **`Alt + Shift + J`**（Joint cut，列表切分）。
* **变形后**：`(list 10 20 30) (40 50 60)`，瞬间裂变为两个独立列表！

#### 练习 C：智能对齐排版（Indent）
* **操作**：无论代码缩进被弄得多乱，按一下 **`Alt + \`**（反斜杠一键排版，完全避开 Chrome 菜单），Parinfer 会根据括号层级一键自动对齐到教科书级 Lisp 规范！

---

## ⚡ 终极连招速查配方（Muscle Memory Combos）

1. **“闪电包装 + 吞噬” 连招**：
   `光标在参数上` $\rightarrow$ `Alt + H`（套括号） $\rightarrow$ `输入函数名 + 空格` $\rightarrow$ `Alt + L`（把下一个参数吸入）。
2. **“安全重构” 连招**：
   `Alt + K`（向外扩选确认范围） $\rightarrow$ 确认高亮区域正是目标 $\rightarrow$ `Alt + X` 或 `Backspace` 一键清除。
3. **“交互求值闭环” 连招**：
   `Alt + 3`（选中顶级函数） $\rightarrow$ `Alt + Enter`（编译至 REPL） $\rightarrow$ 光标移到文件底部的调用例句 $\rightarrow$ `Alt + Enter`（查看最终运行结果）。
