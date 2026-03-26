import { config } from "./config.js";
import app from "./app.js";
import { query } from "./db.js";
import { ensureSchemaAndSeed } from "./bootstrap.js";
import { connectRedis } from "./redis.js";

const start = async () => {
  await query("SELECT 1");
  await ensureSchemaAndSeed();
  await connectRedis();

  app.listen(config.port, () => {
    console.log(`[Vote API] listening on http://0.0.0.0:${config.port}`);
  });
};

start().catch((error) => {
  console.error("[Vote API] 启动失败", error);
  process.exit(1);
});
