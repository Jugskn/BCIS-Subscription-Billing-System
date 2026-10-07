import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const app = await buildApp(config);

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
  app.log.info(`API listening on http://${config.API_HOST}:${config.API_PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
