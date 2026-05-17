"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var expo_sqlite_1 = require("expo-sqlite");
var db = (0, expo_sqlite_1.openDatabaseSync)('mittens.db');
var rows = db.getAllSync("SELECT id, log_name, items, summary_nutrients FROM nutrition_logs ORDER BY id DESC LIMIT 5;");
console.log(JSON.stringify(rows, null, 2));
