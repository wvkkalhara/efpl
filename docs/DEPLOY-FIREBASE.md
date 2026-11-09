# Deployment guide — Firebase project `efpl-2feb8`

Everything here is done in the Firebase console, once. Total time: about 20 minutes.

---

## 0. What you have

```
efpl-biomass/
├── index.html                 ← the app (multi-file, deployable, installable PWA)
├── css/app.css
├── js/                        ← config, store, domain, auth, sync, ui, views
├── sw.js · manifest.webmanifest
├── assets/enerfab-logo.png
├── server.js                  ← optional local/LAN server (node server.js)
├── build.js                   ← makes the single-file copy
├── dist/EnerFab-Biomass-Storage.html   ← one-file version (double-click to run)
├── firebase.rules.json        ← the lock — must be published
├── tests/smoke-test.js        ← 68 automated checks
└── docs/
```

---

## 1. Publish the database rules  ⚠ the one step that matters

The database currently answers **401 Permission denied** to everyone, which is correct but means nothing can sync yet.

1. Firebase console → **Realtime Database → Rules**.
2. Replace the whole file with the contents of `firebase.rules.json`.
3. **Publish**.
4. Reload the app; the sync chip should move from *"Cloud access blocked (rules)"* to *"All changes saved to cloud"*.

The rules do four things: require a signed-in user for any read or write; let only `w.v.k.kalhara@gmail.com` control the subscription switch; validate roles against a fixed list; and block *writes* while the subscription is paused (reads stay open so the app can show the message).

---

## 2. Let people in — Google first (no console work)

**Verified on the `efpl-2feb8` project:** Google sign-in is already enabled (the identity toolkit returns the project's OAuth client `815016276678-3d5oa9…`).

1. Staff open the app and tap **Continue with Google**. Google creates the account; the app records it as **Awaiting approval** with no permissions.
2. The owner opens **Administration → Users & roles**, sees the pending account at the top, picks a role — that is the whole provisioning step. It syncs to every device.
3. No Google account? **Create an account** on the sign-in screen makes an email/password login (it needs the internet once), which also waits for approval.
4. Prefer to pre-create someone? **Add staff account** just registers the email + role; the person still does the sign-in themselves.

**Console-only fallback** (if you ever need it): Authentication → Users → *Add user* with a temporary password, and tell them to use *Forgot password* to set their own. Nothing else in this guide requires the console.

**One setting to check:** Firebase → Authentication → Settings → **Authorized domains** must contain the address you serve the app from (Firebase Hosting domains and `localhost` are added automatically). If you open it from a LAN IP such as `http://192.168.1.20:3000`, add that too, or Google sign-in will refuse with *unauthorized-domain* — email/password and offline sign-in still work there.

| Role | Can do | Typical person |
|---|---|---|
| **Super Admin (owner)** | Everything, including pause/restore and creating admins. Fixed to `w.v.k.kalhara@gmail.com` | You |
| Administrator | All operations + users + settings | Office IT |
| Biomass Supervisor | Accept deliveries, allocate bays, approve gasifier issues, authorise payments, resolve quality issues | Site supervisor |
| Store Keeper | Receive trucks, number/issue bags, farmer declarations, bag returns | Store keeper |
| Gasifier Operator | Request biomass, weigh & record consumption, report problems | Operators |
| Accounts | Release payments to Head Office, mark paid | Finance |
| Auditor | Read-only + audit trail | Internal audit |

---

## 3. Host it (choose one)

### A. Firebase Hosting (recommended — free, HTTPS, installable)

```bash
npm install -g firebase-tools
firebase login
cd efpl-biomass
firebase init hosting      # public directory: "."  · single-page app: No
firebase deploy --only hosting
```

Add to `firebase.json` so the service worker is served correctly:

```json
{ "hosting": { "public": ".",
  "headers": [
    { "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    { "source": "**/*.@(png|css|js)", "headers": [{ "key": "Cache-Control", "value": "max-age=3600" }] }
  ]
} }
```

Then open the `*.web.app` URL on the site tablet → **Add to Home screen**. It now opens full-screen, offline.

### B. Site office PC (no internet needed for the app itself)

```bash
node server.js          # http://<office-pc-ip>:3000
```

Any tablet on the same Wi-Fi opens that address and installs it. This is the most robust option for a site with poor internet: the app runs entirely on the LAN, and only the *sync* needs the internet.

### C. One USB stick / one email

Send `dist/EnerFab-Biomass-Storage.html`. Double-click. It runs with no server at all. Data lives in that browser's storage on that machine; use *Administration → Download backup* to move it.

---

## 4. First run

1. Open the app → **Continue with Google** as `w.v.k.kalhara@gmail.com` (or use *Preview with demo data* to look around first).
2. **Administration → Data & sync → Remove demo data** to clear the sample history.
3. **Administration → Business settings**: set the real unit price (Rs 300), reduced price (Rs 270), fill agreement (90 %), sample size (5 %), dry bag reference (20 kg), site name.
4. **Suppliers → Add supplier**, then add their farmers.
5. **Bag registry → Number new bags** (e.g. 5 000) → **Print labels** → fix to bags.
6. **Issue to supplier** for the first round → print the allocation slip.
7. Receive the first truck.

---

## 5. Offline behaviour — what to expect

| Situation | What the app does |
|---|---|
| No internet | Everything works. Chip says *Offline — saving on this device*. Writes queue up. |
| Internet returns | Queue pushes automatically, then pulls other devices' changes (30 s interval, or tap the chip). |
| Two devices edit the same record | Newest `updatedAt` wins; the loser's change is queued and re-applied where it does not conflict. |
| Subscription paused by the owner | Ordinary staff see the message; the owner gets in; no data is lost. Restoring is instant. |
| Browser storage full | The app warns and keeps working in memory; export a backup and clear old records. |
| Tablet replaced | Export backup on the old one → import on the new one. Or just sign in on the new one: the cloud copy fills in. |

**First sign-in on a brand-new device needs a signal once** (to verify the password with Firebase). After that the device works offline, including cold starts.

---

## 6. Routine operations

| Task | Where |
|---|---|
| Daily: receive trucks | Operations → Receive biomass |
| Daily: approve bay issue | Gasifier issue → Approve |
| Weekly: authorise payments | Payments → Open → Authorise |
| Weekly: release to Head Office | Payments → Release |
| Monthly: supplier performance | Reports → Supplier performance → CSV |
| Monthly: backup | Administration → Download backup (keep off-device) |
| Quarterly: bag stock check | Bag registry (status = In bag store) |
| As needed: new staff | Administration → Users & roles |
| Never: edit the database by hand in the console | — |

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Chip: *Cloud access blocked (rules)* | Rules not published, or not signed in with a valid account | Publish `firebase.rules.json`; sign out and in |
| *Email or password is incorrect* but the password is right | Wrong project account, or the user exists only in the local register | Create the user in Firebase Authentication |
| App opens to a paused screen | Owner set the subscription to SUSPENDED | Owner: Administration → Subscription → Restore |
| *Waiting for approval* and nothing else | Your account has no role yet | Owner: Administration → Users & roles → choose a role |
| Google button says *unauthorized-domain* | This address is not in Firebase → Authentication → Settings → Authorized domains | Add the domain, or sign in with a password |
| Data appears twice | Two devices imported the same backup with different ids | Use *Import (merge)*, which matches on record id |
| Labels print blank | Browser blocked printing a hidden frame | Allow pop-ups/printing for the site, or use the single-file build |
| Scanner types numbers in the wrong place | Scanner is not in keyboard mode | Configure the scanner to send a carriage return after each code |
