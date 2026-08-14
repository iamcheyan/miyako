# Miyako 第二轮收尾（验收报告剩余项）— 完整任务目标

## 一、背景

第一轮修复验收（/tmp/miyako_review_report.md，已存档）确认：音频链路（media:// 流式协议）、
同步流式 .part、Mutex 锁外 IO、进度节流、调试上报移除——**真实完成**；
tsc/lint/cargo test 8/8 全绿。但 P0 完成度仅 56%，剩余项清单如下。

## 二、本轮任务（按优先级）

### P0 必修
1. **同步断点续传**：下载中断后重跑 `.part` 文件应从已下载偏移继续
   （HTTP Range 或 SMB read offset），而不是删了重来
2. **同步取消**：UI 提供「取消同步」按钮 → Rust 侧 cancel token（AtomicBool 或
   CancellationToken），下载循环每文件/每块检查；取消后 .part 保留待续传
3. **下载超时**：单文件读块超时（如 30s 无进展）→ 报错跳下一个，不让整个同步卡死
   （debug-sync-download-stall.md 的原始痛点）
4. **虚拟化列表**：歌曲列表/远程目录/同步日志三处上虚拟化
   （react-window 或自写简单窗口化——只渲染可视区 ±20 行；同步日志已有环形 200 条，
   前端也要对应只渲染尾部可视区）
5. **图标链收尾**：本分支补 CI workflow（照旧分支 build-android.yml 但加图标校验步骤：
   构建后解包 APK 检查 mipmap 资源存在+Manifest icon 引用）；.gitignore 排除
   android-test-app/ 与 gen/android.backup.*（旧壳归档移出 git 跟踪,git rm --cached）

### P1 顺手
6. release signing 配置骨架（env 注入 keystore 路径/密码,未配则警告并退 debug——
   不阻塞 CI）
7. 播放列表 timeupdate 重渲染：PlayerUI 拆分,进度条独立 memo 组件,不重渲整个列表

## 三、验收
1. cargo test 全过（新增续传/取消/超时的单测各 ≥1）
2. tsc/lint/build 三绿
3. 歌曲列表 1000+ 条模拟数据下滚动流畅（无头浏览器 performance mark 或简单 FPS 采样）
4. .gitignore 生效：git status 不再出现 android-test-app 产物
5. CI workflow 文件就位（本地无法跑 GitHub Actions,语法用 actionlint 或仔细自查）
6. commit+push（中文/英文与仓库风格一致,分多个语义提交不要一坨）

## 四、边界
- 无 JDK/Android SDK——Android 构建仍不可行,CI 交给 GitHub 侧跑
- 不重做架构;不动 media:// 协议(已验收通过)
- 验收报告的 12 项剩余清单里,除上述 7 项外其余为 P2 可延后
