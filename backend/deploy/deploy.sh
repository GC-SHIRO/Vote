#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${1:-/srv/vote/api/current}"
SHARED_ENV="${2:-/srv/vote/api/shared/.env}"

if [ ! -d "$APP_ROOT" ]; then
  echo "[deploy] APP_ROOT 不存在: $APP_ROOT"
  exit 1
fi

cd "$APP_ROOT"

if [ -f "$SHARED_ENV" ]; then
  cp "$SHARED_ENV" "$APP_ROOT/.env"
else
  echo "[deploy] 未找到共享环境变量文件: $SHARED_ENV"
  echo "[deploy] 将继续执行，但请确认 .env 已存在"
fi

mkdir -p /srv/vote/logs/api

npm ci --omit=dev

if command -v pm2 >/dev/null 2>&1; then
  pm2 startOrRestart ecosystem.config.cjs --env production
  pm2 save
else
  echo "[deploy] 未检测到 pm2，请先安装: npm i -g pm2"
  exit 1
fi

echo "[deploy] 发布完成"
