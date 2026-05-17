import { openDatabaseSync } from 'expo-sqlite';
const db = openDatabaseSync('mittens.db');
const rows = db.getAllSync("SELECT id, log_name, items, summary_nutrients FROM nutrition_logs ORDER BY id DESC LIMIT 5;");
console.log(JSON.stringify(rows, null, 2));
