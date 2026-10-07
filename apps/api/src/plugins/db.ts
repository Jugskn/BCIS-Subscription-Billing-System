import fp from "fastify-plugin";
import { createDb, type Database } from "@bcis/db";
import type { FastifyPluginAsync } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    db: Database["db"];
    dbClient: Database["client"];
  }
}

const dbPlugin: FastifyPluginAsync<{ connectionString: string }> = async (
  app,
  opts,
) => {
  const { db, client } = createDb(opts.connectionString);
  app.decorate("db", db);
  app.decorate("dbClient", client);
  app.addHook("onClose", async () => {
    await client.end({ timeout: 5 });
  });
};

export default fp(dbPlugin, { name: "db" });
