import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { config } from "./config.js";
import { query, withTransaction } from "./db.js";
import { isRedisReady, redis } from "./redis.js";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, "../uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, uploadDir);
  },
  filename: (_request, file, callback) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
    callback(null, `avatar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`);
  }
});

const avatarUpload = multer({
  storage,
  limits: {
    fileSize: 3 * 1024 * 1024
  },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype.startsWith("image/")) {
      callback(null, true);
      return;
    }
    callback(new Error("仅支持图片文件"));
  }
});

const allowAllOrigins = config.allowedOrigins.includes("*");
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "131072";

const requireAdminAuth = (request, response, next) => {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    response.setHeader("WWW-Authenticate", 'Basic realm="vote-admin"');
    response.status(401).json({ success: false, message: "管理员认证失败" });
    return;
  }

  const encoded = authHeader.slice(6).trim();
  let decoded = "";
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    response.status(401).json({ success: false, message: "管理员认证失败" });
    return;
  }

  const separatorIndex = decoded.indexOf(":");
  const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : "";
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    response.status(401).json({ success: false, message: "管理员账号或密码错误" });
    return;
  }

  next();
};

app.use(
  cors({
    origin(origin, callback) {
      if (allowAllOrigins || !origin || config.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("CORS origin not allowed"));
    }
  })
);

app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(uploadDir));

const nowInWindow = (startTime, endTime) => {
  const now = Date.now();
  const start = startTime ? new Date(startTime).getTime() : Number.NEGATIVE_INFINITY;
  const end = endTime ? new Date(endTime).getTime() : Number.POSITIVE_INFINITY;
  return now >= start && now <= end;
};

const parseRule = (rawRule) => {
  let parsed = {};

  if (typeof rawRule === "string") {
    try {
      parsed = JSON.parse(rawRule);
    } catch {
      parsed = {};
    }
  } else if (rawRule && typeof rawRule === "object") {
    parsed = rawRule;
  }

  const mode = parsed.mode === "multi" ? "multi" : "single";
  const maxSelectionsBase = Number(parsed.maxSelections ?? 1);
  const maxSelections = Number.isFinite(maxSelectionsBase) ? Math.max(1, Math.floor(maxSelectionsBase)) : 1;

  return {
    mode,
    maxSelections: mode === "single" ? 1 : maxSelections
  };
};

const createVoteId = () => {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `vote_${Date.now()}_${randomPart}`;
};

const getClientIp = (request) => {
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim() !== "") {
    return forwardedFor.split(",")[0].trim();
  }
  return request.socket.remoteAddress ?? "";
};

const normalizeCandidateCodes = (payload) => {
  const list = Array.isArray(payload.candidateIds)
    ? payload.candidateIds
    : payload.candidateId
      ? [payload.candidateId]
      : [];

  const normalized = list
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);

  return Array.from(new Set(normalized));
};

const getEventByCode = async (eventCode) => {
  const rows = await query(
    `SELECT id, event_code, status, start_time, end_time, result_visible, rule_json FROM vote_event WHERE event_code = ? LIMIT 1`,
    [eventCode]
  );
  return rows[0] ?? null;
};

const getCandidatesByCodes = async (eventId, candidateCodes) => {
  if (!candidateCodes.length) {
    return [];
  }

  const placeholders = candidateCodes.map(() => "?").join(",");
  const rows = await query(
    `
    SELECT id, candidate_code AS code, candidate_name AS name
    FROM vote_candidate
    WHERE event_id = ?
      AND status = 'active'
      AND candidate_code IN (${placeholders})
    `,
    [eventId, ...candidateCodes]
  );

  return rows;
};

const getTotalVotes = async (eventId) => {
  const rows = await query(`SELECT COUNT(*) AS totalVotes FROM vote_record WHERE event_id = ?`, [eventId]);
  return Number(rows[0]?.totalVotes ?? 0);
};

