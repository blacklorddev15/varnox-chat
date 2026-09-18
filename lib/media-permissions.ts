/**
 * Asking for camera, microphone and photo access the moment the emoji panel opens.
 *
 * Two very different things happen behind one call, because the two places this app runs can
 * ask for different things:
 *
 *   In the Android app the page talks to the shell through the `VarnoxNative` bridge, and the
 *   shell raises Android's own runtime dialog. That is the only way to get a *photos* grant:
 *   the trio the panel asks for is READ_MEDIA_IMAGES + CAMERA + RECORD_AUDIO, and it can only
 *   be granted to the installed app, never to a web page.
 *
 *   In a browser there is no photos permission to ask for. A page cannot reach the photo
 *   library; it gets pictures only through <input type="file">, which hands over exactly the
 *   files the person picks and needs no permission at all. So the browser path asks for what
 *   browsers actually have — camera and microphone — and reports honestly that photos were not
 *   part of the question.
 *
 * The stream is requested for the prompt, not for the media: every track is stopped again
 * immediately in the `finally` block, so granting does not leave the camera indicator lit or
 * hold a device open for the rest of the session.
 */

/** What the ask ended in. `unknown` is not a failure — it means the browser would not say. */
export type MediaPermissionOutcome =
  | 'native'
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'unsupported'
  | 'failed';

/** The bridge `configureWebView()` injects into the page. Only the one method is used here. */
type NativeBridge = {
  requestMediaPermissions?: () => void;
};

function nativeBridge(): NativeBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { VarnoxNative?: NativeBridge }).VarnoxNative ?? null;
}

/** True once the panel has asked in this page load. Asking again cannot change the answer. */
let asked = false;

/** Only for tests: forget that a previous call happened. */
export function resetMediaPermissionPrompt(): void {
  asked = false;
}

/** True when the page is running inside the Android shell rather than a browser. */
export function inNativeShell(): boolean {
  return typeof nativeBridge()?.requestMediaPermissions === 'function';
}

/**
 * Ask for camera, microphone and — in the app only — the photo library.
 *
 * Safe to call on every open: the first call does the work and later ones return the same
 * outcome without prompting again. Requesting once per panel open would in practice mean
 * once per session anyway, because a browser remembers a refusal and stops showing the dialog,
 * which reads as the button being broken.
 */
export async function requestMediaPermissions(): Promise<MediaPermissionOutcome> {
  if (asked) return 'granted';
  asked = true;

  // The shell owns the dialog when there is a shell. It asks for all three, photos included.
  const bridge = nativeBridge();
  if (typeof bridge?.requestMediaPermissions === 'function') {
    try {
      bridge.requestMediaPermissions();
      return 'native';
    } catch {
      return 'failed';
    }
  }

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'unsupported';
  }

  // Nothing is awaited before this call on purpose. getUserMedia must still be inside the
  // gesture that opened the panel — Safari refuses the request outright once the gesture has
  // been spent on an await, and a permission probe beforehand is exactly that kind of await.
  // If the permission is already granted the call comes straight back with a stream, which the
  // finally block turns off again, so the cost of not probing first is a sub-second camera use
  // at most once per page load.
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    return 'granted';
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    // No camera or no microphone on the device is not a refusal, and telling someone they
    // said no when they were never asked is worse than saying nothing.
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'unavailable';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
    return 'failed';
  } finally {
    // The prompt was the point. Switch the devices straight back off.
    stream?.getTracks().forEach((track) => track.stop());
  }
}
