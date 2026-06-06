#!/usr/bin/env node
import { resolveConfig } from "./config.js";
import { buildServer } from "./http/server.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { openDatabase } from "./registry/db.js";
import { Repository } from "./registry/repository.js";

async function main(): Promise<void> {
  const config = resolveConfig();
  const db = openDatabase(config.dbPath);
  const repo = new Repository(db);
  const orchestrator = new Orchestrator({ claudeBin: config.claudeBin, cwd: process.cwd() });
  const app = buildServer({ repo, orchestrator });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Ricevuto ${signal}, arresto in corso…`);
    orchestrator.shutdown();
    await app.close();
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`ccapi in ascolto su http://${config.host}:${config.port} (cwd: ${process.cwd()})`);
}

main().catch((err) => {
  console.error("Avvio fallito:", err);
  process.exit(1);
});
