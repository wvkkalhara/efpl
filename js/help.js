/* =====================================================================
   help.js — a short, plain description of every screen and window.
   ---------------------------------------------------------------------
   Shown when someone presses "What is this page?" (screens) or
   "What is this?" (windows). Hidden by default. Short sentences, everyday
   words, the words used on the buttons. Edit freely: no code depends on
   the wording.
   ===================================================================== */
(function () {
  'use strict';

  const p = (...lines) => lines.map((l) => `<p>${l}</p>`).join('');
  const list = (...items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

  /* ------------------------------ screens ---------------------------- */
  const SCREENS = {
    login:
      p('Sign in to the EnerFab biomass app.')
      + list(
        'Tap <b>Continue with Google</b> and pick your Google account. Or type your email and password.',
        'New here? Sign in once, then ask the administrator to give you a job (role).',
        'After the first sign-in this phone or computer works even with no signal.',
      ),
    pending:
      p('You are signed in, but nobody has given you a job (role) yet.')
      + list('Ask the administrator or the owner to open <b>Administration</b> and pick your role.', 'This page opens the app by itself as soon as they do.'),
    dashboard:
      p('Your start page: the day at a glance.')
      + list(
        '<b>In the yard now</b>: how many full bags are in the bays.',
        '<b>Waiting for you</b>: jobs for you to do. Tap one to go there.',
        'The big buttons at the top open your usual jobs.',
      ),
    intake:
      p('Use this page when a truck of biomass arrives at the gate.')
      + list(
        '<b>1 Supplier</b>: who brought it, the vehicle and the driver.',
        '<b>2 Weight</b>: truck weight full (gross) and empty (tare), and the number of bags. The app works out the weight and the wetness (moisture).',
        '<b>3 Fill check</b>: empty 5 bags in every 100 into the drum and type how full each one was. Full price if the average is 90% or more.',
        '<b>4 Bags</b>: bag numbers, if your bags have them. You can skip this.',
        'What you type is kept safe, even if you print or the phone reloads the page.',
      ),
    deliveries:
      p('Every truck that came in, newest first.')
      + list(
        '<b>Waiting to be accepted</b>: trucks the supervisor still has to put into bays.',
        'Tap a truck to see everything about it, accept it, or print the receipt, invoice or bag labels.',
      ),
    bays:
      p('The bays where full bags are kept.')
      + list(
        '<b>Red</b> bays are dry: use them first. Amber is still damp. Blue is wet. Grey is empty.',
        'Bags dry in the bay: about 0.6 kg less each day.',
        '<b>Daily bay check</b>: each day, weigh one bag from each bay and type the weight. Missing a day is fine.',
        'Each bay shows a small graph of its bag weight. Tap <b>Show more</b> for the full graph and every reading.',
        'Tap a bay to see what is in it, its history, or to change its size.',
        'Every bay needs its own code and its own name: two bays cannot share a name.',
      ),
    gasifier:
      p('Taking biomass from the bays to the gasifier.')
      + list(
        'The bays are listed driest first.',
        'The operator taps <b>Ask for bags</b>. The supervisor approves and picks the bay.',
        'Then the operator weighs one bag of each type (gliricidia, cinnamon…), types how many bags of each, feeds the gasifier, and counts the empty bags (good or torn).',
        'The weight is one bag × the number of bags, for each type.',
      ),
    bags:
      p('Bags with serial numbers (stickers). Only needed if you label your bags.')
      + list(
        '<b>Number new bags</b> and <b>Print labels</b> to make stickers.',
        'Search a number to see where that bag is.',
        'The bag store works without numbers too.',
      ),
    trace:
      p('Find out where a bag came from.')
      + list('Type the number on the bag sticker.', 'You see the supplier, the truck, the bay, the gasifier and the payment.'),
    quality:
      p('Problems with the biomass, such as bags not full, stones or rot.')
      + list(
        'Tap <b>Report an issue</b>. Use the bag number, or pick the gasifier job if the bag has no number.',
        'The app finds the supplier, so they can be told.',
        'The supervisor closes the problem when it is dealt with.',
      ),
    returns:
      p('The store of empty bags.')
      + list(
        '<b>Used</b> bags came back from the gasifier and are still good. <b>New</b> bags were bought.',
        '<b>Issue bags to a supplier</b>: used bags go first, new bags make up the rest.',
        '<b>Receive new bags</b> when you buy bags. <b>Record torn bags</b> to throw bags away.',
        '<b>Count the store</b> now and then, so the numbers match the shelves.',
        '<b>Bags with suppliers</b>: how many of our bags each supplier has now.',
      ),
    payments:
      p('Money owed to suppliers.')
      + list(
        'A payment is made by itself when a truck is accepted.',
        'Then: the supervisor <b>approves</b> it, accounts <b>send it to Head Office</b>, and Head Office <b>pays</b>.',
        'Tap a payment to see the bank details and print a payment slip.',
      ),
    suppliers:
      p('The people who bring biomass.')
      + list('Search by name, code, phone or village.', 'Add a supplier with their bank details, so Head Office can pay them.', 'Tap a supplier to see their trucks and payments, and print a statement.'),
    reports:
      p('Numbers for any time you choose.')
      + list('Pick the days at the top, and a supplier or type if you want.', 'See biomass in and out, money, and wetness (moisture).',
        'See how the bag weight goes down in each bay, by days in the bay, by type at the gasifier, by bag fill and month by month.',
        'Everything updates by itself when new work comes in.', 'Print it, or download it for Excel (CSV).'),
    admin:
      p('For the administrator.')
      + list(
        '<b>Users & roles</b>: give new people a job, or remove someone.',
        '<b>Business settings</b>: prices, the fill check, moisture and other numbers.',
        '<b>Activity log</b>: who did what, and when.',
        '<b>Staff log</b>: everything each staff member did. Pick a person, an area or a period, and download it.',
        '<b>Data & sync</b>: backups, and fixing a phone that shows different numbers.',
      ),
    training:
      p('Short lessons for your job.')
      + list('Each mission shows you the real buttons, step by step.', 'Nothing you do in training is saved.', 'Earn points and badges. Do any mission again whenever you like.'),
  };

  /* ------------------------------ windows ----------------------------
     Matched on the window's title, first match wins. */
  const DIALOGS = [
    [/^Delivery RC-/, p('Everything about one truck: supplier, weights, fill check, bays and payment.') + list('Print the receipt, the invoice or the bag labels here.', 'If it is waiting, the supervisor can accept it from here.')],
    [/^Accept RC-/, p('Put this truck\'s bags into the bays and make the payment.') + list(
      'Type how many bags go in each bay. Empty bays are filled in for you. The total must match.',
      'Check the supplier\'s bank details. Wrong? Press <b>Change bank details</b>.',
      'No bank details yet? Type the bank, branch and account number here. The truck cannot be accepted without them.',
      'The fill check result is shown. If the bags were not filled fully, you can take a percent off and say why.',
      'Press <b>Accept and create payment</b>.',
    )],
    [/^Payment PAY-/, p('One payment to a supplier.') + list('See how it was worked out and where to pay it.', 'Bank details wrong or missing? Press <b>Change bank details</b>, then <b>Save bank details</b>.', 'Press the button for your step: approve, send to Head Office, or mark paid. This needs the bank details.', 'Print the payment slip for Head Office.')],
    [/^Amount taken off /, p('Change how much is taken off this payment, and why.') + list('Type the percent and the reason. The supplier sees the reason on the slip.')],
    [/^Edit BAY-|^Add a bay$/, p('Name a bay and set its size.') + list('The size is a guide. A bay can hold more if needed.', 'Only an empty bay can be removed.')],
    [/^Edit |^Add a supplier$/, p('A supplier\'s details.') + list('Name and phone are needed.', 'Add the bank, branch and account number, so Head Office can pay them.')],
    [/^SUP-\d+ · /, p('One supplier: contact, bank, trucks and payments.') + list('<b>Edit supplier</b> to change details.', '<b>Statement</b> prints everything for them.')],
    [/^BAY-\S+ history$/, p('Everything that went into and out of this bay.') + list('Each line shows the bags, the bag weight and how wet it was.', 'You can print this list.')],
    [/^BAY-/, p('One bay, as it is today.') + list('How many bags, how dry, and which trucks they came from.', 'Daily check: weigh one bag from the bay to update the dryness.', '<b>Show more</b> shows the weight graph. <b>History</b> shows everything in and out.')],
    [/^Daily bay check$/, p('Weigh one bag from each bay.') + list('Type the weight for each bay you weighed.', 'Leave a bay blank if you did not weigh it today. That is fine.')],
    [/weight and moisture$/, p('How this bay\'s bags got lighter over time.') + list('Each dot is a real weighing: a load coming in, a daily check, a test bag or the gasifier.', 'The red dashed line is dry enough to use.')],
    [/^Request biomass/, p('Ask for bags for the gasifier.') + list('Pick the bay and how many bags.', 'The supervisor approves it.')],
    [/^Approve USE-/, p('Approve a request for the gasifier.') + list('Pick the bay. The driest is at the top.', 'You can weigh one bag to check the dryness.')],
    [/^Weigh and feed/, p('Feed the gasifier.') + list(
      'For each type (gliricidia, cinnamon…), type the number of bags and weigh one bag.',
      'The app works out the weight (one bag × the bags) and the wetness.',
      'Count the empty bags: good ones go back to the bag store, torn ones are thrown away.',
      'Something wrong with the biomass? Tick the box to report it.',
    )],
    [/^Report a quality issue$/, p('Report a problem with the biomass.') + list('Type the bag number, or pick the gasifier job if the bag has no number.', 'Say what happened. The app finds the supplier.')],
    [/^QI-\d+/, p('One problem with the biomass.') + list('See who supplied it and what was done.', 'The supervisor can mark the supplier as told, and close it.')],
    [/^Issue bags to a supplier$/, p('Give empty bags to a supplier to fill.') + list('Used bags go first. New bags make up the rest. You can change this.', 'A slip is printed for the supplier to sign.')],
    [/^Number a batch of bags$/, p('Give new bags serial numbers.') + list('Type how many. The labels are offered right after.')],
    [/^Print bag labels$/, p('Print stickers for numbered bags.') + list('Type the first and last number.', 'Up to 1,000 stickers at a time.')],
    [/^Receive new bags$/, p('New bags have arrived from the bag seller.') + list('Type how many. They go on the <b>new</b> shelf.')],
    [/^Record torn bags$/, p('Throw away bags found torn or spoiled in the store.') + list('Pick the shelf (used or new) and how many.', 'Torn bags at the gasifier are counted there instead.')],
    [/^Count the store$/, p('Count the empty bags on the shelves.') + list('Type what you counted. The app\'s numbers are changed to match.')],
    [/^My account$/, p('Your account.') + list('Set or change your password.', 'Open your training.')],
    [/^Menu$/, p('All the pages for your job, and your account.')],
    [/^Add a biomass type$/, p('Add a kind of biomass, for example Ipil Ipil.') + list('It then appears when a truck is received.')],
    [/^Add a staff account$|^Create a staff account$/, p('Add a person by email.') + list('Pick their job (role). They sign in with that email.')],
    [/^Role: /, p('Choose what this job can do.') + list('Tick the jobs. People with this role see only those screens.')],
    [/^Mission complete$/, p('Well done! You finished a mission and earned a badge.')],
    [/^Delete all records everywhere\?$/, p('This deletes all trucks, payments, bags and suppliers on every phone and computer.') + list('Staff, settings and the bay list stay.', 'A backup file is saved first.', 'It cannot be undone.')],
    [/^Re-download this device\?$/, p('Fix one phone or computer that shows different numbers.') + list('Its copy is replaced with the one in the cloud. Nothing is deleted.')],
  ];

  window.EFPL_HELP = {
    screen: (id) => SCREENS[id] || null,
    dialog: (title) => {
      const t = String(title || '');
      const hit = DIALOGS.find(([re]) => re.test(t));
      return hit ? hit[1] : null;
    },
    _screens: SCREENS,
  };
})();
