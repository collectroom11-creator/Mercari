// 디스코드 채널의 메시지 기록을 읽어와서 알림 목록으로 변환한다.
// 알림 내용(제목/가격/이미지)은 디스코드 메시지의 embed에서 그대로 읽지만,
// "관심"/"읽음" 상태는 더는 디스코드 이모지 반응으로 저장하지 않는다 -
// 디스코드 반응 API는 레이트리밋이 빡빡해서 여러 개를 한꺼번에 처리하면
// 일부가 조용히 실패했다. 대신 Redis(Upstash, @vercel/kv)에 읽음/관심
// 상품 id 집합을 저장한다.
// 상태 조회는 SMEMBERS(집합 전체 다운로드)가 아니라 SMISMEMBER로 "지금 가져온
// 메시지 id들만" 묻는다. 읽음 집합은 8월부터 지워지지 않고 계속 커져서, 매 폴링마다
// 전체를 받으면 Upstash 무료 플랜 전송량(월 10GB)을 다 써버려 DB가 막혔었다.
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

  const discordResp = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=100`, {
    headers: { Authorization: `Bot ${token}` },
  });

  if (!discordResp.ok) {
    const text = await discordResp.text();
    res.status(discordResp.status).json({ error: `디스코드 API 오류 (${discordResp.status}): ${text}` });
    return;
  }

  const messages = await discordResp.json();
  const ids = messages.map((m) => m.id);
  // automaticDeserialization이 꺼져 있어서 플래그가 숫자 1 또는 문자열 "1"로 올 수 있다.
  const [readFlags, interestedFlags] = ids.length
    ? await Promise.all([redis.smismember("read", ids), redis.smismember("interested", ids)])
    : [[], []];
  const readSet = new Set(ids.filter((_, i) => Number(readFlags[i]) === 1));
  const interestedSet = new Set(ids.filter((_, i) => Number(interestedFlags[i]) === 1));

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
