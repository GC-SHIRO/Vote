import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { config } from "./config.js";
import { query, withTransaction, pool } from "./db.js";
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
    maxSelections: mode === "single" ? 1 : maxSelections,
    lotteryStatus: parsed.lotteryStatus || "not_started",
    lotteryWinner: parsed.lotteryWinner || null,
    useReservedIds: Boolean(parsed.useReservedIds)
  };
};

const createVoteId = () => {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `vote_${Date.now()}_${randomPart}`;
};

const clearVoteCache = async (eventId) => {
  if (!isRedisReady()) return;
  try {
    await redis.del(`vote:result:${eventId}`);
    await redis.del(`vote:config:response:${eventId}`);
  } catch {
    // no-op
  }
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

const normalizeEventCode = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

const resolveEventCode = (value) => {
  const normalized = normalizeEventCode(value);
  return normalized || config.eventCode;
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

const getDisplayedLotteryWinners = async (eventId) => {
  try {
    const rows = await query(
      `
      SELECT student_id, round, created_at
      FROM lottery_winner
      WHERE event_id = ? AND is_displayed = 1
      ORDER BY round ASC, id ASC
      `,
      [eventId]
    );
    return rows.map((item) => ({
      studentId: item.student_id,
      round: item.round,
      createdAt: item.created_at
    }));
  } catch (error) {
    // 表不存在时返回空数组
    if (error?.code === "ER_NO_SUCH_TABLE") {
      return [];
    }
    throw error;
  }
};

const getAllLotteryWinners = async (eventId) => {
  try {
    const rows = await query(
      `
      SELECT student_id, round, is_displayed, created_at
      FROM lottery_winner
      WHERE event_id = ?
      ORDER BY round ASC, id ASC
      `,
      [eventId]
    );
    return rows.map((item) => ({
      studentId: item.student_id,
      round: item.round,
      isDisplayed: Boolean(item.is_displayed),
      createdAt: item.created_at
    }));
  } catch (error) {
    // 表不存在时返回空数组
    if (error?.code === "ER_NO_SUCH_TABLE") {
      return [];
    }
    throw error;
  }
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
  try {
    const eventId = resolveEventCode(request.query.eventId);
    const cacheKey = `vote:config:response:${eventId}`;

    if (isRedisReady()) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          response.set("X-Cache", "HIT");
          response.json(JSON.parse(cached));
          return;
        }
      } catch (error) {
        console.warn("[Config] Redis 缓存读取失败：", error.message);
      }
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
    const displayedWinners = await getDisplayedLotteryWinners(event.id);

    const payload = {
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
        lotteryStatus: displayedWinners.length > 0 ? "drawn" : "not_started",
        lotteryWinners: displayedWinners.map(w => w.studentId),
        lotteryWinnerList: displayedWinners,
        lotteryDrawCount: rule.lotteryDrawCount,
        useReservedIds: rule.useReservedIds || false,
        candidates
      }
    };

    if (isRedisReady()) {
      try {
        await redis.set(cacheKey, JSON.stringify(payload), "EX", 30);
      } catch (error) {
        console.warn("[Config] Redis 缓存写入失败：", error.message);
      }
    }

    response.json(payload);
  } catch (error) {
    console.error("[Config] 获取配置失败", error);
    response.status(500).json({ success: false, message: "服务端异常" });
  }
});

