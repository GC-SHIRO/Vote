import { useEffect, useMemo, useState } from "react";
import {
  createVoterToken,
  fetchEventConfig,
  fetchResults,
  IS_MOCK_MODE,
  RUNTIME_EVENT_ID,
  submitVote
} from "./api";
import { defaultVoteSettings } from "./data";
import sztuLogo from "./img/log.svg";

const FIRST_ENTRANCE_KEY = "vote-page-first-entrance-v1";
const APP_DEBUG_PREFIX = "[VoteDebug][App]";

const appLog = (...args: unknown[]) => {
  console.log(APP_DEBUG_PREFIX, ...args);
};

const App = () => {
  const [voteSettings, setVoteSettings] = useState(defaultVoteSettings);
  const [configReady, setConfigReady] = useState(IS_MOCK_MODE);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("请选择你支持的选手");
  const [hasVoted, setHasVoted] = useState(false);
  const [results, setResults] = useState<Record<string, number>>({});
  const [isFirstEntrance, setIsFirstEntrance] = useState(false);

  const selectionMode = voteSettings.selectionMode ?? "single";
  const maxSelections = selectionMode === "single" ? 1 : voteSettings.maxSelections ?? 1;

  const syncResults = async (eventId: string) => {
    const response = await fetchResults(eventId);
    const nextResults = response.candidates.reduce<Record<string, number>>((accumulator, candidate) => {
      accumulator[candidate.id] = candidate.voteCount;
      return accumulator;
    }, {});
    setResults(nextResults);
  };

  useEffect(() => {
    let disposed = false;
    let timerId = 0;
    appLog("bootstrap:start", { eventId: RUNTIME_EVENT_ID });

    const bootstrap = async () => {
      try {
        const pullLatest = async () => {
          appLog("poll:config:start", { eventId: RUNTIME_EVENT_ID });
          const dynamicConfig = await fetchEventConfig(RUNTIME_EVENT_ID);
          if (disposed) {
            return;
          }

          setVoteSettings(dynamicConfig);
          appLog("poll:config:done", {
            eventId: dynamicConfig.eventId,
            status: dynamicConfig.status,
            candidates: dynamicConfig.candidates.length,
            resultVisible: dynamicConfig.resultVisible
          });

          if (dynamicConfig.resultVisible) {
            appLog("poll:results:start", { eventId: dynamicConfig.eventId });
            await syncResults(dynamicConfig.eventId);
            appLog("poll:results:done", { eventId: dynamicConfig.eventId });
          }
        };

        const scheduleNextPull = () => {
          if (disposed) {
            return;
          }

          timerId = window.setTimeout(() => {
            pullLatest()
              .catch(() => {
                // keep silent on polling failures
              })
              .finally(() => {
                scheduleNextPull();
              });
          }, 5000);
        };

        await pullLatest();
        setConfigReady(true);
        appLog("bootstrap:ready");
        scheduleNextPull();
      } catch {
        if (!disposed) {
          setMessage("配置或结果加载失败，稍后仍可正常提交投票");
          setConfigReady(true);
          appLog("bootstrap:error");
        }
      }
    };

    bootstrap();

    return () => {
      disposed = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
    };
  }, []);

  const [loadingProgress, setLoadingProgress] = useState(0);
  const [introState, setIntroState] = useState<"loading" | "sliding" | "done">("done");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const alreadyPlayed = window.sessionStorage.getItem(FIRST_ENTRANCE_KEY) === "1";
      if (alreadyPlayed) {
        setIsFirstEntrance(false);
        return;
      }

      setIntroState("loading");
      setIsFirstEntrance(false); // 延迟到 sliding 之后才触发首屏动画
      
      let progress = 0;
      const intervalId = window.setInterval(() => {
        progress += Math.floor(Math.random() * 12) + 6;
        if (progress > 97) progress = 97;
        setLoadingProgress(progress);
      }, 100);

      const timerId = window.setTimeout(() => {
        setLoadingProgress(100);
        window.clearInterval(intervalId);
        
        window.setTimeout(() => {
          setIntroState("sliding"); // Logo 开始飞出，色块平移离开
          
          window.setTimeout(() => {
            setIntroState("done"); // 色块完全离开
            setIsFirstEntrance(true); // 开始组件飞入动画
            
            // 首屏动画结束后，清理类名（让重置正常）
            window.setTimeout(() => setIsFirstEntrance(false), 1200);

            try {
              window.sessionStorage.setItem(FIRST_ENTRANCE_KEY, "1");
            } catch {
              // ignore storage write failures
            }
          }, 800); // 留给滑动和透明度降低的动画时间
        }, 500); // 留时间给 logo 飞出，进度 100% 后停顿 0.5s
      }, 1500); // 总共加载时间设为 1.5s

      return () => {
        window.clearInterval(intervalId);
        window.clearTimeout(timerId);
      };
    } catch {
      setIsFirstEntrance(false);
      // ignore storage read failures
    }
  }, []);

  useEffect(() => {
    const activeIds = new Set(voteSettings.candidates.map((candidate) => candidate.id));
    const allowedCount = selectionMode === "single" ? 1 : maxSelections;
    setSelectedIds((current) => {
      const next = current.filter((id) => activeIds.has(id));
      return next.length > allowedCount ? next.slice(0, allowedCount) : next;
    });
  }, [voteSettings.candidates, selectionMode, maxSelections]);

  const candidates = useMemo(
    () =>
      voteSettings.candidates.map((candidate) => ({
        ...candidate,
        voteCount: results[candidate.id] ?? candidate.voteCount
      })),
    [voteSettings, results]
  );

  const totalVotes = useMemo(
    () => candidates.reduce((sum, candidate) => sum + candidate.voteCount, 0),
    [candidates]
  );

  const sortedCandidates = useMemo(
    () => [...candidates].sort((left, right) => right.voteCount - left.voteCount),
    [candidates]
  );

  const leaderVotes = sortedCandidates[0]?.voteCount ?? 0;
  const leaderCandidate = sortedCandidates[0];
  const isErrorMessage = /失败|异常|未成功|重试/.test(message);
  const leaderShare = totalVotes === 0 ? 0 : (leaderVotes / totalVotes) * 100;

  const voteBreakdown = useMemo(() => {
    const baseBreakdown = sortedCandidates.map((candidate, index) => {
      const previousVotes = index === 0 ? candidate.voteCount : sortedCandidates[index - 1].voteCount;

      return {
        ...candidate,
        rank: index + 1,
        shareRaw: totalVotes === 0 ? 0 : (candidate.voteCount / totalVotes) * 100,
        gap: Math.max(0, previousVotes - candidate.voteCount)
      };
    });

    if (baseBreakdown.length === 0) {
      return baseBreakdown.map((item) => ({ ...item, shareDisplay: 0 }));
    }

    const rounded = baseBreakdown.map((item) => Number(item.shareRaw.toFixed(1)));
    const roundedSum = rounded.reduce((sum, value) => sum + value, 0);
    const diff = Number((100 - roundedSum).toFixed(1));
    const maxIndex = baseBreakdown.reduce(
      (max, item, index, array) => (item.shareRaw > array[max].shareRaw ? index : max),
      0
    );

    return baseBreakdown.map((item, index) => ({
      ...item,
      shareDisplay: index === maxIndex ? Number((rounded[index] + diff).toFixed(1)) : rounded[index]
    }));
  }, [sortedCandidates, totalVotes]);

  const pieChartPaths = useMemo(() => {
    let currentAngle = -90;
    return voteBreakdown.map((candidate) => {
      const angle = (candidate.shareRaw / 100) * 360;
      const startAngleInRads = (currentAngle * Math.PI) / 180;
      const endAngleInRads = ((currentAngle + angle) * Math.PI) / 180;

      const cx = 50;
      const cy = 50;
      const r = 40;

      const startX = cx + r * Math.cos(startAngleInRads);
      const startY = cy + r * Math.sin(startAngleInRads);
      const endX = cx + r * Math.cos(endAngleInRads);
      const endY = cy + r * Math.sin(endAngleInRads);

      const largeArcFlag = angle > 180 ? 1 : 0;

      const pathData = [
        `M ${cx} ${cy}`,
        `L ${startX} ${startY}`,
        `A ${r} ${r} 0 ${largeArcFlag} 1 ${endX} ${endY}`,
        "Z"
      ].join(" ");

      currentAngle += angle;
      return { id: candidate.id, pathData };
    });
  }, [voteBreakdown]);

  const onPickCandidate = (candidateId: string) => {
    if (hasVoted) {
      return;
    }

    if (selectionMode === "single") {
      setSelectedIds([candidateId]);
      return;
    }

    setSelectedIds((current) => {
      if (current.includes(candidateId)) {
        return current.filter((id) => id !== candidateId);
      }

      if (current.length >= maxSelections) {
        setMessage(`多选模式最多可选 ${maxSelections} 位选手`);
        return current;
      }

      return [...current, candidateId];
    });
  };

  const handleVote = async () => {
    appLog("vote:click", {
      selectedCount: selectedIds.length,
      selectedIds,
      status: voteSettings.status,
      selectionMode,
      maxSelections,
      hasVoted
    });

    if (selectedIds.length === 0) {
      setMessage(selectionMode === "single" ? "提交前请先选择一位选手" : "请至少选择一位选手");
      return;
    }

    if (selectionMode === "multi" && selectedIds.length > maxSelections) {
      setMessage(`最多可选择 ${maxSelections} 位选手`);
      return;
    }

    if (hasVoted) {
      return;
    }

    setSubmitting(true);
    setMessage("正在提交投票...");
    appLog("vote:submit:begin", { eventId: voteSettings.eventId, selectedIds });

    try {
      const voterToken = await createVoterToken(voteSettings.eventId);
      const response = await submitVote({
        eventId: voteSettings.eventId,
        voterToken,
        ...(selectionMode === "single"
          ? { candidateId: selectedIds[0] }
          : { candidateIds: selectedIds })
      });

      if (!response.success) {
        appLog("vote:submit:failed-response", { message: response.message });
        setMessage(response.message || "投票未成功，请稍后重试");
        return;
      }

      setHasVoted(true);
      setMessage(response.message);
      appLog("vote:submit:success", {
        message: response.message,
        totalVotes: response.totalVotes,
        acceptedCount: response.acceptedCount
      });

      if (voteSettings.resultVisible) {
        try {
          await syncResults(voteSettings.eventId);
        } catch {
          setResults((current) => {
            const next = { ...current };
            for (const id of selectedIds) {
              next[id] = (next[id] ?? 0) + 1;
            }
            return next;
          });
        }
      }
    } catch (error) {
      appLog("vote:submit:error", {
        error: error instanceof Error ? error.message : String(error)
      });
      setMessage(error instanceof Error ? error.message : "网络异常，请稍后再试");
    } finally {
      setSubmitting(false);
      appLog("vote:submit:finally");
    }
  };

  const selectedCandidates = candidates.filter((candidate) => selectedIds.includes(candidate.id));

  if (!configReady) {
    return (
      <>
        {introState !== "done" && (
          <section className={`logo-intro ${introState === "sliding" ? "is-sliding" : ""}`} aria-hidden="true">
            <div className="logo-intro-core">
              <img src={sztuLogo} alt="" className="logo-intro-mark" />
              <p className="logo-intro-text">Shenzhen Technology University</p>
              <div className="logo-intro-progress">{loadingProgress}%</div>
            </div>
          </section>
        )}
        <main className={`vote-page ${introState !== "done" ? "is-loading-entrance" : ""} ${isFirstEntrance ? "is-first-entrance" : ""}`}>
          <header className="hero-panel">
            <div className="hero-head">
              <div className="hero-brand">
                <img src={sztuLogo} alt="深圳技术大学校徽" className="school-logo" />
                <div>
                  <p className="hero-tag">Shenzhen Technology University</p>
                  <h1>校园十大歌手大赛</h1>
                  <p>正在加载最新活动配置...</p>
                </div>
              </div>
            </div>
          </header>
        </main>
      </>
    );
  }

  return (
    <>
      {introState !== "done" && (
        <section className={`logo-intro ${introState === "sliding" ? "is-sliding" : ""}`} aria-hidden="true">
          <div className="logo-intro-core">
            <img src={sztuLogo} alt="" className="logo-intro-mark" />
            <p className="logo-intro-text">Shenzhen Technology University</p>
            <div className="logo-intro-progress">{loadingProgress}%</div>
          </div>
        </section>
      )}
      <main className={`vote-page ${introState !== "done" ? "is-loading-entrance" : ""} ${isFirstEntrance ? "is-first-entrance" : ""}`}>
        <header className="hero-panel">
          <div className="hero-head">
            <div className="hero-brand">
              <img src={sztuLogo} alt="深圳技术大学校徽" className="school-logo" />
              <div>
                <p className="hero-tag">Shenzhen Technology University</p>
                <h1>{voteSettings.title}</h1>
                <p>{voteSettings.subtitle}</p>
              </div>
          </div>

          <div
            className={`hero-badge ${voteSettings.status === "active" ? "active" : "closed"}`}
            aria-label="活动状态"
          >
            <span className={`hero-dot ${voteSettings.status}`} aria-hidden="true" />
            <strong>{voteSettings.status === "active" ? "投票进行中" : "投票已关闭"}</strong>
          </div>
        </div>

        <div className="hero-stats">
          <article>
            <span>候选人数</span>
            <strong>{candidates.length}</strong>
          </article>
          <article>
            <span>总票数</span>
            <strong>{totalVotes}</strong>
          </article>
          <article>
            <span>领先选手</span>
            <strong>{leaderCandidate?.name ?? "--"}</strong>
          </article>
          <article>
            <span>投票规则</span>
            <strong>{selectionMode === "single" ? "单选" : `多选(${maxSelections})`}</strong>
          </article>
        </div>

        <section className="hero-progress" aria-label="总票数占比分布">
          <div className="hero-progress-head">
            <h3>总票数占比分布</h3>
            <strong>{totalVotes === 0 ? "0.0%" : `${leaderShare.toFixed(1)}%`}</strong>
          </div>
          <div className="hero-progress-track" aria-hidden="true">
            {voteBreakdown.map((candidate) => (
              <div
                key={`share-${candidate.id}`}
                className="hero-progress-segment"
                style={{ width: `${candidate.shareRaw}%` }}
                title={`${candidate.name} ${candidate.shareDisplay.toFixed(1)}%`}
              />
            ))}
          </div>
          <div className="hero-progress-legend">
            {voteBreakdown.map((candidate, index) => (
              <span key={`legend-${candidate.id}`}>
                <i aria-hidden="true" className={`legend-dot rank-${index + 1}`} />
                {candidate.name} {candidate.shareDisplay.toFixed(1)}%
              </span>
            ))}
          </div>
        </section>
      </header>

      <section className="layout-main">
        <section className="candidates-panel">
          <header className="section-header">
            <h2>候选选手</h2>
            <p>
              {selectionMode === "single"
                ? "选择一位你最支持的选手，右侧完成最终确认。"
                : `最多可选择 ${maxSelections} 位选手，右侧完成最终确认。`}
            </p>
          </header>

          <div className="candidate-grid" role="group" aria-label="候选人列表">
            {candidates.map((candidate, index) => {
              const checked = selectedIds.includes(candidate.id);

              return (
                <label
                  key={candidate.id}
                  className={`candidate-card ${checked ? "is-active" : ""} ${hasVoted ? "is-locked" : ""}`}
                >
                  <input
                    type={selectionMode === "single" ? "radio" : "checkbox"}
                    name={selectionMode === "single" ? "candidate" : `candidate-${candidate.id}`}
                    value={candidate.id}
                    checked={checked}
                    disabled={hasVoted}
                    onChange={() => onPickCandidate(candidate.id)}
                    aria-label={`选择${candidate.name}`}
                  />
                  <div className="candidate-rank">#{index + 1}</div>
                  <img src={candidate.avatar} alt={candidate.name} />
                  <div className="candidate-content">
                    <div className="candidate-line">
                      <h3>{candidate.name}</h3>
                      <span>{candidate.voteCount} 票</span>
                    </div>
                    <p>《{candidate.song}》</p>
                    <div className="candidate-meta">
                      <span>{candidate.major}</span>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="rule-box">
            <strong>活动说明</strong>
            <span>{voteSettings.ruleText}</span>
          </div>
        </section>

        <aside className="side-panel">
          <section className="chart-card">
            <header className="section-header compact">
              <h2>实时榜单</h2>
              <p>领先者与票数差距一目了然</p>
            </header>

            <div className="chart-ranks">
              {voteBreakdown.map((candidate) => (
                <article key={`rank-${candidate.id}`} className={`rank-row rank-${candidate.rank}`}>
                  <div className="rank-badge">{candidate.rank}</div>
                  <div className="rank-info">
                    <span>{candidate.name}</span>
                    <small>{totalVotes === 0 ? "0%" : `${candidate.shareDisplay.toFixed(1)}%`}</small>
                  </div>
                  <strong>{candidate.voteCount}</strong>
                  {candidate.gap > 0 && <p className="rank-gap">距离上一名: {candidate.gap} 票</p>}
                </article>
              ))}
            </div>

            <div className="pie-box" aria-label="票数份额饼图">
              <svg viewBox="0 0 100 100" role="img" aria-label="候选人票数份额分布">
                {pieChartPaths.map((slice, i) => (
                  <path
                    key={`pie-${slice.id}`}
                    d={slice.pathData}
                    className={`pie-slice pie-color-${(voteBreakdown.length - 1 - i) % 5 + 1}`}
                  />
                ))}
              </svg>
            </div>
          </section>

          <section className="vote-panel">
            <header className="section-header">
              <h2>确认投票</h2>
              <p>提交后将自动绑定当前设备指纹，不可重复投票。</p>
            </header>

            <div className="picked-driver">
              <span>当前选择</span>
              <strong>
                {selectedCandidates.length > 0
                  ? selectedCandidates.map((item) => item.name).join("、")
                  : "未选择选手"}
              </strong>
              <p>
                {selectedCandidates.length > 0
                  ? selectedCandidates
                      .map((item) => `${item.major} · 《${item.song}》`)
                      .join(" / ")
                  : "请先从左侧候选列表中选择选手"}
              </p>
            </div>

            <button
              className="primary-button"
              type="button"
              onClick={handleVote}
              disabled={submitting || hasVoted || voteSettings.status === "closed"}
            >
              {voteSettings.status === "closed"
                ? "投票已结束"
                : hasVoted
                  ? "已完成投票"
                  : submitting
                    ? "提交中..."
                    : voteSettings.voteButtonText}
            </button>

            <p
              className={`feedback ${hasVoted ? "success" : ""} ${isErrorMessage ? "error" : ""}`}
              role={isErrorMessage ? "alert" : "status"}
              aria-live="polite"
            >
              {message}
            </p>

            <div className="api-note">
              <h3>投票流程</h3>
              <ul>
                <li>选择你支持的选手</li>
                <li>系统生成唯一设备凭证</li>
                <li>后端去重并记录票数</li>
              </ul>
            </div>
          </section>
        </aside>
      </section>
    </main>
    </>
  );
};

export default App;
