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
})();
