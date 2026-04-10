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
import appLogo from "./img/logo.png";
import appText from "./img/文字.png";

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

  // 学号输入弹窗状态
  const [showStudentIdModal, setShowStudentIdModal] = useState(false);
  const [studentIdInput, setStudentIdInput] = useState("");
  const [studentIdError, setStudentIdError] = useState("");

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

    // 显示学号输入弹窗
    setStudentIdInput("");
    setStudentIdError("");
    setShowStudentIdModal(true);
  };

  const validateAndSubmitVote = async () => {
    const trimmed = studentIdInput.trim();
    if (!(/^202[0-5]\d{8}$/.test(trimmed) || /^\d{5}$/.test(trimmed) || /^\d{8}$/.test(trimmed))) {
      setStudentIdError("请输入正确的学号 (5位/8位/12位)");
      return;
    }

    setShowStudentIdModal(false);
    setSubmitting(true);
    setMessage("正在提交投票...");
    appLog("vote:submit:begin", { eventId: voteSettings.eventId, selectedIds });

    try {
      const voterToken = await createVoterToken(voteSettings.eventId);
      const response = await submitVote({
        eventId: voteSettings.eventId,
        voterToken,
        studentId: trimmed,
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
              <img src={appLogo} alt="" className="logo-intro-mark" />
              <img src={appText} alt="" className="logo-intro-text-img" />
              <div className="logo-intro-progress">{loadingProgress}%</div>
            </div>
          </section>
        )}
        <main className={`vote-page ${introState !== "done" ? "is-loading-entrance" : ""} ${isFirstEntrance ? "is-first-entrance" : ""}`}>
          <header className="hero-panel">
            <div className="hero-head">
              <div className="hero-brand">
                <img src={appLogo} alt="活动Logo" className="school-logo" />
                <div>
                  <img src={appText} alt="活动文字" className="hero-tag-img" />
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
            <img src={appLogo} alt="" className="logo-intro-mark" />
            <img src={appText} alt="" className="logo-intro-text-img" />
            <div className="logo-intro-progress">{loadingProgress}%</div>
          </div>
        </section>
      )}
      <main className={`vote-page ${introState !== "done" ? "is-loading-entrance" : ""} ${isFirstEntrance ? "is-first-entrance" : ""}`}>
        <header className="hero-panel">
          <div className="hero-head">
            <div className="hero-brand">
              <img src={appLogo} alt="活动Logo" className="school-logo" />
              <div>
                <img src={appText} alt="活动文字" className="hero-tag-img" />
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
          <section className="chart-card" style={{ marginBottom: '1.5rem', background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
            <header className="section-header compact" style={{ borderBottom: '1px solid #ebebeb', paddingBottom: '0.5rem' }}>
              <h2 style={{ fontSize: '1.25rem', color: '#333' }}>🎟️ 当前抽奖名单</h2>
            </header>
            <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              {(voteSettings.lotteryWinners && voteSettings.lotteryWinners.length > 0) ? (
                <>
                  <p style={{ fontSize: '1rem', color: '#666', marginBottom: '1rem' }}>
                    恭喜以下 {voteSettings.lotteryWinners.length} 位中奖：
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px' }}>
                    {voteSettings.lotteryWinners.map((winnerId, idx) => (
                      <strong key={idx} style={{ 
                        fontSize: '1.4rem', 
                        color: '#fff', 
                        background: '#d32f2f',
                        padding: '8px 16px',
                        borderRadius: '8px',
                        letterSpacing: '1px',
                        display: 'inline-block'
                      }}>
                        {winnerId}
                      </strong>
                    ))}
                  </div>
                </>
              ) : (
                <p style={{ fontSize: '1rem', color: '#999' }}>等待后台开启抽签中...</p>
              )}
            </div>
          </section>

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

    {/* 学号输入弹窗 */}
    {showStudentIdModal && (
      <div 
        className="modal-overlay" 
        onClick={(e) => { if (e.target === e.currentTarget) setShowStudentIdModal(false); }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '16px'
        }}
      >
        <div 
          className="modal-content"
          style={{
            background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)',
            borderRadius: '20px',
            padding: '28px 24px',
            width: '100%',
            maxWidth: '360px',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.5) inset',
            animation: 'modal-in 0.3s ease-out'
          }}
        >
          <h3 style={{
            margin: '0 0 8px',
            fontSize: '1.3rem',
            color: '#0b213f',
            textAlign: 'center'
          }}>
            请输入学号
          </h3>
          <p style={{
            margin: '0 0 20px',
            fontSize: '0.9rem',
            color: '#4e7399',
            textAlign: 'center'
          }}>
            用于抽奖验证，请输入您的学号
          </p>

          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={12}
            placeholder="5位/8位/12位学号"
            value={studentIdInput}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, '').slice(0, 12);
              setStudentIdInput(val);
              if (val.length === 12 && !/^202[0-5]/.test(val)) {
                setStudentIdError("12位学号应以2020-2025开头");
              } else {
                setStudentIdError("");
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') validateAndSubmitVote();
            }}
            autoFocus
            style={{
              width: '100%',
              padding: '14px 16px',
              fontSize: '1.1rem',
              border: `2px solid ${studentIdError ? '#ff6b6b' : '#d0e3f3'}`,
              borderRadius: '12px',
              background: '#fff',
              outline: 'none',
              textAlign: 'center',
              letterSpacing: '1px',
              transition: 'border-color 0.2s',
              marginBottom: studentIdError ? '8px' : '20px'
            }}
          />

          {studentIdError && (
            <p style={{
              margin: '0 0 16px',
              color: '#ff6b6b',
              fontSize: '0.85rem',
              textAlign: 'center'
            }}>
              {studentIdError}
            </p>
          )}

          <div style={{
            display: 'flex',
            gap: '12px'
          }}>
            <button
              type="button"
              onClick={() => setShowStudentIdModal(false)}
              style={{
                flex: 1,
                padding: '14px 20px',
                border: '1px solid #d0e3f3',
                borderRadius: '12px',
                background: '#f0f7ff',
                color: '#4e7399',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={validateAndSubmitVote}
              disabled={studentIdInput.length !== 12}
              style={{
                flex: 1,
                padding: '14px 20px',
                border: 'none',
                borderRadius: '12px',
                background: studentIdInput.length === 12 
                  ? 'linear-gradient(125deg, #2082de 0%, #1165bb 100%)' 
                  : '#c5d8e8',
                color: '#fff',
                fontSize: '1rem',
                fontWeight: 700,
                cursor: studentIdInput.length === 12 ? 'pointer' : 'not-allowed',
                boxShadow: studentIdInput.length === 12 
                  ? '0 4px 12px rgba(32, 130, 222, 0.4)' 
                  : 'none'
              }}
            >
              确认投票
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default App;
