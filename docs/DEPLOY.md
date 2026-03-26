# 部署教学（从空白 ECS 到上线）

本文按 Ubuntu 22.04 LTS 示例，目标是 1 台 ECS 完成前端静态站点 + 后端 API + MySQL + Redis 的可用部署。

## 1. 目标架构

- Nginx：80/443 对外入口
- 前端：Vite 构建后的静态文件，由 Nginx 托管
- 后端：Node.js 进程，由 PM2 托管
- 数据库：MySQL 8
- 缓存：Redis 6+

## 2. 创建 ECS（控制台阶段）

1. 云服务器系统建议：Ubuntu 22.04 LTS。
2. 实例规格建议：2 核 4G（中小活动可先用此规格）。
3. 磁盘建议：系统盘 40G 以上。
4. 安全组至少放行端口：
   - 22（SSH，仅办公 IP 白名单）
   - 80（HTTP）
   - 443（HTTPS）
5. 记录公网 IP，例如 1.2.3.4。

## 3. 首次登录与基础初始化

### 3.1 登录服务器

```bash
ssh root@1.2.3.4
```

### 3.2 创建部署用户（推荐）

```bash
adduser deploy
usermod -aG sudo deploy
```

切换到 deploy 用户继续后续步骤：

```bash
su - deploy
```

### 3.3 更新系统

```bash
sudo apt update
sudo apt -y upgrade
sudo timedatectl set-timezone Asia/Shanghai
```

### 3.4 安装基础工具

```bash
sudo apt install -y git curl wget unzip ufw build-essential
```

### 3.5 防火墙（可选但推荐）

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable
sudo ufw status
```

## 4. 安装运行环境

### 4.1 安装 Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

### 4.2 安装 PM2

```bash
sudo npm install -g pm2
pm2 -v
```

### 4.3 安装 MySQL

```bash
sudo apt install -y mysql-server
sudo systemctl enable mysql
sudo systemctl start mysql
sudo mysql_secure_installation
```

创建数据库和账号（示例）：

```bash
sudo mysql -uroot -p
```

进入 MySQL 后执行：

```sql
CREATE DATABASE vote_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'vote_user'@'127.0.0.1' IDENTIFIED BY '请替换为强密码';
GRANT ALL PRIVILEGES ON vote_db.* TO 'vote_user'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

### 4.4 安装 Redis

```bash
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
redis-cli ping
```

返回 PONG 代表正常。

### 4.5 安装 Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
sudo systemctl status nginx
```

## 5. 拉取项目并部署后端

### 5.1 拉取代码

```bash
cd /home/deploy
git clone 你的仓库地址 Vote
cd Vote
```

### 5.2 安装后端依赖

```bash
cd /home/deploy/Vote/backend
npm install
```

### 5.3 创建后端环境变量

```bash
cp .env.example .env
```

编辑 .env：

```env
NODE_ENV=production
PORT=8080

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=vote_user
DB_PASSWORD=请替换为你的数据库密码
DB_NAME=vote_db
DB_CONN_LIMIT=30

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

ALLOWED_ORIGINS=https://你的域名
EVENT_CODE=campus-singer-2026-final
VOTE_DEDUP_TTL_SECONDS=777600
```

### 5.4 初始化数据库

```bash
npm run init-db
```

### 5.5 启动后端并设置开机自启

```bash
pm2 start src/server.js --name vote-api --cwd /home/deploy/Vote/backend
pm2 save
pm2 startup
```

执行 pm2 startup 输出的命令后，再执行：

```bash
pm2 save
pm2 status
```

### 5.6 验证后端健康

```bash
curl http://127.0.0.1:8080/healthz
```

应返回 success=true。

## 6. 构建并部署前端

### 6.1 安装依赖并构建

```bash
cd /home/deploy/Vote
npm install
```

创建前端环境文件：

```bash
cp .env.example .env
```

编辑 .env：

```env
VITE_API_BASE_URL=https://你的域名
VITE_USE_MOCK=false
```

构建：

```bash
npm run build
```

### 6.2 发布静态文件到 Nginx 目录

```bash
sudo mkdir -p /var/www/vote
sudo rsync -av --delete /home/deploy/Vote/dist/ /var/www/vote/
```

## 7. 配置 Nginx 反向代理

创建站点配置：

```bash
sudo nano /etc/nginx/sites-available/vote.conf
```

写入以下内容（先 HTTP 版本）：

```nginx
server {
	listen 80;
	server_name 你的域名;

	root /var/www/vote;
	index index.html;

	location / {
		try_files $uri $uri/ /index.html;
	}

	location /api/ {
		proxy_pass http://127.0.0.1:8080;
		proxy_http_version 1.1;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
	}

	location /uploads/ {
		proxy_pass http://127.0.0.1:8080;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
	}

	location ~* \.(js|css|png|jpg|jpeg|gif|svg|woff|woff2)$ {
		expires 7d;
		add_header Cache-Control "public, max-age=604800";
	}
}
```

启用并重载：

```bash
sudo ln -s /etc/nginx/sites-available/vote.conf /etc/nginx/sites-enabled/vote.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 8. 绑定域名与 HTTPS

### 8.1 域名解析

在域名服务商处添加 A 记录：

- 主机记录：@ 或 www
- 记录值：ECS 公网 IP

### 8.2 安装证书工具

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### 8.3 自动申请并配置 HTTPS

```bash
sudo certbot --nginx -d 你的域名
```

按提示选择跳转到 HTTPS。完成后验证自动续期：

```bash
sudo certbot renew --dry-run
```

## 9. 上线验收（按顺序）

1. 打开首页，能看到投票页面。
2. 打开 /admin，能进入后台并成功改配置。
3. 切换单选/多选后，投票页规则即时变化。
4. 上传候选人头像后，前台可显示。
5. 停止投票后，投票页按钮应变为结束状态。
6. 访问 /api/v1/votes/results 能返回正常数据。
7. 访问 /healthz 返回 200。

## 10. 日常运维命令

### PM2

```bash
pm2 status
pm2 logs vote-api
pm2 restart vote-api
pm2 stop vote-api
```

### Nginx

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl restart nginx
sudo tail -f /var/log/nginx/error.log
```

### 服务状态

```bash
sudo systemctl status mysql
sudo systemctl status redis-server
sudo systemctl status nginx
```

## 11. 更新发布流程（后续版本）

```bash
cd /home/deploy/Vote
git pull

cd /home/deploy/Vote/backend
npm install
pm2 restart vote-api

cd /home/deploy/Vote
npm install
npm run build
sudo rsync -av --delete /home/deploy/Vote/dist/ /var/www/vote/

sudo nginx -t
sudo systemctl reload nginx
```

## 12. 常见问题排查

### 12.1 前端页面打开但请求失败

- 检查前端 .env 中 VITE_API_BASE_URL 是否为线上域名。
- 检查 Nginx /api/ 代理是否生效。
- 检查后端 pm2 进程是否在线。

### 12.2 后台上传头像失败

- 检查 /uploads/ 路由是否已在 Nginx 代理。
- 检查后端目录写权限。
- 检查上传文件是否超过 3MB。

### 12.3 数据库连接失败

- 检查 backend/.env 的 DB_* 配置。
- 检查 MySQL 用户授权 host 是否为 127.0.0.1。
- 查看 PM2 日志确认具体报错。

### 12.4 HTTPS 不生效

- 确认域名已正确解析到 ECS。
- 检查 80/443 端口是否已放行。
- 重新执行 certbot 并查看报错。
