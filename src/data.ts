import type { VoteSettings } from "./types";

export const defaultVoteSettings: VoteSettings = {
  eventId: "campus-singer-2026-final",
  title: "校园十大歌手大赛",
  subtitle: "请选择你最支持的一位选手，每人限投 1 票",
  ruleText:
    "单设备、用户只能进行单次投票，请谨慎投票",
  voteButtonText: "提交我的投票",
  resultVisible: true,
  status: "active", // 改为 "closed" 即可快捷关闭投票
  selectionMode: "single",
  maxSelections: 1,
  candidates: [
    {
      id: "singer-01",
      name: "林沐",
      major: "信息工程学院 · 软件工程",
      song: "夜空中最亮的星",
      avatar:
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=600&q=80",
      voteCount: 286
    },
    {
      id: "singer-02",
      name: "周屿",
      major: "经济管理学院 · 金融学",
      song: "平凡之路",
      avatar:
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=600&q=80",
      voteCount: 314
    },
    {
      id: "singer-03",
      name: "陈夏",
      major: "外国语学院 · 英语",
      song: "后来",
      avatar:
        "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=600&q=80",
      voteCount: 271
    },
    {
      id: "singer-04",
      name: "许舟",
      major: "土木工程学院 · 建筑学",
      song: "海阔天空",
      avatar:
        "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=600&q=80",
      voteCount: 327
    },
    {
      id: "singer-05",
      name: "沈知遥",
      major: "艺术学院 · 音乐表演",
      song: "这世界那么多人",
      avatar:
        "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80",
      voteCount: 298
    }
  ]
};
