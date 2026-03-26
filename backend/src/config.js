import dotenv from "dotenv";

dotenv.config();

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseOrigins = (value) => {
  if (!value || value.trim() === "") {
    return ["*"];
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: toNumber(process.env.PORT, 8080),
  db: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: toNumber(process.env.DB_PORT, 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "vote_db",
    connectionLimit: toNumber(process.env.DB_CONN_LIMIT, 30)
  },
  redis: {
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: toNumber(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: toNumber(process.env.REDIS_DB, 0)
  },
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
  eventCode: process.env.EVENT_CODE ?? "campus-singer-2026-final",
  voteDedupTtlSeconds: toNumber(process.env.VOTE_DEDUP_TTL_SECONDS, 60 * 60 * 24 * 9)
};
