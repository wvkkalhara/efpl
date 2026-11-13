/* =====================================================================
   tutorial.js — the Training academy.
   ---------------------------------------------------------------------
   A guided, game-like training for every person, built from what their
   role can actually do (so a role the administrator has customised gets
   the matching missions too).

     - Missions: short walkthroughs that put a glowing spotlight on the
       real button or screen and explain it in plain words.
     - Points (XP) for each finished mission, a rank that grows with the
       share of missions done, a badge per mission, a certificate at the end.
     - Works on any device: on a computer the card sits beside the spotlight,
       on a phone it is a sheet at the bottom (or top, if the spotlight is at
       the bottom), and the words say "tap" or "click" to match. When a screen
       lives under "More" on a phone, the spotlight goes there.
     - Safe: training only shows and opens things. It never saves a record,
       so nobody can damage real data while learning.
     - Offered once after the first sign-in; always available again from the
       account menu, My account, the phone's More menu and the Training screen.

   Progress is a per-person convenience, kept on the device.
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.EFPL_CONFIG;
  const Store = window.Store;
  const Auth = window.Auth;
  const App = window.App;
  const UI = window.UI;
  const D = window.Domain;
  const esc = UI.esc;
  const ico = UI.icon;

  /* ---------------------------- the device --------------------------- */
  const mq = (q) => (typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false);
  const device = () => (mq('(max-width: 760px)') ? 'phone' : mq('(max-width: 1100px)') ? 'tablet' : 'computer');
  const touch = () => device() !== 'computer' || mq('(pointer: coarse)');
  /** "{Tap}" / "{tap}" in a text becomes Tap/Click to suit the device. */
  const words = (s) => String(s || '').replace(/\{Tap\}/g, touch() ? 'Tap' : 'Click').replace(/\{tap\}/g, touch() ? 'tap' : 'click');

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms = 2000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (fn()) return true; } catch { /* not there yet */ } await sleep(40); }
    try { return !!fn(); } catch { return false; }
  }
  const reduceMotion = () => mq('(prefers-reduced-motion: reduce)');

  function isShown(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.hidden) return false;
      const cs = window.getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  }

  /* ----------------------------- progress ---------------------------- */
  const me = () => Auth.current() || {};
  const progressKey = () => `efpl.training.v1.${String(me().email || me().uid || 'anyone').toLowerCase()}`;
  function loadProgress() {
    try { const p = JSON.parse(localStorage.getItem(progressKey()) || 'null'); if (p && typeof p === 'object') return Object.assign({ done: {}, xp: 0, invited: false }, p); } catch { /* none */ }
    return { done: {}, xp: 0, invited: false };
  }
  function saveProgress(p) { try { localStorage.setItem(progressKey(), JSON.stringify(p)); } catch { /* private window */ } }

  /* ------------------------- where things are ------------------------ */
  /** A screen's menu button on this device: sidebar, bottom tab, or "More". */
  function navTarget(id) {
    // the first one actually on screen: a phone keeps the sidebar in the page, hidden
    return () => [document.querySelector(`.sidebar [data-nav="${id}"]`), document.querySelector(`.tabbar [data-nav="${id}"]`), document.getElementById('more-btn')]
      .find((el) => isShown(el)) || null;
  }
  /** The field wrapper around an input, so the label is lit up too. */
  const fieldOf = (sel) => () => { const el = document.querySelector(sel); return el ? (el.closest('.field') || el) : null; };
  const modalPart = (sel) => () => document.querySelector(`.modal-backdrop:last-of-type ${sel}`) || document.querySelector(`.modal ${sel}`);
  const headingNext = (text) => () => {
    const h = [...document.querySelectorAll('.modal h4')].find((x) => x.textContent.trim() === text);
    return h ? h.nextElementSibling : null;
  };

  /** Show one step of the Receive form without touching anything typed in it. */
  function revealIntake(k) {
    const form = document.getElementById('intake-form');
    if (!form) return;
    const sections = [...form.querySelectorAll(':scope > section')];
    sections.forEach((s, i) => { s.hidden = i !== k; });
    [...form.querySelectorAll('.stepper li')].forEach((li, i) => { li.className = i === k ? 'on' : i < k ? 'done' : ''; });
    const last = k === sections.length - 1;
    const set = (id, hide) => { const b = form.querySelector(id); if (b) b.hidden = hide; };
    set('#step-back', k === 0); set('#step-next', last); set('#step-submit', !last);
    Tour.touchedIntake = true;
  }

  const firstStockedBay = () => Store.where('bays', (b) => !b.deleted).find((b) => window.VH.bagsInBay(b.id) > 0);
  const waitingTruck = () => Store.all('deliveries').find((d) => d.status === 'AWAITING_ACCEPTANCE');
  const roleName = () => D.ROLE_LABEL[Auth.role()] || Auth.role();
  const can = (p) => Auth.can(p);
  const sees = (id) => App.canSee(id);

  /* ------------------------------ missions ---------------------------
     Each mission: id, title, badge, icon, when (who gets it), steps.
     A step: title, text, and optionally
       route   the screen it happens on (skipped if the role cannot see it)
       target  where the spotlight goes (selector, list, or function);
               no target, or not on screen: a card in the middle
       before  something to open or show first (never saves anything)
       modal   true when the spotlight is inside an open dialog
       when    leave the step out unless this is true
       tap     the person taps the lit-up button to carry on            */
  const MISSIONS = [
    {
      id: 'welcome', title: 'Welcome to the yard', badge: 'First day', icon: 'home',
      blurb: 'Find your way around: your menu, your jobs, the connection light.',
      when: () => true,
      steps: () => [
        { title: `Welcome, ${firstName()}!`, text: () => `You are signed in as <b>${esc(roleName())}</b>. ${esc(D.ROLE_INFO[Auth.role()] || 'You can see everything and run the whole system.')}<br><br>This training walks you through <b>your</b> screens, one mission at a time. Each mission earns points and a badge. <b>Nothing you do in training is saved</b>, so explore freely.` },
        { title: 'Your menu', route: 'dashboard', target: () => document.querySelector('.tabbar') && isShown(document.querySelector('.tabbar')) ? document.querySelector('.tabbar') : document.querySelector('.sidebar .nav'),
          text: () => (device() === 'phone'
            ? 'Your most used screens are in this bar at the bottom. Everything else is under <b>More</b>. You only see the screens your job needs.'
            : 'Every screen for your job is in this menu. You only see what your role needs, so it never gets crowded.') },
        { title: 'Home', route: 'dashboard', target: '.hero', text: 'Home shows the day at a glance: how many bags are in the yard and the big buttons for your usual jobs.' },
        { title: 'Waiting for you', route: 'dashboard', target: '.tasks', text: 'Only the jobs <b>your role</b> can do appear here: trucks to accept, payments to authorise, dry bays to use first. {Tap} one to go straight to it.' },
        { title: 'The connection light', target: '#sync-chip', text: () => `This shows the connection to the cloud:<br><b>Live</b>: connected; changes from other devices appear at once.<br><b>Reconnecting…</b>: the app is getting back online by itself.<br><b>Offline</b>: no signal. Keep working: everything is saved on this ${esc(device())} and uploads by itself later.` },
        { title: 'Your account', target: '#user-btn', text: () => `Your account menu: set or change your password, take a backup, sign out, and <b>open this training again any time</b>.${device() === 'phone' ? ' On a phone the same things are under <b>More</b>.' : ''}` },
      ],
    },
    {
      id: 'receive', title: 'Receive a truck', badge: 'Gatekeeper', icon: 'truckIn',
      blurb: 'Supplier, weighbridge, the 5 % fill check and the bags, step by step.',
      when: () => can('delivery.create') && sees('intake'),
      steps: () => [
        { title: 'Open Receive biomass', target: navTarget('intake'), route: 'dashboard', text: () => (navTarget('intake')() && navTarget('intake')().id === 'more-btn'
          ? 'When a truck arrives, open <b>Receive biomass</b>. On this phone it is under <b>More</b>.'
          : 'When a truck arrives, {tap} <b>Receive biomass</b>.'), tap: true, next: 'intake' },
        { title: 'Four short steps', route: 'intake', before: () => revealIntake(0), target: '.stepper', text: 'A delivery is entered in four steps: <b>Supplier</b>, <b>Weight</b>, <b>Fill check</b>, <b>Bags</b>. A step cannot be skipped while something in it is missing.' },
        { title: 'Find the supplier', route: 'intake', before: () => revealIntake(0), target: '.supplier-pick', text: () => `Search by name, code, phone or village. ${can('supplier.write') ? 'First visit? <b>New supplier</b> adds them here, with their bank details so Head Office can pay them.' : ''}` },
        { title: 'Vehicle and driver', route: 'intake', before: () => revealIntake(0), target: '#intake-form .grid-3', text: 'Choose the biomass type and enter the vehicle number, the driver and the weighbridge slip.' },
        { title: 'Weighbridge', route: 'intake', before: () => revealIntake(1), target: () => document.querySelector('#intake-form section:not([hidden]) .grid-4'), text: 'Type the <b>gross</b> and <b>tare</b> weights and the <b>bags counted</b>. The app works out the net weight and the average bag weight.' },
        { title: 'Moisture from the bag weight', route: 'intake', before: () => revealIntake(1), target: '#weigh-out', text: () => `The average bag weight tells the moisture: an ${Store.settings().moistureCalKg1 || 18} kg bag is ${Store.settings().moistureCalPct1 || 20} %, a ${Store.settings().moistureCalKg2 || 36} kg bag is ${Store.settings().moistureCalPct2 || 60} %. This is used to plan the drying in the bays.` },
        { title: 'Print the blank fill sheet', route: 'intake', before: () => revealIntake(2), target: '#print-fill-sheet', text: 'Print a sheet with one box per sample bag and write the readings at the drum. What you have typed so far is kept safe while you print, even if the phone reloads the page.' },
        { title: 'The full 5 % sample', route: 'intake', before: () => revealIntake(2), target: '#fill-inputs', text: () => `Empty each sample bag into the drum and type the fill height. <b>Every</b> bag in the ${Store.settings().sampleSizePct || 5} % sample must be entered: 120 bags means 6 readings.` },
        { title: 'The price follows the fill', route: 'intake', before: () => revealIntake(2), target: '#fill-result', text: () => `Bags must be <b>100% full</b> for the full price, <b>Rs ${Store.settings().unitPrice || 300}</b> a bag (never more). Below that the price follows the fill: 92% full means 8% off. Wetness never cuts the price. The supervisor can pay full price anyway, with a written reason.` },
        { title: 'Bag serials', route: 'intake', before: () => revealIntake(3), target: fieldOf('[name=serialsText]'), text: 'Scan or paste the bag numbers. A whole range works, like EFPL-BG-000301-000480. You can also leave this for acceptance.' },
        { title: 'Register', route: 'intake', before: () => revealIntake(3), target: '#step-submit', text: () => (can('delivery.accept')
          ? '<b>Register delivery</b> saves the truck and takes you straight on to choosing the bays.'
          : '<b>Register delivery</b> saves the truck. It then waits for the supervisor to accept it into the bays.') },
      ],
    },
    {
      id: 'accept', title: 'Accept a load into the bays', badge: 'Bay boss', icon: 'warehouse',
      blurb: 'Split the bags over the bays, check the bank details, set a deduction.',
      when: () => can('delivery.accept') && sees('deliveries'),
      steps: () => {
        const truck = waitingTruck();
        const s = [
          { title: 'Trucks waiting for you', route: 'deliveries', target: '.toolbar .seg', text: '<b>Waiting to be accepted</b> lists the trucks the gate has entered. The number shows how many are waiting.' },
          { title: 'Every delivery', route: 'deliveries', target: '#delivery-table', text: '{Tap} any delivery to open it: its fill check, moisture, bays, payment, and the buttons to print the <b>receipt</b>, the <b>invoice</b> and the <b>bag labels</b>. Every print carries the EnerFab logo.' },
        ];
        if (truck) {
          s.push(
            { title: 'Choose the bays', route: 'deliveries', before: () => App.acceptFlow(truck.id), modal: true, target: modalPart('#alloc-table'), text: 'A split is suggested, <b>empty bays first</b>. Change any number. The total must match the bags counted. A bay can go over its size if you need it to.' },
            { title: 'Pay to', modal: true, target: headingNext('Pay to'), text: 'The supplier\'s bank details, to check before the payment is made. <b>Change bank details</b> corrects them here. If there are none, the boxes are open and must be filled in: no payment is made without a bank and account number.' },
            { title: 'Deduction', modal: true, target: () => { const el = document.querySelector('.modal [name=deductionPct]'); return el ? el.closest('.grid-2') : null; }, text: () => `The fill check result is shown here. If the bags were not filled fully, take a percent off. The reason starts as "<b>${esc(Store.settings().defaultDeductionReason || 'Bags are not filled fully')}</b>". The box starts at 0.` },
            { title: 'Accept', modal: true, target: modalPart('[data-act=accept]'), text: '<b>Accept and create payment</b> puts the bags in the bays and makes the payment for authorisation. (In training nothing is accepted: this dialog closes when you go on.)' },
          );
        } else {
          s.push({ title: 'Accepting a truck', text: 'When you open a waiting truck and press <b>Accept</b>, you choose the bays (empty bays are suggested first), check the supplier\'s bank details, and set any deduction. The usual reason is "Bags are not filled fully". Accepting creates the payment by itself.' });
        }
        return s;
      },
    },
    {
      id: 'bays', title: 'Bays and drying', badge: 'Dry keeper', icon: 'warehouse',
      blurb: 'Read the yard: red bays are dry and go first. History, size, moisture.',
      when: () => sees('bays'),
      steps: () => {
        const bay = firstStockedBay();
        const s = [
          { title: 'Open Bays & stock', route: 'dashboard', target: navTarget('bays'), tap: true, next: 'bays', text: () => (navTarget('bays')() && navTarget('bays')().id === 'more-btn' ? '<b>Bays & stock</b> is under <b>More</b> on this phone.' : '{Tap} <b>Bays & stock</b>.') },
          { title: 'The yard in numbers', route: 'bays', target: '#view .stats', text: () => `Bags in the yard, bays in use, how many are dry, and the drying rate: a bag loses about <b>${Store.settings().dryingKgPerDay ?? 0.6} kg a day</b>, so 50 kg becomes about 30 kg in a month.` },
          { title: 'Red means use it first', route: 'bays', target: '#bay-tiles', text: () => `<b>Red</b> bays are dry (at or below ${D.moistureReadyPct(Store.settings())} % moisture) and should go to the gasifier first. Amber is still damp, blue is wet, grey is empty.` },
          { title: 'Filters', route: 'bays', target: '#bay-filters', text: 'Show only the bays with stock, the dry ones, or the empty ones.' },
          { title: 'Daily bay check', route: 'bays', when: () => !!document.getElementById('day-check'), target: '#day-check', text: 'Each day, weigh <b>one bag</b> from each bay and type the weights here. A missed day is fine: leave that bay blank.' },
          { title: 'A small graph per bay', route: 'bays', target: () => document.querySelector('.bay-tile .bt-foot') || document.getElementById('bay-tiles'), text: 'Each bay shows its bag weight over the last 14 days. <b>Show more</b> opens the full graph with every reading and how much weight it loses a day.' },
        ];
        if (bay) {
          s.push(
            { title: 'Everything about a bay', route: 'bays', before: () => App.openBay(bay.id), modal: true, target: modalPart('.bay-now'), text: '{Tap} a bay to see it as it is <b>now</b>: bags in it, today\'s moisture and bag weight, and the oldest load. Weigh a bag from the bay to replace the estimate with a real reading.' },
            { title: 'Bay history', modal: true, target: modalPart('[data-act=history]'), text: '<b>History</b> lists every load that went in and every issue taken out, with the bag weight and the <b>moisture each time</b>. It can be printed.' },
          );
          if (can('bay.allocate')) s.push({ title: 'Flexible bays', modal: true, target: modalPart('[data-act=edit]'), text: '<b>Edit bay</b> renames or resizes a bay. Sizes are a guide. <b>Add bay</b> on the Bays screen adds more, and an empty bay can be removed.' });
        }
        return s;
      },
    },
    {
      id: 'gasifier', title: 'Feed the gasifier', badge: 'Fire starter', icon: 'flame',
      blurb: 'Ask for biomass, approve the driest bay, weigh the bags of each type.',
      when: () => sees('gasifier'),
      steps: () => [
        { title: 'Open Gasifier', route: 'dashboard', target: navTarget('gasifier'), tap: true, next: 'gasifier', text: () => (navTarget('gasifier')() && navTarget('gasifier')().id === 'more-btn' ? '<b>Gasifier</b> is under <b>More</b>.' : '{Tap} <b>Gasifier</b>.') },
        { title: 'Driest bays first', route: 'gasifier', target: '#view .bay-grid', text: 'Bays with stock, <b>driest first</b>, with today\'s bag weight and moisture. Red ones are dry: use them first.' },
        { title: 'Ask for biomass', route: 'gasifier', when: () => can('usage.request'), target: '#new-usage', text: '<b>Ask for bags</b> asks for a number of bags from a bay. It then waits for the supervisor.' },
        { title: 'Approve', route: 'gasifier', when: () => can('usage.approve'), text: 'As supervisor you see each request under <b>Open requests</b>. <b>Approve and choose bay</b>: the driest bay is offered first, and you can weigh a bag to confirm.' },
        { title: 'Weigh and feed', route: 'gasifier', when: () => can('usage.consume'), text: 'When a request is approved, press <b>Weigh and feed</b>: for each type (gliricidia, cinnamon…) type the <b>number of bags</b> and the weight of <b>all those bags together</b>. The app works out the average bag and the moisture, and the bags leave the bay.' },
        { title: 'The empty bags', route: 'gasifier', when: () => can('usage.consume'), text: 'In the same window, count the empty bags: <b>good</b> ones go back to the bag store as used bags, <b>torn</b> ones are thrown away. Something wrong (bags not full, stones, rot)? Tick the box and report it: the app knows which load the bags came from, even without serials.' },
        { title: 'What went to the gasifier', route: 'gasifier', target: () => [...document.querySelectorAll('#view h3')].find((h) => /What went to the gasifier/.test(h.textContent)), text: 'Everything that went to the gasifier: bay, bags, average weight, moisture and who did it.' },
      ],
    },
    {
      id: 'bags', title: 'Bags and labels', badge: 'Tag master', icon: 'tag',
      blurb: 'The bag store: used bags first, new bags to top up, torn bags out.',
      when: () => sees('bags') || sees('returns'),
      steps: () => [
        { title: 'The bag store', route: 'returns', when: () => sees('returns'), target: '#view .stats', text: 'Empty bags are kept on two shelves: <b>used</b> (back from the gasifier and still good) and <b>new</b>. You also see how many bags each supplier is holding, and how many were thrown away.' },
        { title: 'Issue bags to a supplier', route: 'returns', when: () => sees('returns') && can('bag.issue'), target: '#bs-issue', text: 'Bags go out from the <b>used</b> shelf first; new bags make up the rest. The split is filled in for you and can be changed. A slip is printed for the supplier.' },
        { title: 'New bags and torn bags', route: 'returns', when: () => sees('returns') && can('returns.write'), target: '#bs-new', text: '<b>Receive new bags</b> when a delivery of bags arrives. <b>Record torn bags</b> found in the store. When new bags run low, the dashboard tells you to order more.' },
        { title: 'Count the store', route: 'returns', when: () => sees('returns') && can('returns.write'), target: '#bs-count', text: 'Count the shelves now and then and type the numbers: the app puts its figures right and keeps the difference in the movements.' },
        { title: 'Serial numbers (optional)', route: 'bags', when: () => sees('bags'), target: '#bag-search', text: 'If you label bags with serial numbers, the Bag registry finds any bag. The bag store works by counts, so serials are not needed.' },
        { title: 'Number and label bags', route: 'bags', when: () => sees('bags') && can('bag.generate'), target: '#gen-bags', text: 'Create a run of new serials and print the labels. The supplier number is written by hand on the label, so a bag can go to a different supplier next round.' },
        { title: 'Every numbered bag', route: 'bags', when: () => sees('bags'), target: '#bag-table', text: 'If you use serial numbers, each bag\'s status is here: in the store, with a supplier, in a bay, or thrown away.' },
      ],
    },
    {
      id: 'quality', title: 'Trace and quality', badge: 'Detective', icon: 'search',
      blurb: 'Follow any bag back to its supplier, and report problems.',
      when: () => sees('trace') || sees('quality'),
      steps: () => [
        { title: 'Trace a bag', route: 'trace', when: () => sees('trace'), target: () => { const el = document.getElementById('trace-input'); return el ? (el.closest('form') || el) : null; }, text: 'Type the serial on the tag. You see the supplier, the delivery and receipt, the bay, the gasifier run and the payment.' },
        { title: 'Report a problem', route: 'quality', when: () => sees('quality') && can('quality.report'), target: '#new-issue', text: 'Stones, rot or wrong material? Report it against the bag serials. The supplier is found automatically.' },
        { title: 'Close a problem', route: 'quality', when: () => sees('quality') && can('quality.resolve'), text: 'Open an issue to record who was told and how, then resolve it.' },
      ],
    },
    {
      id: 'payments', title: 'Pay the suppliers', badge: 'Paymaster', icon: 'wallet',
      blurb: 'From acceptance to paid: authorise, release, mark paid.',
      when: () => sees('payments'),
      steps: () => [
        { title: 'Open Payments', route: 'dashboard', target: navTarget('payments'), tap: true, next: 'payments', text: () => (navTarget('payments')() && navTarget('payments')().id === 'more-btn' ? '<b>Payments</b> is under <b>More</b>.' : '{Tap} <b>Payments</b>.') },
        { title: 'Money at a glance', route: 'payments', target: '#view .stats', text: 'What is in the pipeline, waiting for authorisation, with Head Office, and paid to date.' },
        { title: 'The stages', route: 'payments', target: '#view .toolbar .seg', text: 'A payment is made when a truck is accepted, then: <b>Waiting for supervisor</b> → <b>Approved</b> → <b>With Head Office</b> → <b>Paid</b>.' },
        { title: 'Your part', route: 'payments', target: '#payment-table', text: () => {
          const jobs = [];
          if (can('payment.approve')) jobs.push('<b>authorise</b> payments and change deductions');
          if (can('payment.release')) jobs.push('<b>release</b> authorised payments to Head Office');
          if (can('payment.pay')) jobs.push('<b>mark them paid</b>');
          return `${jobs.length ? `Your job: ${jobs.join(', ')}.` : 'You can see every payment.'} {Tap} a payment to open it: the supplier's bank details and a printable payment slip are there.`;
        } },
      ],
    },
    {
      id: 'suppliers', title: 'Suppliers', badge: 'Networker', icon: 'truck',
      blurb: 'Find a supplier, keep their bank details, print a statement.',
      when: () => sees('suppliers'),
      steps: () => [
        { title: 'Find anyone fast', route: 'suppliers', target: '#sup-search', text: 'Search by name, code, phone, village or account number.' },
        { title: 'Add a supplier', route: 'suppliers', when: () => can('supplier.write'), target: '#add-sup', text: 'Add a supplier with their NIC, phone and <b>bank details</b>. A supplier without bank details is flagged, so they are not forgotten.' },
        { title: 'Statements', route: 'suppliers', target: '#sup-table', text: '{Tap} a supplier to see their loads and payments and print a statement.' },
      ],
    },
    {
      id: 'reports', title: 'Read the reports', badge: 'Analyst', icon: 'chart',
      blurb: 'Any period, any supplier: in and out, money, moisture.',
      when: () => sees('reports'),
      steps: () => [
        { title: 'Pick a period', route: 'reports', target: '#rp-presets', text: '7, 30 or 90 days, this month, all time, or your own dates. Every figure follows at once.' },
        { title: 'Filter', route: 'reports', target: fieldOf('[name=rpSupplier]'), text: 'Narrow it to one supplier or one biomass type.' },
        { title: 'Live figures', route: 'reports', target: '#report-body', text: 'Bags and kilograms in and out, money by stage, moisture by supplier. The page updates by itself when another device records something.' },
        { title: 'Print or export', route: 'reports', target: '#print-report', text: 'Print the report (with the logo) or download CSV files for a spreadsheet.' },
      ],
    },
    {
      id: 'admin', title: 'Run the system', badge: 'Chief', icon: 'settings',
      blurb: 'People and roles, prices and moisture, the activity log, backups.',
      when: () => sees('admin') && (can('user.manage') || can('settings.write')),
      steps: () => [
        { title: 'Administration', route: 'admin', target: '#admin-tabs', text: 'Users & roles, business settings, the audit trail and data & sync.' },
        { title: 'People', route: 'admin', when: () => can('user.manage'), before: () => clickTab('users'), target: () => document.getElementById('add-user') || document.getElementById('admin-body'), text: 'New people sign in with Google and wait here as <b>Awaiting approval</b>: pick their role. <b>Add staff account</b> adds someone by email. <b>Remove</b> signs a person out everywhere; their records stay.' },
        { title: 'Prices, moisture and drying', route: 'admin', when: () => can('settings.write'), before: () => clickTab('settings'), target: () => document.getElementById('save-settings') || document.getElementById('admin-body'), text: 'Rs per bag, the fill agreement, the 5 % sample, the moisture line, the drying rate (0.6 kg a day) and the default deduction reason. Every device follows what is saved here.' },
        { title: 'Activity log', route: 'admin', before: () => clickTab('audit'), target: '#admin-body', text: 'Every action, by whom and when, from every device. It cannot be edited.' },
        { title: 'Staff log', route: 'admin', when: () => can('user.manage'), before: () => clickTab('staff'), target: '#admin-body', text: 'Everything each staff member did. Pick a <b>person</b>, an <b>area</b> or a <b>period</b>, see a summary by person, and download it as CSV.' },
        { title: 'Backups', route: 'admin', before: () => clickTab('data'), target: () => document.getElementById('backup-now') || document.getElementById('admin-body'), text: 'Take a backup file at any time. The cloud keeps the shared copy; every device also keeps its own.' },
      ],
    },
    {
      id: 'audit', title: 'Look, don\'t touch', badge: 'Inspector', icon: 'search',
      blurb: 'Your read-only view of every screen and the activity log.',
      when: () => Auth.role() === 'auditor',
      steps: () => [
        { title: 'Read-only', text: 'As auditor you can open <b>every</b> screen, but nothing can be changed from your account. Buttons that would change something are not shown to you.' },
        { title: 'The activity log', route: 'admin', before: () => clickTab('audit'), target: '#admin-body', text: 'Every action on every device, newest first: who did it and when.' },
        { title: 'Reports', route: 'reports', target: '#report-body', text: 'All figures for any period, ready to print or export.' },
      ],
    },
  ];

  function firstName() { return esc(String(me().name || me().email || 'there').split(/[ @]/)[0]); }
  function clickTab(id) { const b = document.querySelector(`#admin-tabs [data-tab="${id}"]`); if (b && !b.classList.contains('active')) b.click(); }

  /** The missions this person gets, with their steps worked out now. */
  function myMissions() {
    return MISSIONS.filter((m) => { try { return m.when(); } catch { return false; } });
  }
  function stepsOf(m) {
    return m.steps().filter((s) => {
      if (s.route && !App.canSee(s.route)) return false;
      try { return !s.when || s.when(); } catch { return false; }
    });
  }
  const minutes = (m) => Math.max(1, Math.round((stepsOf(m).length * 20) / 60));

  /* -------------------------------- ranks ---------------------------- */
  const RANKS = [
    [0, 'New starter'], [0.01, 'Trainee'], [0.34, 'Yard hand'], [0.6, 'Skilled hand'], [0.85, 'Expert'], [1, 'Yard master'],
  ];
  function rank(p) {
    const list = myMissions();
    const done = list.filter((m) => p.done[m.id]).length;
    const share = list.length ? done / list.length : 0;
    let name = RANKS[0][1];
    for (const [at, n] of RANKS) if (share >= at) name = n;
    return { name, done, total: list.length, share };
  }

  /* ---------------------------- the spotlight ------------------------ */
  const Tour = {
    active: null,
    touchedIntake: false,

    async start(missionId) {
      if (Tour.active) Tour.stop(true);
      const m = MISSIONS.find((x) => x.id === missionId);
      if (!m) return;
      await closeDialogs();
      const steps = stepsOf(m);
      if (!steps.length) return UI.toast('Nothing to show for your role in this mission', 'warn');
      const list = myMissions();
      Tour.active = { m, steps, i: 0, no: list.indexOf(m) + 1, of: list.length, startRoute: App.route };
      Tour.touchedIntake = false;
      buildLayer();
      const p = loadProgress(); p.invited = true; saveProgress(p);
      await Tour.show(0);
    },

    async show(i) {
      const t = Tour.active;
      if (!t) return;
      t.i = Math.max(0, Math.min(t.steps.length - 1, i));
      const st = t.steps[t.i];
      const token = (t.token = (t.token || 0) + 1);
      layer.classList.add('is-moving');
      if (!st.modal) await closeDialogs();
      if (st.route && App.route !== st.route) {
        App.navigate(st.route);
        await waitFor(() => App.route === st.route && document.getElementById('view') && document.getElementById('view').children.length, 2500);
        await sleep(200);
      }
      if (token !== t.token || !Tour.active) return;
      if (st.before) { try { st.before(); } catch (e) { console.warn('training step', e); } await sleep(st.modal ? 380 : 120); }
      if (token !== t.token || !Tour.active) return;
      let el = resolveTarget(st);
      if (el) {
        // a tall target (a whole menu, a table) lines up at its top; anything else is centred
        const tall = el.getBoundingClientRect().height > window.innerHeight * 0.7;
        el.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest', behavior: 'auto' });
        await sleep(60);
        if (!isShown(el)) el = null;
      }
      if (token !== t.token || !Tour.active) return;
      t.el = el;
      t.sheetTop = undefined;
      paintCard(st, el);
      if (el) fitAroundSheet(el);
      place();
      layer.classList.remove('is-moving');
    },

    next() {
      const t = Tour.active;
      if (!t) return;
      if (t.i >= t.steps.length - 1) return Tour.finish();
      Tour.show(t.i + 1);
    },
    back() { const t = Tour.active; if (t && t.i > 0) Tour.show(t.i - 1); },

    /** Leave training. Resolves once the dialogs it opened are closed. */
    async stop(quiet) {
      const t = Tour.active;
      Tour.active = null;
      unbindTap();
      if (layer) { layer.remove(); layer = null; }
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
      document.removeEventListener('keydown', onKey, true);
      if (t && !quiet) {
        await closeDialogs();
        // the Receive form was only shown step by step: put it back as it was
        if (Tour.touchedIntake && App.route === 'intake') App.mountView();
        Tour.touchedIntake = false;
      }
    },

    async finish() {
      const t = Tour.active;
      if (!t) return;
      const p = loadProgress();
      const before = rank(p).name;
      const first = !p.done[t.m.id];
      const gained = first ? t.steps.length * 10 + 50 : 0;
      if (first) p.done[t.m.id] = { at: new Date().toISOString(), xp: gained };
      p.xp = (p.xp || 0) + gained;
      saveProgress(p);
      const r = rank(p);
      await Tour.stop();                 // close the training's own dialogs first…
      celebrate(t.m, gained, r, r.name !== before);   // …so they cannot take the celebration with them
      if (App.route === 'training') setTimeout(() => App.mountView(), 300);
    },
  };

  function resolveTarget(st) {
    if (!st.target) return null;
    const list = typeof st.target === 'function' ? [st.target] : [].concat(st.target);
    for (const c of list) {
      let el = null;
      try { el = typeof c === 'function' ? c() : document.querySelector(c); } catch { el = null; }
      if (el && isShown(el)) return el;
    }
    return null;
  }

  async function closeDialogs() {
    for (let n = 0; n < 6; n++) {
      const open = [...document.querySelectorAll('.modal-backdrop')].filter((b) => !b.classList.contains('closing'));
      if (!open.length) break;
      const x = open[open.length - 1].querySelector('.modal-head [data-close]') || open[open.length - 1].querySelector('[data-close]');
      if (!x) break;
      x.click();
      await sleep(260);
    }
  }

  let layer = null;
  function buildLayer() {
    layer = document.createElement('div');
    layer.className = 'tour';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-labelledby', 'tour-title');
    layer.innerHTML = `
      <div class="tour-shade" data-s="t"></div><div class="tour-shade" data-s="l"></div>
      <div class="tour-shade" data-s="r"></div><div class="tour-shade" data-s="b"></div>
      <div class="tour-hole" aria-hidden="true"></div>
      <div class="tour-ring" aria-hidden="true"></div>
      <div class="tour-card" tabindex="-1"></div>`;
    document.body.appendChild(layer);
    layer.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tour]');
      if (!b) return;
      const a = b.dataset.tour;
      if (a === 'next') Tour.next();
      else if (a === 'back') Tour.back();
      else if (a === 'exit') Tour.stop();
    });
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    document.addEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (!Tour.active) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); Tour.stop(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); Tour.next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); Tour.back(); }
  }
  let raf = 0;
  function onMove() { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); }

  let tapEl = null;
  let tapFn = null;
  function unbindTap() { if (tapEl && tapFn) tapEl.removeEventListener('click', tapFn, true); tapEl = null; tapFn = null; }

  function paintCard(st, el) {
    const t = Tour.active;
    const card = layer.querySelector('.tour-card');
    const text = typeof st.text === 'function' ? st.text() : st.text;
    const isLast = t.i === t.steps.length - 1;
    const p = loadProgress();
    const replay = !!p.done[t.m.id];
    // A "tap" step: the real button is lit and the person taps it to go on.
    // The "More" button is never used this way, because it opens a menu.
    unbindTap();
    const interactive = !!(st.tap && el && el.id !== 'more-btn');
    layer.classList.toggle('lets-tap', interactive);
    if (interactive) {
      tapEl = el;
      tapFn = () => { setTimeout(() => { if (Tour.active === t) Tour.next(); }, 60); };
      el.addEventListener('click', tapFn, true);
    }
    card.innerHTML = `
      <div class="tour-top">
        <span class="tour-mission">${ico(t.m.icon)}<span>Mission ${t.no} of ${t.of} · ${esc(t.m.title)}</span></span>
        <button class="tour-x" data-tour="exit" aria-label="Leave training">${ico('x')}</button>
      </div>
      <div class="tour-bar" aria-hidden="true"><span style="width:${Math.round(((t.i + 1) / t.steps.length) * 100)}%"></span></div>
      <h3 id="tour-title">${esc(st.title)}</h3>
      <div class="tour-text">${words(text)}</div>
      ${!el && st.target ? '<p class="tour-note">This part is not on the screen right now, so here it is in words.</p>' : ''}
      ${interactive ? `<p class="tour-hint">${ico('chevron')}<span>${words('{Tap} the glowing button to carry on')}</span></p>` : ''}
      <div class="tour-foot">
        <span class="tour-count">${t.i + 1} / ${t.steps.length}${replay ? ' · replay' : ` · <b>+${t.steps.length * 10 + 50} XP</b> at the end`}</span>
        <span class="tour-btns">
          ${t.i > 0 ? '<button class="nm-btn" data-tour="back">Back</button>' : ''}
          <button class="nm-btn primary" data-tour="next">${isLast ? 'Finish mission' : interactive ? 'Skip' : 'Next'}</button>
        </span>
      </div>`;
    card.classList.remove('pop');
    void card.offsetWidth;
    card.classList.add('pop');
    try { card.focus({ preventScroll: true }); } catch { card.focus(); }
  }

  /** The element that scrolls `el` (a dialog body, or the page). */
  function scroller(el) {
    for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const oy = window.getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
    }
    return null;   // the page itself
  }

  /** Is the element pinned to the screen (top bar, bottom tabs), so scrolling cannot move it? */
  function pinned(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const p = window.getComputedStyle(n).position;
      if (p === 'fixed' || p === 'sticky') return true;
    }
    return false;
  }

  /**
   * On a phone the card is a sheet across the bottom (or top) of the screen.
   * Choose the side with more room, then scroll so the lit-up part sits in
   * the free space instead of under the sheet.
   */
  function fitAroundSheet(el) {
    if (window.innerWidth > 640 || !layer) return;
    const card = layer.querySelector('.tour-card');
    card.classList.add('as-sheet');
    const vh = window.innerHeight;
    const sheetH = Math.min(card.offsetHeight || 0, vh * 0.62);
    let r = el.getBoundingClientRect();
    if (!pinned(el)) {
      const room = vh - sheetH;                      // free space with the sheet at the bottom
      const want = r.height < room - 24 ? Math.max(12, (room - r.height) / 2) : 12;
      const delta = r.top - want;
      if (Math.abs(delta) > 4) {
        const sc = scroller(el);
        if (sc) sc.scrollTop += delta; else window.scrollBy(0, delta);
      }
      r = el.getBoundingClientRect();
    }
    Tour.active.sheetTop = (r.top + r.height / 2) > (vh / 2) && r.top > vh - r.bottom;
  }

  /** Put the shade, the ring and the card where they belong for this screen size. */
  function place() {
    const t = Tour.active;
    if (!t || !layer) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const el = t.el && isShown(t.el) ? t.el : null;
    const shade = (k, x, y, w, h) => { const s = layer.querySelector(`[data-s="${k}"]`); Object.assign(s.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, h)}px` }); };
    const ring = layer.querySelector('.tour-ring');
    const hole = layer.querySelector('.tour-hole');
    const card = layer.querySelector('.tour-card');
    let r = null;
    if (el) {
      const b = el.getBoundingClientRect();
      const pad = 6;
      r = { x: Math.max(4, b.left - pad), y: Math.max(4, b.top - pad), w: 0, h: 0 };
      r.w = Math.min(vw - 4, b.right + pad) - r.x;
      r.h = Math.min(vh - 4, b.bottom + pad) - r.y;
      shade('t', 0, 0, vw, r.y); shade('b', 0, r.y + r.h, vw, vh - r.y - r.h);
      shade('l', 0, r.y, r.x, r.h); shade('r', r.x + r.w, r.y, vw - r.x - r.w, r.h);
      for (const n of [ring, hole]) { Object.assign(n.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, display: 'block' }); }
    } else {
      shade('t', 0, 0, vw, vh); shade('b', 0, 0, 0, 0); shade('l', 0, 0, 0, 0); shade('r', 0, 0, 0, 0);
      ring.style.display = 'none'; hole.style.display = 'none';
    }
    layer.classList.toggle('no-target', !el);

    // the card
    const narrow = vw <= 640;
    card.classList.toggle('as-sheet', narrow);
    card.style.left = card.style.top = card.style.right = card.style.bottom = '';
    if (narrow) {
      // a sheet at the bottom, or at the top when the spotlight sits low
      // (the bottom tabs, say) and there is more room above it
      const low = r && (t.sheetTop !== undefined ? t.sheetTop : (r.y + r.h / 2 > vh * 0.52 && r.y > vh - (r.y + r.h)));
      card.classList.toggle('at-top', !!low);
      return;
    }
    card.classList.remove('at-top');
    const cw = card.offsetWidth || 380;
    const ch = card.offsetHeight || 240;
    const gap = 16;
    let x;
    let y;
    if (!r) { x = (vw - cw) / 2; y = (vh - ch) / 2; } else if (r.y + r.h + gap + ch <= vh - 8) { x = r.x + r.w / 2 - cw / 2; y = r.y + r.h + gap; } else if (r.y - gap - ch >= 8) { x = r.x + r.w / 2 - cw / 2; y = r.y - gap - ch; } else if (r.x + r.w + gap + cw <= vw - 8) { x = r.x + r.w + gap; y = r.y + r.h / 2 - ch / 2; } else if (r.x - gap - cw >= 8) { x = r.x - gap - cw; y = r.y + r.h / 2 - ch / 2; } else { x = vw - cw - 16; y = vh - ch - 16; }
    card.style.left = `${Math.round(Math.max(8, Math.min(vw - cw - 8, x)))}px`;
    card.style.top = `${Math.round(Math.max(8, Math.min(vh - ch - 8, y)))}px`;
  }

  /* --------------------------- celebration --------------------------- */
  function celebrate(m, gained, r, rankUp) {
    const list = myMissions();
    const next = list.find((x) => !loadProgress().done[x.id]);
    const confetti = reduceMotion() ? '' : `<div class="win-confetti" aria-hidden="true">${Array.from({ length: 26 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 7) * 0.09}s;--r:${(i * 53) % 360}deg;--c:${['#1a7f0b', '#8cc465', '#d9a400', '#1f5a73', '#c00000'][i % 5]}"></i>`).join('')}</div>`;
    UI.modal({
      title: 'Mission complete',
      size: 'sm',
      body: `${confetti}
        <div class="win">
          <div class="win-badge">${ico(m.icon)}</div>
          <p class="win-kicker">Badge earned</p>
          <h3>${esc(m.badge)}</h3>
          <p class="muted">${esc(m.title)}</p>
          <div class="win-stats">
            <div><b>${gained ? `+${gained}` : '0'}</b><span>${gained ? 'XP' : 'XP (replay)'}</span></div>
            <div><b>${r.done}/${r.total}</b><span>missions</span></div>
            <div><b>${esc(r.name)}</b><span>${rankUp ? 'new rank!' : 'rank'}</span></div>
          </div>
          ${r.done === r.total ? `<p class="win-cert">${ico('star')} You finished every mission for your job. You are a certified <b>${esc(roleName())}</b>.</p>` : ''}
        </div>`,
      footer: `<button class="nm-btn" data-act="map">All missions</button>
        ${next ? `<button class="nm-btn primary" data-act="next">Next: ${esc(next.title)}</button>` : r.done === r.total ? '<button class="nm-btn primary" data-act="cert">Print certificate</button>' : ''}`,
      onMount(el, close) {
        const go = (fn) => { close(); setTimeout(fn, 280); };
        const map = el.querySelector('[data-act=map]');
        if (map) map.addEventListener('click', () => go(() => App.navigate('training')));
        const nx = el.querySelector('[data-act=next]');
        if (nx) nx.addEventListener('click', () => go(() => Tour.start(next.id)));
        const cert = el.querySelector('[data-act=cert]');
        if (cert) cert.addEventListener('click', () => printCertificate());
      },
    });
  }

  function printCertificate() {
    const p = loadProgress();
    const r = rank(p);
    UI.print(`${window.VH.printHeader('Training certificate', new Date().toLocaleDateString())}
      <div class="cert">
        <p>This certifies that</p>
        <h1>${esc(me().name || me().email || '')}</h1>
        <p>has completed every training mission for the role of</p>
        <h2>${esc(roleName())}</h2>
        <p>on the EnerFab Biomass Storage system, with ${p.xp || 0} points: rank <b>${esc(r.name)}</b>.</p>
        <p class="meta">Missions: ${myMissions().filter((m) => p.done[m.id]).map((m) => esc(m.title)).join(' · ')}</p>
        <div class="sign">Supervisor</div>
      </div>`, 'Training certificate');
  }

  /* --------------------------- the Training screen ------------------- */
  App.register('training', {
    title: 'Training',
    render(view) {
      const p = loadProgress();
      const list = myMissions();
      const r = rank(p);
      const next = list.find((m) => !p.done[m.id]);
      const pct = Math.round(r.share * 100);
      view.innerHTML = `
        <section class="train-hero nm-card">
          <div class="train-ring" style="--p:${pct}">
            <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="tr-bg"/><circle cx="60" cy="60" r="52" class="tr-fg" pathLength="100" style="stroke-dasharray:${pct} 100"/></svg>
            <div><b>${pct}%</b><span>complete</span></div>
          </div>
          <div class="train-hero-main">
            <p class="train-kicker">${esc(roleName())}</p>
            <h2>${esc(r.name)}</h2>
            <p class="muted">${r.done} of ${r.total} missions · ${p.xp || 0} XP · ${Object.keys(p.done).filter((id) => list.some((m) => m.id === id)).length} badges</p>
            <div class="train-actions">
              ${next ? `<button class="nm-btn primary" data-start="${next.id}">${ico('chevron')}${r.done ? 'Continue' : 'Start training'}: ${esc(next.title)}</button>`
                : `<button class="nm-btn primary" data-cert>${ico('star')}Print my certificate</button>`}
            </div>
            <p class="muted small">Training only shows things: nothing you do in it is saved. Works on phones, tablets and computers.</p>
          </div>
        </section>

        <h3 class="train-h">Your missions</h3>
        <div class="train-grid">
          ${list.map((m, i) => {
            const done = !!p.done[m.id];
            const isNext = next && next.id === m.id;
            return `<article class="train-card ${done ? 'is-done' : ''} ${isNext ? 'is-next' : ''}">
              <div class="train-card-top">
                <span class="train-no">${done ? ico('check') : i + 1}</span>
                <span class="train-ico">${ico(m.icon)}</span>
              </div>
              <h4>${esc(m.title)}</h4>
              <p class="muted small">${esc(m.blurb)}</p>
              <p class="train-meta">${stepsOf(m).length} steps · about ${minutes(m)} min · ${done ? `<b>${esc(m.badge)}</b> earned` : `+${stepsOf(m).length * 10 + 50} XP`}</p>
              <button class="nm-btn ${isNext ? 'primary' : ''} block" data-start="${m.id}">${done ? 'Replay' : isNext ? 'Start' : 'Start'}</button>
            </article>`;
          }).join('')}
        </div>

        <h3 class="train-h">Badges</h3>
        <div class="train-badges">
          ${list.map((m) => `<div class="tb ${p.done[m.id] ? 'on' : ''}" title="${esc(m.title)}"><span>${ico(p.done[m.id] ? m.icon : 'lock')}</span><small>${esc(m.badge)}</small></div>`).join('')}
        </div>

        <p class="train-reset"><button class="link" data-reset>Start my training again from zero</button></p>`;

      UI.$$('[data-start]', view).forEach((b) => b.addEventListener('click', () => Tour.start(b.dataset.start)));
      const cert = view.querySelector('[data-cert]');
      if (cert) cert.addEventListener('click', printCertificate);
      view.querySelector('[data-reset]').addEventListener('click', async () => {
        const ok = await UI.confirm({ title: 'Start again?', message: 'Your missions, points and badges on this device go back to zero. Nothing else changes.', confirmText: 'Start again' });
        if (!ok) return;
        saveProgress({ done: {}, xp: 0, invited: true });
        App.mountView();
      });
    },
  });

  /* ------------------------ first-time invitation -------------------- */
  function invite() {
    if (CFG.tutorialAutoStart === false || Tour.active) return;
    const user = Auth.current();
    if (!user || Auth.isPending(user) || !document.querySelector('.app-shell')) return;
    const p = loadProgress();
    if (p.invited || Object.keys(p.done).length) return;
    if (document.querySelector('.train-invite')) return;
    const list = myMissions();
    const total = list.reduce((a, m) => a + minutes(m), 0);
    const card = document.createElement('div');
    card.className = 'train-invite';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Training');
    card.innerHTML = `
      <div class="ti-badge">${ico('cap')}</div>
      <div class="ti-text">
        <b>Welcome, ${firstName()}. Your training is ready.</b>
        <span>${list.length} short missions for ${/^[aeiou]/i.test(roleName()) ? 'an' : 'a'} ${esc(roleName())}, about ${total} minutes. Earn badges as you go.</span>
      </div>
      <div class="ti-btns">
        <button class="nm-btn" data-ti="later">Later</button>
        <button class="nm-btn primary" data-ti="go">Start training</button>
      </div>`;
    document.body.appendChild(card);
    requestAnimationFrame(() => card.classList.add('in'));
    const done = () => { const q = loadProgress(); q.invited = true; saveProgress(q); card.classList.remove('in'); setTimeout(() => card.remove(), 300); };
    card.querySelector('[data-ti=later]').addEventListener('click', () => { done(); UI.toast('Training is always in your account menu', 'info'); });
    card.querySelector('[data-ti=go]').addEventListener('click', () => { done(); Tour.start('welcome'); });
  }

  // offer it once the app is on screen after signing in
  const _render = App.render.bind(App);
  App.render = function () {
    _render();
    clearTimeout(App._inviteTimer);
    App._inviteTimer = setTimeout(invite, 1200);
  };
  // a sign-out takes the invitation and any training with it
  window.addEventListener('hashchange', () => { if (!Auth.current()) Tour.stop(true); });

  window.Training = {
    start: (id) => Tour.start(id || (myMissions().find((m) => !loadProgress().done[m.id]) || MISSIONS[0]).id),
    stop: () => Tour.stop(),
    open: () => App.navigate('training'),
    missions: () => myMissions().map((m) => ({ id: m.id, title: m.title, steps: stepsOf(m).length })),
    progress: loadProgress,
    get active() { return Tour.active ? { mission: Tour.active.m.id, step: Tour.active.i, steps: Tour.active.steps.length, target: !!Tour.active.el } : null; },
    _invite: invite,
  };
})();
