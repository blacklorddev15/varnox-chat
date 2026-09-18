/**
 * Keeping a call alive after the app is left.
 *
 * A browser tab needs nothing here: it is either in front or the user has deliberately put it
 * aside, and a browser that is backgrounded still keeps a call running. The Android app cannot
 * rely on that. Android hands a backgrounded app silence instead of the microphone, and treats
 * it as disposable — so a call that is working perfectly well drops the moment the app leaves
 * the screen, which reads as the call disconnecting by itself.
 *
 * The shell can prevent both, but only while it knows a call is up. That is the whole job of
 * this file: the call screen says when it appears and when it goes away, and the shell does the
 * rest. Nothing here carries audio, and nothing here is needed for the call to work while the
 * app is in front.
 */

type NativeBridge = {
  setCallActive?: (active: boolean) => void;
};

function bridge(): NativeBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { VarnoxNative?: NativeBridge }).VarnoxNative ?? null;
}

/**
 * Whether the shell can keep a call running in the background.
 *
 * Only the Android app can, so this is false in every browser — which is correct rather than a
 * shortcoming: a browser has nothing to switch on.
 */
export function nativeCallAvailable(): boolean {
  const native = bridge();
  return typeof native?.setCallActive === 'function';
}

/**
 * Tell the shell whether a call is up.
 *
 * Called with `true` when the call screen appears — before the call is answered, not after, so
 * an outgoing call is protected while it is still ringing — and with `false` when the screen
 * goes away, which is the one place a call ends.
 *
 * Deliberately reports nothing back. The shell either can hold a call open or it cannot, and
 * neither answer changes what the call screen does; a return value here would be a promise the
 * page has no use for. Failures are swallowed for the same reason: a call that cannot be
 * protected in the background is still a call, and it should not be interrupted by an error
 * from the layer that was only trying to help.
 */
export function setNativeCallActive(active: boolean): void {
  const native = bridge();
  if (typeof native?.setCallActive !== 'function') return;
  try {
    native.setCallActive(active);
  } catch {
    // Nothing to recover from. The call goes on.
  }
}
