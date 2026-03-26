# 后端部署脚本使用说明

## 1. 脚本清单

- `deploy.sh`：后端发布脚本（安装依赖 + PM2 重启）
- `nginx.vote.conf`：Nginx 反向代理模板

## 2. 服务器首次准备

```bash
sudo mkdir -p /srv/vote/api/current
sudo mkdir -p /srv/vote/api/shared
sudo mkdir -p /srv/vote/logs/api
```

将后端代码上传到：

- `/srv/vote/api/current`

将生产环境变量放到：

- `/srv/vote/api/shared/.env`

## 3. 安装运行时

```bash
# Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# MySQL + Redis + Nginx
sudo apt-get install -y mysql-server redis-server nginx

# PM2
sudo npm i -g pm2

sudo systemctl enable mysql redis-server nginx
sudo systemctl start mysql redis-server nginx
```

## 3.1 推荐参数（单 2核4G ECS + 1000 并发目标）

- MySQL（本机部署）：
	- `max_connections = 300`
	- `innodb_buffer_pool_size = 2G`
	- `long_query_time = 0.3`
- Redis（本机部署，2GB 起）：
	- `maxmemory-policy = allkeys-lru`
	- `appendonly = no`
- 后端环境变量：
	- `DB_HOST=127.0.0.1`
	- `REDIS_HOST=127.0.0.1`
	- `DB_CONN_LIMIT=30`
	- `VOTE_DEDUP_TTL_SECONDS=777600`

## 4. 执行部署

```bash
cd /srv/vote/api/current
chmod +x deploy/deploy.sh
./deploy/deploy.sh /srv/vote/api/current /srv/vote/api/shared/.env
```

执行后会：

1. 复制共享 `.env` 到当前代码目录
2. 执行 `npm ci --omit=dev`
3. 使用 `ecosystem.config.cjs` 启动/重启 `vote-api`
4. 执行 `pm2 save`

## 5. 服务检查

```bash
pm2 status
pm2 logs vote-api --lines 100
curl http://127.0.0.1:8080/healthz
```

## 6. 配置 Nginx

把 `nginx.vote.conf` 放到：

- `/etc/nginx/sites-available/vote.conf`

启用：

```bash
sudo ln -s /etc/nginx/sites-available/vote.conf /etc/nginx/sites-enabled/vote.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 7. 回滚

如果新版本异常：

1. 将代码目录回退到上一个稳定版本
2. 在该版本目录执行 `./deploy/deploy.sh`
3. 观察 `pm2 logs vote-api`
