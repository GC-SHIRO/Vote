# 快速部署指南 (基于 deploy.sh)

本指南使用仓库自带的 `backend/deploy/deploy.sh` 脚本，实现后端环境的依赖安装、数据库初始化与 PM2 平滑重启。相比于 `DEPLOY.md` 的纯手动基础版，此方式更自动化，非常适合作为日常更新或 CI/CD 流水线的核心发布命令。

## 1. 为什么推荐使用 deploy.sh？

`deploy.sh` 内部集成了以下自动化逻辑：
1. **环境隔离保护**：支持将 `.env` 放在统一的外部 Shared 文件夹，避免代码覆盖。
2. **稳定依赖拉取**：强制使用 `npm ci --omit=dev` 安装，保障生产依赖一致性。
3. **自动表结构同步**：自动执行 `npm run init-db`，代码中新增数据库字段时（如 `student_id`）可自动完成迁移。
4. **PM2 生态系统**：依赖 `ecosystem.config.cjs` 启动，拥有更丰富的参数配置。

## 2. 首次部署或日常更新

假设你已经将代码 `git clone` 到了 `/home/deploy/Vote`，并且服务器已经安装好了 Node.js、PM2、MySQL 等基础服务。

### 步骤 1：拉取代码
```bash
cd /home/deploy/Vote
git pull
```

### 步骤 2：执行一键部署脚本 (后端部分)

给脚本赋予执行权限（首次需要）：
```bash
chmod +x backend/deploy/deploy.sh
```

**执行脚本**：
由于 `deploy.sh` 默认面向的企业级标准路径是 `/srv/vote/api`，如果我们直接在当前目录下运行，可以通过**传入自定义路径**参数来适配：

```bash
# 参数1: 后端项目根目录
# 参数2: 环境变量文件存放路径
./backend/deploy/deploy.sh /home/deploy/Vote/backend /home/deploy/Vote/backend/.env
```

### 步骤 3：前端构建 (静态资源)

在前端完成快速构建并同步到 Nginx 托管目录：

```bash
cd /home/deploy/Vote
npm ci
npm run build
sudo rsync -av --delete dist/ /var/www/vote/
```

---

## 3. 最简更新命令总结 (Cheat Sheet)

后续每次修改代码要发版时，只需要跑这几行：

```bash
cd /home/deploy/Vote
git pull

# 1. 后端重新编译、建表与重启
./backend/deploy/deploy.sh /home/deploy/Vote/backend /home/deploy/Vote/backend/.env

# 2. 前端构建与静态同步
npm run build && sudo rsync -av --delete dist/ /var/www/vote/
```