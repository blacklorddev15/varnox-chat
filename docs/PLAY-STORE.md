# Publishing Varnox on Google Play

A checklist, in the order the work has to happen. Verified against the repo on 2026-09-18.

---

## 1. What Play requires that you already have

| Requirement | Status |
|---|---|
| **Account deletion** | ✅ `app/api/account/delete/route.ts`, with a "Delete my account" control in `components/settings-screen.tsx` |
| **Installable PWA to wrap** | ✅ `manifest.webmanifest` — `display: standalone`, `scope /`, portrait |
| **App icon, 512×512** | ✅ but see the note below |
| **A signed bundle** | ✗ nothing built yet |

**Use `public/icon-maskable-512.png` for the Play listing, not `icon-512.png`.** The store icon must be a full square — Play applies its own shape. `icon-512.png` has rounded corners and transparency, so it will show dark notches wherever Play does not mask it. The maskable render is already full-bleed, which is exactly what is wanted here.

---

## 2. What is missing in the app

### A privacy policy page — required, and you don't have one

```
find app -iname "*privacy*"   ->   (nothing)
```

The store listing **cannot be submitted without a privacy policy URL**. It needs to be a real page on your domain, and it has to describe what you actually collect — for Varnox that is an email address, a phone number, message contents, and optionally a profile photo.

Two consequences worth stating plainly:

- It must be **accurate**. Your messages are stored on your own server in plaintext, unlike a Signal-style design. A policy claiming "end-to-end encrypted" would be false, and Play can pull an app for a misleading declaration.
- It should be **reachable without signing in**, since reviewers check it before they have an account.

I can write this page — see the end of this document.

### A web-accessible deletion route

Play requires users be able to **request deletion without installing the app**. You have the in-app path, and the endpoint is `POST /api/account/delete`. What the Data safety form asks for is a URL a person can visit. A small page that explains how to request deletion, and its link, is enough.

---

## 3. Build an `.aab`, not an `.apk`

**Play does not accept APKs for new apps** — it takes an Android App Bundle. An APK is for sideloading and testing only. PWABuilder and Bubblewrap both emit an AAB; make sure you pick that option, because a lot of guides online still tell you to produce an APK.

Do this stage **after** the domain is fixed (section 5).

---

## 4. Store listing assets

| Asset | Spec |
|---|---|
| App icon | 512×512 PNG, full square — use `icon-maskable-512.png` |
| Feature graphic | 1024×500 PNG or JPEG |
| Phone screenshots | 2–8, min 320px, max 3840px |

Screenshots will need to come from a real device. Your welcome card, a chat, and Settings would cover it.

---

## 5. The two things that will actually block you

### The domain is settled — use `varnox-chat.vercel.app`

A Trusted Web Activity is **bound to a domain** and proves ownership by serving a file at that domain:

```
https://varnox-chat.vercel.app/.well-known/assetlinks.json
```

Chrome fetches it and compares it against the app's signing fingerprint. If it is missing or wrong, the app either refuses to open or shows a **URL bar across the top** — a web page in a frame rather than an app.

**This does not need the custom domain.** `varnox-chat.vercel.app` is a real HTTPS domain served by
this project, so it can host that file, and the app declares *that* as its host. The `blacklord.tech`
subdomain was never a requirement for the APK, and stays optional: fix it whenever, and the web app
gains a shorter address without the APK changing.

The route exists now — `app/.well-known/assetlinks.json/route.ts` — reading `ANDROID_PACKAGE_NAME`
and `ANDROID_SHA256`. It answers **404 until both are set**, deliberately, so an unconfigured
deployment looks unconfigured rather than looking like a mismatch.

⚠️ **`ANDROID_SHA256` normally needs TWO fingerprints.** With Play App Signing on — the default —
Google re-signs the bundle with its own key, so the certificate on the installed app is *not* the one
that signed the file you uploaded. Declare only the upload key and you get an app that works
sideloaded and shows a URL bar when installed from Play. It is the most common way this file is
wrong, and the failure is silent.

Note the sending domain does **not** follow the app's address: `MAIL_FROM` stays on
`varnoxapp.blacklord.tech`, because Resend verifies a domain whose DNS you control and a
`vercel.app` subdomain cannot be verified. App address and mail address are allowed to differ.

### Policy 4.3 — Google tightened this in 2025–2026

Play has been **hardening its rules against apps that are essentially a website in a wrapper** (the "Minimum Functionality" / spam policy). A TWA of a PWA is the accepted way to do this, and Varnox is a real application with accounts, messaging, moderation and a ban system rather than a content page — so it is defensible. But be ready for the reviewer question, and make the listing describe the *app*, not the website. If the listing reads as "our website, but installable", expect a rejection.

---

## 6. Forms you have to fill in

- **Data safety** — declare the email, phone, messages and photos. This is checked against your privacy policy; an inconsistency between the two is a common cause of rejection.
- **Content rating** — questionnaire, then a rating is assigned.
- **Target API level** — Play requires new apps to target a recent Android API, and the bar **moves every August**. As of the guidance found today, new apps are expected at API 35 or above, with an August 31 2026 deadline and extensions available to November 1 2026. The wrapper tooling sets this for you — the mistake to avoid is pinning an old `targetSdkVersion` by hand. Confirm the number in force in the Play Console rather than trusting this line, because it changes yearly.

---

## 7. Order of operations

1. **Set `ANDROID_PACKAGE_NAME` and `ANDROID_SHA256`** once a keystore exists — both the upload key
   and Play's — and check `/.well-known/assetlinks.json` serves them
2. **Add the privacy policy page** and a public deletion-request page
3. **Build the AAB** (PWABuilder is the fastest; CI if you want it repeatable)
4. **Verify it opens without a URL bar** — the real test that step 1 worked
5. **Verify it opens without a URL bar** — this is the real test that step 4 worked
6. **Developer account** — a one-time registration fee, then identity verification, which for a new personal account also involves testing requirements before you can reach production. Check the current terms in the Play Console.
7. **Store listing** — assets from section 4, then the forms from section 6
8. **Submit**. First review takes days, not hours

---

## What I can do next

- **Write the privacy policy page** — accurate to what Varnox actually stores, and honest about the plaintext-on-your-server design
- **Write a deletion-request page**
- **Write `app/.well-known/assetlinks.json`** so the fingerprint is served over HTTPS
- **Write the CI workflow** to build and sign the AAB on every tag — untested here, so expect a fix or two on the first run
- **Write the store listing copy** — title, short description, full description, in the app's voice

Everything in that list except the CI workflow is blocked on nothing. The AAB itself is blocked on the domain.
