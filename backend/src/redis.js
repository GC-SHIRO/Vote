import Redis from "ioredis";
import { config } from "./config.js";

export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableReadyCheck: true
});

let redisReady = false;

export const connectRedis = async () => {
  try {
    await redis.connect();
    redisReady = true;
  } catch (error) {
    redisReady = false;
    console.warn("[Redis] 连接失败，降级为仅依赖 MySQL 去重：", error.message);
  }
};

redis.on("ready", () => {
  redisReady = true;
});

redis.on("error", (error) => {
  redisReady = false;
  console.warn("[Redis] 异常：", error.message);
});

export const isRedisReady = () => redisReady;
