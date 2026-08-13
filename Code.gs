// ═══════════════════════════════════════════════════════════════════════
// MOVE — Google Apps Script backend
// Paste into Extensions → Apps Script in a Google Sheet (a NEW sheet —
// don't reuse the main fitness-tracker sheet, since column layouts differ).
// Deploy as Web App: Execute as "Me", Access "Anyone".
//
// Stores three things, matching what the app tracks:
//   • Exercise Log   — one row per day, raw exercises JSON (sets/reps/load)
//   • Workout Streak — one row per day, which exercises were marked done
//   • Yoga Log       — one row per day, preset/routine usage
// ═══════════════════════════════════════════════════════════════════════

var SHEET_EXERCISE = "Exercise Log";
var SHEET_WORKOUTS = "Workout Streak";
var SHEET_YOGA     = "Yoga Log";

var EXERCISE_HEADERS = ["Date", "Exercises JSON"];
var WORKOUT_HEADERS  = ["Date", "Exercises Completed", "Exercise Count"];
var YOGA_HEADERS     = ["Date", "Yoga Log JSON"];

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var json = JSON.stringify({
    exercises: getExerciseData_(ss),
    workouts:  getWorkoutData_(ss),
    yoga:      getYogaData_(ss)
  });
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var raw = (e && e.parameter && e.parameter.data) || "{}";
    var payload = JSON.parse(raw);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (payload.exercises) writeExerciseData_(ss, payload.exercises);
    if (payload.workouts)  writeWorkoutData_(ss, payload.workouts);
    if (payload.yoga)      writeYogaData_(ss, payload.yoga);

    return ContentService.createTextOutput(JSON.stringify({status:"saved"}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status:"error", message: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── sheet helpers ─────────────────────────────────────────────────────
function getSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
function upsertRow_(sheet, dateKey, rowValues) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === dateKey) {
      sheet.getRange(i + 1, 1, 1, rowValues.length).setValues([rowValues]);
      return;
    }
  }
  sheet.appendRow(rowValues);
}

// ── Exercise Log (day -> exercises array) ───────────────────────────────
function writeExerciseData_(ss, exercisesByDate) {
  var sheet = getSheet_(ss, SHEET_EXERCISE, EXERCISE_HEADERS);
  Object.keys(exercisesByDate).forEach(function(dateKey) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
    var day = exercisesByDate[dateKey];
    if (!day || !day.exercises || !day.exercises.length) return;
    upsertRow_(sheet, dateKey, [dateKey, JSON.stringify(day.exercises)]);
  });
}
function getExerciseData_(ss) {
  var sheet = ss.getSheetByName(SHEET_EXERCISE);
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var out = {};
  for (var i = 1; i < data.length; i++) {
    var dateKey = data[i][0], json = data[i][1];
    if (!dateKey || !json) continue;
    try { out[dateKey] = { exercises: JSON.parse(json) }; } catch (e) {}
  }
  return out;
}

// ── Workout Streak (day -> {exId: true, ...}) ───────────────────────────
function writeWorkoutData_(ss, workoutsByDate) {
  var sheet = getSheet_(ss, SHEET_WORKOUTS, WORKOUT_HEADERS);
  Object.keys(workoutsByDate).forEach(function(dateKey) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
    var done = workoutsByDate[dateKey];
    var names = Object.keys(done || {});
    if (!names.length) return;
    upsertRow_(sheet, dateKey, [dateKey, names.join(", "), names.length]);
  });
}
function getWorkoutData_(ss) {
  var sheet = ss.getSheetByName(SHEET_WORKOUTS);
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var out = {};
  for (var i = 1; i < data.length; i++) {
    var dateKey = data[i][0], names = data[i][1];
    if (!dateKey || !names) continue;
    var obj = {};
    String(names).split(",").forEach(function(n) { n = n.trim(); if (n) obj[n] = true; });
    out[dateKey] = obj;
  }
  return out;
}

// ── Yoga Log (day -> preset/routine usage JSON) ─────────────────────────
function writeYogaData_(ss, yogaByDate) {
  var sheet = getSheet_(ss, SHEET_YOGA, YOGA_HEADERS);
  // The app's yoga log isn't date-keyed the same way — store as a single
  // "latest" row keyed to today's date so history isn't lost between pushes.
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  upsertRow_(sheet, today, [today, JSON.stringify(yogaByDate)]);
}
function getYogaData_(ss) {
  var sheet = ss.getSheetByName(SHEET_YOGA);
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};
  var last = data[data.length - 1];
  try { return JSON.parse(last[1]); } catch (e) { return {}; }
}
