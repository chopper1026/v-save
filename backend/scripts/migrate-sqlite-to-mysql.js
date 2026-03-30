#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const mysql = require('mysql2/promise');

function loadEnvFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalIndex = line.indexOf('=');
    if (equalIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalIndex).trim();
    const value = line.slice(equalIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function openSqliteDatabase(sqlitePath) {
  return new sqlite3.Database(sqlitePath);
}

function sqliteAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

function sqliteClose(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function quoteIdentifier(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

async function main() {
  const backendRoot = path.resolve(__dirname, '..');
  loadEnvFromFile(path.join(backendRoot, '.env'));
  loadEnvFromFile(path.join(backendRoot, '.env.local'));

  const sqlitePath = process.env.SQLITE_PATH
    ? path.resolve(backendRoot, process.env.SQLITE_PATH)
    : path.join(backendRoot, 'video_downloader.db');

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found: ${sqlitePath}`);
  }

  const mysqlHost = process.env.DATABASE_HOST || '127.0.0.1';
  const mysqlPort = Number(process.env.DATABASE_PORT || 3306);
  const mysqlUser = process.env.DATABASE_USER || 'root';
  const mysqlPassword = process.env.DATABASE_PASSWORD || '';
  const mysqlDatabase = process.env.DATABASE_NAME || 'video_downloader';

  console.log(`[migrate] sqlite=${sqlitePath}`);
  console.log(
    `[migrate] mysql=${mysqlUser}@${mysqlHost}:${mysqlPort}/${mysqlDatabase}`,
  );

  const sqliteDb = openSqliteDatabase(sqlitePath);
  const mysqlAdmin = await mysql.createConnection({
    host: mysqlHost,
    port: mysqlPort,
    user: mysqlUser,
    password: mysqlPassword,
  });

  await mysqlAdmin.query(
    `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(
      mysqlDatabase,
    )} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await mysqlAdmin.end();

  const mysqlDb = await mysql.createConnection({
    host: mysqlHost,
    port: mysqlPort,
    user: mysqlUser,
    password: mysqlPassword,
    database: mysqlDatabase,
  });

  try {
    const tableRows = await sqliteAll(
      sqliteDb,
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const tables = tableRows.map((row) => row.name);

    if (tables.length === 0) {
      console.log('[migrate] no sqlite tables found');
      return;
    }

    await mysqlDb.query('SET FOREIGN_KEY_CHECKS=0');

    for (const table of tables) {
      const mysqlTableName = quoteIdentifier(table);
      const [existsRows] = await mysqlDb.query(
        'SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
        [mysqlDatabase, table],
      );

      if (!existsRows[0] || existsRows[0].cnt === 0) {
        throw new Error(
          `MySQL table "${table}" does not exist. Start backend with DATABASE_TYPE=mysql and DB_SYNCHRONIZE=true first.`,
        );
      }

      const sqliteColumnsInfo = await sqliteAll(
        sqliteDb,
        `PRAGMA table_info("${table}")`,
      );
      const columns = sqliteColumnsInfo.map((col) => col.name);

      if (columns.length === 0) {
        console.log(`[migrate] skip ${table}: no columns`);
        continue;
      }

      const sqliteCountRows = await sqliteAll(
        sqliteDb,
        `SELECT COUNT(*) AS cnt FROM "${table}"`,
      );
      const sqliteCount = sqliteCountRows[0]?.cnt || 0;

      console.log(`[migrate] table=${table} sqlite_rows=${sqliteCount}`);

      await mysqlDb.query(`DELETE FROM ${mysqlTableName}`);

      if (sqliteCount > 0) {
        const rows = await sqliteAll(sqliteDb, `SELECT * FROM "${table}"`);
        const placeholdersPerRow = `(${columns.map(() => '?').join(',')})`;
        const chunkSize = 500;

        for (let i = 0; i < rows.length; i += chunkSize) {
          const chunk = rows.slice(i, i + chunkSize);
          const values = [];
          for (const row of chunk) {
            for (const col of columns) {
              values.push(row[col]);
            }
          }

          const sql = `INSERT INTO ${mysqlTableName} (${columns
            .map(quoteIdentifier)
            .join(',')}) VALUES ${chunk
            .map(() => placeholdersPerRow)
            .join(',')}`;
          await mysqlDb.query(sql, values);
        }
      }

      const [mysqlCountRows] = await mysqlDb.query(
        `SELECT COUNT(*) AS cnt FROM ${mysqlTableName}`,
      );
      const mysqlCount = mysqlCountRows[0]?.cnt || 0;

      if (Number(mysqlCount) !== Number(sqliteCount)) {
        throw new Error(
          `Row count mismatch for ${table}: sqlite=${sqliteCount}, mysql=${mysqlCount}`,
        );
      }

      console.log(`[migrate] table=${table} migrated_ok rows=${mysqlCount}`);
    }

    console.log('[migrate] all tables migrated successfully');
  } finally {
    try {
      await mysqlDb.query('SET FOREIGN_KEY_CHECKS=1');
    } catch (_err) {
      // no-op
    }

    await mysqlDb.end();
    await sqliteClose(sqliteDb);
  }
}

main().catch((error) => {
  console.error('[migrate] failed:', error.message);
  process.exit(1);
});
