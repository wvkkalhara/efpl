/* =====================================================================
   EnerFab Biomass Storage — configuration
   ---------------------------------------------------------------------
   The Firebase "apiKey" below is a *public identifier*, not a secret:
   Google ships it inside every web app. What actually protects your data
   is (a) Firebase Authentication and (b) the Realtime Database rules in
   firebase.rules.json. Never put a service-account JSON in this file.
   ===================================================================== */
window.EFPL_CONFIG = {
  appName: 'EnerFab Biomass Storage',
  version: '1.2.0',
  build: '2026.11',

  /* ---- Firebase project (efpl-2feb8) ---- */
  firebase: {
    apiKey: 'AIzaSyByfrCoGo1zEadbA0ra1EpzcAxjAIuWmQw',
    authDomain: 'efpl-2feb8.firebaseapp.com',
    databaseURL: 'https://efpl-2feb8-default-rtdb.firebaseio.com',
    projectId: 'efpl-2feb8',
    storageBucket: 'efpl-2feb8.firebasestorage.app',
    messagingSenderId: '815016276678',
    appId: '1:815016276678:web:9c61bcbfabe4004b919dc7',
  },

  /* ---- Sign-in options ---------------------------------------------
     Google sign-in is enabled on the efpl-2feb8 project: a person taps
     "Continue with Google", their account is created by Google itself and
     the owner approves the role here. Nobody has to be created by hand in
     the Firebase console. */
  allowGoogleSignIn: true,
  allowSelfRegistration: true,   // staff can create an email/password login, then wait for approval
  googleSdkVersion: '10.12.2',

  /* ---- Preview / demonstration mode -------------------------------
     When true, the sign-in screen offers "Preview with demo data", which
     opens the app as the owner WITHOUT contacting Firebase. It exists so
     the system can be demonstrated with no signal and no real accounts.
     SET THIS TO false BEFORE GO-LIVE.                                  */
  allowLocalPreview: true,

  /* ---- Ownership ---- */
  superAdminEmails: ['w.v.k.kalhara@gmail.com'],

  /* ---- Offline-first behaviour ---- */
  storageKey: 'efpl.biomass.v1',
  sessionKey: 'efpl.session.v1',
  sessionDays: 90,            // stay signed in for 90 days on a trusted device
  syncIntervalMs: 30000,      // background pull every 30 s while online
  syncPath: 'biomass',        // RTDB root for operational data
  configPath: 'appConfig',    // RTDB root for subscription / remote flags

  /* ---- Business defaults (editable in Settings) ---- */
  defaults: {
    unitPrice: 300,           // Rs / bag at full fill            (req 3)
    reducedUnitPrice: 270,    // Rs / bag when the fill check fails (req 3)
    fillThresholdPct: 90,     // average fill % that keeps full price
    sampleSizePct: 5,         // % of bags pulled for the fill check
    minSampleSize: 3,
    standardDryBagKg: 20,     // reference dry weight for the moisture estimate
    moistureWarnPct: 25,
    moistureRejectPct: 45,
    bagSerialPrefix: 'EFPL-BG',
    maxBagsPerDelivery: 2000,
    bayCount: 6,
  },

  biomassTypes: [
    { id: 'GLIRICIDIA', label: 'Gliricidia', rateFactor: 1.0 },
    { id: 'IPIL_IPIL', label: 'Ipil Ipil', rateFactor: 1.0 },
    { id: 'CINNAMON', label: 'Cinnamon waste', rateFactor: 0.95 },
    { id: 'TIMBER_OFFCUT', label: 'Timber off-cuts', rateFactor: 1.05 },
    { id: 'COCONUT_SHELL', label: 'Coconut shell', rateFactor: 1.15 },
    { id: 'MIXED', label: 'Mixed / other approved', rateFactor: 0.95 },
  ],
};
