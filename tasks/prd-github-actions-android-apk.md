# PRD: GitHub Actions 自动构建 Android APK

## 介绍

本 PRD 描述为当前的 Tauri Android 项目配置 GitHub Actions 工作流，实现代码推送到仓库后自动生成 ARM 架构的 APK 文件供用户下载。用户已有 GitHub 仓库，需要完整、可运行的 CI/CD 配置。

## 目标

1. **自动化构建**：每次推送到 `main` 分支或创建 PR 到 `main` 时，自动触发 Android APK 构建。
2. **提供可下载 APK**：将构建好的 APK 作为 GitHub Actions 的产物（Artifacts）供用户下载。
3. **发布 Release**：当推送 tag 时，自动创建 GitHub Release 并上传 APK，方便用户直接下载稳定版本。
4. **支持主流架构**：确保生成的 APK 兼容绝大多数 Android 手机（ARM 架构）。

## 用户故事

### 用户故事 1：开发者推送代码后自动构建 APK
- **作为**开发者
- **我想要**每次推送到 `main` 分支或创建 PR 到 `main` 时，自动触发 Android APK 构建
- **以便于**我可以快速验证代码变更是否影响 Android 构建，并获取最新的 APK 进行测试。

### 用户故事 2：用户从 Actions 页面下载 APK
- **作为**用户
- **我想要**在 GitHub Actions 页面直接下载最新构建的 APK
- **以便于**我可以安装并测试最新功能，无需等待正式发布。

### 用户故事 3：用户从 Releases 页面下载稳定版 APK
- **作为**用户
- **我想要**当项目发布新 tag 时，在 Releases 页面下载稳定版的 APK
- **以便于**我可以获取经过验证的稳定版本。

### 用户故事 4：开发者手动触发构建
- **作为**开发者
- **我想要**能够手动触发一次构建（workflow_dispatch）
- **以便于**在需要时重新构建 APK（例如，依赖更新后）。

## 功能需求

### FR1: 构建触发条件
- 当代码推送到 `main` 分支时自动触发构建。
- 当创建 PR 到 `main` 分支时自动触发构建。
- 支持手动触发（workflow_dispatch）。

### FR2: 构建环境配置
- 使用 Ubuntu 作为运行环境。
- 安装 Node.js 20.x、Java JDK 17、Android SDK（build-tools 36.0.0，platforms android-36）。
- 安装 Rust 工具链，并添加 `aarch64-linux-android` 和 `armv7-linux-androideabi` 目标。
- 安装项目 npm 依赖（`npm ci`）。

### FR3: Android APK 构建
- 初始化 Tauri Android 项目（`npx tauri android init --ci`）。
- 构建 ARM64 架构的 APK（`npx tauri android build --target aarch64 --apk`）。
- 构建 ARMv7 架构的 APK（`npx tauri android build --target armv7 --apk`）。
- 将构建好的 APK 重命名并保存到 `release` 目录。

### FR4: 产物上传
- 将 ARM64 APK 上传为 GitHub Actions 产物，保留 30 天。
- 将 ARMv7 APK 上传为 GitHub Actions 产物，保留 30 天。
- 产物名称清晰标识架构（如 `miyako-arm64-apk`、`miyako-armv7-apk`）。

### FR5: Release 发布
- 当推送以 `refs/tags/` 开头的引用时，自动创建 GitHub Release。
- 将 ARM64 和 ARMv7 APK 上传到 Release 中。
- Release 为非草稿、非预发布版本。

### FR6: 构建摘要
- 在 GitHub Actions 运行摘要中提供构建信息、下载说明和安装命令。

## 非目标

1. **APK 签名**：不生成签名 APK，仅生成未签名的 APK。
2. **其他架构**：不构建 x86 或 x86_64 架构的 APK（除非未来有明确需求）。
3. **自动测试**：不包含自动化测试步骤（仅构建）。
4. **多渠道发布**：不自动发布到 Google Play 或其他应用商店。

## 技术考虑

1. **缓存策略**：缓存 Rust 依赖（`~/.cargo/registry`、`~/.cargo/git`、`src-tauri/target`）以加速构建。
2. **Android SDK 配置**：使用 `android-actions/setup-android@v3` 安装 SDK，并接受许可证。
3. **Rust 交叉编译**：安装 Android 目标并配置工具链。
4. **APK 查找逻辑**：在构建后通过 `find` 命令查找生成的 APK，并处理可能的路径变化。
5. **环境变量**：设置 `ANDROID_HOME` 和 `ANDROID_SDK_ROOT` 指向正确路径。

## 开放问题

1. **APK 命名规则**：是否需要更详细的版本号或构建号？当前使用固定名称 `miyako-arm64.apk` 和 `miyako-armv7.apk`。
2. **构建失败通知**：是否需要添加构建失败时的通知（例如，邮件或 Slack）？
3. **多分支支持**：是否需要为其他分支（如 `develop`）配置构建？
4. **ARM 架构选择**：用户提到“主编这一个就行了”，但为了兼容性，当前构建两个 ARM 架构。是否真的只需要一个架构？

## 附录

### 参考工作流
现有工作流文件：`.github/workflows/build-android.yml`，已实现大部分功能。

### 验证步骤
1. 推送代码到 `main` 分支，确认 Actions 运行成功。
2. 创建 PR 到 `main`，确认 Actions 运行成功。
3. 打 tag 并推送，确认创建 Release 并上传 APK。
4. 下载 APK 并在 Android 设备上安装测试。