const getEventCandidatesForAdmin = async (eventId) => {
  const rows = await query(
    `
    SELECT
      candidate_code AS id,
      candidate_name AS name,
      academy,
      major_name AS major,
      song_name AS song,
      avatar_url AS avatarUrl,
      display_order AS displayOrder,
      status
    FROM vote_candidate
    WHERE event_id = ?
    ORDER BY display_order ASC, id ASC
    `,
    [eventId]
  );

  return rows;
};

const getEventCandidatesForPublic = async (eventId, resultVisible) => {
  const rows = await query(
    `
    SELECT
      c.candidate_code AS id,
      c.candidate_name AS name,
      c.academy,
      c.major_name AS major,
      c.song_name AS song,
      c.avatar_url AS avatar,
      c.display_order AS displayOrder,
      COALESCE(r.vote_count, 0) AS voteCount
    FROM vote_candidate c
    LEFT JOIN (
      SELECT candidate_id, COUNT(*) AS vote_count
      FROM vote_record
      WHERE event_id = ?
      GROUP BY candidate_id
    ) r ON r.candidate_id = c.id
    WHERE c.event_id = ? AND c.status = 'active'
    ORDER BY c.display_order ASC, c.id ASC
    `,
    [eventId, eventId]
  );

  return rows.map((item) => ({
    id: item.id,
    name: item.name,
    major: [item.academy, item.major].filter(Boolean).join(" · "),
    song: item.song ?? "",
    avatar: item.avatar ?? "",
    voteCount: Number(resultVisible ? item.voteCount : 0)
  }));
};

app.get("/healthz", async (_request, response) => {
  let dbOk = true;
  try {
    await query("SELECT 1");
  } catch {
    dbOk = false;
  }

  response.status(dbOk ? 200 : 503).json({
    success: dbOk,
    service: "vote-api",
    db: dbOk ? "ok" : "down",
    redis: isRedisReady() ? "ok" : "degraded",
    now: new Date().toISOString()
  });
});

app.get("/api/v1/events/config", async (request, response) => {
  const eventId = request.query.eventId;

  if (!eventId || typeof eventId !== "string") {
    response.status(400).json({
      success: false,
      message: "请求参数有误",
      code: "INVALID_PARAM"
    });
    return;
  }

  const event = await getEventByCode(eventId);
  if (!event) {
    response.status(404).json({
      success: false,
      message: "活动不存在",
      code: "EVENT_NOT_FOUND"
    });
    return;
  }

  const rule = parseRule(event.rule_json);
  const candidates = await getEventCandidatesForPublic(event.id, Boolean(event.result_visible));

  response.json({
    success: true,
    data: {
      eventId: event.event_code,
      title: "校园十大歌手大赛",
      subtitle: "请选择你最支持的选手",
      ruleText:
        rule.mode === "single"
          ? "当前为单选模式，每人限投 1 位选手"
          : `当前为多选模式，每人最多可选 ${rule.maxSelections} 位选手`,
      voteButtonText: "提交我的投票",
      resultVisible: Boolean(event.result_visible),
      status: event.status === "active" ? "active" : "closed",
      selectionMode: rule.mode,
      maxSelections: rule.maxSelections,
      candidates
    }
  });
});

