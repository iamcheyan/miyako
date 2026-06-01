// 设备状态检查 - 用于判断是否应该自动同步

// Battery Manager 接口
interface BatteryManager extends EventTarget {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

// Network Information 接口
interface NetworkInformation extends EventTarget {
  effectiveType: string;
  type: string;
  downlink: number;
  rtt: number;
}

// 扩展 Navigator 接口
interface NavigatorWithBattery extends Navigator {
  getBattery(): Promise<BatteryManager>;
}

interface NavigatorWithConnection extends Navigator {
  connection: NetworkInformation;
}

/**
 * 检查设备是否正在充电
 */
export async function isCharging(): Promise<boolean> {
  try {
    // Battery API: https://developer.mozilla.org/en-US/docs/Web/API/BatteryManager
    const nav = navigator as NavigatorWithBattery;
    if (!nav.getBattery) {
      return false;
    }
    const battery = await nav.getBattery();
    return battery.charging;
  } catch {
    // Battery API 不可用时，返回 false 不同步
    return false;
  }
}

/**
 * 检查是否连接到 WiFi
 */
export function isConnectedToWiFi(): boolean {
  // 如果不在线，肯定不是 WiFi
  if (!navigator.onLine) {
    return false;
  }

  // Network Information API: https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation
  const nav = navigator as NavigatorWithConnection;
  const connection = nav.connection;
  if (connection) {
    // 检查连接类型
    return connection.type === 'wifi' || connection.effectiveType === 'wifi';
  }

  // 如果 API 不可用，在线就假定是 WiFi
  return true;
}

/**
 * 检查是否可以访问 NAS（简单网络检查）
 */
export function canReachNas(): boolean {
  // 简单检查是否在线
  return navigator.onLine;
}

/**
 * 检查是否满足自动同步的所有条件
 * 条件：充电 + WiFi + 可访问 NAS
 */
export function shouldAutoSync(): boolean {
  // 同步条件：充电 + WiFi + 在线
  // 注意：isCharging 是异步的，这里只能做同步检查
  // 充电检查会在 runSync 中单独处理
  return isConnectedToWiFi() && canReachNas();
}

/**
 * 检查是否满足自动同步的所有条件（包括异步检查）
 */
export async function shouldAutoSyncAsync(): Promise<boolean> {
  const [charging, wifi, nas] = await Promise.all([
    isCharging(),
    Promise.resolve(isConnectedToWiFi()),
    Promise.resolve(canReachNas()),
  ]);

  return charging && wifi && nas;
}
