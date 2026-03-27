# 前端说明

## 1. 产品目标

面向活动参与者，提供一个响应快、信息清晰、可实时看到排名变化的投票页面。

## 2. 用户可见能力

- 单选/多选投票（由后台配置决定）
- 实时榜单（从高到低展示）
- 候选人信息动态更新（头像、姓名、歌名、学院专业）
- 活动状态联动（开始/停止）

## 3. 运行方式

```bash
npm install
npm run dev
```

前端环境变量示例：

```env
VITE_API_BASE_URL=http://localhost:8080
VITE_USE_MOCK=false
```

无域名部署（ECS 公网 IP）示例：

```env
VITE_API_BASE_URL=http://1.2.3.4
VITE_USE_MOCK=false
```

## 4. 页面入口

- 投票页：`/`
- 后台页：`/admin`

## 5. 关键说明

- 生产联调必须关闭 mock（`VITE_USE_MOCK=false`）。
- 投票规则（单选/多选、限选人数）由后端配置下发，不需要改前端代码。
