import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { fetchEventConfig, RUNTIME_EVENT_ID } from "./api";
import { defaultVoteSettings } from "./data";
import type { RankedCandidate } from "./types";
// import appLogo from "./img/logo.png";
// import appText from "./img/文字.png";

const FAST_POLL_MS = 2000;
const SLOW_POLL_MS = 5000;
const LOTTERY_REVEAL_MS = 2000;
const LOTTERY_SCRAMBLE_STEP_MS = 90;

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
      {candidates.map((c) => {
        const pct = maxVotes > 0 ? (c.voteCount / maxVotes) * 100 : 0;
        return (
          <div key={c.id} className="dashboard-bar-wrapper">
            <div className="dashboard-bar-head">
              <span className="dashboard-bar-rank">#{c.rank}</span>
              <span className="dashboard-bar-value">{c.voteCount}</span>
            </div>
            <div className="dashboard-bar-track" aria-hidden="true">
              <div
                className="dashboard-bar"
                style={{ height: `${Math.max(pct, 2)}%` }}
              />
            </div>
            <div className="dashboard-bar-label" title={c.name}>{c.name}</div>
          </div>
        );
      })}
    </div>
  );
});

function getPieSlicePath(
  cx: number,
  cy: number,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number
): string {
  const start = (Math.PI / 180) * (startAngleDeg - 90);
  const end = (Math.PI / 180) * (endAngleDeg - 90);

  const x1 = cx + radius * Math.cos(start);
  const y1 = cy + radius * Math.sin(start);
  const x2 = cx + radius * Math.cos(end);
  const y2 = cy + radius * Math.sin(end);

  const largeArcFlag = endAngleDeg - startAngleDeg > 180 ? 1 : 0;

  return [
    `M ${cx} ${cy}`,
    `L ${x1} ${y1}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
    "Z"
  ].join(" ");
}

const PIE_COLORS = ["#1c56b4", "#2f80ed", "#5aabe8", "#82c8f7", "#a8daf9", "#d6efff"];

const VotePieChart = memo(function VotePieChart({
  candidates,
  totalVotes
}: {
  candidates: RankedCandidate[];
  totalVotes: number;
}) {
  const pieData = useMemo(() => {
    const top = candidates.slice(0, 5).map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      value: candidate.voteCount
    }));
    const otherVotes = candidates.slice(5).reduce((sum, candidate) => sum + candidate.voteCount, 0);

    if (otherVotes > 0) {
      top.push({ id: "others", name: "其他", value: otherVotes });
    }

    return top.filter((item) => item.value > 0);
  }, [candidates]);

  let currentAngle = 0;

  return (
    <div className="dashboard-pie-panel" aria-label="票数占比">
      <div className="dashboard-pie-left">
        <h3 className="dashboard-pie-title">票数占比</h3>
        {totalVotes > 0 && pieData.length > 0 && (
          <div className="dashboard-pie-chart-wrap" role="img" aria-label="候选人票数占比饼图">
            <svg viewBox="0 0 240 240" className="dashboard-pie-chart" aria-hidden="true">
              <circle cx="120" cy="120" r="94" className="dashboard-pie-base" />
              {pieData.map((item, index) => {
                const sweep = (item.value / totalVotes) * 360;
                const startAngle = currentAngle;
                const endAngle = currentAngle + sweep;
                currentAngle = endAngle;

                if (sweep >= 359.99) {
                  return (
                    <circle
                      key={item.id}
                      cx="120"
                      cy="120"
                      r="94"
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  );
                }

                return (
                  <path
                    key={item.id}
                    d={getPieSlicePath(120, 120, 94, startAngle, endAngle)}
                    fill={PIE_COLORS[index % PIE_COLORS.length]}
                  />
                );
              })}
              <circle cx="120" cy="120" r="54" fill="#ffffff" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.05))" />
            </svg>
              <div className="dashboard-pie-center">
                <strong>{totalVotes}</strong>
                <span>总票数</span>
              </div>
            </div>
        )}
      </div>

      {totalVotes > 0 && pieData.length > 0 ? (
        <div className="dashboard-pie-legend">
          {pieData.map((item, index) => {
            const percent = (item.value / totalVotes) * 100;
            return (
              <div key={item.id} className="dashboard-pie-legend-row">
                <span
                  className="dashboard-pie-dot"
                  style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                  aria-hidden="true"
                />
                <span className="dashboard-pie-name" title={item.name}>{item.name}</span>
                <span className="dashboard-pie-percent">{percent.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="dashboard-pie-empty">暂无数据</div>
      )}
    </div>
  );
});

function ScrambleNumber({ targetText, duration = 1000 }: { targetText: string, duration?: number }) {
  const [displayText, setDisplayText] = useState(() => String(Math.floor(Math.random() * 800) + 1).padStart(3, "0"));
  const [isScrambling, setIsScrambling] = useState(true);

  useEffect(() => {
    setIsScrambling(true);
    setDisplayText(String(Math.floor(Math.random() * 800) + 1).padStart(3, "0"));

    const stopTimer = setTimeout(() => {
      setIsScrambling(false);
      setDisplayText(targetText);
    }, duration);

    return () => clearTimeout(stopTimer);
  }, [targetText, duration]);

  useEffect(() => {
    if (!isScrambling) return;

    const intervalId = setInterval(() => {
      const randomNum = Math.floor(Math.random() * 800) + 1;
      setDisplayText(String(randomNum).padStart(3, "0"));
    }, LOTTERY_SCRAMBLE_STEP_MS);

    return () => clearInterval(intervalId);
  }, [isScrambling]);

  return <>{displayText}</>;
}

const LotterySection = memo(function LotterySection({
  currentScrollWinner,
  displayList,
  totalWinners,
  currentRevealIndex,
  scrollAreaRef
}: {
  currentScrollWinner: string | null;
  displayList: string[];
  totalWinners: number;
  currentRevealIndex: number;
  scrollAreaRef: RefObject<HTMLDivElement | null>;
}) {
  const revealedCount = Math.min(displayList.length, totalWinners);

  return (
    <section className="dashboard-section lottery-section" aria-live="polite">
      <h2 className="section-title">
        抽奖学号
        {totalWinners > 0 && (
          <span className="lottery-count">
            已揭晓 {revealedCount} / {totalWinners}
          </span>
        )}
      </h2>

      {totalWinners > 0 ? (
        <div className="lottery-container">
          <div className="lottery-stage-meta">
            {currentScrollWinner ? (
              <span className="lottery-stage-badge">本轮第 {currentRevealIndex} 位</span>
            ) : (
              <span className="lottery-stage-finish">本轮揭晓完成</span>
            )}
          </div>

          <div className="lottery-scroll-mask" ref={scrollAreaRef}>
            <div className="lottery-scroll-wrapper">
              {displayList.map((winner, index) => {
                const isCurrent = currentScrollWinner !== null && index === displayList.length - 1;

                return (
                  <div
                    key={`${winner}-${index}`}
                    className={`lottery-item${isCurrent ? " lottery-current" : ""}`}
                  >
                    <span className="lottery-item-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="lottery-item-id">
                      {isCurrent ? (
                         <ScrambleNumber targetText={winner.padStart(3, "0")} duration={LOTTERY_REVEAL_MS} />
                      ) : (
                        winner.padStart(3, "0")
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="lottery-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="8" width="18" height="12" rx="2" />
            <path d="M12 8v12" />
            <path d="M16 8c0-1.5-1-3-3-3s-3 1.5-3 3" />
            <path d="M8 8c0-1.5 1-3 3-3s3 1.5 3 3" />
          </svg>
          <span className="lottery-placeholder-main">大奖揭晓，敬请期待</span>
          <span className="lottery-placeholder-sub">正在等待管理员开启抽奖...</span>
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
  const prevVoteMap = useRef<Record<string, number>>({});
  const prevCandidatesRef = useRef<RankedCandidate[]>([]);
  const prevLotteryWinnersStrRef = useRef<string>("[]");
  const hasRecentActivity = useRef(false);
  const lotteryScrollRef = useRef<HTMLDivElement | null>(null);

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
        const newWinnersStr = JSON.stringify(config.lotteryWinners ?? []);
        
        const isCandidatesChanged = hasDataChanged(prevCandidatesRef.current, sorted);
        const isLotteryChanged = newWinnersStr !== prevLotteryWinnersStrRef.current;

        // Skip state update if nothing changed
        if (!isCandidatesChanged && !isLotteryChanged) {
          hasRecentActivity.current = false;
          return;
        }

        hasRecentActivity.current = true;

        if (isCandidatesChanged) {
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
        } // close if (isCandidatesChanged)

        if (isLotteryChanged) {
          prevLotteryWinnersStrRef.current = newWinnersStr;
          const newWinners = config.lotteryWinners ?? [];
          setLotteryWinners((prev) => {
            const isSameList =
              prev.length === newWinners.length && prev.every((id, i) => id === newWinners[i]);
            if (isSameList) {
              return prev;
            }

          if (newWinners.length === 0) {
            setLotteryQueue([]);
            setCurrentLotteryIndex(0);
            return [];
          }

          const isAppendUpdate =
            newWinners.length >= prev.length && prev.every((id, i) => id === newWinners[i]);

          if (isAppendUpdate) {
            const appended = newWinners.slice(prev.length);
            if (appended.length > 0) {
              setLotteryQueue((q) => [...q, ...appended]);
            }
          } else {
            // A new draw round should replay reveal from the top.
            setLotteryQueue([...newWinners]);
            setCurrentLotteryIndex(0);
          }

          return newWinners;
        });
        } // close if (isLotteryChanged)

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

  // Keep queue advance aligned with the scramble duration so each number settles
  // before the next winner starts revealing.
  useEffect(() => {
    if (lotteryQueue.length === 0) return;
    const timer = setTimeout(tickLottery, LOTTERY_REVEAL_MS);
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

  const revealedWinners = useMemo(
    () => lotteryWinners.slice(0, currentLotteryIndex),
    [lotteryWinners, currentLotteryIndex]
  );

  const currentScrollWinner = lotteryQueue.length > 0 ? lotteryQueue[0] : null;

  const lotteryDisplayList = useMemo(
    () => (currentScrollWinner ? [...revealedWinners, currentScrollWinner] : revealedWinners),
    [revealedWinners, currentScrollWinner]
  );

  const currentRevealIndex = useMemo(() => {
    if (!currentScrollWinner) return 0;
    return Math.min(revealedWinners.length + 1, lotteryWinners.length);
  }, [currentScrollWinner, revealedWinners.length, lotteryWinners.length]);

  useEffect(() => {
    const node = lotteryScrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
  }, [lotteryDisplayList.length]);

  return (
    <main className="dashboard-page">
      {/* 现代环境动效图层 */}
      <div className="aurora-layer aurora-layer-3" aria-hidden="true" />
      {/* 粒子漂浮层 */}
      <div className="particle-fx" style={{ width: '10px', height: '10px', left: '15%', animationDuration: '18s', animationDelay: '0s' }} aria-hidden="true" />
      <div className="particle-fx" style={{ width: '8px', height: '8px', left: '35%', animationDuration: '24s', animationDelay: '4s' }} aria-hidden="true" />
      <div className="particle-fx" style={{ width: '14px', height: '14px', left: '60%', animationDuration: '20s', animationDelay: '2s' }} aria-hidden="true" />
      <div className="particle-fx" style={{ width: '12px', height: '12px', left: '80%', animationDuration: '28s', animationDelay: '6s' }} aria-hidden="true" />
      <div className="particle-fx" style={{ width: '9px', height: '9px', left: '90%', animationDuration: '22s', animationDelay: '10s' }} aria-hidden="true" />

      <header className="dashboard-header">
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
          <div className="rank-list-watermark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            <span>TOP SINGER</span>
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
            <div className="dashboard-visuals">
              <BarChart candidates={candidates} maxVotes={maxVotes} />
              <VotePieChart candidates={candidates} totalVotes={totalVotes} />
            </div>
          </section>

          <LotterySection
            currentScrollWinner={currentScrollWinner}
            displayList={lotteryDisplayList}
            totalWinners={lotteryWinners.length}
            currentRevealIndex={currentRevealIndex}
            scrollAreaRef={lotteryScrollRef}
          />
        </div>
      </div>
    </main>
  );
};

export default DashboardApp;
