/* boot.js — start the app. Kept in its own file (not inline in index.html)
   so the Content-Security-Policy can forbid inline scripts entirely. */
(function () {
  'use strict';
  // Service worker gives true offline start-up when served over http(s).
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* preview sandbox */ });
    });
  }
  window.addEventListener('load', function () { window.App.boot(); });
  // Writes are saved a fraction of a second after they happen. If the tab is
  // closed or the tablet is locked in that moment, save immediately instead.
  var saveNow = function () { try { window.Store.flush(); } catch (e) { /* nothing more can be done */ } };
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') saveNow(); });
})();
