/**
 * Background notifications inside the Android app.
 *
 * A browser tab answers for itself: it asks through the Notification API and, while it is open,
 * can post notifications of its own. The Android app cannot do either. Chromium does not
 * implement the Push or Notifications APIs in WebView, so `Notification` is not there to ask,
 * and the page is not running once the app is in the background — which is exactly when a
 * message notification matters.
 *
 * So the app does it natively, with a foreground service that keeps its own connection and
 * raises the notifications itself. The page's part is only to say whether the user wants that,
 * which it does over the same `VarnoxNative` bridge everything else in the shell uses.
 */

type NativeBridge = {
  notificationsSupported?: () => boolean;
  notificationsEnabled?: () => boolean;
  setNotifications?: (enabled: boolean) => void;
};

function bridge(): NativeBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { VarnoxNative?: NativeBridge }).VarnoxNative ?? null;
}

/** True when the app can do background notifications, false in every browser. */
export function nativeNotificationsAvailable(): boolean {
  const native = bridge();
  return typeof native?.notificationsSupported === 'function'
    ? native.notificationsSupported() === true
    : false;
}

/**
 * Whether background notifications are actually running.
 *
 * Asked of the shell rather than remembered here, because only the shell knows whether Android
 * still permits it — a permission revoked in Android Settings has to show up as off, and the
 * stored preference the page might otherwise trust would still say on.
 */
export function nativeNotificationsEnabled(): boolean {
  const native = bridge();
  if (typeof native?.notificationsEnabled !== 'function') return false;
  try {
    return native.notificationsEnabled() === true;
  } catch {
    return false;
  }
}

/**
 * Turn background notifications on or off.
 *
 * Deliberately does not report success. Turning them on can put Android's permission dialog on
 * screen, and the answer arrives after this returns — so the caller re-reads
 * {@link nativeNotificationsEnabled} rather than being told an outcome that is not known yet.
 */
export function setNativeNotifications(enabled: boolean): void {
  const native = bridge();
  if (typeof native?.setNotifications !== 'function') return;
  try {
    native.setNotifications(enabled);
  } catch {
    // Nothing to recover from: the switch will simply stay where the shell says it is.
  }
}
