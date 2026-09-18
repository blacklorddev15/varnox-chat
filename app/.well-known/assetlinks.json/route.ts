import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * The Digital Asset Links declaration: the file that lets an Android app open this site full
 * screen, rather than with a URL bar across the top.
 *
 * A Trusted Web Activity is bound to a domain, and Chrome proves that binding by fetching this
 * file over HTTPS and comparing the fingerprint against the certificate that signed the installed
 * app. No file, or one that does not match, and the app opens as a web page in a frame — the exact
 * thing a wrapper exists to avoid. It is the difference between an app and a bookmark.
 *
 * Served from the environment rather than committed, because the fingerprint is not knowable until
 * a keystore exists, and because getting it wrong fails SILENTLY: the app installs, opens, and
 * shows a browser bar, with no error anywhere to say why. An env var can be corrected without a
 * code change, which matters for a value that is discovered by trial.
 *
 * ANDROID_SHA256 takes MULTIPLE fingerprints, comma-separated, and it usually has to. With Play
 * App Signing on — the default — Google re-signs the bundle with its own key, so the certificate
 * on the installed app is NOT the one that signed the file you uploaded. Declare only the upload
 * key and the app works when sideloaded and shows a URL bar when installed from Play: the most
 * common way this file is wrong.
 */
export async function GET() {
  const pkg = (process.env.ANDROID_PACKAGE_NAME ?? '').trim();
  const fingerprints = (process.env.ANDROID_SHA256 ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

  /*
    404 rather than an empty list while nothing is configured, so a missing declaration looks
    missing. An empty array would be a valid answer that means "no app is allowed to do this",
    which is a different thing and is much harder to diagnose.
  */
  if (!pkg || fingerprints.length === 0) {
    return new NextResponse('Asset links are not configured on this deployment.', { status: 404 });
  }

  return new NextResponse(
    JSON.stringify([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: pkg,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ]),
    { headers: { 'content-type': 'application/json' } }
  );
}
