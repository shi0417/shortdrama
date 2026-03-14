# Git Manager Usage and Checklist

## 1. 这个 bat 修复了什么问题

### 以前为什么可能漏提文件

- 脚本里原先用 `cd /d "%~dp0"` 把工作目录切到 **bat 文件所在目录**。若 bat 放在子目录（例如 `scripts/`），则“当前目录”是子目录而不是仓库根目录。
- 虽然 `git add -A` 在 Git 里会针对**整个工作区**生效，但若用户从资源管理器“以管理员身份运行”或从其他位置间接调用 bat，当前目录可能不是仓库内任意路径，导致 `git rev-parse`、`git status` 等行为不符合预期，或用户误以为“只提交了当前文件夹”。
- 未在提交前展示 `git status --short`，提交后也未展示本次 commit 包含哪些文件，容易造成“以为提交了其实没提交”的错觉。

### 现在如何自动定位 repo root

- 脚本启动后先进入 bat 所在目录，然后执行：
  ```bat
  git rev-parse --show-toplevel
  ```
  得到当前仓库的**根目录绝对路径**，再 `cd /d "%REPO_ROOT%"` 切到该路径。
- 之后所有 `git add -A`、`git status`、`git commit`、`git push` 等都在**仓库根目录**下执行，确保操作对象是整个仓库，且与用户预期一致。

---

## 2. 使用方式

### 如何运行 git-manager.bat

- **推荐**：双击 `git-manager.bat`（会新开一个 cmd 窗口并保持打开，便于查看输出）。
- 也可在 cmd 中进入**仓库内任意目录**（或仓库根目录），执行：
  ```bat
  path\to\git-manager.bat
  ```
  或先 `cd` 到 bat 所在目录再执行 `git-manager.bat`。

**要求**：bat 文件必须位于该 Git 仓库内（根目录或子目录均可），否则会报错“Cannot find Git repository root”。

### 脚本会自动做哪些步骤

1. 检查 Git 是否可用。
2. 从当前（bat 所在）目录定位仓库根目录并切换到根目录。
3. 检查是否为 Git 仓库、检测当前分支。
4. 若无 `origin` 远程则自动添加（指向 `https://github.com/shi0417/shortdrama.git`）；若 `origin` 已存在但 URL 与预期不一致，会打印 `[WARN]` 提醒，避免推送到错误仓库。
5. **提交前**：输出 `git status --short`，展示当前所有改动。
6. 在**仓库根目录**执行 `git add -A`，暂存全部改动。
7. 若有暂存改动则生成带时间戳的 commit message（纯 CMD，使用 WMIC，不依赖 PowerShell）并执行 `git commit`。
8. **提交后**：若有新建 commit，则输出 `git show --name-only --stat --oneline -1`，展示本次 commit 包含哪些文件。
9. **Push 分支**：先检查当前分支是否有 upstream（`git rev-parse @{u}`），结果用变量保存，避免被前面命令的 errorlevel 覆盖；输出 `[INFO] Checking whether current branch has upstream...` 与 `Upstream detected: YES/NO`。若有 upstream：先 `git fetch`，再 `git pull --rebase --autostash`，再 `git push`；若无则 `git push -u origin <分支名>`。
10. 输出简要成功信息（含 `Your branch is now synced with origin/<branch>`）与自检清单（**若本次未创建新 commit**，不会打印 commit message，清单中 [4] 显示“No new commit (pushed existing commits only)”）；若任一步失败则报错并中止。

---

## 3. 提交前自检清单

在脚本执行前或看到“Current changes before staging...”输出后，建议自检：

| 项 | 说明 |
|----|------|
| bat 是否在仓库内运行 | 脚本必须放在本仓库内（根或子目录），否则无法通过 `git rev-parse --show-toplevel` 找到仓库根。 |
| 当前是否在正确仓库 | 脚本会打印 `[INFO] Repository root: ...`，确认该路径是你要提交的仓库（例如 `shortdrama`）。 |
| `git status --short` 是否看到预期文件 | 脚本会先输出一次 `git status --short`，确认列表里包含你期望提交的文件，没有漏掉目录。 |
| 是否有不该提交的文件 | 检查是否出现 `dist/`、`node_modules/`、本地配置、临时文件、大文件等；若有，应先加入 `.gitignore` 或从工作区移除，再运行脚本。 |
| 当前分支是否正确 | 脚本会打印 `[INFO] Current branch: ...`，确认是你要推送的分支（如 `main`）。 |

---

## 4. 提交后自检清单

脚本跑完后，建议再做一次核对：

