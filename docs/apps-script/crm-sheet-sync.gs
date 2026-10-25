/**
 * Relifish buyer call sheet: hourly sync from relifish.com.
 * Updates ONLY the database columns (Stage, Phone, Cart, Orders, ...), matched by phone number,
 * and adds new buyers at the bottom. Your own columns (Call outcome, Feedback, Notes, ...) are never written.
 *
 * Setup (once): Extensions → Apps Script → paste this file → Project Settings → Script properties:
 *   CRM_URL = https://www.relifish.com/api/admin/crm-sheet
 *   CRM_KEY = <the key Relifish gave you>
 * Then run `setup` once (allow access when asked). It syncs now and every hour after.
 * Each sync also keeps the dropdowns (LISTS below) and the live summary counts at the top.
 */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncBuyers') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncBuyers').timeBased().everyHours(1).create();
  syncBuyers();
}

function syncBuyers() {
  var props = PropertiesService.getScriptProperties();
  var res = UrlFetchApp.fetch(props.getProperty('CRM_URL'), { headers: { 'x-crm-key': props.getProperty('CRM_KEY') }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Relifish answered ' + res.getResponseCode());
  var rows = JSON.parse(res.getContentText()).rows;
  if (!rows.length) return;

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var all = sh.getDataRange().getValues();
  var h = -1;
  for (var i = 0; i < all.length; i++) if (all[i][0] === 'Stage' && all[i][1] === 'Call goal') { h = i; break; }
  if (h < 0) throw new Error('Header row (Stage | Call goal) not found');

  // Add any missing column headers ("Last activity" goes right after "Signed up"; others at the end), then re-read.
  var want = Object.keys(rows[0]).concat(['DND']);
  var missing = want.filter(function (name) { return all[h].indexOf(name) < 0; });
  missing.forEach(function (name) {
    var hdr = sh.getRange(h + 1, 1, 1, sh.getLastColumn()).getValues()[0];
    var after = name === 'Last activity' ? hdr.indexOf('Signed up') : -1;
    var at = after >= 0 ? after + 2 : hdr.length + 1;          // 1-based column for the new header
    if (after >= 0) sh.insertColumnAfter(after + 1);
    sh.getRange(h + 1, at).setValue(name);
  });
  if (missing.length) all = sh.getDataRange().getValues();
  var header = all[h];
  var col = {}; header.forEach(function (name, j) { if (name) col[name] = j; });
  if (col['Phone'] === undefined) throw new Error('No Phone column');
  var digits = function (s) { return String(s || '').replace(/\D/g, '').slice(-10); };

  var firstData = h + 1;                       // 0-based index of the first data row
  var data = all.slice(firstData);             // existing rows
  var rowOf = {};
  data.forEach(function (r, k) { var p = digits(r[col['Phone']]); if (p) rowOf[p] = k; });

  var dbCols = Object.keys(rows[0]).filter(function (name) { return col[name] !== undefined; });
  var added = 0;
  rows.forEach(function (rec) {
    var p = digits(rec['Phone']);
    var k = rowOf[p];
    if (k === undefined) {                      // new buyer: new row at the bottom
      k = data.length; data.push(header.map(function () { return ''; })); rowOf[p] = k; added++;
    }
    dbCols.forEach(function (name) {
      if (name === 'Name' && !rec[name] && data[k][col[name]]) return;   // keep names you typed when the app has none
      data[k][col[name]] = rec[name];
    });
  });

  // Write back one database column at a time, so your own columns are never touched.
  dbCols.forEach(function (name) {
    var values = data.map(function (r) { var v = r[col[name]]; return [v === undefined ? '' : v]; });
    sh.getRange(firstData + 1, col[name] + 1, values.length, 1).setValues(values);
  });
  applyRules(sh, h + 1);
  sh.getRange(2, 1).setValue('Synced from relifish.com: ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'd MMM yyyy, h:mm a') + ' · ' + rows.length + ' buyers · ' + added + ' new');
}

// ---- Dropdowns and live summary counts (applied on every sync) ----
var LISTS = {
  'Stage': ['1 Phone+OTP only', '2 Added to cart', '3 Order not paid', '4 Paid - delivery due', '5 Delivered - review'],
  'Call outcome': ['Reached', 'No answer', 'No answer + SMS sent', 'Not reachable', 'Busy / call back', 'Wrong number', 'Do not call'],
  'What stopped them / objection': ['Trust / wants COD', 'Price', 'Not needed now', 'Slot / timing', 'Cleaning & cut doubt', 'Just exploring', 'Buys from own fish seller', 'Login problem', 'Location problem', 'Payment problem', 'Other'],
  'Problem faced (login, location, payment, other)': ['Login', 'Location', 'Payment', 'Delivery', 'None', 'Other'],
  'Deal closed?': ['Yes', 'No', 'Follow-up'],
  'Rating 1-5': ['1', '2', '3', '4', '5'],
  'Photo / review OK?': ['Yes', 'No'],
  'Reminder for': ['Order', 'Pre-order', 'Payment', 'Review', 'Callback'],
  'Society campaign interest?': ['Yes', 'No', 'Maybe'],
  'Will refer neighbours?': ['Yes', 'No', 'Maybe'],
  'DND': ['Yes']
};
var DATES = ['Call date', 'Next reminder date', 'Campaign callback date'];

function colLetter(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

function applyRules(sh, headerRow) {
  var header = sh.getRange(headerRow, 1, 1, sh.getLastColumn()).getValues()[0];
  var n = Math.max(sh.getLastRow() - headerRow, 1) + 200;     // room for new buyers
  Object.keys(LISTS).forEach(function (name) {
    var j = header.indexOf(name); if (j < 0) return;
    sh.getRange(headerRow + 1, j + 1, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(LISTS[name], true).setAllowInvalid(false).build());
  });
  DATES.forEach(function (name) {
    var j = header.indexOf(name); if (j < 0) return;
    sh.getRange(headerRow + 1, j + 1, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build()).setNumberFormat('d mmm yyyy');
  });

  // Summary block (row starting "Stage | Buyers"): live COUNTIFS so the numbers always match the rows below.
  var top = sh.getRange(1, 1, headerRow - 1, Math.max(sh.getLastColumn(), 12)).getValues();
  var s = -1; for (var i = 0; i < top.length; i++) if (top[i][0] === 'Stage' && top[i][1] === 'Buyers') { s = i; break; }
  if (s < 0) return;
  var sumHead = top[s];
  if (sumHead.indexOf('DND') < 0) { var last = sumHead.length; while (last > 0 && !sumHead[last - 1]) last--; sh.getRange(s + 1, last + 1).setValue('DND'); sumHead[last] = 'DND'; }
  var R = function (name) { var j = header.indexOf(name); return j < 0 ? null : '$' + colLetter(j + 1) + '$' + (headerRow + 1) + ':$' + colLetter(j + 1); };
  var stage = R('Stage');
  var rule = { 'Buyers': function (a) { return '=COUNTIF(' + stage + ',' + a + ')'; } };
  [['Called', 'Call outcome', '"<>"'], ['Reached', 'Call outcome', '"Reached"'], ['Deal closed', 'Deal closed?', '"Yes"'],
   ['Society campaign Yes', 'Society campaign interest?', '"Yes"'], ['Will refer Yes', 'Will refer neighbours?', '"Yes"'],
   ['Reminders set', 'Next reminder date', '"<>"'], ['DND', 'DND', '"Yes"']].forEach(function (x) {
    var rng = R(x[1]); if (rng) rule[x[0]] = function (a) { return '=COUNTIFS(' + stage + ',' + a + ',' + rng + ',' + x[2] + ')'; };
  });
  for (var r = s + 1; r < top.length && top[r][0]; r++) {
    var isTotal = top[r][0] === 'Total';
    sumHead.forEach(function (name, j) {
      if (!rule[name]) return;
      var cell = sh.getRange(r + 1, j + 1), L = colLetter(j + 1);
      cell.setFormula(isTotal ? '=SUM(' + L + (s + 2) + ':' + L + r + ')' : rule[name]('$A' + (r + 1)));
    });
  }
}

// ---- One-time clean-up (run once, 25 Oct): fix typos, restore names, fill from your call notes ----
var OUTCOME = { 'reached': 'Reached', 'no answer': 'No answer', 'no answer, sms': 'No answer + SMS sent', 'no answer, sms sent': 'No answer + SMS sent',
  'no anser, sms sent': 'No answer + SMS sent', 'sms sent, no reach': 'No answer + SMS sent', 'not conncetcr': 'Not reachable', 'ignore': 'Do not call',
  'will cehck th price and get back': 'Reached', 'will order today': 'Reached' };
var OUTCOME_NOTE = { 'will cehck th price and get back': 'Said: will check the price and get back', 'will order today': 'Said on 24 Oct: will order today' };
var NAMES = {"9987137252": "Supriya wadhavkar", "9820841350": "Shweta Uchill", "9324292199": "Narsh more", "9969540051": "Reema rajput", "7738624028": "Ameya Lad", "7350246176": "Sayali sawant", "9833375988": "Raju Panchal", "9820984149": "Poonam karnik", "9920866618": "Manoj", "9029319204": "Life", "9029235101": "Aniket", "7499691808": "RAM", "9967021345": "vaibhav samant", "8976209025": "Aarti nithinwar", "9987042297": "Anu karwe", "9867325848": "Kirti koynade", "9867665621": "Pradnya pawar", "9820027803": "Suhail nathani", "9920582936": "kavita", "7506199592": "Rou qaudors", "9821012123": "Prakash samant", "9967801118": "Subha pillai", "9978901782": "Arkadev adkhikari", "9820976875": "Manoj das", "9841811432": "Raja sekar", "8104479906": "Reshma Walawalkar", "9833425455": "Rajesh Walawalkar", "8888708963": "Abhay kanta", "9324799195": "Kiran sawant", "9819486659": "Pravin Dias", "9867624786": "Adnan", "7021539902": "Ritika", "9734971122": "Supratik"};
var FILL = {
  '9821697970': { 'What stopped them / objection': 'Trust / wants COD', 'Next reminder date': new Date(2026, 9, 28), 'Reminder for': 'Order', 'Deal closed?': 'Follow-up' },
  '9987137252': { 'What stopped them / objection': 'Cleaning & cut doubt', 'Deal closed?': 'Follow-up' },
  '7738624028': { 'What stopped them / objection': 'Slot / timing' },
  '9833375988': { 'What stopped them / objection': 'Just exploring' },
  '9869746124': { 'What stopped them / objection': 'Buys from own fish seller', 'Next reminder date': new Date(2026, 9, 27), 'Reminder for': 'Order' },
  '8976209025': { 'What stopped them / objection': 'Price' },
  '9867665621': { 'What stopped them / objection': 'Price' },
  '9821012123': { 'What stopped them / objection': 'Not needed now', 'Reminder for': 'Pre-order' },
  '9978901782': { 'What stopped them / objection': 'Not needed now' },
  '9867325848': { 'DND': 'Yes' }, '9820027803': { 'DND': 'Yes' }, '9923753706': { 'DND': 'Yes' }
};

function tidyOnce() {
  syncBuyers();                                 // adds Last activity / DND columns first
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var all = sh.getDataRange().getValues();
  var h = -1; for (var i = 0; i < all.length; i++) if (all[i][0] === 'Stage' && all[i][1] === 'Call goal') { h = i; break; }
  var header = all[h], col = {}; header.forEach(function (name, j) { if (name) col[name] = j; });
  var data = all.slice(h + 1), touched = {}, changes = 0;
  var set = function (r, name, v) { if (col[name] === undefined) return; r[col[name]] = v; touched[name] = true; changes++; };
  data.forEach(function (r) {
    var p = String(r[col['Phone']] || '').replace(/\D/g, '').slice(-10); if (!p) return;
    if (!r[col['Name']] && NAMES[p]) set(r, 'Name', NAMES[p]);
    var raw = String(r[col['Call outcome']] || '').trim(), key = raw.toLowerCase().replace(/\s+/g, ' ');
    if (raw && OUTCOME[key] && OUTCOME[key] !== raw) {
      set(r, 'Call outcome', OUTCOME[key]);
      if (OUTCOME_NOTE[key]) set(r, 'Notes', [r[col['Notes']], OUTCOME_NOTE[key]].filter(String).join('; '));
    }
    var f = FILL[p] || {};
    Object.keys(f).forEach(function (name) { if (col[name] !== undefined && !r[col[name]]) set(r, name, f[name]); });
  });
  Object.keys(touched).forEach(function (name) {
    sh.getRange(h + 2, col[name] + 1, data.length, 1).setValues(data.map(function (r) { return [r[col[name]]]; }));
  });
  applyRules(sh, h + 1);
  Logger.log(changes + ' cells cleaned');
}