app.post("/api/v1/votes", async (request, response) => {
  try {
    const { eventId, voterToken, studentId } = request.body ?? {};
  const candidateCodes = normalizeCandidateCodes(request.body ?? {});
  const resolvedEventId = resolveEventCode(eventId);

  if (!voterToken || candidateCodes.length === 0) {
    response.status(400).json({
      success: false,
      message: "请求参数不完整（缺少选手等），请刷新后重试",
      code: "INVALID_PARAM"
    });
    return;
  }

  // 检查学号格式：如果是12位则需校验前4位(2020-2025)，如果是5位或8位则仅校验数字，否则提示错误
  if (studentId && !(/^202[0-5]\d{8}$/.test(studentId) || /^\d{5}$/.test(studentId) || /^\d{8}$/.test(studentId))) {
    response.status(400).json({
      success: false,
      message: "输入学号不正确或格式无效",
      code: "INVALID_STUDENT_ID"
    });
    return;
  }

  const event = await getEventByCode(resolvedEventId);
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

  // Check if student_id already voted in this event (if student_id is provided)
  if (studentId) {
    const existingStudentVote = await query(
      `SELECT id FROM vote_record WHERE event_id = ? AND student_id = ? LIMIT 1`,
      [event.id, studentId]
    );
    if (existingStudentVote.length > 0) {
      return response.status(409).json({
        success: false,
        message: "该学号已参与本次投票，每位学生只能投票一次",
        code: "ALREADY_VOTED_STUDENT"
      });
    }
  }

  try {
    const insertedVoteIds = await withTransaction(async (connection) => {
      // Use FOR UPDATE to lock existing rows for this voter, preventing concurrent inserts
      // This makes the check-and-insert atomic within the transaction
      const [voteRows] = await connection.execute(
        `SELECT candidate_id FROM vote_record WHERE event_id = ? AND voter_token = ? FOR UPDATE`,
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
            user_agent,
            student_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            voteId,
            event.id,
            candidate.id,
            voterToken,
            getClientIp(request),
            String(request.headers["user-agent"] ?? "").slice(0, 255),
            studentId
          ]
        );
        createdIds.push(voteId);
      }

      return createdIds;
    });

    await clearVoteCache(resolvedEventId);

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
      // Check if the duplicate is for student_id
      if (error?.sqlMessage?.includes('uniq_event_student_id')) {
        response.status(409).json({
          success: false,
          message: "该学号已参与本次投票，每位学生只能投票一次",
          code: "ALREADY_VOTED_STUDENT"
        });
      } else {
        response.status(409).json({
          success: false,
          message: "存在重复投票记录或已超过最大选择数",
          code: "ALREADY_VOTED_CANDIDATE"
        });
      }
      return;
    }

    if (error?.code === "ALREADY_VOTED_STUDENT") {
      response.status(409).json({
        success: false,
        message: "该学号已参与本次投票，每位学生只能投票一次",
        code: "ALREADY_VOTED_STUDENT"
      });
      return;
    }

    throw error;
  }
  } catch (error) {
    console.error("[Vote] 投票操作失败", error);
    response.status(500).json({ success: false, message: "服务端异常，请稍后重试" });
  }
});

app.get("/api/v1/votes/results", async (request, response) => {
  try {
    const eventId = resolveEventCode(request.query.eventId);

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
  } catch (error) {
    console.error("[Result] 获取结果失败", error);
    response.status(500).json({ success: false, message: "获取数据异常" });
  }
});

app.get("/api/v1/admin/config", requireAdminAuth, async (request, response) => {
  try {
    const eventId = resolveEventCode(request.query.eventId);

  const event = await getEventByCode(eventId);
  if (!event) {
    response.status(404).json({ success: false, message: "活动不存在" });
    return;
  }

  const rule = parseRule(event.rule_json);
  const candidates = await getEventCandidatesForAdmin(event.id);
  const allWinners = await getAllLotteryWinners(event.id);
  const displayedWinners = allWinners.filter(w => w.isDisplayed);

  response.json({
    success: true,
    data: {
      eventId: event.event_code,
      status: event.status,
      resultVisible: Boolean(event.result_visible),
      selectionMode: rule.mode,
      maxSelections: rule.maxSelections,
      lotteryStatus: displayedWinners.length > 0 ? "drawn" : "not_started",
      lotteryWinners: displayedWinners.map(w => w.studentId),
      lotteryWinnerList: allWinners,
      lotteryDrawCount: rule.lotteryDrawCount,
      useReservedIds: rule.useReservedIds || false,
      startTime: event.start_time,
      endTime: event.end_time,
      candidates
    }
  });
  } catch (error) {
    console.error("[Admin] 获取配置失败", error);
    response.status(500).json({ success: false, message: "服务端异常" });
  }
});

