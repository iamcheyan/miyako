# MiyaKo 🎵

极简音乐播放器，专注于本地音乐播放和 NAS 同步。

## ✨ 特性

- **NAS 同步** - 配置 SMB/NAS 信息后，一键同步音乐到本地
- **离线播放** - 同步完成后无需网络，随时随地听歌
- **极简设计** - 去繁就简，专注于音乐本身
- **Android 支持** - 通过 Tauri 构建，支持 Android 设备

## 📱 下载

前往 [Releases](https://github.com/iamcheyan/miyako/releases) 页面下载最新 APK：

- `miyako-arm64.apk` - 适用于现代 Android 设备 (2016+)
- `miyako-armv7.apk` - 适用于较旧的 Android 设备

## 🚀 快速开始

### 配置 NAS

1. 打开应用，进入「NAS 设置」
2. 填写 SMB 服务器信息：
   - 服务器地址
   - 共享文件夹
   - 用户名和密码

### 同步音乐

1. 进入「同步音乐」页面
2. 选择要同步的文件夹
3. 点击开始同步

### 开始播放

同步完成后，回到首页即可看到所有音乐，点击即可播放。

## 🛠️ 开发

### 技术栈

- **前端**: React + TypeScript + Vite
- **后端**: Tauri + Rust
- **同步**: SMB 协议

### 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建 Android APK
npm run android:build
```

## 📄 License

MIT
