# Scheme Strict Paredit Hacker IDE

一个专为极致 Scheme 编程体验而生的**极简黑客生产力 IDE**。
结合了 **Monaco Editor**、**Strict Paredit**、**Parinfer**、**真实 PTY 统一终端 (Steel REPL + Bash)** 与 **零依赖终端 GUI 拦截系统**。

专为高效生产与严格测试 [`docs/strict_paredit_guide.md`](docs/strict_paredit_guide.md) 中定义的 **17 个单发（One-Shot）极速快捷键** 而设计。

---

## 🚀 极速启动

无需安装 Node.js、npm 或额外脚本，直接运行单个自包含可执行程序：

```bash
### 1. 一键构建并启动 (源码环境)
```bash
# Linux / macOS (自动编译前端、构建 Rust 独立二进制并运行)
./start
# 若仅编译构建本地二进制而不启动服务：
./start --build-only

# Windows (CMD / PowerShell)
.\start.bat
# 仅构建二进制：
.\start.bat --build-only
```

### 2. 直接运行已构建的独立二进制
```bash
# Linux / macOS 直接运行
./scheme-ide

# Windows 直接运行
.\scheme-ide.exe
```

IDE 启动后自动输出就绪横幅并探测网络 IP：
* 本机 / 端口转发访问：**`http://localhost:8085`**
* 宿主机 / 局域网直连：**`http://<自动检测的IP>:8085`**
* VS Code 远程开发：在底部「端口 (PORTS)」面板转发 `8085` 端口。

---

## 🖥️ 极简 IDE 交互架构

### 1. 冷启动全屏终端 (Cold Start 100%)
* 页面初始打开时，呈现**极简 100% 全宽终端工作区**，去除所有多余的状态栏、顶栏和侧边栏。
* **Tab 1（λ REPL）**：常驻的原生 Steel Scheme 交互式终端（真实 PTY，运行 `steel` 0.8.2），固定在第一项，不可关闭。
* **Tab 2+（Bash）**：独立的 Linux Bash 会话（真实 PTY），支持自由通过 `+` 新建或 `×` 关闭。

### 2. 动态展屏与文件打开 (`gui open`)
* 在任意 Bash 终端中输入内置拦截命令打开或编辑文件：
  ```bash
  gui open sample.scm
  # 或简写
  gui edit src/math.scm
  ```
* 左侧多标签代码编辑区瞬间**自动滑出展开**，默认按 **60 : 40** 黄金比例分屏呈现。
* Monaco 编辑器立即载入文件，并在顶部标签栏高亮显示。

### 3. 动态折叠 (Dynamic Collapse)
* 当左侧编辑区的所有文件标签被全部关闭时，左侧编辑区自动**平滑折叠回 0% 宽度**，右侧终端重新回归 100% 全屏，还原最纯粹的终端生产力模式。

### 4. 自由分屏调节
* 编辑区与终端区之间设有 **4px 极窄可拖拽分割条**，悬停高亮提示，拖动即可按像素级自由调节左右比例。
* 也可在终端中直接使用命令调整分屏：
  ```bash
  gui ratio 70:30
  gui ratio 50:50
  gui ratio 0:100   # 隐藏左侧编辑区
  ```

### 5. Monaco 代码发射与 REPL 自动聚焦联动
* 在左侧代码编辑区编写 Scheme 代码时：
  * 按下 **`Alt + Enter`** 或 **`Ctrl + Enter`**（Mac: `⌥ ↵` 或 `⌘ ↵`）。
  * 系统自动提取光标所在的最内层有效 S-expression（或选中范围）。
  * **右侧终端自动平滑切换至 Tab 1 (`λ REPL`)**。
  * 将代码直接注入 Steel PTY 的标准输入并回车执行。
  * REPL 终端自动平滑滚动至最底部最新求值气泡，实现零心智负担的所写即所见。

---

## ⚡ 终端 CLI `gui` 命令集 (零依赖无感拦截)

后端在 PTY 字节流层自动拦截识别，**无需在系统安装任何外部软件包或全局脚本**，绝不触发 `bash: command not found`：

