import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { fetchEventConfig, RUNTIME_EVENT_ID } from "./api";
import { defaultVoteSettings } from "./data";
import type { RankedCandidate } from "./types";
import appLogo from "./img/logo.png";
import appText from "./img/文字.png";

const FAST_POLL_MS = 2000;
const SLOW_POLL_MS = 5000;
const LOTTERY_SCROLL_MS = 1500;

const RankCard = memo(function RankCard({ candidate }: { candidate: RankedCandidate }) {
  const animClass = candidate.rankChanged
    ? candidate.rank < candidate.prevRank
      ? " rank-up"
      : " rank-down"
    : "";

  return (
    <article
      className={`rank-card${animClass}`}
      style={{ animationDelay: `${(candidate.rank - 1) * 0.06}s` }}
      aria-label={`第${candidate.rank}名 ${candidate.name} ${candidate.voteCount}票`}
    >
      <div className={`rank-number rank-${candidate.rank}`} aria-hidden="true">
        {candidate.rank}
      </div>
      <img src={candidate.avatar} alt={candidate.name} className="rank-avatar" loading="lazy" />
      <div className="rank-info">
        <h3>{candidate.name}</h3>
        <p>{candidate.major} · 《{candidate.song}》</p>
      </div>
      <div className="rank-votes">
        <span className={`vote-count${candidate.voteDelta > 0 ? " vote-bump" : ""}`}>
          {candidate.voteCount}
        </span>
        <span className="vote-label">票</span>
        {candidate.voteDelta > 0 && (
          <span className="vote-delta" aria-label={`新增${candidate.voteDelta}票`}>
            +{candidate.voteDelta}
          </span>
        )}
      </div>
    </article>
  );
});

const BarChart = memo(function BarChart({
  candidates,
  maxVotes
}: {
  candidates: RankedCandidate[];
  maxVotes: number;
}) {
  return (
    <div className="dashboard-bar-chart" role="img" aria-label="投票数据柱状图">
      {candidates.map((c, i) => {
        const pct = maxVotes > 0 ? (c.voteCount / maxVotes) * 100 : 0;
        return (
          <div key={c.id} className="dashboard-bar-wrapper">
            <div className="dashboard-bar-value">{c.voteCount}</div>
            <div
              className={`dashboard-bar bar-color-${(i % 5) + 1}`}
              style={{ height: `${Math.max(pct, 2)}%` }}
            />
            <div className="dashboard-bar-label" title={c.name}>{c.name}</div>
          </div>
        );
      })}
    </div>
  );
});

const TREND_COLORS = ["#1f78d1", "#0f9373", "#e67e22", "#8e44ad", "#2c3e50"];
const MAX_HISTORY_POINTS = 30;

