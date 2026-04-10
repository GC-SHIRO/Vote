# Dashboard 看板页面设计方案

## 1. 需求概述

在 `/dashboard` 路由下新增一个大屏看板页面，用于比赛现场实时展示。核心要求：

- **实时排名**：按票数动态排序，排名变化时有动画效果
- **投票数据**：总票数、各候选人票数、投票趋势
- **抽奖信息**：中奖学号滚动逐个展示（而非一次性全部展示）
- **时效性**：轮询间隔 2 秒（投票页为 5 秒），确保数据实时性
- **大屏适配**：专为横屏/大屏设计，单页适配，无需滚动
- **浅色主题**：与投票页面保持一致的浅色设计风格
- **品牌标识**：包含学生社团管理中心Logo和文字组合
- **单页显示**：所有内容必须在一个屏幕内完整显示，无需滚动

## 2. 现有代码分析

### 2.1 前端路由机制

`src/main.tsx` 通过 `window.location.pathname` 判断路由：

```ts
const isAdminPage = window.location.pathname.startsWith("/admin");
const RootComponent = isAdminPage ? AdminApp : App;
```

**修改点**：增加 `/dashboard` 路由判断，渲染 `DashboardApp`。

### 2.2 现有 API 接口（可复用）

| 接口 | 用途 | 轮询频率 |
|------|------|----------|
| `GET /api/v1/events/config?eventId=...` | 获取活动配置 + 候选人信息（含票数） | 投票页 5s |
| `GET /api/v1/votes/results?eventId=...` | 获取投票结果（候选人票数） | 按需 |

### 2.3 现有数据结构

`VoteSettings`（`src/types.ts`）包含：
- `candidates: Candidate[]` — 候选人列表（含 `voteCount`）
- `lotteryWinners: string[]` — 当前显示的中奖学号列表
- `lotteryWinnerList: LotteryWinner[]` — 详细中奖记录
- `lotteryStatus: "not_started" | "drawn"` — 抽奖状态
- `status: "active" | "closed"` — 活动状态
- `selectionMode` / `maxSelections` — 投票规则

`VoteResultResponse`（`src/types.ts`）包含：
- `candidates: Array<{ id, name, voteCount }>` — 票数结果
- `updatedAt: string` — 更新时间

### 2.4 现有轮询机制

`App.tsx` 使用 `setTimeout` 递归轮询：

```ts
const scheduleNextPull = () => {
  timerId = window.setTimeout(() => {
    pullLatest().catch(() => {}).finally(() => scheduleNextPull());
  }, 5000); // 投票页 5 秒
};
```

**Dashboard 将使用 2 秒间隔**。

## 3. 修改文件清单

### 3.1 新增文件

| 文件 | 说明 |
|------|------|
| `src/DashboardApp.tsx` | Dashboard 看板主组件 |
| `src/dashboard.css` | Dashboard 样式（大屏适配、动画） |

### 3.2 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/main.tsx` | 添加 `/dashboard` 路由判断，导入 `DashboardApp` 和 `dashboard.css` |
| `src/types.ts` | 添加 `DashboardState` 类型（排名变化、动画状态等） |

### 3.3 不需要修改的文件

| 文件 | 原因 |
|------|------|
| `src/api.ts` | 复用 `fetchEventConfig` 和 `fetchResults`，无需新增 API |
| `backend/src/app.js` | 现有接口已满足 Dashboard 数据需求 |
| `vite.config.ts` | 无需修改（SPA 模式下 `/dashboard` 会 fallback 到 `index.html`） |

## 4. DashboardApp 组件设计

### 4.1 页面布局（大屏横屏，单页适配）

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [Logo] 学生社团管理中心 · 校园十大歌手大赛实时看板    活动状态 | 时间  │
├──────────────────────────┬──────────────────────────────────────────────┤
│                          │                                              │
│   🏆 实时排名区域         │   📊 投票数据统计区                           │
│   （左侧 50%）           │   （右侧 50%）                              │
│                          │                                              │
│   候选人卡片列表（紧凑）  │   - 总票数（大字）                            │
│   按票数降序排列          │   - 投票参与率                               │
│   排名变化有动画          │   - 各候选人票数柱状图                        │
│   头像 + 姓名 + 票数     │   - 实时票数增量（最近 10s）                  │
│   排名数字带颜色渐变      │                                              │
│   （内部可滚动）          │                                              │
├──────────────────────────┴──────────────────────────────────────────────┤
│   🎟️ 抽奖区域（滚动展示中奖学号）                                        │
│   中奖学号逐个滚动出现，每个学号有独立动画                                 │
│   等待抽奖时显示占位提示                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 状态管理

