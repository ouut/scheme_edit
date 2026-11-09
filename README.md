# Scheme Strict Paredit Editor & Tester

一个基于 **Monaco Editor**、**Paredit.js**、**Parinfer** 与 **Rust (Axum + 常驻 Steel REPL)** 的现代化 Scheme 编辑器与快捷键测试环境。

专为严格测试 [`docs/strict_paredit_guide.md`](docs/strict_paredit_guide.md) 中定义的 **17 个单发（One-Shot）极速快捷键** 而设计。

---

## 🚀 极速启动

在项目根目录下直接运行：

```bash
./start.sh
# 或
./start
```

打开浏览器访问：
* 本机 / 端口转发访问：**`http://localhost:3000`**
* 宿主机 (Mac) 浏览器直连：**`http://192.168.64.3:3000`**（根据虚拟机 IP 直连）
* 或在 VS Code 底部「端口 (PORTS)」面板添加转发 `3000` 端口后访问 `http://localhost:3000`。

---

## ✨ 核心特性

1. **17 个 Strict Paredit 专属快捷键全覆盖**：
   - 包含向外扩选、向内收缩、发射求值、圆/方括号包裹、吞噬/吐出、脱壳解包、顶级函数选择、前进后退、深度钻入、向上跳出、整块删除、智能缩进、参数对调与列表切分。
   - 右手全面构建在 **`H-J-K-L` 四轴八态主键矩阵**，彻底脱离 macOS 全部 5 大系统死键（`E, U, I, N, ~`），无论输入法何种状态均 100% 免疫死键拦截与字符泄漏！
   - Monaco 与全局事件双层拦截，解决浏览器菜单抢焦与系统默认快捷键冲突。
2. **实时 HUD 快捷键闪烁看板（Flash Effect）**：
   * 右侧常驻 17 键交互看板（按 5 星至 1 星频率排序）。
   * 键盘按下任意对应快捷键时，看板上对应卡片产生高亮发光动效（Glow Flash），并在底部记录精确到毫秒的操作日志。
3. **工业级常驻 Steel Scheme REPL 引擎**：
   * 原生 Rust 后端运行常驻 **Steel Scheme 0.8.2** 解释器，单次求值耗时仅 **5~7ms**。
   * **全局状态持久化**：`define` 函数/变量、`set!` 状态修改、闭包与 `define-syntax` 宏定义在内存会话中持久保留。
   * **按需依赖隔离**：自动分析直接与间接引用依赖，绝不会受到文件中其他未完成练习或语法草稿的污染。
   * **REPL 交互式命令行**：底部 REPL 面板提供专用的 `λ >` 输入行，支持直接键入回车求值，并支持键盘 `↑` / `↓` 浏览历史指令。
   * **双重安全防护**：0ms 未闭合括号语法即时拦截，5 秒超时自动熔断保护。
4. **Parinfer 智能/括号双模**：
   * 顶部工具栏支持在 **Paren Mode**（默认保护结构）、**Smart Mode** 与 **关闭** 之间无缝切换。
5. **Rust 高性能静态服务器**：
   * 编译为原生 Release 二进制（`server/target/release/server`），内存占用低，托管前端静态资源并提供 CORS 支持与 SPA fallback。

---

## ⌨️ 17 个快捷键速查表

| 频级 | Windows / Linux | macOS (⌥ Option) | 命令动作 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- |
| ⭐⭐⭐⭐⭐ (45%) | **`Alt + K`** | **`⌥ + K`** | **向外扩选** (Expand) | 自动严丝合缝选中当前 `(...)`，连按扩大一层括号 |
| ⭐⭐⭐⭐⭐ (45%) | **`Alt + Enter` / `Ctrl + Enter`** | **`⌥ + ↵` / `⌘ + ↵`** | **发射求值** (Eval REPL) | 选中代码或当前表达式立即送入 Steel REPL |
| ⭐⭐⭐⭐ (25%) | **`Alt + H`** | **`⌥ + H`** | **圆括号包裹** (Wrap Parens) | `cards` $\rightarrow$ `(cards)`（Hold/Hug 零死键） |
| ⭐⭐⭐⭐ (25%) | **`Alt + Shift + H`** | **`⌥ + ⇧ + H`** | **方括号包裹** (Wrap Square) | `x 10` $\rightarrow$ `[x 10]`（Hold square 零死键） |
| ⭐⭐⭐⭐ (20%) | **`Alt + L`** | **`⌥ + L`** | **向右吞噬** (Slurp) | `(a b) c` $\rightarrow$ `(a b c)`（L 偏右吸入） |
| ⭐⭐⭐⭐ (20%) | **`Alt + J`** | **`⌥ + J`** | **向左吐出** (Barf) | `(a b c)` $\rightarrow$ `(a b) c`（J 偏左收缩） |
| ⭐⭐⭐ (15%) | **`Alt + Shift + K`** | **`⌥ + ⇧ + K`** | **向内收缩** (Contract) | 选区历史回退 / 向内缩一级（方案 A 零死键，兼容 `Alt+I`） |
| ⭐⭐⭐ (10%) | **`Alt + 3`** | **`⌥ + 3`** | **选中顶级函数** (Defun) | 一键选中最外层整个 `(define ...)` |
| ⭐⭐⭐ (10%) | **`Alt + O`** | **`⌥ + O`** | **脱壳解包** (Splice) | `(let () (expr))` $\rightarrow$ `(expr)` |
| ⭐⭐⭐ (10%) | **`Alt + 2`** | **`⌥ + 2`** | **大步前进** (Forward Sexp) | 光标跨过右侧整组完整 S 表达式 |
| ⭐⭐⭐ (10%) | **`Alt + 1`** | **`⌥ + 1`** | **大步后退** (Backward Sexp) | 光标跨过左侧整组完整 S 表达式 |
| ⭐⭐ (5%) | **`Alt + W`** | **`⌥ + W`** | **步进深入** (Step Into) | 跳进当前括号内部最左侧第一个参数前（前进深入） |
| ⭐⭐ (5%) | **`Alt + S`** | **`⌥ + S`** | **步退跳出** (Step Out) | 跳到当前外层括号左侧前置位（后退撤出） |
| ⭐⭐ (5%) | **`Alt + X`** | **`⌥ + X`** | **向后整块删除** (Kill Sexp) | 删掉光标右侧整组子表达式（不破坏括号，免 Chrome 地址栏抢焦） |
| ⭐⭐ (5%) | **`Alt + \`** | **`⌥ + \`** | **智能格式排版** (Indent) | 按 Lisp 规范重新对齐当前 S 表达式代码块（免 Chrome 菜单抢焦） |
| ⭐ (2%) | **`Alt + Shift + L`** | **`⌥ + ⇧ + L`** | **相邻参数对调** (Transpose) | `(equal? a b)` $\rightarrow$ `(equal? b a)`（Leap swap） |
| ⭐ (2%) | **`Alt + Shift + J`** | **`⌥ + ⇧ + J`** | **列表切分** (Split) | `(a b \| c d)` $\rightarrow$ `(a b) (c d)`（Joint cut） |

---

## 📚 详细文档

* [Strict Paredit 极速快捷键设计手册](docs/strict_paredit_guide.md)
* [Strict Paredit 互动实战训练手册](docs/strict_paredit_training_manual.md)

---

## 🧪 自动化测试

前端快捷键逻辑测试套件（18 项）：
```bash
cd frontend && npm test
```

后端 Rust 单元与集成测试套件（19 项）：
```bash
cd server && cargo test
```
