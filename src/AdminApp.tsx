import { useEffect, useMemo, useState } from "react";
import {
  createAdminCandidate,
  deleteAdminCandidate,
  fetchAdminConfig,
  RUNTIME_EVENT_ID,
  updateAdminCandidate,
  updateAdminConfig,
  uploadAvatar
} from "./api";
import { defaultVoteSettings } from "./data";
import type { AdminCandidate, AdminConfig } from "./types";

type CandidateDraft = {
  id: string;
  name: string;
  academy: string;
  major: string;
  song: string;
  avatarUrl: string;
  displayOrder: number;
  status: "active" | "inactive";
  uploading?: boolean;
};

const toDraft = (item: AdminCandidate): CandidateDraft => ({
  id: item.id,
  name: item.name,
  academy: item.academy ?? "",
  major: item.major ?? "",
  song: item.song ?? "",
  avatarUrl: item.avatarUrl ?? "",
  displayOrder: item.displayOrder,
  status: item.status,
  uploading: false
});

const emptyCandidate = (): CandidateDraft => ({
  id: "",
  name: "",
  academy: "",
  major: "",
  song: "",
  avatarUrl: "",
  displayOrder: 99,
  status: "active",
  uploading: false
});

const toDateTimeLocalValue = (value: string | null) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
};

const fromDateTimeLocalValue = (value: string) => {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
};

