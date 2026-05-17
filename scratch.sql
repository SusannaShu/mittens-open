CREATE TABLE test (logged_at TEXT);
INSERT INTO test VALUES ('2026-05-17T01:13:50.000Z');
SELECT date(logged_at) FROM test;
SELECT date(logged_at, 'localtime') FROM test;
