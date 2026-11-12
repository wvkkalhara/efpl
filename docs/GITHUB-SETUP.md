# Putting this on GitHub

The folder is already a **git repository with one commit** on the `main` branch
— nothing to initialise, nothing to clean up. You only need to point it at a
remote.

---

## 1. Create the repository — make it **Private**

The licence in this repo is proprietary and the code reveals how supplier
payments, farmer data and the owner's controls work. GitHub → **New repository**:

* Name: `efpl-biomass-storage` (or anything you like)
* Visibility: **Private**
* Do **not** tick "Add a README", "Add .gitignore" or "Choose a licence" — they
  already exist and would cause a merge conflict on the first push.
* Create repository.

## 2. Push the existing commit

Copy the remote URL from the page GitHub shows you, then:

```bash
cd efpl-biomass-github
git remote add origin https://github.com/<your-account>/efpl-biomass-storage.git
git push -u origin main
```

If GitHub asks for a password, use a **personal access token** (Settings →
Developer settings → Personal access tokens → Fine-grained, scope: Contents →
read & write), not your account password. Or use the GitHub CLI:

```bash
gh auth login
gh repo create efpl-biomass-storage --private --source=. --push
```

## 3. Turn on the safety nets (2 minutes)

| Setting | Where | Why |
|---|---|---|
| **Secret scanning** + Push protection | Settings → Code security | Blocks a Firebase service-account key from ever being pushed |
| **Dependabot alerts** | Settings → Code security | Only `jsdom` is a dependency, but keep it current |
| **Branch protection** on `main` | Settings → Branches | Require the CI check to pass before merging |
| **Require pull request reviews** | same page | A change to `firebase.rules.json` or `js/auth.js` should be read by a second person |

The workflow in `.github/workflows/ci.yml` runs on every push and pull request:
syntax check of every file → JSON validation → the 74-check smoke test → build.
If it is red, the site will not work, so do not merge.

## 4. What is deliberately **not** in the repository

| Excluded | Why | How to get it |
|---|---|---|
| `node_modules/` | Generated | `npm install` |
| `dist/` | Generated (840 KB single file) | `npm run build` — or download it from the CI run's artefacts |
| `.env`, `serviceAccountKey.json` | Secrets | Never commit. Ask the owner. |
| Backup JSON exports | Farmer NIC / phone = personal data under the PDPA | Keep off-device, encrypted |

`.gitignore` already blocks all of these. Check `git status` before pushing and
you will never have to think about it again.

## 5. Deploying from the repository

```bash
npm install -g firebase-tools
firebase login
firebase use efpl-2feb8      # already set in .firebaserc
firebase deploy --only hosting,database
```

That publishes both the app (`firebase.json` → hosting) and the database rules
(`firebase.rules.json` → `database`). After the first deploy, add the
`*.web.app` address to Firebase → Authentication → Settings → **Authorized
domains** so Google sign-in works there.

You can also connect the repo to **Firebase Hosting via GitHub** (Hosting →
"Connect to GitHub"), but a manual `firebase deploy` from a laptop is easier to
control for a site with one maintainer.

## 6. If you prefer the GitHub web uploader

Drag-and-drop upload ignores `.gitignore`, so uploading the whole folder would
carry `node_modules/` and `dist/`. Either:

* push from git (recommended, keeps history and CI), or
* upload only the 37 tracked files — `git ls-files` lists them — or
* upload the repository zip provided alongside this folder (it contains the
  commit, so history is preserved).

## 7. Working with a colleague

```bash
git clone https://github.com/<your-account>/efpl-biomass-storage.git
cd efpl-biomass-storage
npm install
npm test          # green before you start
git switch -c bags/fix-duplicate-serial
# …work…
git commit -am "bags: refuse a serial that is already stored"
git push -u origin bags/fix-duplicate-serial
```

Then open a pull request. House rules and commit conventions are in
`CONTRIBUTING.md`.
