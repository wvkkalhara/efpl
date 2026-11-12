/* =====================================================================
   i18n.js — language choice: English only, or English with Sinhala.
   ---------------------------------------------------------------------
   The app is written in English. In "English + සිංහල" mode the Sinhala
   wording is added beside (or under) the English for the labels people
   act on: menu, headings, field names, buttons, table headers, statuses.
   English always stays, so printed slips, the audit trail and Head Office
   read the same on every device.

   It works on the finished screen: whenever something is drawn, any label
   whose text is in the dictionary gets a small <span class="si"> after it.
   Nothing else in the app needs to know about languages.

   The choice is per device (a store keeper's tablet can show Sinhala
   while the office PC stays in English) and is kept in localStorage.

   To add or correct a translation, edit the SI table below. The key is
   the English text exactly as it appears on screen.
   ===================================================================== */
(function () {
  'use strict';
  const KEY = 'efpl.lang';

  const SI = {
    /* ---- menu ---- */
    'Operations': 'මෙහෙයුම්',
    'Traceability': 'සොයා බැලීම',
    'Money': 'මුදල්',
    'Insight': 'වාර්තා සහ පාලනය',
    'Dashboard': 'මුල් පිටුව',
    'Receive biomass': 'ජෛව ස්කන්ධ භාර ගැනීම',
    'Deliveries': 'ලැබුණු තොග',
    'Bays & stock': 'ගබඩා කොටස් සහ තොග',
    'Gasifier issue': 'ගෑසිෆයරයට නිකුත් කිරීම',
    'Bag registry': 'බෑග් ලේඛනය',
    'Trace a bag': 'බෑගයක් සොයන්න',
    'Quality issues': 'ගුණාත්මක ගැටලු',
    'Bag returns': 'හිස් බෑග් ආපසු ලැබීම',
    'Payments': 'ගෙවීම්',
    'Suppliers': 'සැපයුම්කරුවන්',
    'Farmers': 'ගොවීන්',
    'Reports': 'වාර්තා',
    'Administration': 'පරිපාලනය',
    'Menu': 'මෙනුව',

    /* ---- dashboard ---- */
    'In the yard now': 'දැන් ගබඩාවේ ඇති',
    'Received, last 30 days': 'පසුගිය දින 30 තුළ ලැබුණු',
    'Into the gasifier, last 7 days': 'පසුගිය දින 7 තුළ ගෑසිෆයරයට',
    'Payments in progress': 'සිදුවෙමින් පවතින ගෙවීම්',
    'Empty bags in store': 'ගබඩාවේ ඇති හිස් බෑග්',
    'Stock by bay': 'ගබඩා කොටස් අනුව තොග',
    'Latest movements': 'මෑත ගනුදෙනු',
    'Approve bay issue': 'නිකුතුව අනුමත කරන්න',
    'Manage bays': 'ගබඩා කොටස් බලන්න',
    'All deliveries': 'සියලු ලැබීම්',

    /* ---- receiving ---- */
    'Who delivered?': 'ගෙනාවේ කවුද?',
    'Weighing and bag count': 'බර කිරීම සහ බෑග් ගණන',
    'Random fill check': 'අහඹු පිරවුම් පරීක්ෂාව',
    'Bag serials (optional at the gate)': 'බෑග් අනුක්‍රමික අංක',
    'Supplier': 'සැපයුම්කරු',
    'Biomass type': 'ජෛව ස්කන්ධ වර්ගය',
    'Vehicle number': 'වාහන අංකය',
    'Driver name': 'රියදුරුගේ නම',
    'Driver NIC': 'රියදුරුගේ හැඳුනුම්පත් අංකය',
    'Weighbridge slip no.': 'බර පාලමේ පත්‍රිකා අංකය',
    'Gross weight (kg)': 'දළ බර (කි.ග්‍රෑ.)',
    'Tare weight (kg)': 'හිස් වාහනයේ බර (කි.ග්‍රෑ.)',
    'Net weight (kg)': 'ශුද්ධ බර (කි.ග්‍රෑ.)',
    'Bags counted': 'ගණන් කළ බෑග්',
    'Supervisor decision': 'අධීක්ෂකගේ තීරණය',
    'Reason or remarks': 'හේතුව හෝ සටහන්',
    'Serials on this truck': 'මෙම ලොරියේ බෑග් අංක',
    'Notes': 'සටහන්',
    'Clear': 'හිස් කරන්න',
    'Register delivery': 'ලැබීම ලියාපදිංචි කරන්න',

    /* ---- deliveries and acceptance ---- */
    'All': 'සියල්ල',
    'Awaiting acceptance': 'භාර ගැනීමට ඇති',
    'Accepted': 'භාර ගත්',
    'Receipt': 'රිසිට්පත',
    'Type': 'වර්ගය',
    'Bags': 'බෑග්',
    'Net kg': 'ශුද්ධ කි.ග්‍රෑ.',
    'Fill check': 'පිරවුම් පරීක්ෂාව',
    'Moisture': 'තෙතමනය',
    'Deducted': 'අඩු කළ',
    'Status': 'තත්ත්වය',
    'Payment': 'ගෙවීම',
    'Open': 'විවෘත කරන්න',
    'Vehicle': 'වාහනය',
    'Weighbridge': 'බර පාලම',
    'Allocation': 'ගබඩා කොටස් වෙන් කිරීම',
    'Farmer split': 'ගොවීන් අතර බෙදීම',
    'Print receipt': 'රිසිට්පත මුද්‍රණය',
    'Print bag labels': 'බෑග් ලේබල් මුද්‍රණය',
    'Accept and allocate bay': 'භාරගෙන ගබඩා කොටස වෙන් කරන්න',
    'Accept and create payment': 'භාරගෙන ගෙවීම සාදන්න',
    'Declare farmer split': 'ගොවීන් අතර බෙදීම ඇතුළත් කරන්න',
    'Save declaration': 'ප්‍රකාශය සුරකින්න',
    'Deduction': 'අඩු කිරීම',
    'Deduct from this batch (%)': 'මෙම තොගයෙන් අඩු කරන ප්‍රතිශතය (%)',
    'Reason for the deduction': 'අඩු කිරීමට හේතුව',
    'Bag serials on this truck': 'මෙම ලොරියේ බෑග් අංක',
    'Supervisor note': 'අධීක්ෂකගේ සටහන',
    'Cancel': 'අවලංගු කරන්න',
    'Save': 'සුරකින්න',

    /* ---- bags, bays, gasifier ---- */
    'Number new bags': 'නව බෑග් අංකනය කරන්න',
    'Issue to supplier': 'සැපයුම්කරුට නිකුත් කරන්න',
    'Issue bags': 'බෑග් නිකුත් කරන්න',
    'Number the bags': 'බෑග් අංකනය කරන්න',
    'Serial': 'අනුක්‍රමික අංකය',
    'Farmer': 'ගොවියා',
    'Bay': 'ගබඩා කොටස',
    'Updated': 'යාවත්කාලීන කළ දිනය',
    'Trace': 'සොයන්න',
    'Add bay': 'ගබඩා කොටසක් එක් කරන්න',
    'Request issue': 'නිකුතුවක් ඉල්ලන්න',
    'View bags': 'බෑග් බලන්න',
    'Which bay to draw from': 'ගත යුත්තේ කුමන ගබඩා කොටසින්ද',
    'New issue request': 'නව නිකුත් ඉල්ලීමක්',
    'Issue history': 'නිකුත් කිරීම් ඉතිහාසය',
    'Approve and choose bay': 'අනුමත කර ගබඩා කොටස තෝරන්න',
    'Weigh and consume': 'බර කිරා භාවිතයට ගන්න',
    'Approve': 'අනුමත කරන්න',
    'Record consumption': 'භාවිතය සටහන් කරන්න',
    'Send for approval': 'අනුමැතියට යවන්න',
    'Bay requested': 'ඉල්ලන ගබඩා කොටස',
    'Number of bags': 'බෑග් ගණන',
    'Bag 1 (kg)': 'බෑගය 1 (කි.ග්‍රෑ.)',
    'Bag 2 (kg)': 'බෑගය 2 (කි.ග්‍රෑ.)',
    'Bag 3 (kg)': 'බෑගය 3 (කි.ග්‍රෑ.)',
    'Request': 'ඉල්ලීම',
    'Sample weights': 'සාම්පල බර',
    'Avg bag': 'බෑගයක සාමාන්‍ය බර',
    'Out weight': 'පිටවූ බර',

    /* ---- payments ---- */
    'Supplier and farmer': 'සැපයුම්කරු සහ ගොවියා',
    'Unit price': 'ඒකක මිල',
    'Payable': 'ගෙවිය යුතු මුදල',
    'Draft': 'කෙටුම්පත',
    'Awaiting authorisation': 'අනුමැතියට ඇති',
    'Authorised': 'අනුමත කළ',
    'Sent to H.O.': 'ප්‍රධාන කාර්යාලයට යැවූ',
    'Paid': 'ගෙවා ඇත',
    'Draft — farmer split pending': 'කෙටුම්පත',
    'Awaiting supervisor authorisation': 'අධීක්ෂකගේ අනුමැතියට ඇත',
    'Authorised — to be released': 'අනුමත කර ඇත',
    'Sent to Head Office': 'ප්‍රධාන කාර්යාලයට යවා ඇත',
    'Payee': 'මුදල් ලබන්නා',
    'Against delivery': 'අදාළ ලැබීම',
    'Computation': 'ගණනය',
    'Farmer declaration': 'ගොවීන් පිළිබඳ ප්‍රකාශය',
    'History': 'ඉතිහාසය',
    'Payment slip': 'ගෙවීම් පත්‍රිකාව',
    'Change deduction': 'අඩු කිරීම වෙනස් කරන්න',
    'Save deduction': 'අඩු කිරීම සුරකින්න',
    'Authorise': 'අනුමත කරන්න',
    'Release to Head Office': 'ප්‍රධාන කාර්යාලයට යවන්න',
    'Mark as paid': 'ගෙවූ බව සටහන් කරන්න',

    /* ---- suppliers and farmers ---- */
    'Add supplier': 'සැපයුම්කරුවෙකු එක් කරන්න',
    'Add farmer': 'ගොවියෙකු එක් කරන්න',
    'Save supplier': 'සැපයුම්කරු සුරකින්න',
    'Save farmer': 'ගොවියා සුරකින්න',
    'Edit supplier': 'සැපයුම්කරු සංස්කරණය',
    'Edit': 'සංස්කරණය',
    'Statement': 'ගිණුම් ප්‍රකාශය',
    'Code': 'කේතය',
    'Contact': 'සම්බන්ධ කර ගැනීම',
    'Name': 'නම',
    'Phone': 'දුරකථන අංකය',
    'NIC': 'හැඳුනුම්පත් අංකය',
    'Village': 'ගම',
    'Address / village': 'ලිපිනය / ගම',
    'Bank account': 'බැංකු ගිණුම',
    'Farmer registration no.': 'ගොවි ලියාපදිංචි අංකය',
    'Land (acres)': 'ඉඩම (අක්කර)',

    /* ---- quality and returns ---- */
    'Report an issue': 'ගැටලුවක් වාර්තා කරන්න',
    'Record issue': 'ගැටලුව සටහන් කරන්න',
    'Bag serial': 'බෑගයේ අංකය',
    'Category': 'වර්ගය',
    'Severity': 'බරපතළකම',
    'What happened?': 'සිදුවූයේ කුමක්ද?',
    'Corrective action': 'නිවැරදි කිරීමේ පියවර',
    'Resolve': 'විසඳූ බව සටහන් කරන්න',
    'Record a return': 'ආපසු ලැබීමක් සටහන් කරන්න',
    'Bags returned': 'ආපසු ලැබුණු බෑග්',
    'Good, back to stock': 'හොඳයි, නැවත තොගයට',
    'Can be repaired': 'අලුත්වැඩියා කළ හැකි',
    'Beyond repair (replace)': 'අලුත්වැඩියා කළ නොහැකි',
    'New bags to order': 'ඇණවුම් කළ යුතු නව බෑග්',
    'Empty bags to check': 'පරීක්ෂා කළ යුතු හිස් බෑග්',
    'Being repaired': 'අලුත්වැඩියා වෙමින් පවතින',
    'Bags in store': 'ගබඩාවේ ඇති බෑග්',

    /* ---- account ---- */
    'Settings': 'සැකසුම්',
    'Backup data': 'දත්ත උපස්ථයක් ගන්න',
    'Sign out': 'ඉවත් වන්න',
    'Sign in': 'ඇතුළු වන්න',
    'Email': 'විද්‍යුත් තැපෑල',
    'Password': 'මුරපදය',
    'Forgot password': 'මුරපදය අමතකද?',
    'Create an account': 'ගිණුමක් සාදන්න',
    'Save settings': 'සැකසුම් සුරකින්න',
    'Print': 'මුද්‍රණය',
    'Language': 'භාෂාව',
  };

  let mode = 'en';
  try { mode = window.localStorage.getItem(KEY) === 'mix' ? 'mix' : 'en'; } catch { /* private window */ }

  // Only labels are touched — never free text, names or numbers.
  const SEL = 'button, h1, h2, h3, h4, th, .field > span, .stat-label, .nav-label, .nav-group-label, .badge, .hero-yard-label, .more-item > span:last-child';

  function decorate(root) {
    if (mode !== 'mix' || !root || root.nodeType !== 1) return;
    const els = root.matches(SEL) ? [root] : [];
    root.querySelectorAll(SEL).forEach((el) => els.push(el));
    for (const el of els) {
      if (el.closest('.lang-switch')) continue;                // the language switch itself
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType !== 3) continue;
        const si = SI[node.nodeValue.trim()];
        if (!si) continue;
        const next = node.nextSibling;
        if (next && next.nodeType === 1 && next.classList.contains('si')) continue;
        const span = document.createElement('span');
        span.className = 'si';
        span.lang = 'si';
        span.textContent = si;
        el.insertBefore(span, next);
      }
    }
  }

  function apply() {
    document.documentElement.dataset.lang = mode;
    document.querySelectorAll('.si').forEach((n) => n.remove());
    if (document.body) decorate(document.body);
  }

  function set(next) {
    mode = next === 'mix' ? 'mix' : 'en';
    try { window.localStorage.setItem(KEY, mode); } catch { /* private window */ }
    apply();
  }

  /** The two-button switch, used in the account menu and on the sign-in screen. */
  const switchHtml = () => `<div class="lang-switch" role="group" aria-label="Language">
      <button type="button" class="lang-opt" data-lang="en">English</button>
      <button type="button" class="lang-opt" data-lang="mix">English + <span lang="si">සිංහල</span></button>
    </div>`;

  function start() {
    apply();
    if (typeof MutationObserver === 'function') {
      new MutationObserver((muts) => {
        if (mode !== 'mix') return;
        for (const m of muts) {
          if (m.target && m.target.nodeType === 1) decorate(m.target);
          m.addedNodes.forEach((n) => decorate(n));
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.lang-opt[data-lang]');
      if (!btn) return;
      e.stopPropagation();
      set(btn.dataset.lang);
    });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  window.I18n = { get mode() { return mode; }, set, switchHtml, SI };
})();