app.put("/api/v1/admin/config", requireAdminAuth, async (request, response) => {
  const {
    eventId,
    status,
    resultVisible,
    selectionMode,
    maxSelections,
    lotteryDrawCount,
    startTime,
    endTime,
    controlAction
  } = request.body ?? {};

  const resolvedEventId = resolveEventCode(eventId);
  const event = await getEventByCode(resolvedEventId);
  if (!event) {
    response.status(404).json({ success: false, message: "活动不存在" });
    return;
  }

  const nextStatus = ["active", "closed", "draft"].includes(status) ? status : event.status;
  const nextMode = selectionMode === "multi" ? "multi" : "single";
  const nextMaxBase = Number(maxSelections ?? 1);
  const nextMax = Number.isFinite(nextMaxBase) ? Math.max(1, Math.floor(nextMaxBase)) : 1;
  const nextLotteryDrawCountBase = Number(lotteryDrawCount ?? 1);
  const nextLotteryDrawCount = Number.isFinite(nextLotteryDrawCountBase) ? Math.max(1, Math.min(50, Math.floor(nextLotteryDrawCountBase))) : 1;
  const action = typeof controlAction === "string" ? controlAction : "";

  try {
    let nextStartTime = startTime ? new Date(startTime) : null;
    let nextEndTime = endTime ? new Date(endTime) : null;

    if (action === "start_now") {
      nextStartTime = new Date(Date.now() - 60 * 1000);
      nextEndTime = null;
    }

    if (action === "stop_now") {
      nextEndTime = new Date();
    }

    const currentRule = parseRule(event.rule_json);
    await query(
      `
      UPDATE vote_event
      SET
        status = ?,
        result_visible = ?,
        start_time = ?,
        end_time = ?,
        rule_json = JSON_OBJECT('mode', ?, 'maxSelections', ?, 'lotteryDrawCount', ?, 'useReservedIds', false),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [
        nextStatus,
        resultVisible ? 1 : 0,
        nextStartTime,
        nextEndTime,
        nextMode,
        nextMode === "single" ? 1 : nextMax,
        nextLotteryDrawCount,
        event.id
      ]
    );

    await clearVoteCache(resolvedEventId);

    response.json({ success: true, message: "配置已更新" });
  } catch (error) {
    console.error("[Admin] 更新配置失败", error);
    response.status(500).json({ success: false, message: "服务端保存异常" });
  }
});

app.post("/api/v1/admin/candidates", requireAdminAuth, async (request, response) => {
  try {
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

  const resolvedEventId = resolveEventCode(eventId);

  if (!name) {
    response.status(400).json({ success: false, message: "姓名必填" });
    return;
  }

  const event = await getEventByCode(resolvedEventId);
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

  await clearVoteCache(resolvedEventId);

  response.json({
    success: true,
    message: "候选人已创建",
    data: {
      id: candidateCode
    }
  });
  } catch (error) {
    console.error("[Admin] 创建候选人失败", error);
    response.status(500).json({ success: false, message: "服务端异常" });
  }
});

app.put("/api/v1/admin/candidates/:candidateCode", requireAdminAuth, async (request, response) => {
  try {
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

  const resolvedEventId = resolveEventCode(eventId);

  if (!candidateCode) {
    response.status(400).json({ success: false, message: "缺少必要参数" });
    return;
  }

  const event = await getEventByCode(resolvedEventId);
  if (!event) {
    response.status(404).json({ success: false, message: "活动不存在" });
    return;
  }

  const [currentRows] = await pool.execute(
    `SELECT candidate_name, academy, major_name, song_name, avatar_url, display_order, status FROM vote_candidate WHERE event_id = ? AND candidate_code = ? LIMIT 1`,
    [event.id, candidateCode]
  );
  if (currentRows.length === 0) {
    response.status(404).json({ success: false, message: "候选人不存在" });
    return;
  }
  const current = currentRows[0];

  const nextName = typeof name === "string" ? name.trim() || current.candidate_name : current.candidate_name;
  const nextAcademy = typeof academy === "string" ? academy.trim() || null : current.academy;
  const nextMajor = typeof major === "string" ? major.trim() || null : current.major_name;
  const nextSong = typeof song === "string" ? song.trim() || null : current.song_name;
  const nextAvatar = typeof avatarUrl === "string" ? avatarUrl.trim() || null : current.avatar_url;
  const nextDisplayOrder = Number.isFinite(Number(displayOrder)) ? Number(displayOrder) : (current.display_order ?? 0);
  const nextStatus =
    typeof status === "string"
      ? status === "inactive"
        ? "inactive"
        : "active"
      : current.status ?? "active";

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
      nextName,
      nextAcademy,
      nextMajor,
      nextSong,
      nextAvatar,
      nextDisplayOrder,
      nextStatus,
      event.id,
      candidateCode
    ]
  );

  await clearVoteCache(resolvedEventId);

  response.json({ success: true, message: "候选人已更新" });
  } catch (error) {
    console.error("[Admin] 更新候选人失败", error.stack || error);
    response.status(500).json({ success: false, message: "服务端异常" });
  }
});

app.delete("/api/v1/admin/candidates/:candidateCode", requireAdminAuth, async (request, response) => {
  try {
    const { candidateCode } = request.params;
  const eventId = resolveEventCode(request.query.eventId);

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

  await clearVoteCache(eventId);

  response.json({ success: true, message: "候选人已删除" });
  } catch (error) {
    console.error("[Admin] 删除候选人失败", error);
    response.status(500).json({ success: false, message: "服务端异常" });
  }
});

app.post(
  "/api/v1/admin/upload-avatar",
  requireAdminAuth,
  avatarUpload.single("avatar"),
  async (request, response) => {
    try {
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
    } catch (error) {
      console.error("[Admin] 上传头像失败", error);
      response.status(500).json({ success: false, message: "服务端异常" });
    }
  }
);

app.post("/api/v1/admin/lottery/draw", requireAdminAuth, async (request, response) => {
  try {
    const eventId = resolveEventCode(request.body?.eventId);
    const drawCount = Number(request.body?.count) || 1;
    const event = await getEventByCode(eventId);
    if (!event) {
      return response.status(404).json({ success: false, message: "活动不存在" });
    }

    const rule = parseRule(event.rule_json);
    console.log("[Debug] Lottery draw - rule:", JSON.stringify(rule), "event.rule_json:", event.rule_json);
    const actualDrawCount = Math.max(1, Math.min(50, drawCount));
    
    // 检查表是否存在，不存在则创建
    try {
      await query(`SELECT 1 FROM lottery_winner LIMIT 1`);
    } catch (err) {
      if (err?.code === "ER_NO_SUCH_TABLE") {
        // 创建表
        await query(`
          CREATE TABLE IF NOT EXISTS lottery_winner (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            event_id BIGINT NOT NULL,
            student_id VARCHAR(12) NOT NULL,
            round INT NOT NULL DEFAULT 1,
            is_displayed TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_lottery_event (event_id),
            KEY idx_lottery_display (event_id, is_displayed)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
      } else {
        throw err;
      }
    }
    
    // 获取当前最大轮次
    const [roundRow] = await query(
      `SELECT MAX(round) as maxRound FROM lottery_winner WHERE event_id = ?`,
      [event.id]
    );
    const nextRound = (roundRow?.maxRound || 0) + 1;

    let winners = [];

    // 获取已经中过奖的号码
    const drawnRows = await query(`SELECT student_id FROM lottery_winner WHERE event_id = ?`, [event.id]);
    const drawnNumbers = new Set(drawnRows.map(r => parseInt(r.student_id, 10)));
    
    // 生成新的随机数 (1-800) 且不重复
    const maxNumber = 800;
    while (winners.length < actualDrawCount && drawnNumbers.size < maxNumber) {
      const candidate = Math.floor(Math.random() * maxNumber) + 1;
      if (!drawnNumbers.has(candidate)) {
        drawnNumbers.add(candidate);
        winners.push(String(candidate));
      }
    }

    if (winners.length === 0) {
      return response.status(400).json({ success: false, message: "所有号码均已中奖，无法继续抽奖" });
    }

    // 将之前的显示状态设为 0（隐藏）
    await query(
      `UPDATE lottery_winner SET is_displayed = 0 WHERE event_id = ?`,
      [event.id]
    );

    // 插入新的中奖记录
    for (const studentId of winners) {
      await query(
        `INSERT INTO lottery_winner (event_id, student_id, round, is_displayed) VALUES (?, ?, ?, 1)`,
        [event.id, studentId, nextRound]
      );
    }

    await clearVoteCache(eventId);

    response.json({ 
      success: true, 
      message: `抽奖成功，共抽出 ${winners.length} 人`, 
      winners,
      round: nextRound
    });
  } catch (error) {
    console.error("[Admin] 抽奖失败", error);
    response.status(500).json({ success: false, message: "抽奖失败，系统异常" });
  }
});

