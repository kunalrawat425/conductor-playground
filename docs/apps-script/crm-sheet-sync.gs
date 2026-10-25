/**
 * Relifish buyer call sheet: hourly sync from relifish.com.
 * Updates ONLY the database columns (Stage, Phone, Cart, Orders, ...), matched by phone number,
 * and adds new buyers at the bottom. Your own columns (Call outcome, Feedback, Notes, ...) are never written.
 *
 * Setup (once): Extensions → Apps Script → paste this file → Project Settings → Script properties:
 *   CRM_URL = https://www.relifish.com/api/admin/crm-sheet
 *   CRM_KEY = <the key Relifish gave you>
 * Then run `setup` once (allow access when asked). It syncs now and every hour after.
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
    dbCols.forEach(function (name) { data[k][col[name]] = rec[name]; });
  });

  // Write back one database column at a time, so your own columns are never touched.
  dbCols.forEach(function (name) {
    var values = data.map(function (r) { var v = r[col[name]]; return [v === undefined ? '' : v]; });
    sh.getRange(firstData + 1, col[name] + 1, values.length, 1).setValues(values);
  });
  sh.getRange(2, 1).setValue('Synced from relifish.com: ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'd MMM yyyy, h:mm a') + ' · ' + rows.length + ' buyers · ' + added + ' new');
}
