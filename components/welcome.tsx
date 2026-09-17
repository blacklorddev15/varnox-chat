import Link from 'next/link';

/**
 * The front door.
 *
 * Opening the app lands here: a name, one line about what this is, and a single action. It is a
 * server component with no state, and "Get Started" is a link rather than an onClick, so the
 * first screen costs nothing and works before any JavaScript has loaded — which matters more
 * here than anywhere else in the app, because it is the first thing anybody sees.
 *
 * It deliberately carries no sign-in link. That was the deployment owner's decision: this is a
 * registration front door. The sign-in screen is still reachable at `/login?signin=1`, which is
 * not advertised anywhere, because every account that already exists would otherwise have no way
 * back in — including the ones holding the addresses already in the database. If that safety
 * valve is ever unwanted, removing the `signin` branch in app/login/page.tsx is the whole change.
 */
export function Welcome() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Varnox</h1>
        <p className="sub">
          A small messaging app you run on your own server. Your messages stay on it — not shared
          with any other messenger.
        </p>

        {/* Straight into registration, which is the only thing this screen offers. The mode
            parameter is what tells the screen to open the wizard rather than the sign-in form. */}
        <Link className="btn" href="/login?signin=1&mode=register" style={{ marginTop: 18 }}>
          Get Started
        </Link>
      </div>
    </div>
  );
}
