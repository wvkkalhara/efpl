# Deploying to Cloudflare Pages

The app is a static site: no build step, no server code. Cloudflare Pages
serves the repository as it is.

## 1. Put the folder on GitHub

Upload the whole project folder to a new GitHub repository (private is
recommended). Do **not** upload a `node_modules` folder if one exists.

## 2. Connect it to Cloudflare Pages

Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
**Connect to Git** → choose the repository, then use these build settings:

| Setting                 | Value                                  |
| ----------------------- | -------------------------------------- |
| Framework preset        | None                                   |
| Build command           | *(leave empty)*                        |
| Build output directory  | `/` *(the repository root)*            |
| Root directory          | *(leave empty)*                        |

Deploy. Every later push to the main branch redeploys automatically.

`_headers` adds the security headers (Content-Security-Policy and friends) and
`_redirects` keeps `docs/`, `tests/`, the tooling and the config files off the
public site. Cloudflare reads both files and never serves them.

## 3. Allow the new web address in Firebase (required for Google sign-in)

Firebase console → project **efpl-2feb8** → **Authentication** → **Settings** →
**Authorized domains** → **Add domain**:

* `<your-project>.pages.dev`
* your custom domain too, if you add one in Cloudflare

Without this, "Continue with Google" fails with an "unauthorized domain" message.

## 4. Publish the database rules (once, and after every rules change)

Firebase console → **Realtime Database** → **Rules** → paste the contents of
`firebase.rules.json` → **Publish**. Cloudflare does not deploy these — they
live in Firebase.

## 5. Check after the first deploy

* The site opens and the demo button works.
* Google sign-in completes (proves step 3).
* A staff account with a role can save a record (proves step 4).
* Response headers include `Content-Security-Policy`
  (browser dev tools → Network → the page request).
* `https://<your-site>/docs/README.md` or `/firebase.rules.json` sends you back to the app.

## Before go-live with real staff

`js/config.js` → `allowLocalPreview` controls the "Preview with demo data" button.
It is safe to leave on — the demo is sandboxed and never uploads — but switch it
off if the public should not see the demo at all.