```ts
type RankedCandidate = Candidate & {
  rank: number;           // 当前排名
  prevRank: number;       // 上一次排名（用于动画方向判断）
  rankChanged: boolean;   // 排名是否变化
  voteDelta: number;      // 票数增量（最近一次更新）
};

type DashboardState = {
  candidates: RankedCandidate[];      // 排序后的候选人
  totalVotes: number;                 // 总票数
  prevTotalVotes: number;             // 上次总票数
  lotteryWinners: string[];           // 当前显示的中奖学号
  displayedLotteryWiners: string[];   // 已经完成动画展示的学号
  lotteryQueue: string[];             // 待逐个展示的学号队列
  currentLotteryIndex: number;        // 当前显示的学号索引（用于滚动）
  status: "active" | "closed";        // 活动状态
  lastUpdate: string;                 // 最后更新时间
};
```

### 4.3 核心逻辑

#### 4.3.1 数据轮询（2 秒间隔）

```ts
useEffect(() => {
  let disposed = false;
  let timerId = 0;

  const pullLatest = async () => {
    const config = await fetchEventConfig(eventId);
    if (disposed) return;
    
    // 更新候选人排名和票数
    updateCandidates(config.candidates);
    // 检查新的中奖学号
    checkNewLotteryWinners(config.lotteryWinners);
  };

  const scheduleNext = () => {
    timerId = window.setTimeout(() => {
      pullLatest().catch(() => {}).finally(scheduleNext);
    }, 2000); // 2 秒轮询
  };

  pullLatest();
  scheduleNext();

  return () => { disposed = true; clearTimeout(timerId); };
}, []);
```

#### 4.3.2 排名变化检测与动画

```ts
const updateCandidates = (newCandidates: Candidate[]) => {
  // 计算新排名
  const sorted = [...newCandidates].sort((a, b) => b.voteCount - a.voteCount);
  
  setCandidates(prev => {
    const prevMap = new Map(prev.map(c => [c.id, c]));
    
    return sorted.map((candidate, index) => {
      const prevCandidate = prevMap.get(candidate.id);
      const prevRank = prevCandidate?.rank ?? (index + 1);
      const prevVotes = prevCandidate?.voteCount ?? candidate.voteCount;
      
      return {
        ...candidate,
        rank: index + 1,
        prevRank,
        rankChanged: prevRank !== (index + 1),
        voteDelta: candidate.voteCount - prevVotes
      };
    });
  });
};
```

#### 4.3.3 抽奖学号滚动展示

```ts
const checkNewLotteryWinners = (newWinners: string[]) => {
  setLotteryState(prev => {
    const prevSet = new Set(prev.displayedLotteryWiners);
    const newOnes = newWinners.filter(id => !prevSet.has(id));
    
    if (newOnes.length === 0) return prev;
    
    // 将新学号加入待展示队列
    return {
      ...prev,
      lotteryWinners: newWinners,
      lotteryQueue: [...prev.lotteryQueue, ...newOnes]
    };
  });
};

// 滚动展示动画
useEffect(() => {
  if (lotteryQueue.length === 0) return;
  
  const timer = setTimeout(() => {
    const [next, ...rest] = lotteryQueue;
    setLotteryState(prev => ({
      ...prev,
      displayedLotteryWiners: [...prev.displayedLotteryWiners, next],
      lotteryQueue: rest,
      currentLotteryIndex: prev.displayedLotteryWiners.length
    }));
  }, 1500); // 每个学号间隔 1.5 秒滚动展示
  
  return () => clearTimeout(timer);
}, [lotteryQueue]);
```

### 4.4 动画设计

