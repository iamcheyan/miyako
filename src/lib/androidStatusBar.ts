// Android 状态栏控制工具

declare global {
  interface Window {
    StatusBarAndroid?: {
      setVisible: (visible: boolean) => void;
    };
  }
}

/**
 * 设置 Android 状态栏可见性
 * @param visible true 显示状态栏，false 隐藏状态栏
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
 * 隐藏 Android 状态栏
 */
export function hideStatusBar(): void {
  setStatusBarVisible(false);
}
