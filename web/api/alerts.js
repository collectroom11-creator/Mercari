// 디스코드 채널의 메시지 기록을 읽어와서 알림 목록으로 변환한다.
// 알림 내용(제목/가격/이미지)은 디스코드 메시지의 embed에서 그대로 읽지만,
// "관심"/"읽음" 상태는 더는 디스코드 이모지 반응으로 저장하지 않는다 -
// 디스코드 반응 API는 레이트리밋이 빡빡해서 여러 개를 한꺼번에 처리하면
// 일부가 조용히 실패했다. 대신 Redis(Upstash, @vercel/kv)에 읽음/관심
// 상품 id 집합을 저장한다 - 한 번의 SMEMBERS 조회로 전체 상태를 가져올
// 수 있어 훨씬 빠르고 안정적이다.
const { Redis } = require("@upstash/redis");

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
  // 디스코드 메시지 id는 순수 숫자로만 된 문자열이라, 기본 자동
  // 역직렬화(JSON.parse)를 거치면 숫자로 바뀌어서 정밀도가 깨지고
  // readSet.has(m.id) 비교도 타입이 달라져(number !== string) 항상
  // 실패한다. 그래서 smembers 결과를 원문 문자열 그대로 받는다.
  automaticDeserialization: false,
});

module.exports = async function handler(req, res) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;
  if (!token || !channelId) {
    res.status(500).json({ error: "서버 설정 누락: DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID" });
    return;
  }

  const [discordResp, readIds, interestedIds] = await Promise.all([
    fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=100`, {
      headers: { Authorization: `Bot ${token}` },
    }),
    redis.smembers("read"),
    redis.smembers("interested"),
  ]);

  if (!discordResp.ok) {
    const text = await discordResp.text();
    res.status(discordResp.status).json({ error: `디스코드 API 오류 (${discordResp.status}): ${text}` });
    return;
  }

  const readSet = new Set(readIds);
  const interestedSet = new Set(interestedIds);
  const messages = await discordResp.json();

  const alerts = [];
  for (const m of messages) {
    for (const embed of m.embeds || []) {
      alerts.push({
        messageId: m.id,
        platform: embed.author?.name || "",
        brand: embed.title || "",
        priceText: embed.description || "",
        url: embed.url || "",
        image: embed.image?.url || "",
        createdAt: m.timestamp,
        interested: interestedSet.has(m.id),
        read: readSet.has(m.id),
      });
    }
  }

  res.status(200).json({ alerts });
};
