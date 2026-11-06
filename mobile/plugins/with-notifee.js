// Notifee ships its Android core as a local Maven repo; the app project must see it too.
// Release builds are minified (R8): keep Room's generated databases, or WorkManager (pulled in by
// Notifee / Firebase) crashes at launch with "Failed to create an instance of WorkDatabase".
const fs = require("fs");
const path = require("path");
const { withProjectBuildGradle, withDangerousMod } = require("expo/config-plugins");

const KEEP = `
# Room / WorkManager (Notifee, Firebase) — added by plugins/with-notifee.js
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep class androidx.work.impl.** { *; }
`;

module.exports = (config) => {
  config = withProjectBuildGradle(config, (c) => {
    const repo = `maven { url "$rootDir/../node_modules/@notifee/react-native/android/libs" }`;
    if (!c.modResults.contents.includes("@notifee/react-native/android/libs")) {
      c.modResults.contents = c.modResults.contents.replace(/allprojects\s*\{\s*repositories\s*\{/, (m) => `${m}\n    ${repo}`);
    }
    return c;
  });
  return withDangerousMod(config, ["android", (c) => {
    const f = path.join(c.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
    const cur = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
    if (!cur.includes("androidx.work.impl")) fs.writeFileSync(f, cur + KEEP);
    return c;
  }]);
};
