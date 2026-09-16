import type { Call, CallParticipant } from './types';

/**
 * The decisions a mesh call makes, kept out of the component.
 *
 * Nothing here touches WebRTC or the DOM, and that is the point. A mesh fails in ways that are
 * hard to see — two connections opened to the same person, an offer crossing another offer, a
 * socket nobody closed, one bad connection ending the call for everybody — and every one of
 * those is decided by a plain function below rather than by browser behaviour. Keeping them here
 * means they can be checked without two phones.
 */

/**
 * Who this browser should hold a connection to.
 *
 * Only people actually on the call. Somebody still being rung has no media to send yet, so
 * opening a connection to them would mean negotiating with nothing on the other end and holding
 * a dead socket until they answer — or until the ring window expires.
 */
export function activePeers(participants: CallParticipant[], meId: string): string[] {
  return participants
    .filter((p) => p.user.id !== meId && p.state === 'joined')
    .map((p) => p.user.id);
}

/**
 * Which side of a pair makes the offer.
 *
 * Compared by id, not by who called or who answered first, so both ends of every pair work it
 * out independently and reach the same answer. That is the entire purpose: if both ends offered,
 * both would create a connection and the two would collide, and recovering from that needs a
 * full "perfect negotiation" implementation.
 *
 * Returns true for exactly one side of any pair, and never for a pair with itself.
 */
export function shouldOffer(meId: string, peerId: string): boolean {
  return meId !== peerId && meId < peerId;
}

/**
 * What the mesh needs to open, and what it needs to close.
 *
 * Compares the connections that exist against the ones that should, so somebody joining
 * mid-call opens one new connection on each existing browser, and somebody leaving closes
 * theirs. Nothing is renegotiated: each pair is negotiated once, when both are on the call.
 */
export function reconcile(
  current: string[],
  desired: string[]
): { open: string[]; close: string[] } {
  const have = new Set(current);
  const want = new Set(desired);
  return {
    open: desired.filter((id) => !have.has(id)),
    close: current.filter((id) => !want.has(id)),
  };
}

/**
 * Whether one peer's connection failing should end the whole call.
 *
 * On a two-person call, yes — there is nobody else to talk to, and that is exactly what the
 * screen did before group calls existed, so the behaviour does not change for the case that
 * already worked. On a larger call, one bad connection must not take the call away from
 * everybody else still in it.
 */
export function peerFailureEndsCall(participantCount: number): boolean {
  return participantCount <= 2;
}

/**
 * How hanging up is recorded.
 *
 * A two-person call is over when either side hangs up, and the record should say who ended it
 * and whether it was ever answered — which is what /end does. On a larger call, hanging up means
 * leaving: the call carries on without you, and only the last person out ends it.
 */
export function hangUpEndpoint(participantCount: number): 'end' | 'leave' {
  return participantCount > 2 ? 'leave' : 'end';
}

/**
 * Am I the one being rung?
 *
 * Membership rather than the callee field, because a group call has no callee — so the old
 * `call.calleeId === me.id` test would be false for every invitee on a group call, and they
 * would land straight on the in-call screen with their microphone open instead of being asked.
 */
export function isInvitee(participants: CallParticipant[], meId: string): boolean {
  return participants.some((p) => p.user.id === meId && p.state === 'invited');
}

/** The people currently on the call, for counting and for drawing tiles. */
export function joinedParticipants(participants: CallParticipant[]): CallParticipant[] {
  return participants.filter((p) => p.state === 'joined');
}

/** A one-line description of who is on a call, for the header. */
export function describeCall(call: Call, meId: string): string {
  const joined = joinedParticipants(call.participants);
  if (call.participants.length <= 2) return call.peer.displayName;

  // Two participants is the one-to-one case and is named after the other person, which is what
  // the screen has always shown while ringing and while connecting. Only a group call has
  // anything else to say.
  const others = joined.filter((p) => p.user.id !== meId).length;
  if (others === 0) return 'Waiting for others';
  return `${others} other${others === 1 ? '' : 's'} on the call`;
}
