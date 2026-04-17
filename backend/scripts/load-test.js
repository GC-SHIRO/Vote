import http from 'k6/http';
import { check, sleep } from 'k6';

// 测试配置：模拟真实业务的波峰波谷
export const options = {
  stages: [
  { duration: '10s', target: 1000 },
  { duration: '20s', target: 1000 },
  { duration: '10s', target: 0 },
  ],
  thresholds: {
    // 产品级 SLA 要求：
    http_req_duration: ['p(95)<500'], // 95% 的用户请求必须在 500ms 内响应（保障丝滑体验）
    http_req_failed: ['rate<0.01'],   // 整体失败率不能超过 1%
  },
};

// 目标服务器地址（请根据实际 IP 修改）
const BASE_URL = 'http://8.161.226.72';

// 活动 ID
const EVENT_ID = "campus-singer-2026-final";

// 生成随机合法学号（2020-2025 开头）
function generateStudentId() {
  const year = 2020 + Math.floor(Math.random() * 6); // 2020-2025
  const random = String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
  return `${year}${random}`;
}

// 生成设备指纹
function generateFingerprint() {
  return `fp_k6_${__VU}_${__ITER}_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`;
}

// 随机选择候选人
function pickCandidates(candidates, mode, maxSelections) {
  if (mode === 'single') {
    // 单选模式：随机选1个
    return [candidates[Math.floor(Math.random() * candidates.length)]];
  } else {
    // 多选模式：随机选1到maxSelections个
    const count = Math.max(1, Math.floor(Math.random() * maxSelections) + 1);
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }
}

export default function () {
  // 0. 前端页面加载（静态资源加载压力）
  let htmlRes = http.get(`${BASE_URL}/`);
  check(htmlRes, {
    '前端静态页面加载成功': (r) => r.status === 200,
  });
  
  // 模拟浏览器解析静态资源的时间
  sleep(Math.random() * 0.5 + 0.2);

  // 1. 获取活动配置和候选人列表
  let configRes = http.get(`${BASE_URL}/api/v1/events/config?eventId=${EVENT_ID}`);
  check(configRes, {
    '拉取配置成功': (r) => r.status === 200,
  });

  // 解析配置
  let config = {};
  try {
    config = JSON.parse(configRes.body).data || {};
  } catch (e) {
    console.error('解析配置失败:', e);
  }

  // 检查活动状态
  if (config.status !== 'active') {
    console.log('活动未开始或已结束，跳过投票');
    sleep(1);
    return;
  }

  // 获取候选人列表和投票模式
  const candidates = (config.candidates || []).map(c => c.id);
  if (candidates.length === 0) {
    console.error('没有可用候选人');
    return;
  }

  const selectionMode = config.selectionMode || 'single';
  const maxSelections = config.maxSelections || 1;

  // 模拟用户浏览时间
  sleep(Math.random() * 1.5 + 0.5);

  // 2. 选择候选人
  const selectedCandidates = pickCandidates(candidates, selectionMode, maxSelections);
  
  // 生成投票数据
  const fingerprint = generateFingerprint();
  const studentId = generateStudentId();

  // 构建请求体
  const payload = {
    eventId: EVENT_ID,
    voterToken: fingerprint,
    studentId: studentId,
  };

  // 根据单选/多选模式设置不同参数
  if (selectionMode === 'single') {
    payload.candidateId = selectedCandidates[0];
  } else {
    payload.candidateIds = selectedCandidates;
  }

  const headers = { 'Content-Type': 'application/json' };
  
  // 3. 提交投票
  let voteRes = http.post(
    `${BASE_URL}/api/v1/votes`, 
    JSON.stringify(payload), 
    { headers }
  );
  
  check(voteRes, {
    '投票操作成功': (r) => r.status === 200,
    '投票业务成功': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true;
      } catch {
        return false;
      }
    },
  });

  // 打印错误日志用于调试
  if (voteRes.status !== 200) {
    console.error(`投票失败: status=${voteRes.status}, body=${voteRes.body}`);
  } else {
    const body = JSON.parse(voteRes.body);
    if (!body.success) {
      console.error(`投票业务失败: ${body.message}`);
    }
  }
  
  // 模拟请求间隔
  sleep(1);
}
