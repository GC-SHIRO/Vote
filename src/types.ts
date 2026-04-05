export type Candidate = {
  id: string;
  name: string;
  major: string;
  song: string;
  avatar: string;
  voteCount: number;
};

export type LotteryWinner = {
  studentId: string;
  round: number;
  createdAt?: string;
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
  lotteryStatus?: "not_started" | "drawn";
  lotteryWinner?: string; // 兼容旧数据
  lotteryWinners?: string[]; // 当前显示的中奖学号列表
  lotteryWinnerList?: LotteryWinner[]; // 详细中奖列表
  lotteryDrawCount?: number; // 每次抽奖人数
  useReservedIds?: boolean;
  candidates: Candidate[];
};

export type VoteSubmitRequest = {
  eventId: string;
  candidateId?: string;
  candidateIds?: string[];
  voterToken: string;
  studentId: string;
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

export type AdminLotteryWinner = {
  studentId: string;
  round: number;
  isDisplayed: boolean;
  createdAt?: string;
};

export type AdminConfig = {
  eventId: string;
  status: "active" | "closed" | "draft";
  resultVisible: boolean;
  selectionMode: "single" | "multi";
  maxSelections: number;
  lotteryStatus: "not_started" | "drawn";
  lotteryWinner: string | null; // 兼容旧数据
  lotteryWinners: string[]; // 当前显示的中奖学号
  lotteryWinnerList: AdminLotteryWinner[]; // 所有中奖历史
  lotteryDrawCount: number; // 每次抽奖人数设置
  useReservedIds: boolean;
  startTime: string | null;
  endTime: string | null;
  candidates: AdminCandidate[];
};