| 命令 | 说明 | 示例 |
| :--- | :--- | :--- |
| `gui open <file>` | 在左侧编辑区打开指定文件 | `gui open fib.scm` |
| `gui edit <file>` | `gui open` 的别名 | `gui edit tests/test.scm` |
| `gui close [file]` | 关闭当前或指定文件标签页 | `gui close fib.scm` |
| `gui ratio <L:R>` | 调整左侧编辑器与右侧终端比例 | `gui ratio 70:30` |
| `gui help` | 显示 gui 命令帮助菜单 | `gui help` |

---

## ⌨️ 17 个 Strict Paredit 快捷键速查表

全套快捷键全面构建在右手 **`H-J-K-L` 四轴八态主键矩阵**，彻底脱离 macOS 全部 5 大系统死键（`E, U, I, N, ~`），无论输入法何种状态均 100% 免疫死键拦截与字符泄漏！

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

## 📦 独立二进制发布与跨平台支持 (Standalone Binary & Releases)

本项目支持**编译为完全自包含的单个二进制可执行文件**（Single Self-Contained Binary）：
- **零运行时依赖**：使用 `rust-embed` 在编译期将 Monaco Editor、xterm.js、字体、Web Workers 与 CSS 完整打包进二进制文件的数据段。
- **开箱即用**：无需安装 Node.js、npm 或保留静态资源文件夹，单个可执行文件直接启动并提供完整 Web IDE 服务。
- **跨平台原生支持**：
  - **Linux (x86_64)**: `scheme-ide-linux-x86_64.tar.gz` (内置 `/bin/bash` PTY)
  - **macOS Universal**: `scheme-ide-macos-universal.tar.gz` (Apple Silicon M 系列与 Intel 架构通用二进制，内置 `/bin/zsh` / `$SHELL` PTY)
  - **Windows (x86_64)**: `scheme-ide-windows-x86_64.zip` (Windows ConPTY / `cmd.exe` / PowerShell 原生支持)

### ⬇️ 从 GitHub Releases 下载
前往仓库的 [**Releases 页面**](../../releases) 下载对应平台的打包产物：
```bash
# 以 Linux / macOS 为例：
tar -xvf scheme-ide-*.tar.gz
./scheme-ide
```

### ⚙️ 环境变量配置

| 环境变量 | 默认值 | 作用说明 |
| :--- | :--- | :--- |
| `PORT` | `8085` | IDE 服务监听的 HTTP 端口 |
| `STEEL_BIN` | 自动探测 | Steel Scheme 可执行文件路径（优先探测二进制同级目录、`~/.cargo/bin/steel` 及 PATH） |
| `STATIC_DIR` | 内置资源 | 可选，用于开发时覆盖内置前端资源，指定本地磁盘路径（如 `./frontend/dist`） |

### 🛠️ 本地编译构建单个二进制

```bash
# 1. 构建前端静态资源
cd frontend && npm ci && npm run build && cd ..

# 2. 编译自包含发布二进制
cargo build --release --manifest-path server/Cargo.toml

# 产物即为单文件可执行程序：server/target/release/scheme-ide
```

---

## 🧪 自动化测试套件

本仓库包含全套单元测试与前后端集成测试：

1. **前端快捷键与交互集成测试（47 项全绿）**：
   ```bash
   cd frontend && npm test
   # 包含：
   # - testShortcuts.js (18 项 Strict Paredit 快捷键逻辑)
   # - testFrontendIntegration.js (29 项冷启动、动态展开/折叠、比例计算、CLI 命令拦截解析、防重开标签与 Monaco Sexp 提取)
   ```

2. **后端 Rust 单元与端到端测试（26 项全绿）**：
   ```bash
   cd server && cargo test
   # 包含：
   # - 静态嵌入资源 (rust-embed) SPA 路由测试
   # - Steel PTY 与 Bash PTY 生命周期与双向流
   # - WebSocket 终端全链路集成测试
   # - CLI gui 命令解析与拦截测试
   # - 文件读取与写入 API 测试
   # - HTTP Eval 与会话持久化测试
   ```

---

## 📚 详细设计与使用文档

* [终端黑客 IDE 架构与通信协议设计手册](docs/terminal_ide_architecture.md)
* [Strict Paredit 极速快捷键设计手册](docs/strict_paredit_guide.md)
* [Strict Paredit 互动实战训练手册](docs/strict_paredit_training_manual.md)
