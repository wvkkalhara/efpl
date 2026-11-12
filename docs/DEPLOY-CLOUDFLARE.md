# Deploying to Cloudflare (Workers & Pages)

The app is a static site: no build step, no server code. Cloudflare
serves the repository as it is.

## 1. Put the folder on GitHub

Upload the whole project folder to a new GitHub repository (private is
recommended). Do **not** upload a `node_modules` folder if one exists.

## 2. Connect it to Cloudflare

Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**
→ choose the repository. The repository already contains everything Cloudflare
needs, so the defaults work:

| Setting          | Value                                       |
| ---------------- | ------------------------------------------- |
| Build command    | *(leave empty — `npm run build` also works)* |
| Deploy command   | `npx wrangler deploy`                       |
| Root directory   | *(leave empty)*                             |

Every later push to the main branch redeploys automatically.

What the repository files do:

* `wrangler.jsonc` — tells Cloudflare this is a static site (a Worker with
  static assets, no server code).
* `.assetsignore` — the list of files **not** to publish. Cloudflare installs
  the test tool into `node_modules` during the build (one file there is 152 MB,
  far over the 25 MB limit), so without this list the deploy fails with
  "Asset too large". Only the 18 app files are published: `index.html`,
  `css/`, `js/`, `assets/`, `sw.js`, `manifest.webmanifest`.
* `_headers` — security headers (Content-Security-Policy and friends).
* `_redirects` — sends requests for docs/tooling paths back to the app.

Cloudflare reads `_headers`, `_redirects` and `.assetsignore`; it never serves them.

## 3. Allow the new web address in Firebase (required for Google sign-in)

Firebase console → project **efpl-2feb8** → **Authentication** → **Settings** →
**Authorized domains** → **Add domain**:

* `efpl.<your-account>.workers.dev` (the address Cloudflare shows after the first deploy)
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
