# Working on this codebase

This is a deliberately boring stack: plain HTML, CSS and JavaScript, loaded with
`<script>` tags in a fixed order. No bundler, no framework, no runtime
dependencies. Please keep it that way — the app has to open on a site tablet
with no build step and no internet.

## Getting started

```bash
npm install        # jsdom, for the tests only
npm test           # 74 checks: boots the real app in a DOM and drives the flows
npm run build      # produces dist/EnerFab-Biomass-Storage.html (one portable file)
npm start          # http://localhost:3000 (needed for service-worker/offline testing)
```

`file://` works for a quick look, but the service worker only registers over
http(s), so use `npm start` when you are testing offline behaviour.

## House rules

1. **Escape everything.** Any value that reaches the DOM goes through `UI.esc()`
   or `UI.attr()`. There is no exception for "internal" data — a farmer's name is
   user input.
2. **Money and weights are computed in `js/domain.js`**, never in a view and
   never from a raw input field. If you need a new rule, add a pure function and
   a test for it.
3. **Never delete a biomass record.** Use `Store.remove()` (soft delete). The
   audit trail and the farmers' payment history depend on it.
4. **Every state change writes an audit entry** with `VH.audit(action, entity,
   id, detail)`.
5. **Permissions are checked in two places**: the view is not rendered without
   the permission, and the action re-checks it. Roles live in
   `Domain.PERMISSIONS`.
6. **No `console.log` in committed code.** Use `UI.toast()` for the operator.

## Adding a screen

1. Write it in the matching view file:
   * `js/views-core.js` — dashboard, receiving, deliveries, trace
   * `js/views-stock.js` — bag registry, bays, gasifier
   * `js/views-money.js` — payments, master data, quality, returns, reports, admin
2. Register it:

```js
App.register('my-screen', {
  title: 'My screen',
  perm: 'report.read',            // optional
  render(view, app) { view.innerHTML = '…'; },
});
```

3. Add it to the `NAV` array in `js/app.js` and, if a new file was needed, to
   `index.html`, `build.js` and `sw.js`.
4. Add at least one check to `tests/smoke-test.js` — the suite walks every route
   automatically, so a broken render fails CI.

## Adding a collection (a new kind of record)

1. Add the name to `COLLECTIONS` in `js/store.js`.
2. Add it to `SYNCED` in `js/sync.js` so it reaches Firebase.
3. Add a rule branch in `firebase.rules.json`.
4. Mention it in the backup/restore and "remove demo data" paths in
   `js/views-money.js`.

## Commit style

```
area: what changed

why it matters, in one or two sentences.
```

Areas: `intake`, `bags`, `bays`, `gasifier`, `payments`, `auth`, `sync`, `ui`,
`docs`, `ci`, `rules`.

Examples:

* `bags: refuse a serial that is already stored`
* `auth: sign in with Google, first-time accounts land in pending`
* `docs: bag tagging SOP for the 5 000-bag round`

Keep commits small enough to describe in one line, and never commit `dist/` or
`node_modules/` (both are ignored).

## Branching

`main` is what the site runs. Work on a branch, open a pull request, let CI run,
then merge. If a change touches `.github/`, `firebase.rules.json` or
`js/auth.js`, ask a second person to read it before merging.

## Releasing

1. Bump `version` in `js/config.js` and `package.json`; add a `CHANGELOG.md` entry.
2. `npm test && npm run build`.
3. `firebase deploy --only hosting,database` (or copy `dist/` to the office PC).
4. Test on the site tablet with aeroplane mode on, then off.
