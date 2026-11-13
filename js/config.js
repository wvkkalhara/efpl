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
  version: '1.9.1',
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
  allowLocalPreview: false,     // the owner can switch the demo on from Administration → Subscription

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
    // Full price only for bags 100 % full; below that the part missing is
    // taken off (92 % full -> 8 % off). Fixed in domain.js (FULL_FROM_PCT).
    fillThresholdPct: 100,
    sampleSizePct: 5,         // % of bags pulled for the fill check
    minSampleSize: 1,         // no extra minimum: the sample is the full 5 % and every bag in it is measured
    // Moisture from bag weight: moisture % = (40 / 18) x kg - 20,
    // i.e. the line through 18 kg = 20 % and 36 kg = 60 %.        (req 5, 6)
    moistureCalKg1: 18, moistureCalPct1: 20,
    moistureCalKg2: 36, moistureCalPct2: 60,
    moistureWarnPct: 30,      // "damp" from here
    moistureHighPct: 45,      // "wet" from here — a reason to deduct, never to reject
    // Taking money off for moisture: OFF. On this site loads are not wet;
    // the problem is bags not filled fully (the fill check and the reason
    // "Bags are not filled fully"). An administrator can switch these on.
    deductDampPct: 0,         // % proposed for a damp load
    deductWetPct: 0,          // % proposed for a wet load
    bagSerialPrefix: 'EFPL-BG',
    maxBagsPerDelivery: 2000,
    // Bays: created the first time the yard is opened; each one can be
    // renamed, resized or added to later.
    bayCount: 30,
    bayCapacityBags: 200,
    // Drying in the bay: a bag loses about 0.6 kg a day (50 kg becomes
    // about 30 kg in a month) until it is as dry as it gets.
    dryingKgPerDay: 0.6,
    driestBagKg: 18,          // bags stop losing weight here (18 kg = 20 % moisture)
    moistureReadyPct: 25,     // a bay at or below this is flagged "dry: use first"
    defaultDeductionReason: 'Bags are not filled fully',
    // Bag store: warn when the new-bag shelf falls to this many.
    bagReorderLevel: 500,
  },

  biomassTypes: [
    // The starting list. More are added in the app (Receive biomass, or
    // Administration → Business settings) — no code change needed.
    { id: 'GLIRICIDIA', label: 'Gliricidia' },
    { id: 'CINNAMON', label: 'Cinnamon' },
    { id: 'OTHER', label: 'Other' },
  ],
};
