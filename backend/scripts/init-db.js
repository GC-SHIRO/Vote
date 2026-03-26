import mysql from "mysql2/promise";
import { config } from "../src/config.js";
import { ensureSchemaAndSeed } from "../src/bootstrap.js";

const run = async () => {
  const adminConnection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password
  });

  await adminConnection.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await adminConnection.end();

  await ensureSchemaAndSeed();
  console.log("数据库初始化完成");
};

run().catch((error) => {
  console.error("数据库初始化失败", error);
  process.exit(1);
});