| 项 | 说明 |
|----|------|
| `git show --name-only --stat --oneline -1` 是否包含预期文件 | 脚本在 commit 成功后会输出这一次命令的结果；确认列表里是本次打算提交的文件，没有漏掉或误加。 |
| `git status` 是否干净 | 脚本结尾会再次输出 `git status --short`；若为“clean working tree”或 0 行，说明当前工作区已全部提交且无未暂存改动。 |
| 是否成功 push 到目标分支 | 看是否有 `[OK] Push completed successfully` 和 `Pushed to GitHub: OK`，且无 `[ERROR] git push failed`。 |
| GitHub 上是否能看到对应 commit | 打开 `https://github.com/shi0417/shortdrama`，切到对应分支，刷新后应能看到最新 commit 与时间戳 message。 |

---

## 5. 常见问题

### 为什么有文件没提交

- **未在仓库内**：若 bat 不在本仓库里，脚本会报错退出，不会执行 add/commit。
- **被 .gitignore 忽略**：被忽略的文件不会出现在 `git status` 里，也不会被 `git add -A` 加入；若你希望提交，需从 `.gitignore` 中移除或使用 `git add -f`（脚本未做 -f，需手工处理）。
- **没有改动**：若文件已提交且未再修改，`git status` 不会显示，属于正常。

### 为什么提示不是 git repo

- 脚本先 `cd` 到 bat 所在目录，再执行 `git rev-parse --show-toplevel`。若 bat 不在任何 Git 仓库内，或该目录下没有 `.git`，就会报 “Cannot find Git repository root” 或 “Current directory is not a git repository”。解决：把 bat 放到仓库内再运行。

### 为什么 push 失败

- **网络/权限**：无法访问 GitHub、未登录或没有写权限。
- **远程有新的 commit**：脚本会先 `fetch` 再 `pull --rebase`，若 rebase 冲突会中止并提示；需本地解决冲突后重新运行脚本。
- **分支不存在于远程**：首次推送会执行 `git push -u origin <分支>`；若远程没有该分支且创建失败，检查权限与仓库名。

### 为什么 rebase 失败

- 通常是因为 `git pull --rebase` 时存在冲突。脚本会自动执行 `git rebase --abort`，把分支恢复成 rebase 前的状态。你需要在本机解决冲突：手工解决后 `git add` 再 `git rebase --continue`，或改用 merge 策略；完成后再重新运行 bat 推送。

### 为什么 GitHub 上没看到改动

- 确认脚本最后输出了 `[OK] Push completed successfully` 且无 push 报错。
- 在浏览器中打开**正确分支**（脚本会打印 `origin/<分支名>`），并刷新页面。
- 若 push 实际失败（例如网络中断），脚本会打印 `[ERROR] git push failed`，此时 GitHub 不会更新。

### 为什么出现 [WARN] origin URL is not the expected repository

- 表示当前配置的 `origin` 远程 URL 与脚本内预期的 `https://github.com/shi0417/shortdrama.git` 不一致（例如指向了 fork 或其它仓库）。脚本仍会继续执行 push，但请确认你是否要推送到当前 `origin`；若推错仓库，可执行 `git remote set-url origin https://github.com/shi0417/shortdrama.git` 修正。

---

## 6. 推荐手工核对命令

可在本机随时执行以下命令做核对（不修改任何内容）：

| 命令 | 用途 |
|------|------|
| `git status` | 查看工作区与暂存区状态（是否有未提交、未暂存改动）。 |
| `git status --short` | 简短列表，与脚本中“提交前”输出一致，便于快速扫一眼改了哪些文件。 |
| `git log --oneline -n 10` | 查看最近 10 条 commit，确认刚提交的 commit 是否在顶端。 |
| `git show --name-only --stat --oneline -1` | 查看**最近一次 commit** 包含哪些文件及统计，与脚本“提交后”输出一致。 |
| `git branch --show-current` | 查看当前所在分支名。 |
| `git remote -v` | 查看远程名称与 URL，确认 `origin` 是否指向预期的 GitHub 仓库。 |

建议在运行 bat **之前**看一次 `git status --short`，**之后**看一次 `git show --name-only --stat --oneline -1` 和 `git status`，避免“以为提交了其实没提交”的情况。若曾遇到“commit 成功但未自动 push”，可确认日志中是否出现 `[INFO] Checking whether current branch has upstream...` 与 `Upstream detected: YES/NO`、以及随后的 `[STEP] Syncing...` 或 `First push...` 和 `[OK] Push completed successfully`；若没有，参见 `docs/git-manager-push-fix-report.md`。
