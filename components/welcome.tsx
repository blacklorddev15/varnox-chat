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
        {/*
          The greeting is the heading now, and the brand is set inside it rather than above it as a
          separate wordmark. Stacking "Varnox" and then "Welcome to Varnox App" made the screen say
          the same word twice in a row, and the second time said it better.
        */}
        {/* The banner: the first thing on the screen is a face rather than a sentence. */}
        <img className="welcome-face" src="/welcome.jpg" alt="" width={88} height={88} />
        <h1 className="welcome-title">
          Welcome to <span className="welcome-brand">Varnox App</span>.
        </h1>
        {/* Its own class rather than .sub: .sub is the auth screen's body copy too, and italic
            belongs to this greeting, not to every paragraph in the sign-in flow. */}
        <p className="sub welcome-copy">
          A place to make friends. Nothing
          <br />
          sold, nothing shared — kept private.
          <br />
          Talk to people worth talking to.
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
