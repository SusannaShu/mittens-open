const SQLite = require('expo-sqlite');
const db = SQLite.openDatabaseSync('mittens.db');
try {
  const row = db.getFirstSync("SELECT * FROM nutrition_logs ORDER BY id DESC LIMIT 1");
  console.log(row);
} catch (e) {
  console.error(e);
}