| 场景 | 动画效果 | CSS 实现 |
|------|----------|----------|
| 排名上升 | 卡片上移 + 绿色高亮闪烁 | `@keyframes rank-up` (translateY + color) |
| 排名下降 | 卡片下移 + 红色高亮闪烁 | `@keyframes rank-down` |
| 票数增加 | 数字跳动 + 放大 | `@keyframes vote-bump` (scale) |
| 新学号滚动 | 从下方滚动进入 + 平滑过渡 | `@keyframes lottery-scroll-in` (translateY) |
| 学号高亮 | 金色背景脉冲 | `@keyframes lottery-highlight` (background-color) |
| 页面入场 | 整体淡入 + 上移 | `@keyframes dashboard-enter` |

### 4.5 排名卡片样式

```tsx
<article 
  key={candidate.id}
  className={`rank-card ${candidate.rankChanged ? (candidate.rank < candidate.prevRank ? 'rank-up' : 'rank-down') : ''}`}
>
  <div className={`rank-number rank-${candidate.rank}`}>
    {candidate.rank}
  </div>
  <img src={candidate.avatar} alt={candidate.name} className="rank-avatar" />
  <div className="rank-info">
    <h3>{candidate.name}</h3>
    <p>{candidate.major} · 《{candidate.song}》</p>
  </div>
  <div className="rank-votes">
    <span className="vote-count">{candidate.voteCount}</span>
    <span>票</span>
    {candidate.voteDelta > 0 && (
      <span className="vote-delta">+{candidate.voteDelta}</span>
    )}
  </div>
</article>
```

### 4.6 抽奖滚动展示组件

```tsx
const LotteryScroll = ({ winners, currentIndex }: { winners: string[]; currentIndex: number }) => {
  if (winners.length === 0) {
    return <div className="lottery-placeholder">等待抽奖结果...</div>;
  }

  return (
    <div className="lottery-container">
      <div 
        className="lottery-scroll-wrapper"
        style={{ transform: `translateY(-${currentIndex * 60}px)` }}
      >
        {winners.map((winner, index) => (
          <div 
            key={winner}
            className={`lottery-item ${index === currentIndex ? 'lottery-item-highlight' : ''}`}
          >
            {winner}
          </div>
        ))}
      </div>
    </div>
  );
};
```

## 5. 前端路由修改

### `src/main.tsx` 修改

```ts
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AdminApp from "./AdminApp";
import DashboardApp from "./DashboardApp";
import "./styles.css";
import "./admin.css";
import "./dashboard.css";

const pathname = window.location.pathname;
let RootComponent = App;
if (pathname.startsWith("/admin")) {
  RootComponent = AdminApp;
} else if (pathname.startsWith("/dashboard")) {
  RootComponent = DashboardApp;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);
```

### 4.7 DashboardApp 头部组件

```tsx
import appLogo from "./img/logo.png";
import appText from "./img/文字.png";

const DashboardHeader = () => {
  return (
    <header className="dashboard-header">
      <img src={appLogo} alt="学生社团管理中心" className="dashboard-logo" />
      <img src={appText} alt="学生社团管理中心" className="dashboard-text" />
      <h1 className="dashboard-title">校园十大歌手大赛 · 实时看板</h1>
      <div className="dashboard-status">
        <span>活动状态: 进行中</span>
        <span>最后更新: {new Date().toLocaleTimeString()}</span>
      </div>
    </header>
  );
};
```

## 6. 样式设计要点

### 6.1 大屏适配（浅色主题，单页显示）

```css
.dashboard-page {
  height: 100vh;
  background: linear-gradient(135deg, #f8fbff 0%, #e6f2ff 50%, #f0f8ff 100%);
  color: #333;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
  padding: 16px;
  box-sizing: border-box;
  overflow: hidden; /* 防止滚动，确保单页显示 */
}

.dashboard-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 2px solid #e3f2fd;
  height: 80px;
  flex-shrink: 0; /* 防止头部被压缩 */
}

.dashboard-logo {
  width: 60px;
  height: auto;
  flex-shrink: 0;
}

.dashboard-text {
  width: clamp(140px, 20vw, 200px);
  height: auto;
  flex-shrink: 0;
}

.dashboard-title {
  flex: 1;
  font-size: clamp(1.2rem, 2.5vw, 1.8rem);
  font-weight: 700;
  color: #1565c0;
  margin: 0;
  white-space: nowrap; /* 防止标题换行 */
}

.dashboard-status {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  font-size: 0.9rem;
  color: #666;
  flex-shrink: 0;
}

.dashboard-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  height: calc(100vh - 140px); /* 减去头部高度 */
  min-height: 0; /* 防止内容溢出 */
}

.dashboard-section {
  background: rgba(255, 255, 255, 0.9);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  border: 1px solid #e3f2fd;
  overflow: hidden; /* 防止内容溢出 */
  display: flex;
  flex-direction: column;
}

.rank-list {
  flex: 1;
  overflow-y: auto; /* 允许排名列表内部滚动 */
  min-height: 0;
}

.lottery-section {
  grid-column: 1 / -1; /* 抽奖区域占满整行 */
  height: 100px; /* 固定抽奖区域高度 */
}
```

