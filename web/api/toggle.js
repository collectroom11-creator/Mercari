// "관심"/"읽음" 버튼 클릭 시 호출됨. Redis 집합("read" 또는 "interested")에
// 상품 id를 추가/제거하는 것으로 상태를 저장한다. 디스코드 이모지 반응
// 방식은 레이트리밋 때문에 여러 개를 한꺼번에 처리하면 일부가 조용히
// 실패했었는데, Redis는 그런 제약이 없어 한 번에 딱 처리된다.
const { Redis } = require("@upstash/redis");

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const VALID_KINDS = new Set(["read", "interested"]);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 허용" });
    return;
  }

  const { messageId, kind, on } = req.body || {};
  if (!messageId || !VALID_KINDS.has(kind)) {
    res.status(400).json({ error: "messageId와 kind('read' | 'interested')가 필요합니다" });
    return;
  }

  if (on) {
    await redis.sadd(kind, messageId);
  } else {
    await redis.srem(kind, messageId);
  }

  res.status(200).json({ ok: true });
};
