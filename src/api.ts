import FingerprintJS from "@fingerprintjs/fingerprintjs";
import { defaultVoteSettings } from "./data";
import type {
  AdminConfig,
  VoteSettings,
  VoteResultResponse,
  VoteSubmitRequest,
  VoteSubmitResponse
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() ?? "";
const DEBUG_PREFIX = "[VoteDebug]";

const debugLog = (...args: unknown[]) => {
  console.log(DEBUG_PREFIX, ...args);
};
const readLocalStorage = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeLocalStorage = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Keep voting flow available even when storage is not writable.
  }
};

const resolveUseMock = () => {
  const raw = String(import.meta.env.VITE_USE_MOCK ?? "").trim().toLowerCase();
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }

  if (typeof window === "undefined") {
    return false;
  }

  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
};

const USE_MOCK = resolveUseMock();
export const IS_MOCK_MODE = USE_MOCK;

const readEventIdFromUrl = () => {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const value = window.location.search ? new URLSearchParams(window.location.search).get("eventId") : "";
    return value?.trim() ?? "";
  } catch {
    return "";
  }
};

const ACTIVE_EVENT_STORAGE_KEY = "vote:active-event-id";

const resolveRuntimeEventId = () => {
  const fromUrl = readEventIdFromUrl();
  if (fromUrl) {
    return fromUrl;
  }

  const fromEnv = import.meta.env.VITE_EVENT_ID?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const fromStorage = readLocalStorage(ACTIVE_EVENT_STORAGE_KEY)?.trim();
  if (fromStorage) {
    return fromStorage;
  }

  return defaultVoteSettings.eventId;
};

export const RUNTIME_EVENT_ID = resolveRuntimeEventId();
const ADMIN_AUTH_HEADER = `Basic ${btoa("admin:131072")}`;
const REQUEST_TIMEOUT_MS = 20000;
const MOBILE_REQUEST_TIMEOUT_MS = 30000;
const SUBMIT_TIMEOUT_MS = 12000;
const MOBILE_SUBMIT_TIMEOUT_MS = 15000;

const mockDelay = (ms: number) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

let fingerprintAgentPromise: ReturnType<typeof FingerprintJS.load> | null = null;

const rememberRuntimeEventId = (eventId: string) => {
  if (eventId?.trim()) {
    writeLocalStorage(ACTIVE_EVENT_STORAGE_KEY, eventId.trim());
  }
};