### 6.2 排名卡片动画

```css
@keyframes rank-up {
  0% { transform: translateY(0); background: transparent; }
  50% { transform: translateY(-8px); background: rgba(76, 175, 80, 0.2); }
  100% { transform: translateY(0); background: transparent; }
}

@keyframes rank-down {
  0% { transform: translateY(0); background: transparent; }
  50% { transform: translateY(8px); background: rgba(244, 67, 54, 0.2); }
  100% { transform: translateY(0); background: transparent; }
}

@keyframes vote-bump {
  0% { transform: scale(1); }
  50% { transform: scale(1.3); color: #ffd700; }
  100% { transform: scale(1); }
}

.rank-up { animation: rank-up 0.6s ease-out; }
.rank-down { animation: rank-down 0.6s ease-out; }
.vote-bump { animation: vote-bump 0.4s ease-out; }
```

### 6.3 抽奖滚动展示动画

```css
.lottery-container {
  height: 60px;
  overflow: hidden;
  position: relative;
  background: linear-gradient(90deg, #e3f2fd, #bbdefb);
  border-radius: 8px;
  padding: 0 16px;
  display: flex;
  align-items: center;
}

.lottery-scroll-wrapper {
  display: flex;
  flex-direction: column;
  transition: transform 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.lottery-item {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 700;
  color: #1565c0;
  white-space: nowrap;
}

@keyframes lottery-scroll-in {
  0% { transform: translateY(100%); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}

@keyframes lottery-highlight {
  0%, 100% { background-color: transparent; }
  50% { background-color: rgba(255, 215, 0, 0.2); }
}

.lottery-item-enter {
  animation: lottery-scroll-in 0.6s ease-out;
}

.lottery-item-highlight {
  animation: lottery-highlight 1.5s ease-in-out infinite;
}

.lottery-placeholder {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-style: italic;
}
```

## 7. 实现步骤

1. **创建 `src/types.ts` 补充**：添加 `RankedCandidate` 类型和 `currentLotteryIndex`
2. **创建 `src/dashboard.css`**：大屏布局 + 动画定义（浅色主题，单页适配）
3. **创建 `src/DashboardApp.tsx`**：看板主组件（包含头部Logo和文字）
4. **修改 `src/main.tsx`**：添加 `/dashboard` 路由
5. **测试验证**：本地 `npm run dev` 访问 `/dashboard`，确保单页显示无滚动

## 8. 与现有页面的对比

| 特性 | 投票页 (`/`) | 看板页 (`/dashboard`) |
|------|-------------|---------------------|
| 轮询间隔 | 5 秒 | 2 秒 |
| 排名展示 | 静态排序 | 动态排序 + 动画 |
| 抽奖学号 | 一次性全部显示 | 滚动逐个展示 |
| 布局 | 移动端优先 | 大屏横屏优先（单页适配） |
| 交互 | 可投票 | 只读展示 |
| 认证 | 无 | 无 |
| 主题 | 浅色主题 | 浅色主题（统一风格） |
| Logo | 包含学生社团中心Logo | 包含学生社团中心Logo |
| 滚动 | 页面可滚动 | 单页显示，无需滚动 |

## 9. 注意事项

- **性能**：2 秒轮询 + 动画可能对低端设备造成压力，需确保动画使用 `transform` 和 `opacity` 触发 GPU 加速
- **网络**：Dashboard 应部署在与投票页相同的网络环境，避免跨域问题
- **浏览器兼容**：动画使用 CSS `@keyframes`，兼容所有现代浏览器
- **Vite SPA fallback**：Vite dev server 默认支持 SPA fallback，`/dashboard` 会正确返回 `index.html`
