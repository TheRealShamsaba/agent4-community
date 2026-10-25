import { chmod, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const source = path.resolve(process.argv[2] || "data/agent4-rooms.sqlite");
const destination = path.resolve(process.argv[3] || `data/backups/agent4-rooms-${new Date().toISOString().slice(0, 10)}.sqlite`);

await stat(source);
await mkdir(path.dirname(destination), { recursive: true });
await rm(destination, { force: true });

const database = new DatabaseSync(source);
try {
  const escapedDestination = destination.replaceAll("'", "''");
  database.exec(`VACUUM INTO '${escapedDestination}'`);
} finally {
  database.close();
}

await chmod(destination, 0o600);
console.log(destination);