const generateClientId = () => {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }

    if (typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    }
  }

  return `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timerId = 0;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timerId = window.setTimeout(() => {
      reject(new Error(`${label}_timeout`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    window.clearTimeout(timerId);
  }
};

const getHeaders = (withJsonContentType = true) => ({
  ...(withJsonContentType ? { "Content-Type": "application/json" } : {}),
  "X-Requested-With": "campus-singer-vote-web"
});

const getAdminHeaders = (withJsonContentType = true) => ({
  ...getHeaders(withJsonContentType),
  Authorization: ADMIN_AUTH_HEADER
});

const toAbsoluteMediaUrl = (url: string) => {
  if (!url) {
    return url;
  }

  if (/^https?:\/\//.test(url)) {
    return url;
  }

  return API_BASE_URL ? `${API_BASE_URL}${url}` : url;
};

const isCrossOriginApiBase = () => {
  if (!API_BASE_URL || typeof window === "undefined") {
    return false;
  }

  try {
    const currentOrigin = window.location.origin;
    const apiOrigin = new URL(API_BASE_URL, currentOrigin).origin;
    return apiOrigin !== currentOrigin;
  } catch {
    return false;
  }
};

const buildRequestUrls = (path: string) => {
  const urls: string[] = [];

  const isLocalhostAddress = (hostname: string) => 
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

  let isApiBaseLocal = false;
  if (API_BASE_URL) {
    try {
      isApiBaseLocal = isLocalhostAddress(new URL(API_BASE_URL).hostname);
    } catch {
      // ignore
    }
  }

  const isCurrentLocal = typeof window !== "undefined" && isLocalhostAddress(window.location.hostname);
  
  // If API is pointing to localhost but current page is NOT, reaching localhost from phone will fail/hang.
  // In this case, we prefer the proxy route.
  if (isApiBaseLocal && !isCurrentLocal && path.startsWith("/")) {
    urls.push(path);
  } else {
    if (API_BASE_URL) {
      urls.push(`${API_BASE_URL}${path}`);
    }
    // Fallback to proxy route
    if (path.startsWith("/") && isCrossOriginApiBase()) {
      urls.push(path);
    }
  }

  if (urls.length === 0) {
    urls.push(path);
  }

  return Array.from(new Set(urls));
};

const sleep = (ms: number) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const isMobileClient = () => {
  if (typeof navigator === "undefined") {
    return false;
  }

  const ua = navigator.userAgent || "";
  return /Mobile|Android|iPhone|iPad|MicroMessenger/i.test(ua);
};

const getRequestTimeoutMs = () => {
  const raw = Number(import.meta.env.VITE_REQUEST_TIMEOUT_MS ?? 0);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }

  return isMobileClient() ? MOBILE_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
};

const getSubmitTimeoutMs = () => (isMobileClient() ? MOBILE_SUBMIT_TIMEOUT_MS : SUBMIT_TIMEOUT_MS);

const isRetriableNetworkError = (error: unknown) => {
  if (error instanceof Error && error.message === "request_timeout") {
    return true;
  }

  return error instanceof TypeError;
};

const safeFetch = async <T>(
  path: string,
  init?: RequestInit,
  withJsonContentType = true,
  options?: { retries?: number; timeoutMs?: number }
): Promise<T> => {
  const method = (init?.method || "GET").toUpperCase();
  const retries = options?.retries ?? (method === "GET" ? 1 : 0);
  const timeoutMs = options?.timeoutMs ?? getRequestTimeoutMs();
  const urls = buildRequestUrls(path);

  debugLog("request:start", { path, method, retries, timeoutMs, urls });

  let lastError: unknown = null;

  for (let urlIndex = 0; urlIndex < urls.length; urlIndex += 1) {
    const requestUrl = urls[urlIndex];

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      let timerId = 0;

      try {
        const startedAt = Date.now();
        const timeoutPromise = new Promise<never>((_, reject) => {
          timerId = window.setTimeout(() => {
            if (controller) {
              try {
                controller.abort(new Error("request_timeout"));
              } catch {
                controller.abort();
              }
            }
            reject(new Error("request_timeout"));
          }, timeoutMs);
        });

        const fetchPromise = fetch(requestUrl, {
          ...init,
          ...(controller ? { signal: controller.signal } : {}),
          headers: {
            ...getHeaders(withJsonContentType),
            ...(init?.headers ?? {})
          }
        });

        const response = await Promise.race([fetchPromise, timeoutPromise]);

        window.clearTimeout(timerId);

        if (!response.ok) {
          let message = `接口调用失败: ${response.status}`;
          try {
            const payload = (await response.json()) as { message?: string };
            if (payload?.message) {
              message = payload.message;
            }
          } catch {
            // ignore parse error
          }
          throw new Error(message);
        }

        debugLog("request:success", {
          path,
          method,
          url: requestUrl,
          attempt,
          urlIndex,
          costMs: Date.now() - startedAt
        });

        return (await response.json()) as T;
      } catch (error) {
        window.clearTimeout(timerId);
        const isAbortTimeout = error instanceof Error && /request_timeout|aborted|AbortError/i.test(error.message);
        const normalizedError = isAbortTimeout ? new Error("request_timeout") : error;

        debugLog("request:error", {
          path,
          method,
          url: requestUrl,
          attempt,
          urlIndex,
          error: normalizedError instanceof Error ? normalizedError.message : String(normalizedError)
        });

        if (attempt < retries && isRetriableNetworkError(normalizedError)) {
          debugLog("request:retry", { path, method, url: requestUrl, nextAttempt: attempt + 1 });
          await sleep(350 * (attempt + 1));
          continue;
        }

        if (isRetriableNetworkError(normalizedError) && urlIndex < urls.length - 1) {
          debugLog("request:fallback-url", { path, from: requestUrl, to: urls[urlIndex + 1] });
          lastError = normalizedError;
          break;
        }

        if (normalizedError instanceof Error && normalizedError.message === "request_timeout") {
          throw new Error("网络超时，请稍后再试");
        }

        throw normalizedError;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("网络异常，请稍后再试");
};

export const createVoterToken = async (eventId = RUNTIME_EVENT_ID) => {
  const storageKey = `vote-token:${eventId}`;
  const cached = readLocalStorage(storageKey);

  if (cached) {
    debugLog("token:cached", { eventId });
    return cached;
  }

  if (USE_MOCK) {
    const token = `mock_${generateClientId()}`;
    writeLocalStorage(storageKey, token);
    debugLog("token:mock", { eventId });
    return token;
  }

  try {
    if (!fingerprintAgentPromise) {
      fingerprintAgentPromise = withTimeout(FingerprintJS.load(), 3000, "fp_load");
    }

    const agent = await fingerprintAgentPromise;
    const result = await withTimeout(agent.get(), 3000, "fp_get");
    const token = `fp_${result.visitorId}`;
    writeLocalStorage(storageKey, token);
    debugLog("token:fingerprint", { eventId });
    return token;
  } catch {
    const fallbackToken = `fp_fallback_${generateClientId()}`;
    writeLocalStorage(storageKey, fallbackToken);
    debugLog("token:fallback", { eventId });
    return fallbackToken;
  }
};

export const submitVote = async (
  payload: VoteSubmitRequest
): Promise<VoteSubmitResponse> => {
  debugLog("vote:submit:start", {
    eventId: payload.eventId,
    candidateId: payload.candidateId,
    candidateIds: payload.candidateIds,
    hasToken: Boolean(payload.voterToken)
  });

  if (USE_MOCK) {
    await mockDelay(700);
    return {
      success: true,
      message: "投票成功，感谢你的支持",
      voteId: `mock_${Date.now()}`,
      totalVotes: defaultVoteSettings.candidates.reduce(
        (sum, item) => sum + item.voteCount,
        0
      ) + 1
    };
  }

  const response = await safeFetch<VoteSubmitResponse>("/api/v1/votes", {
    method: "POST",
    body: JSON.stringify(payload)
  }, true, {
    retries: 0,
    timeoutMs: getSubmitTimeoutMs()
  });

  debugLog("vote:submit:done", {
    success: response.success,
    totalVotes: response.totalVotes,
    acceptedCount: response.acceptedCount
  });

  return response;
};

export const fetchResults = async (eventId = RUNTIME_EVENT_ID): Promise<VoteResultResponse> => {
  if (USE_MOCK) {
    await mockDelay(300);
    return {
      success: true,
      updatedAt: new Date().toISOString(),
      candidates: defaultVoteSettings.candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        voteCount: candidate.voteCount
      }))
    };
  }

  return safeFetch<VoteResultResponse>(
    `/api/v1/votes/results?eventId=${encodeURIComponent(eventId)}`,
    undefined,
    true,
    {
      retries: 1
    }
  );
};

export const fetchEventConfig = async (eventId = RUNTIME_EVENT_ID): Promise<VoteSettings> => {
  if (USE_MOCK) {
    return defaultVoteSettings;
  }

  const response = await safeFetch<{ success: boolean; data: VoteSettings }>(
    `/api/v1/events/config?eventId=${encodeURIComponent(eventId)}`,
    undefined,
    true,
    {
      retries: 1
    }
  );

  debugLog("config:fetched", {
    eventId: response.data.eventId,
    status: response.data.status,
    candidates: response.data.candidates.length,
    resultVisible: response.data.resultVisible
  });

  rememberRuntimeEventId(response.data.eventId);

  return {
    ...response.data,
    candidates: response.data.candidates.map((item) => ({
      ...item,
      avatar: toAbsoluteMediaUrl(item.avatar)
    }))
  };
};

export const fetchAdminConfig = async (eventId = RUNTIME_EVENT_ID): Promise<AdminConfig> => {
  const response = await safeFetch<{ success: boolean; data: AdminConfig }>(
    `/api/v1/admin/config?eventId=${encodeURIComponent(eventId)}`,
    {
      headers: getAdminHeaders()
    }
  );

  rememberRuntimeEventId(response.data.eventId);

  return {
    ...response.data,
    candidates: response.data.candidates.map((item) => ({
      ...item,
      avatarUrl: item.avatarUrl ? toAbsoluteMediaUrl(item.avatarUrl) : item.avatarUrl
    }))
  };
};

export const updateAdminConfig = async (payload: {
  eventId: string;
  status: "active" | "closed" | "draft";
  resultVisible: boolean;
  selectionMode: "single" | "multi";
  maxSelections: number;
  startTime?: string | null;
  endTime?: string | null;
  controlAction?: "start_now" | "stop_now" | "none";
}) => {
  return safeFetch<{ success: boolean; message: string }>("/api/v1/admin/config", {
    method: "PUT",
    headers: getAdminHeaders(),
    body: JSON.stringify(payload)
  });
};

export const createAdminCandidate = async (payload: {
  eventId: string;
  name: string;
  academy?: string;
  major?: string;
  song?: string;
  avatarUrl?: string;
  displayOrder?: number;
  status?: "active" | "inactive";
}) => {
  return safeFetch<{ success: boolean; message: string }>("/api/v1/admin/candidates", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify(payload)
  });
};

export const updateAdminCandidate = async (
  candidateId: string,
  payload: {
    eventId: string;
    name: string;
    academy?: string;
    major?: string;
    song?: string;
    avatarUrl?: string;
    displayOrder?: number;
    status?: "active" | "inactive";
  }
) => {
  return safeFetch<{ success: boolean; message: string }>(`/api/v1/admin/candidates/${candidateId}`, {
    method: "PUT",
    headers: getAdminHeaders(),
    body: JSON.stringify(payload)
  });
};

export const deleteAdminCandidate = async (eventId: string, candidateId: string) => {
  return safeFetch<{ success: boolean; message: string }>(
    `/api/v1/admin/candidates/${candidateId}?eventId=${eventId}`,
    {
      method: "DELETE",
      headers: getAdminHeaders()
    }
  );
};

export const uploadAvatar = async (file: File) => {
  const formData = new FormData();
  formData.append("avatar", file);

  const response = await safeFetch<{ success: boolean; data: { url: string } }>(
    "/api/v1/admin/upload-avatar",
    {
      method: "POST",
      headers: getAdminHeaders(false),
      body: formData
    },
    false
  );

  return toAbsoluteMediaUrl(response.data.url);
};