app.post("/api/v1/votes", async (request, response) => {
  const { eventId, voterToken } = request.body ?? {};
  const candidateCodes = normalizeCandidateCodes(request.body ?? {});

  if (!eventId || !voterToken || candidateCodes.length === 0) {
    response.status(400).json({
      success: false,
      message: "请求参数有误，请刷新后重试",
      code: "INVALID_PARAM"
    });
    return;
  }

  const event = await getEventByCode(eventId);
  if (!event) {
    response.status(404).json({
      success: false,
      message: "活动不存在或已下线",
      code: "EVENT_NOT_FOUND"
    });
    return;
  }

  if (event.status !== "active" || !nowInWindow(event.start_time, event.end_time)) {
    response.status(409).json({
      success: false,
      message: "当前不在投票时间内",
      code: "EVENT_NOT_ACTIVE"
    });
    return;
  }

  const rule = parseRule(event.rule_json);
  if (rule.mode === "single" && candidateCodes.length !== 1) {
    response.status(400).json({
      success: false,
      message: "当前活动为单选，只能选择 1 位选手",
      code: "INVALID_SELECTION"
    });
    return;
  }

  if (candidateCodes.length > rule.maxSelections) {
    response.status(400).json({
      success: false,
      message: `当前最多可选择 ${rule.maxSelections} 位选手`,
      code: "SELECTION_LIMIT"
    });
    return;
  }

  const candidates = await getCandidatesByCodes(event.id, candidateCodes);
  if (candidates.length !== candidateCodes.length) {
    response.status(409).json({
      success: false,
      message: "存在不可投票的选手，请刷新后重试",
      code: "CANDIDATE_INVALID"
    });
    return;
  }

  try {
    const insertedVoteIds = await withTransaction(async (connection) => {
      const [voteRows] = await connection.execute(
        `SELECT candidate_id FROM vote_record WHERE event_id = ? AND voter_token = ?`,
        [event.id, voterToken]
      );

      const votedCandidateIds = new Set(voteRows.map((item) => Number(item.candidate_id)));
      const usedCount = votedCandidateIds.size;

      if (rule.mode === "single" && usedCount >= 1) {
        const error = new Error("already_voted");
        error.code = "ALREADY_VOTED";
        throw error;
      }

      if (usedCount + candidateCodes.length > rule.maxSelections) {
        const error = new Error("selection_limit");
        error.code = "SELECTION_LIMIT";
        throw error;
      }

      const duplicated = candidates.find((candidate) => votedCandidateIds.has(Number(candidate.id)));
      if (duplicated) {
        const error = new Error("duplicated_candidate");
        error.code = "DUPLICATED_CANDIDATE";
        throw error;
      }

      const createdIds = [];
      for (const candidate of candidates) {
        const voteId = createVoteId();
        await connection.execute(
          `
          INSERT INTO vote_record (
            vote_id,
            event_id,
            candidate_id,
            voter_token,
            client_ip,
            user_agent
          ) VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            voteId,
            event.id,
            candidate.id,
            voterToken,
            getClientIp(request),
            request.headers["user-agent"] ?? ""
          ]
        );
        createdIds.push(voteId);
      }

      return createdIds;
    });

    if (isRedisReady()) {
      try {
        await redis.del(`vote:result:${eventId}`);
      } catch (error) {
        console.warn("[Vote] Redis 缓存清理失败：", error.message);
      }
    }

    const totalVotes = await getTotalVotes(event.id);

    response.json({
      success: true,
      message: "投票成功，感谢你的支持",
      voteId: insertedVoteIds[0],
      voteIds: insertedVoteIds,
      totalVotes,
      acceptedCount: insertedVoteIds.length
    });
  } catch (error) {
    if (error?.code === "ALREADY_VOTED") {
      response.status(409).json({
        success: false,
        message: "您已完成投票",
        code: "ALREADY_VOTED"
      });
      return;
    }

    if (error?.code === "SELECTION_LIMIT") {
      response.status(409).json({
        success: false,
        message: `本活动最多可选择 ${rule.maxSelections} 位选手`,
        code: "SELECTION_LIMIT"
      });
      return;
    }

    if (error?.code === "DUPLICATED_CANDIDATE" || error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) {
      response.status(409).json({
        success: false,
        message: "存在重复投票记录",
        code: "ALREADY_VOTED_CANDIDATE"
      });
      return;
    }

    throw error;
  }
});

app.get("/api/v1/votes/results", async (request, response) => {
  const eventId = request.query.eventId;

  if (!eventId || typeof eventId !== "string") {
    response.status(400).json({
      success: false,
      message: "请求参数有误，请刷新后重试",
      code: "INVALID_PARAM"
    });
    return;
  }

  const event = await getEventByCode(eventId);
  if (!event) {
    response.status(404).json({
      success: false,
      message: "活动不存在或已下线",
      code: "EVENT_NOT_FOUND"
    });
    return;
  }

  const resultCacheKey = `vote:result:${eventId}`;
  if (isRedisReady()) {
    try {
      const cached = await redis.get(resultCacheKey);
      if (cached) {
        response.json(JSON.parse(cached));
        return;
      }
    } catch (error) {
      console.warn("[Result] Redis 缓存读取失败：", error.message);
    }
  }

  const rows = await query(
    `
    SELECT
      c.candidate_code AS id,
      c.candidate_name AS name,
      COALESCE(r.vote_count, 0) AS voteCount
    FROM vote_candidate c
    LEFT JOIN (
      SELECT candidate_id, COUNT(*) AS vote_count
      FROM vote_record
      WHERE event_id = ?
      GROUP BY candidate_id
    ) r ON r.candidate_id = c.id
    WHERE c.event_id = ? AND c.status = 'active'
    ORDER BY c.display_order ASC, c.id ASC
    `,
    [event.id, event.id]
  );

  const candidates = rows.map((item) => ({
    id: item.id,
    name: item.name,
    voteCount: Number(event.result_visible ? item.voteCount : 0)
  }));

  const payload = {
    success: true,
    updatedAt: new Date().toISOString(),
    candidates
  };

  if (isRedisReady()) {
    try {
      await redis.set(resultCacheKey, JSON.stringify(payload), "EX", 10);
    } catch (error) {
      console.warn("[Result] Redis 缓存写入失败：", error.message);
    }
  }

  response.json(payload);
});

app.get("/api/v1/admin/config", requireAdminAuth, async (request, response) => {
  const eventId = request.query.eventId;

  if (!eventId || typeof eventId !== "string") {
    response.status(400).json({ success: false, message: "缺少 eventId" });
    return;
  }

  const event = await getEventByCode(eventId);
  if (!event) {
    response.status(404).json({ success: false, message: "活动不存在" });
    return;
  }

  const rule = parseRule(event.rule_json);
  const candidates = await getEventCandidatesForAdmin(event.id);

  response.json({
    success: true,
    data: {
      eventId: event.event_code,
      status: event.status,
      resultVisible: Boolean(event.result_visible),
      selectionMode: rule.mode,
      maxSelections: rule.maxSelections,
      startTime: event.start_time,
      endTime: event.end_time,
      candidates
    }
  });
});

app.put("/api/v1/admin/config", requireAdminAuth, async (request, response) => {
  const {
    eventId,
    status,
    resultVisible,
    selectionMode,
    maxSelections,
    startTime,
    endTime
  } = request.body ?? {};

  if (!eventId || typeof eventId !== "string") {
    response.status(400).json({ success: false, message: "缺少 eventId" });
    return;
  }

  const event = await getEventByCode(eventId);
  if (!event) {
    response.status(404).json({ success: false, message: "活动不存在" });
    return;
  }

  const nextStatus = ["active", "closed", "draft"].includes(status) ? status : event.status;
  const nextMode = selectionMode === "multi" ? "multi" : "single";
  const nextMaxBase = Number(maxSelections ?? 1);
  const nextMax = Number.isFinite(nextMaxBase) ? Math.max(1, Math.floor(nextMaxBase)) : 1;

  await query(
    `
    UPDATE vote_event
    SET
      status = ?,
      result_visible = ?,
      start_time = ?,
      end_time = ?,
      rule_json = JSON_OBJECT('mode', ?, 'maxSelections', ?),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [
      nextStatus,
      resultVisible ? 1 : 0,
      startTime || null,
      endTime || null,
      nextMode,
      nextMode === "single" ? 1 : nextMax,
      event.id
    ]
  );

  if (isRedisReady()) {
    try {
      await redis.del(`vote:result:${eventId}`);
    } catch {
      // no-op
    }
  }

  response.json({ success: true, message: "配置已更新" });
});

app.post("/api/v1/admin/candidates", requireAdminAuth, async (request, response) => {
  const {
    eventId,
    name,
    academy,
    major,
    song,
    avatarUrl,
    displayOrder,
    status
  } = request.body ?? {};

  if (!eventId || !name) {
    response.status(400).json({ success: false, message: "eventId 与姓名必填" });
    return;
  }

  const event = await getEventByCode(eventId);
  if (!event) {
    response.status(404).json({ success: false, message: "活动不存在" });
    return;
  }

  const candidateCode = `singer-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;

  await query(
    `
    INSERT INTO vote_candidate (
      event_id,
      candidate_code,
      candidate_name,
      academy,
      major_name,
      song_name,
      avatar_url,
      display_order,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      event.id,
      candidateCode,
      String(name).trim(),
      academy ? String(academy).trim() : null,
      major ? String(major).trim() : null,
      song ? String(song).trim() : null,
      avatarUrl ? String(avatarUrl).trim() : null,
      Number.isFinite(Number(displayOrder)) ? Number(displayOrder) : 99,
      status === "inactive" ? "inactive" : "active"
    ]
  );

  response.json({
    success: true,
    message: "候选人已创建",
    data: {
      id: candidateCode
    }
  });
});

app.put("/api/v1/admin/candidates/:candidateCode", requireAdminAuth, async (request, response) => {
  const { candidateCode } = request.params;
  const {
    eventId,
    name,
    academy,
    major,
    song,
    avatarUrl,
    displayOrder,
    status
  } = request.body ?? {};

  if (!eventId || !candidateCode) {
    response.status(400).json({ success: false, message: "缺少必要参数" });
    return;
  }

  const event = await getEventByCode(eventId);
  if (!event) {
    response.status(404).json({ success: false, message: "活动不存在" });
    return;
  }

  await query(
    `
    UPDATE vote_candidate
    SET
      candidate_name = ?,
      academy = ?,
      major_name = ?,
      song_name = ?,
      avatar_url = ?,
      display_order = ?,
      status = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE event_id = ? AND candidate_code = ?
    `,
    [
      String(name ?? "").trim(),
      academy ? String(academy).trim() : null,
      major ? String(major).trim() : null,
      song ? String(song).trim() : null,
      avatarUrl ? String(avatarUrl).trim() : null,
      Number.isFinite(Number(displayOrder)) ? Number(displayOrder) : 99,
      status === "inactive" ? "inactive" : "active",
      event.id,
      candidateCode
    ]
  );

  response.json({ success: true, message: "候选人已更新" });
});

app.delete("/api/v1/admin/candidates/:candidateCode", requireAdminAuth, async (request, response) => {
  const { candidateCode } = request.params;
  const eventId = request.query.eventId;

  if (!eventId || typeof eventId !== "string") {
    response.status(400).json({ success: false, message: "缺少 eventId" });
    return;
  }

  const event = await getEventByCode(eventId);
  if (!event) {
    response.status(404).json({ success: false, message: "活动不存在" });
    return;
  }

  await query(
    `
    UPDATE vote_candidate
    SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
    WHERE event_id = ? AND candidate_code = ?
    `,
    [event.id, candidateCode]
  );

  response.json({ success: true, message: "候选人已删除" });
});

app.post(
  "/api/v1/admin/upload-avatar",
  requireAdminAuth,
  avatarUpload.single("avatar"),
  async (request, response) => {
  if (!request.file) {
    response.status(400).json({ success: false, message: "未接收到头像文件" });
    return;
  }

  response.json({
    success: true,
    data: {
      url: `/uploads/${request.file.filename}`
    }
  });
  }
);

app.use((error, _request, response, _next) => {
  console.error("[Unhandled Error]", error);
  response.status(500).json({
    success: false,
    message: error?.message || "系统繁忙，请稍后重试",
    code: "SYSTEM_ERROR"
  });
});

export default app;
