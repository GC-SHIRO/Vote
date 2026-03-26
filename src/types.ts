export type Candidate = {
  id: string;
  name: string;
  major: string;
  song: string;
  avatar: string;
  voteCount: number;
};

export type VoteSettings = {
  eventId: string;
  title: string;
  subtitle: string;
  ruleText: string;
  voteButtonText: string;
  resultVisible: boolean;
  status: "active" | "closed";
  selectionMode?: "single" | "multi";
  maxSelections?: number;
  candidates: Candidate[];
};

export type VoteSubmitRequest = {
  eventId: string;
  candidateId?: string;
  candidateIds?: string[];
  voterToken: string;
};

export type VoteSubmitResponse = {
  success: boolean;
  message: string;
  voteId?: string;
  voteIds?: string[];
  totalVotes?: number;
  acceptedCount?: number;
};

export type VoteResultResponse = {
  success: boolean;
  updatedAt: string;
  candidates: Array<Pick<Candidate, "id" | "name" | "voteCount">>;
};

export type AdminCandidate = {
  id: string;
  name: string;
  academy: string | null;
  major: string | null;
  song: string | null;
  avatarUrl: string | null;
  displayOrder: number;
  status: "active" | "inactive";
};

export type AdminConfig = {
  eventId: string;
  status: "active" | "closed" | "draft";
  resultVisible: boolean;
  selectionMode: "single" | "multi";
  maxSelections: number;
  startTime: string | null;
  endTime: string | null;
  candidates: AdminCandidate[];
};
