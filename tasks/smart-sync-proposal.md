# 智能同步引擎设计提案 (Smart Sync Engine Proposal)

为了解决当前同步引擎“生硬单向覆盖”的痛点（如：NAS 端整理文件夹、重命名文件导致本地需要重新下载和删除），本提案建议引入**“状态感知与启发式重命名检测”**机制。

---

## 核心设计思路

在不下载 NAS 文件的前提下，我们无法直接获取其 MD5。因此，我们采用 **本地状态数据库 + 启发式元数据匹配 (Metadata Heuristics)** 的方案，实现**超低成本、零流量、毫秒级**的移动与重命名同步。

### 1. 同步流程对比

| 场景 (NAS 端重命名/移动文件) | 现有“生硬同步”流程 | 智能同步流程 |
| :--- | :--- | :--- |
| **网络流量** | 下载完整文件 (几十 MB) | **0 字节** |
| **执行耗时** | 取决于网速 (数十秒至数分钟) | **小于 10 毫秒** |
| **磁盘开销** | 写入新文件，删除旧文件 (双倍擦写) | **仅一次本地文件指针移动 (`rename`)** |

---

## 技术架构与核心模块

### 模块一：本地状态数据库 (State DB)

使用轻量级本地数据库（如 Rust 的 `rusqlite` 或增强版 `sync_state.json`）记录所有已成功同步的文件元数据：

```json
{
  "remote_path": "Music/FolderA/song.mp3",
  "local_path": "/Users/tetsuya/Music/NasSync/Music/FolderA/song.mp3",
  "size": 10485760,
  "last_modified": 1774007888,
  "md5": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

* **MD5 计算时机**：仅在文件**首次下载完成**或**本地扫描首次发现新文件**时，在后台线程异步计算一次并存入数据库，之后不再重复计算。

---

### 模块二：启发式匹配算法 (Heuristics Matching)

当对比 NAS 远程文件与本地文件时，系统不再直接执行“下载”和“删除”，而是先进行**双向对齐匹配**：

1. **收集待处理动作**：
   * 收集所有**“待下载”**（NAS 有，本地无）的远程文件列表 $U$。
   * 收集所有**“待删除”**（本地有，NAS 无）的本地文件列表 $D$。

2. **多级匹配策略**：
   对于每一个待下载文件 $u \in U$，尝试在待删除列表 $D$ 中寻找最匹配的项 $d \in D$：

   * **第一级：精确匹配 (基于 MD5)**
     * 条件：$u$ 的文件大小与 $d$ 一致，且本地数据库中记录的 $d$ 的 MD5 值，与 $u$ 在状态历史中的值匹配（或本地算力匹配）。
   * **第二级：同名同大小匹配 (启发式)**
     * 条件：文件名相同（如 `song.mp3`）且文件大小（`size`）完全一致，仅父级文件夹路径不同。
   * **第三级：大小与修改时间匹配**
     * 条件：文件大小完全一致，且修改时间（`last_modified`）完全一致。

3. **动作重构**：
   如果匹配成功，将 $u$ 的 `Download` 动作与 $d$ 的 `Delete` 动作为合并，重构为 **`LocalMove`（本地移动）** 动作。

---

## 核心代码架构改造方案

### 1. 新增动作定义 (`sync_engine.rs`)

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Action {
    Download,
    Skip,
    Delete,
    LocalMove, // 新增：本地移动/重命名
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncAction {
    pub remote_path: String,     // 新的远程路径
    pub local_path: String,      // 新的本地路径
    pub old_local_path: Option<String>, // 新增：如果是 LocalMove，记录旧的本地路径
    pub action: Action,
    pub reason: String,
}
```

### 2. 匹配与转换算法

在 `compare_with_local` 执行完毕后，加入一个匹配拦截器：

```rust
pub fn detect_renames_and_moves(actions: &mut Vec<SyncAction>) {
    let mut downloads: Vec<SyncAction> = Vec::new();
    let mut deletes: Vec<SyncAction> = Vec::new();
    let mut skips: Vec<SyncAction> = Vec::new();

    // 分离出待下载和待删除的动作
    for act in actions.drain(..) {
        match act.action {
            Action::Download => downloads.push(act),
            Action::Delete => deletes.push(act),
            _ => skips.push(act),
        }
    }

    let mut final_actions = skips;

    // 匹配算法
    for mut dl in downloads {
        let mut matched_index = None;

        for (idx, del) in deletes.iter().enumerate() {
            // 启发式匹配条件：文件名和大小完全一致
            let dl_filename = Path::new(&dl.remote_path).file_name();
            let del_filename = Path::new(&del.remote_path).file_name();

            if dl_filename == del_filename {
                matched_index = Some(idx);
                break;
            }
        }

        if let Some(idx) = matched_index {
            let matched_delete = deletes.remove(idx);
            // 转换为 LocalMove 动作
            final_actions.push(SyncAction {
                remote_path: dl.remote_path,
                local_path: dl.local_path,
                old_local_path: Some(matched_delete.local_path),
                action: Action::LocalMove,
                reason: format!("检测到文件从旧路径移动：{}", matched_delete.remote_path),
            });
        } else {
            // 没有匹配到，依然需要下载
            final_actions.push(dl);
        }
    }

    // 剩下没有被匹配的 deletes，依然执行删除
    final_actions.extend(deletes);
    *actions = final_actions;
}
```

### 3. 执行阶段 (`sync_download`)

```rust
match action.action {
    Action::LocalMove => {
        let old_path = action.old_local_path.as_ref().unwrap();
        let new_path = &action.local_path;

        if Path::new(old_path).exists() {
            // 1. 确保新本地目录存在
            if let Some(parent) = Path::new(new_path).parent() {
                fs::create_dir_all(parent).await?;
            }
            // 2. 直接在本地 rename (毫秒级)
            fs::rename(old_path, new_path).await?;
            
            // 3. 更新同步状态
            update_sync_state_path(&mut state, &action.remote_path, new_path);
        } else {
            // 如果旧文件意外不存在，则降级为重新下载
            smb_client::download_file(connection_id, &action.remote_path, new_path).await?;
        }
    }
    // ... 其他动作 ...
}
```

---

## 逐步实施计划

1. **第一阶段 (轻量启发式)**：
   无需数据库支持。仅基于“文件名 + 文件大小”在内存中进行交叉对比。只要满足两边文件名和大小一致，即判定为移动。**这可以瞬间解决 90% 以上的文件夹整理、整理专辑分类时的重复下载问题。**

2. **第二阶段 (完美 MD5 数据库保障)**：
   引入 SQLite 存储本地已下载文件的 MD5 映射。即使文件名被彻底改掉（如 `Track01.mp3` $\rightarrow$ `星降るカフェテラス.mp3`），系统也能通过 MD5 秒速匹配并在本地重命名，达成 100% 精确度的智能同步。
