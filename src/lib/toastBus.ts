export type AppToastType = "success" | "error" | "warning" | "info";

export interface AppToastDetail {
  message: string;
  type?: AppToastType;
  duration?: number;
}

export const APP_TOAST_EVENT = "app-toast";

export function showAppToast(
  message: string,
  type: AppToastType = "info",
  duration?: number,
): void {
  window.dispatchEvent(
    new CustomEvent<AppToastDetail>(APP_TOAST_EVENT, {
      detail: { message, type, duration },
    }),
  );
}