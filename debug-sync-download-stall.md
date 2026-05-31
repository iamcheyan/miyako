# Debug Session: sync-download-stall
- **Status**: [OPEN]
- **Issue**: 同步页已经完成扫描与对比，显示“开始下载文件...”，但界面长时间没有进一步进度或完成提示，用户无法判断是否真的在下载、卡在哪个文件、还是下载已失败但未反馈。
- **Debug Server**: http://127.0.0.1:7778/event
- **Log File**: .dbg/trae-debug-log-sync-download-stall.ndjson

## Reproduction Steps
1. 打开应用并确保同步页显示“已连接”。
2. 点击同步按钮，等待扫描和对比完成。
3. 观察日志停留在“开始下载文件...”。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | 后端实际正在顺序下载文件，但前端没有接收或展示任何逐文件进度 | High | Low | Pending |
| B | `sync_download` 在第一个或某个具体文件的 `download_file` 调用中阻塞 | High | Medium | Pending |
| C | 下载完成后卡在 `get_file_info`、状态写入或 `save_sync_state`，所以界面停在下载开始 | Medium | Medium | Pending |
| D | 本地路径 `~/Music/NasSync` 未展开为真实路径，导致写文件或建目录阶段出现异常/阻塞 | Medium | Low | Pending |
| E | Tauri 命令内部有进度，但没有向前端发回 callback，导致进度条始终是 `0 / 15` | High | Low | Pending |

## Log Evidence
- Pre-fix: `hasCallback = false`，前端不会收到逐文件下载进度
- Pre-fix: 下载并未卡死，前两个文件已完整完成下载、写入、`get_file_info` 与状态更新
- Pre-fix: 本地文件被误写到 `src-tauri/~/Music/NasSync/...`
- Post-fix: 后端已开始把文件写到 `/Users/tetsuya/Music/NasSync/...`
- Post-fix: 后端确实持续发送逐文件进度，但前端仍未显示，怀疑监听目标与连接状态管理存在页面级实现问题

## Verification Conclusion
- 已确认根因 1：前端未接收到逐文件进度，因为原实现没有把 callback 从 Rust 回传到前端
- 已确认根因 2：`~/Music/NasSync` 未展开，导致文件写入错误目录
- 已新增修复：真实路径展开、同步进度事件回传、前端共享 SMB 连接状态
