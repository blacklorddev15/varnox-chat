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
  notificationDiagnostics?: () => string;
};

/** What the shell reports about the background connection, as far as it is willing to say. */
export type NotificationDiagnostics = {
  wanted: boolean;
  permitted: boolean;
  running: boolean;
  chats: number;
  lastPollAt: number;
  problem: string | null;
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
 * What the shell says about the background connection, or null outside the app.
 *
 * Exists so that "I never get notifications" has an answer instead of a list of suspects. The
 * service can be running and still delivering nothing — a session it cannot read, a server that
 * did not answer — and in that state the phone looks exactly like nobody has messaged. Each field
 * is one step that has to succeed, so whichever is false is the one to look at.
 */
export function nativeNotificationDiagnostics(): NotificationDiagnostics | null {
  const native = bridge();
  if (typeof native?.notificationDiagnostics !== 'function') return null;
  try {
    const raw = native.notificationDiagnostics();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NotificationDiagnostics>;
    return {
      wanted: parsed.wanted === true,
      permitted: parsed.permitted === true,
      running: parsed.running === true,
      chats: typeof parsed.chats === 'number' ? parsed.chats : -1,
      lastPollAt: typeof parsed.lastPollAt === 'number' ? parsed.lastPollAt : 0,
      problem: typeof parsed.problem === 'string' ? parsed.problem : null,
    };
  } catch {
    // An older shell without this method, or a reply that is not the shape expected. Either way
    // there is nothing to show, and nothing here is worth interrupting the screen over.
    return null;
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

/**
 * Turn background notifications on and wait for Android's answer.
 *
 * The permission dialog is answered by the person, not by the app, and it can take as long as
 * they take to read it — so there is no promise to await and nothing to report synchronously.
 * The only honest source of truth is the shell's own answer, asked for until it changes or
 * patience runs out. Fifteen seconds is long enough to read a dialog and short enough that a
 * refusal reports itself rather than appearing to hang.
 *
 * Both places that ask — the sign-up wizard and Settings — go through this, so the two agree on
 * what "on" means and neither can drift into reporting an outcome Android has not given yet.
 */
export async function enableNativeNotifications(): Promise<boolean> {
  setNativeNotifications(true);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (nativeNotificationsEnabled()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return nativeNotificationsEnabled();
}