const TrendChart = memo(function TrendChart({
  history,
  topNames
}: {
  history: Array<Record<string, number> & { tick: number }>;
  topNames: string[];
}) {
  if (history.length < 2) {
    return (
      <div className="trend-chart-placeholder">
        <span>收集数据中，趋势图即将显示...</span>
      </div>
    );
  }

  return (
    <div className="trend-chart-wrapper" role="img" aria-label="票数趋势折线图">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={history} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(123,170,219,0.15)" />
          <XAxis
            dataKey="tick"
            tick={false}
            axisLine={{ stroke: "rgba(123,170,219,0.2)" }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#4e7399" }}
            axisLine={{ stroke: "rgba(123,170,219,0.2)" }}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: "rgba(255,255,255,0.95)",
              border: "1px solid rgba(123,170,219,0.25)",
              borderRadius: 8,
              fontSize: 13,
              boxShadow: "0 4px 16px rgba(0,0,0,0.08)"
            }}
            labelFormatter={() => ""}
          />
          {topNames.map((name, i) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={TREND_COLORS[i % TREND_COLORS.length]}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="trend-chart-legend">
        {topNames.map((name, i) => (
          <span key={name} className="trend-legend-item">
            <span
              className="trend-legend-dot"
              style={{ background: TREND_COLORS[i % TREND_COLORS.length] }}
            />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
});

const LotterySection = memo(function LotterySection({
  currentScrollWinner,
  displayedWinners
}: {
  currentScrollWinner: string | null;
  displayedWinners: string[];
}) {
  return (
    <section className="dashboard-section lottery-section" aria-live="polite">
      <h2 className="section-title">
        抽奖学号
        {displayedWinners.length > 0 && (
          <span className="lottery-count">共 {displayedWinners.length} 位</span>
        )}
      </h2>
      {currentScrollWinner ? (
        <div className="lottery-container">
          <div className="lottery-scroll-wrapper">
            <div className="lottery-item lottery-current">{currentScrollWinner}</div>
          </div>
        </div>
      ) : displayedWinners.length > 0 ? (
        <div className="lottery-container">
          <div className="lottery-scroll-wrapper">
            <div className="lottery-item">
              {displayedWinners[displayedWinners.length - 1]}
            </div>
          </div>
        </div>
      ) : (
        <div className="lottery-placeholder">
          <span>等待抽奖结果...</span>
        </div>
      )}
    </section>
  );
});

function hasDataChanged(
  prev: RankedCandidate[],
  next: Array<{ id: string; voteCount: number }>
): boolean {
  if (prev.length !== next.length) return true;
  const prevMap = new Map(prev.map((c) => [c.id, c.voteCount]));
  for (const c of next) {
    if (prevMap.get(c.id) !== c.voteCount) return true;
  }
  return false;
}

const DashboardApp = () => {
  const [candidates, setCandidates] = useState<RankedCandidate[]>([]);
  const [lotteryWinners, setLotteryWinners] = useState<string[]>([]);
  const [lotteryQueue, setLotteryQueue] = useState<string[]>([]);
  const [currentLotteryIndex, setCurrentLotteryIndex] = useState(0);
  const [status, setStatus] = useState<"active" | "closed">("active");
  const [lastUpdate, setLastUpdate] = useState("");
  const [title, setTitle] = useState(defaultVoteSettings.title);
  const [voteHistory, setVoteHistory] = useState<Array<Record<string, number> & { tick: number }>>([]);
  const prevVoteMap = useRef<Record<string, number>>({});
  const prevCandidatesRef = useRef<RankedCandidate[]>([]);
  const hasRecentActivity = useRef(false);
  const tickCounter = useRef(0);

  const tickLottery = useCallback(() => {
    setLotteryQueue((prev) => prev.slice(1));
    setCurrentLotteryIndex((prev) => prev + 1);
  }, []);

  // Poll with adaptive interval
  useEffect(() => {
    let disposed = false;
    let timerId = 0;

    const pullLatest = async () => {
      try {
        const config = await fetchEventConfig(RUNTIME_EVENT_ID);
        if (disposed) return;

        if (config.title !== title) setTitle(config.title);
        if (config.status !== status) setStatus(config.status);

        const sorted = [...config.candidates].sort((a, b) => b.voteCount - a.voteCount);

        // Skip state update if nothing changed
        if (!hasDataChanged(prevCandidatesRef.current, sorted)) {
          hasRecentActivity.current = false;
          return;
        }

        hasRecentActivity.current = true;

        // Record vote history snapshot for trend chart (Top 5 only)
        tickCounter.current += 1;
        const top5 = sorted.slice(0, 5);
        const snapshot: Record<string, number> & { tick: number } = { tick: tickCounter.current };
        for (const c of top5) {
          snapshot[c.name] = c.voteCount;
        }
        setVoteHistory((prev) => {
          const next = [...prev, snapshot];
          return next.length > MAX_HISTORY_POINTS ? next.slice(-MAX_HISTORY_POINTS) : next;
        });

        setCandidates((prev) => {
          const prevMap = new Map(prev.map((c) => [c.id, c]));
          const prevVotes = prevVoteMap.current;

          const ranked = sorted.map((candidate, index) => {
            const prevCandidate = prevMap.get(candidate.id);
            const prevRank = prevCandidate?.rank ?? index + 1;
            const oldVotes = prevVotes[candidate.id] ?? candidate.voteCount;

            return {
              ...candidate,
              rank: index + 1,
              prevRank,
              rankChanged: prevRank !== index + 1,
              voteDelta: candidate.voteCount - oldVotes
            };
          });

          const newVoteMap: Record<string, number> = {};
          for (const c of sorted) {
            newVoteMap[c.id] = c.voteCount;
          }
          prevVoteMap.current = newVoteMap;
          prevCandidatesRef.current = ranked;

          return ranked;
        });

        const newWinners = config.lotteryWinners ?? [];
        setLotteryWinners((prev) => {
          const prevSet = new Set(prev);
          const newOnes = newWinners.filter((id) => !prevSet.has(id));
          if (newOnes.length > 0) {
            setLotteryQueue((q) => [...q, ...newOnes]);
          }
          return newWinners;
        });

        setLastUpdate(new Date().toLocaleTimeString("zh-CN"));
      } catch {
        // silent on polling failures
      }
    };

    const scheduleNext = () => {
      if (disposed) return;
      const interval = hasRecentActivity.current ? FAST_POLL_MS : SLOW_POLL_MS;
      hasRecentActivity.current = false;
      timerId = window.setTimeout(() => {
        pullLatest().catch(() => {}).finally(() => scheduleNext());
      }, interval);
    };

    pullLatest();
    scheduleNext();

    return () => {
      disposed = true;
      window.clearTimeout(timerId);
    };
  }, []);

  // Scroll lottery queue one by one
  useEffect(() => {
    if (lotteryQueue.length === 0) return;
    const timer = setTimeout(tickLottery, LOTTERY_SCROLL_MS);
    return () => clearTimeout(timer);
  }, [lotteryQueue, tickLottery]);

  const totalVotes = useMemo(
    () => candidates.reduce((sum, c) => sum + c.voteCount, 0),
    [candidates]
  );

  const maxVotes = useMemo(
    () => Math.max(...candidates.map((c) => c.voteCount), 1),
    [candidates]
  );

  const topNames = useMemo(
    () => candidates.slice(0, 5).map((c) => c.name),
    [candidates]
  );

  const displayedWinners = useMemo(() => {
    const shown = lotteryWinners.filter((_, i) => i < currentLotteryIndex);
    return [...shown, ...lotteryQueue].length > 0 ? lotteryWinners : [];
  }, [lotteryWinners, currentLotteryIndex, lotteryQueue]);

  const currentScrollWinner = lotteryQueue.length > 0 ? lotteryQueue[0] : null;

  return (
    <main className="dashboard-page">
      <div className="aurora-layer aurora-layer-3" aria-hidden="true" />
      <header className="dashboard-header">
        <img src={appLogo} alt="学生社团管理中心" className="dashboard-logo" />
        <img src={appText} alt="学生社团管理中心" className="dashboard-text" />
        <h1 className="dashboard-title">{title} · 实时看板</h1>
        <div className="dashboard-status">
          <span className={`status-badge ${status}`} role="status">
            <span className={`status-dot ${status}`} aria-hidden="true" />
            <strong>{status === "active" ? "投票进行中" : "投票已关闭"}</strong>
          </span>
          {lastUpdate && <span className="update-time">更新: {lastUpdate}</span>}
        </div>
      </header>

      <div className="dashboard-body">
        <section className="dashboard-section" aria-label="实时排名">
          <h2 className="section-title">实时排名</h2>
          <div className="rank-list" role="list">
            {candidates.map((candidate) => (
              <RankCard key={candidate.id} candidate={candidate} />
            ))}
          </div>
        </section>

        <div className="dashboard-right">
          <section className="dashboard-section" aria-label="投票数据">
            <h2 className="section-title">投票数据</h2>
            <div className="dashboard-stats">
              <div className="dashboard-stat-card">
                <div className="stat-value">{totalVotes}</div>
                <div className="stat-label">总票数</div>
              </div>
              <div className="dashboard-stat-card">
                <div className="stat-value">{candidates.length}</div>
                <div className="stat-label">候选人数</div>
              </div>
              <div className="dashboard-stat-card">
                <div className="stat-value">{candidates[0]?.name ?? "--"}</div>
                <div className="stat-label">当前领先</div>
              </div>
            </div>
            <TrendChart history={voteHistory} topNames={topNames} />
          </section>

          <LotterySection
            currentScrollWinner={currentScrollWinner}
            displayedWinners={displayedWinners}
          />
        </div>
      </div>
    </main>
  );
};

export default DashboardApp;
