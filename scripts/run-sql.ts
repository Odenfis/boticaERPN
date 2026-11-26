import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { getSqlPool } from '../server/db/mssqlClient';

dotenv.config();

function splitGoBatches(sqlText: string): string[] {
  return sqlText
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

async function runSqlFile(filePath: string) {
  const pool = await getSqlPool();
  const raw = fs.readFileSync(filePath, 'utf8');
  const batches = splitGoBatches(raw);
  console.log(`Ejecutando ${path.basename(filePath)} (${batches.length} lotes T-SQL)...`);
  for (const batch of batches) {
    await pool.request().batch(batch);
  }
  console.log(`Completado: ${path.basename(filePath)}`);
}

async function main() {
  const mode = process.argv[2] || 'migrate';
  const root = process.cwd();

  if (mode === 'migrate') {
    const migrationsDir = path.join(root, 'sql', 'migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      await runSqlFile(path.join(migrationsDir, file));
    }
    console.log('Migraciones aplicadas correctamente.');
  } else if (mode === 'seed') {
    await runSqlFile(path.join(root, 'sql', 'seed_demo.sql'));
    console.log('Datos demo cargados correctamente.');
  } else {
    console.error('Uso: tsx scripts/run-sql.ts [migrate|seed]');
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Error ejecutando script SQL Server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
