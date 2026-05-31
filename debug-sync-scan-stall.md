# Debug Session: sync-scan-stall
- **Status**: [OPEN]
- **Issue**: 同步页点击同步后只显示“开始扫描远程目录...”，之后长时间无更多日志，也没有错误提示，用户无法判断当前是卡住、仍在扫描，还是已进入下一阶段。
- **Debug Server**: TBD
- **Log File**: .dbg/trae-debug-log-sync-scan-stall.ndjson

## Reproduction Steps
1. 打开应用并确保同步页显示“已连接”。
2. 点击同步按钮。
3. 观察日志停留在“开始扫描远程目录...”。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | 远程递归扫描仍在进行，但前端没有阶段性进度日志，所以看起来像“没反应” | High | Low | Pending |
| B | `sync_scan_remote` 在某个子目录递归或 `smb_list_dir` 调用上阻塞，没有返回也没有超时 | High | Medium | Pending |
| C | 扫描实际已完成，但在 `sync_compare` 阶段因本地路径或文件元数据处理卡住 | Medium | Low | Pending |
| D | 扫描结果为空或极大，前端分支没有补充日志，导致界面只停在首条扫描日志 | Medium | Low | Pending |
| E | Tauri 命令成功/失败后没有把详细状态继续写回前端日志区，信息只丢在后端或控制台 | Medium | Medium | Pending |

## Log Evidence
[Pending]

## Verification Conclusion
[Pending]
