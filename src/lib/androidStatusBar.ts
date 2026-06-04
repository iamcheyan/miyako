// Android 状态栏控制工具

declare global {
  interface Window {
    StatusBarAndroid?: {
      setVisible: (visible: boolean) => void;
      getTopInset?: () => number;
      getBottomInset?: () => number;
      getAndroidNavHeight?: () => number;
    };
  }
}

/**
 * 设置 Android 状态栏可见性。
 * 当前应用统一保持状态栏显示，visible=false 会被原生层忽略。
 */
export function setStatusBarVisible(visible: boolean): void {
  if (window.StatusBarAndroid) {
    window.StatusBarAndroid.setVisible(visible);
  }
}

/**
 * 显示 Android 状态栏
 */
export function showStatusBar(): void {
  setStatusBarVisible(true);
}

/**
 * 状态栏现在全局保持显示，此函数保留为兼容旧调用。
 */
export function hideStatusBar(): void {
  setStatusBarVisible(true);
}