const AdminApp = () => {
  const eventId = RUNTIME_EVENT_ID || defaultVoteSettings.eventId;
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [message, setMessage] = useState("正在加载后台配置...");

  const [status, setStatus] = useState<"active" | "closed" | "draft">("active");
  const [selectionMode, setSelectionMode] = useState<"single" | "multi">("single");
  const [maxSelections, setMaxSelections] = useState(1);
  const [resultVisible, setResultVisible] = useState(true);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const [candidates, setCandidates] = useState<CandidateDraft[]>([]);
  const [newCandidate, setNewCandidate] = useState<CandidateDraft>(emptyCandidate);
  const [savingCandidateId, setSavingCandidateId] = useState<string>("");

  const activeCount = useMemo(
    () => candidates.filter((item) => item.status === "active").length,
    [candidates]
  );

  const loadConfig = async () => {
    setLoading(true);
    try {
      const config = await fetchAdminConfig(eventId);
      setStatus(config.status);
      setSelectionMode(config.selectionMode);
      setMaxSelections(config.maxSelections);
      setResultVisible(config.resultVisible);
      setStartTime(toDateTimeLocalValue(config.startTime));
      setEndTime(toDateTimeLocalValue(config.endTime));
      setCandidates(config.candidates.map(toDraft));
      setMessage("配置加载完成");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "后台配置加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const saveConfig = async (nextStatus?: "active" | "closed" | "draft") => {
    setSavingConfig(true);
    try {
      await updateAdminConfig({
        eventId,
        status: nextStatus ?? status,
        selectionMode,
        maxSelections: selectionMode === "single" ? 1 : maxSelections,
        resultVisible,
        startTime: fromDateTimeLocalValue(startTime),
        endTime: fromDateTimeLocalValue(endTime)
      });
      if (nextStatus) {
        setStatus(nextStatus);
      }
      setMessage("活动配置已保存");
      await loadConfig();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "配置保存失败");
    } finally {
      setSavingConfig(false);
    }
  };

  const onUploadAvatar = async (file: File, targetId: string) => {
    setCandidates((current) =>
      current.map((item) => (item.id === targetId ? { ...item, uploading: true } : item))
    );

    try {
      const url = await uploadAvatar(file);
      setCandidates((current) =>
        current.map((item) =>
          item.id === targetId ? { ...item, avatarUrl: url, uploading: false } : item
        )
      );
      setMessage("头像上传成功");
    } catch (error) {
      setCandidates((current) =>
        current.map((item) => (item.id === targetId ? { ...item, uploading: false } : item))
      );
      setMessage(error instanceof Error ? error.message : "头像上传失败");
    }
  };

  const saveCandidate = async (item: CandidateDraft) => {
    setSavingCandidateId(item.id);
    try {
      await updateAdminCandidate(item.id, {
        eventId,
        name: item.name,
        academy: item.academy,
        major: item.major,
        song: item.song,
        avatarUrl: item.avatarUrl,
        displayOrder: item.displayOrder,
        status: item.status
      });
      setMessage(`候选人 ${item.name} 已更新`);
      await loadConfig();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "候选人更新失败");
    } finally {
      setSavingCandidateId("");
    }
  };

  const removeCandidate = async (item: CandidateDraft) => {
    if (!window.confirm(`确认删除候选人 ${item.name} ?`)) {
      return;
    }

    setSavingCandidateId(item.id);
    try {
      await deleteAdminCandidate(eventId, item.id);
      setMessage(`候选人 ${item.name} 已删除`);
      await loadConfig();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "候选人删除失败");
    } finally {
      setSavingCandidateId("");
    }
  };

  const createCandidate = async () => {
    if (!newCandidate.name.trim()) {
      setMessage("新增候选人需填写姓名");
      return;
    }

    setSavingCandidateId("new");
    try {
      await createAdminCandidate({
        eventId,
        name: newCandidate.name,
        academy: newCandidate.academy,
        major: newCandidate.major,
        song: newCandidate.song,
        avatarUrl: newCandidate.avatarUrl,
        displayOrder: newCandidate.displayOrder,
        status: newCandidate.status
      });
      setNewCandidate(emptyCandidate());
      setMessage("候选人创建成功");
      await loadConfig();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "候选人创建失败");
    } finally {
      setSavingCandidateId("");
    }
  };

  const changeCandidate = (id: string, patch: Partial<CandidateDraft>) => {
    setCandidates((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  return (
    <main className="admin-page">
      <header className="admin-hero">
        <div>
          <p className="admin-tag">Admin Panel</p>
          <h1>投票活动后台管理</h1>
          <p>快速配置单选/多选规则、启停活动状态，并维护候选人信息。</p>
        </div>
        <a href="/" className="jump-link">
          前往投票页
        </a>
      </header>

      <section className="admin-grid">
        <article className="admin-card">
          <h2>活动配置</h2>
          <div className="form-grid">
            <label>
              投票状态
              <select value={status} onChange={(event) => setStatus(event.target.value as "active" | "closed" | "draft") }>
                <option value="active">进行中</option>
                <option value="closed">已关闭</option>
                <option value="draft">未开始</option>
              </select>
            </label>

            <label>
              投票模式
              <select
                value={selectionMode}
                onChange={(event) => setSelectionMode(event.target.value as "single" | "multi")}
              >
                <option value="single">单选</option>
                <option value="multi">多选</option>
              </select>
            </label>

            <label>
              限选人数
              <input
                type="number"
                min={1}
                value={selectionMode === "single" ? 1 : maxSelections}
                disabled={selectionMode === "single"}
                onChange={(event) => setMaxSelections(Math.max(1, Number(event.target.value) || 1))}
              />
            </label>

            <label>
              开始时间
              <input
                type="datetime-local"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </label>

            <label>
              结束时间
              <input
                type="datetime-local"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </label>

            <label className="switch-row">
              <input
                type="checkbox"
                checked={resultVisible}
                onChange={(event) => setResultVisible(event.target.checked)}
              />
              实时结果可见
            </label>
          </div>

          <div className="action-row">
            <button type="button" onClick={() => saveConfig("active")} disabled={savingConfig || loading}>
              快速开始投票
            </button>
            <button type="button" onClick={() => saveConfig("closed")} disabled={savingConfig || loading}>
              快速停止投票
            </button>
            <button type="button" className="primary" onClick={() => saveConfig()} disabled={savingConfig || loading}>
              保存配置
            </button>
          </div>

          <p className="hint">当前活跃候选人: {activeCount} 人</p>
        </article>

        <article className="admin-card">
          <h2>新增候选人</h2>
          <div className="candidate-editor">
            <input
              placeholder="姓名"
              value={newCandidate.name}
              onChange={(event) => setNewCandidate((current) => ({ ...current, name: event.target.value }))}
            />
            <input
              placeholder="学院"
              value={newCandidate.academy}
              onChange={(event) => setNewCandidate((current) => ({ ...current, academy: event.target.value }))}
            />
            <input
              placeholder="专业"
              value={newCandidate.major}
              onChange={(event) => setNewCandidate((current) => ({ ...current, major: event.target.value }))}
            />
            <input
              placeholder="歌名"
              value={newCandidate.song}
              onChange={(event) => setNewCandidate((current) => ({ ...current, song: event.target.value }))}
            />
            <input
              placeholder="头像 URL（可选）"
              value={newCandidate.avatarUrl}
              onChange={(event) => setNewCandidate((current) => ({ ...current, avatarUrl: event.target.value }))}
            />
            <input
              type="number"
              placeholder="排序"
              value={newCandidate.displayOrder}
              onChange={(event) =>
                setNewCandidate((current) => ({ ...current, displayOrder: Number(event.target.value) || 99 }))
              }
            />
            <button type="button" className="primary" onClick={createCandidate} disabled={savingCandidateId === "new" || loading}>
              新增候选人
            </button>
          </div>
        </article>
      </section>

      <section className="admin-list">
        <h2>候选人管理</h2>
        {loading && <p>加载中...</p>}
        {!loading && candidates.length === 0 && <p>暂无候选人</p>}

        {candidates.map((item) => (
          <article key={item.id} className="candidate-item">
            <div className="avatar-col">
              {item.avatarUrl ? <img src={item.avatarUrl} alt={item.name} /> : <div className="avatar-placeholder">无头像</div>}
              <label className="upload-btn">
                {item.uploading ? "上传中..." : "上传头像"}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      onUploadAvatar(file, item.id);
                    }
                  }}
                />
              </label>
            </div>

            <div className="candidate-fields">
              <input value={item.name} placeholder="姓名" onChange={(event) => changeCandidate(item.id, { name: event.target.value })} />
              <input value={item.academy} placeholder="学院" onChange={(event) => changeCandidate(item.id, { academy: event.target.value })} />
              <input value={item.major} placeholder="专业" onChange={(event) => changeCandidate(item.id, { major: event.target.value })} />
              <input value={item.song} placeholder="歌名" onChange={(event) => changeCandidate(item.id, { song: event.target.value })} />
              <input value={item.avatarUrl} placeholder="头像 URL" onChange={(event) => changeCandidate(item.id, { avatarUrl: event.target.value })} />
              <input
                type="number"
                value={item.displayOrder}
                placeholder="排序"
                onChange={(event) => changeCandidate(item.id, { displayOrder: Number(event.target.value) || 99 })}
              />
              <select value={item.status} onChange={(event) => changeCandidate(item.id, { status: event.target.value as "active" | "inactive" })}>
                <option value="active">启用</option>
                <option value="inactive">停用</option>
              </select>
            </div>

            <div className="candidate-actions">
              <button
                type="button"
                className="primary"
                onClick={() => saveCandidate(item)}
                disabled={loading || savingCandidateId === item.id || item.uploading}
              >
                保存
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => removeCandidate(item)}
                disabled={loading || savingCandidateId === item.id}
              >
                删除
              </button>
            </div>
          </article>
        ))}
      </section>

      <footer className="admin-footer">{message}</footer>
    </main>
  );
};

export default AdminApp;
