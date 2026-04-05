import http from 'k6/http';
import { check, sleep } from 'k6';

// 测试配置：模拟真实业务的波峰波谷
export const options = {
  stages: [
    { duration: '30s', target: 200 },  // 预热：30秒内用户量爬升到 200
    { duration: '1m', target: 1000 },  // 爆发：1分钟内用户暴增至 1000（模拟活动推送瞬间）
    { duration: '2m', target: 1000 },  // 持续：维持 1000 并发稳定持续 2 分钟
    { duration: '30s', target: 0 },    // 冷却：活动热度退潮，30秒内降至 0
  ],
  thresholds: {
    // 产品级 SLA 要求：
    http_req_duration: ['p(95)<500'], // 95% 的用户请求必须在 500ms 内响应（保障丝滑体验）
    http_req_failed: ['rate<0.01'],   // 整体失败率不能超过 1%
  },
};

// 目标服务器地址 (根据实际 Nginx 端口配置可能需要加 :3000 等，这里默认 HTTP 80/443 转发)
const BASE_URL = 'http://8.145.62.223'; 

export default function () {
  // 0. 前端页面加载（静态资源加载压力）
  // 模拟真实用户打开网页首先加载 HTML、JS、CSS
  let htmlRes = http.get(`${BASE_URL}/`);
  check(htmlRes, {
    '前端静态页面加载成功': (r) => r.status === 200,
  });
  
  // 模拟浏览器解析页面后去拿静态资源的时间（大概需要几百ms到1s）
  sleep(Math.random() * 0.5 + 0.2);

  // 1. 用户进入页面：前端通过 JS 自动拉取投票选项列表和配置
  // 刚才查到真实的 eventId 是: "campus-singer-2026-final"
  const eventId = "campus-singer-2026-final"; 
  let res = http.get(`${BASE_URL}/api/v1/events/config?eventId=${eventId}`);
  check(res, {
    '拉取配置成功': (r) => r.status === 200,
  });

  // 模拟真实用户的思考时间（浏览选项、犹豫投给谁）：0.5 到 2 秒
  sleep(Math.random() * 1.5 + 0.5);

  // 2. 用户执行动作：点击投票
  // 刚才查到的真实 candidateId，比如 "singer-01" 到 "singer-05"
  const candidates = ["singer-01", "singer-02", "singer-03", "singer-04", "singer-05"];
  const targetCandidateId = candidates[Math.floor(Math.random() * candidates.length)];
  
  // 【核心解答】解决设备指纹重复问题：
  // 真实前端是用 fingerprintjs 生成字符串传给后端 voterToken 字段
  // k6 每次循环动态生成一个伪随机唯一字符串，就能完美伪装成无数台新设备
  const mockFingerprint = `fp_k6_${__VU}_${__ITER}_${Math.random().toString(36).substring(2, 10)}`;
  
  // 生成随机合法学号 2024xxxxxxxx
  const mockStudentId = `2024${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;

  const payload = JSON.stringify({
    eventId: eventId,
    candidateId: targetCandidateId,
    voterToken: mockFingerprint, // 后端会把这个当做真实的设备指纹处理，成功绕过防刷限制
    studentId: mockStudentId
  });

  const headers = { 'Content-Type': 'application/json' };
  
  let voteRes = http.post(`${BASE_URL}/api/v1/votes`, payload, { headers });
  check(voteRes, {
    '投票操作成功': (r) => r.status === 200,
  });
  
  // 模拟请求间隔
  sleep(1);
}
