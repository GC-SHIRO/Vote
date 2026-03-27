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
const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? "true") === "true";
const ADMIN_AUTH_HEADER = `Basic ${btoa("admin:131072")}`;

const mockDelay = (ms: number) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

let fingerprintAgentPromise: ReturnType<typeof FingerprintJS.load> | null = null;

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

const safeFetch = async <T>(path: string, init?: RequestInit, withJsonContentType = true): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...getHeaders(withJsonContentType),
      ...(init?.headers ?? {})
    }
  });

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

  return (await response.json()) as T;
};

export const createVoterToken = async () => {
  const storageKey = `vote-token:${defaultVoteSettings.eventId}`;
  const cached = readLocalStorage(storageKey);

  if (cached) {
    return cached;
  }

  if (USE_MOCK || !API_BASE_URL) {
    const token = `mock_${generateClientId()}`;
    writeLocalStorage(storageKey, token);
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
    return token;
  } catch {
    const fallbackToken = `fp_fallback_${generateClientId()}`;
    writeLocalStorage(storageKey, fallbackToken);
    return fallbackToken;
  }
};

export const submitVote = async (
  payload: VoteSubmitRequest
): Promise<VoteSubmitResponse> => {
  if (USE_MOCK || !API_BASE_URL) {
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

  return safeFetch<VoteSubmitResponse>("/api/v1/votes", {
    method: "POST",
    body: JSON.stringify(payload)
  });
};

export const fetchResults = async (eventId = defaultVoteSettings.eventId): Promise<VoteResultResponse> => {
  if (USE_MOCK || !API_BASE_URL) {
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
    `/api/v1/votes/results?eventId=${eventId}`
  );
};

export const fetchEventConfig = async (): Promise<VoteSettings> => {
  if (USE_MOCK || !API_BASE_URL) {
    return defaultVoteSettings;
  }

  const response = await safeFetch<{ success: boolean; data: VoteSettings }>(
    `/api/v1/events/config?eventId=${defaultVoteSettings.eventId}`
  );

  return {
    ...response.data,
    candidates: response.data.candidates.map((item) => ({
      ...item,
      avatar: toAbsoluteMediaUrl(item.avatar)
    }))
  };
};

export const fetchAdminConfig = async (eventId: string): Promise<AdminConfig> => {
  const response = await safeFetch<{ success: boolean; data: AdminConfig }>(
    `/api/v1/admin/config?eventId=${eventId}`,
    {
      headers: getAdminHeaders()
    }
  );

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
