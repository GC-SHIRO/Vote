import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { fetchEventConfig, RUNTIME_EVENT_ID } from "./api";
import { defaultVoteSettings } from "./data";
import type { RankedCandidate } from "./types";
// import appLogo from "./img/logo.png";
// import appText from "./img/文字.png";

const FAST_POLL_MS = 2000;
const SLOW_POLL_MS = 5000;

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
  const candidateCount = candidates.length;

  return (
    <div className="dashboard-bar-chart" role="img" aria-label="投票数据柱状图">
      {candidates.map((c) => {
        const pct = maxVotes > 0 ? (c.voteCount / maxVotes) * 100 : 0;
        const scaledPct = Math.pow(pct / 100, 1.75) * 100;
        const rankRatio = candidateCount > 1 ? (c.rank - 1) / (candidateCount - 1) : 0;
        const barStyle = {
          height: `${Math.max(scaledPct, 1.2)}%`,
          "--bar-saturation": `${68 - rankRatio * 18}%`,
          "--bar-lightness-top": `${69 + rankRatio * 6}%`,
          "--bar-lightness-bottom": `${58 + rankRatio * 9}%`
        } as CSSProperties;

        return (
          <div key={c.id} className="dashboard-bar-wrapper">
            <div className="dashboard-bar-head">
              <span className="dashboard-bar-rank">#{c.rank}</span>
              <span className="dashboard-bar-value">{c.voteCount}</span>
            </div>
            <div className="dashboard-bar-track" aria-hidden="true">
              <div className="dashboard-bar" style={barStyle} />
            </div>
            <div className="dashboard-bar-label" title={c.name}>{c.name}</div>
          </div>
        );
      })}
    </div>
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
  const [status, setStatus] = useState<"active" | "closed">("active");
  const [lastUpdate, setLastUpdate] = useState("");
  const [title, setTitle] = useState(defaultVoteSettings.title);
  const prevVoteMap = useRef<Record<string, number>>({});
  const prevCandidatesRef = useRef<RankedCandidate[]>([]);
  const hasRecentActivity = useRef(false);

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
        const isCandidatesChanged = hasDataChanged(prevCandidatesRef.current, sorted);

        // Skip state update if nothing changed
        if (!isCandidatesChanged) {
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

  const totalVotes = useMemo(
    () => candidates.reduce((sum, c) => sum + c.voteCount, 0),
    [candidates]
  );

  const maxVotes = useMemo(
    () => Math.max(...candidates.map((c) => c.voteCount), 1),
    [candidates]
  );

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

        <section className="dashboard-section dashboard-data-section" aria-label="投票数据">
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
          </div>
        </section>
      </div>
    </main>
  );
};

export default DashboardApp;