app.post("/api/v1/admin/lottery/reset", requireAdminAuth, async (request, response) => {
  try {
    const eventId = resolveEventCode(request.body?.eventId);
    const event = await getEventByCode(eventId);
    if (!event) {
      return response.status(404).json({ success: false, message: "活动不存在" });
    }

    const rule = parseRule(event.rule_json);
    const resetType = request.body?.type || 'display'; // 'display' | 'all'

    // 检查表是否存在
    try {
      await query(`SELECT 1 FROM lottery_winner LIMIT 1`);
    } catch (err) {
      if (err?.code === "ER_NO_SUCH_TABLE") {
        // 表不存在，直接返回成功
        return response.json({ success: true, message: "抽奖数据为空，无需重置" });
      }
      throw err;
    }

    if (resetType === 'all') {
      // 完全重置：删除所有中奖记录
      await query(`DELETE FROM lottery_winner WHERE event_id = ?`, [event.id]);
    } else {
      // 仅重置显示状态：将当前显示设为隐藏（前台显示"等待抽奖"）
      await query(
        `UPDATE lottery_winner SET is_displayed = 0 WHERE event_id = ? AND is_displayed = 1`,
        [event.id]
      );
    }

    await clearVoteCache(eventId);

    const message = resetType === 'all' ? "抽奖数据已完全重置" : "前台已恢复为等待抽奖状态";
    response.json({ success: true, message });
  } catch (error) {
    console.error("[Admin] 重置抽奖状态失败", error);
    response.status(500).json({ success: false, message: "服务端异常" });
  }
});

