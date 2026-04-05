# 后端说明

## 1. 产品目标

为投票活动提供稳定的规则执行与数据存储能力，确保结果可信、可追踪。

## 2. 核心能力

- 投票提交与结果查询（包含学号与设备指纹双重校验）
- 活动配置读取（投票页动态配置）
- 后台管理接口（活动状态、投票规则、候选人管理）
- 抽奖业务支持（模拟预留池与真实学号滚库抽取）
- 候选人头像上传
- 基础缓存与去重能力（Redis 可用时）

## 3. 管理员账号（写死）

- 账号：`admin`
- 密码：`131072`
- 鉴权方式：HTTP Basic Auth（仅后台管理接口）

## 4. 快速启动

```bash
cd backend
npm install
cp .env.example .env
npm run init-db
npm run dev
```

## 5. 主要接口

- `GET /healthz`
- `GET /api/v1/events/config?eventId=...`
- `POST /api/v1/votes`
- `GET /api/v1/votes/results?eventId=...`
- `GET /api/v1/admin/config?eventId=...`
- `PUT /api/v1/admin/config`
- `POST /api/v1/admin/lottery/draw`
- `POST /api/v1/admin/lottery/reset`
- `POST /api/v1/admin/candidates`
- `PUT /api/v1/admin/candidates/:candidateCode`
- `DELETE /api/v1/admin/candidates/:candidateCode?eventId=...`
- `POST /api/v1/admin/upload-avatar`