// 一键清空所有投票
app.post("/api/v1/admin/votes/clear", requireAdminAuth, async (request, response) => {
  try {
    const eventId = resolveEventCode(request.body?.eventId);
    const event = await getEventByCode(eventId);
    if (!event) {
      return response.status(404).json({ success: false, message: "活动不存在" });
    }

    // 删除该活动的所有投票记录
    const [result] = await query(
      `DELETE FROM vote_record WHERE event_id = ?`,
      [event.id]
    );

    const deletedCount = result?.affectedRows || 0;

    // 清除 Redis 缓存
    await clearVoteCache(eventId);

    console.log(`[Admin] 已清空活动 ${eventId} 的所有投票，共 ${deletedCount} 条记录`);
    response.json({ 
      success: true, 
      message: `已清空所有投票，共删除 ${deletedCount} 条记录`,
      deletedCount
    });
  } catch (error) {
    console.error("[Admin] 清空投票失败", error);
    response.status(500).json({ success: false, message: "清空投票失败，系统异常" });
  }
});

app.use((error, _request, response, _next) => {
  console.error("[Unhandled Error]", error);
  response.status(500).json({
    success: false,
    message: error?.message || "系统繁忙，请稍后重试",
    code: "SYSTEM_ERROR"
  });
});

export default app;
