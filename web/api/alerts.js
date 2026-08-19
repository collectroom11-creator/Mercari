// 디스코드 채널의 메시지 기록을 읽어와서 알림 목록으로 변환한다.
// 별도 저장소(DB) 없이 디스코드 자체를 저장소로 쓴다 - 봇이 이미 embed로
// 보내는 title(브랜드)/author(플랫폼)/description(가격)/image/url을 그대로
// 파싱하고, "관심"/"읽음" 상태는 봇 계정 자신의 이모지 반응(⭐/✅) 존재
// 여부로 판단한다(reactions[].me).
const INTERESTED_EMOJI = "⭐";
const READ_EMOJI = "✅";

module.exports = async function handler(req, res) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;
  if (!token || !channelId) {
    res.status(500).json({ error: "서버 설정 누락: DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID" });
    return;
  }

  const resp = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages?limit=100`,
    { headers: { Authorization: `Bot ${token}` } }
  );

  if (!resp.ok) {
    const text = await resp.text();
    res.status(resp.status).json({ error: `디스코드 API 오류 (${resp.status}): ${text}` });
    return;
  }

  const messages = await resp.json();

  if (req.query && req.query.debug) {
    res.status(200).json({
      debug: true,
      isArray: Array.isArray(messages),
      count: Array.isArray(messages) ? messages.length : null,
      sample: Array.isArray(messages) ? messages.slice(0, 2) : messages,
    });
    return;
  }

  const alerts = [];
  for (const m of messages) {
    for (const embed of m.embeds || []) {
      const reactions = m.reactions || [];
      const interested = reactions.some((r) => r.emoji?.name === INTERESTED_EMOJI && r.me);
      const read = reactions.some((r) => r.emoji?.name === READ_EMOJI && r.me);
      alerts.push({
        messageId: m.id,
        platform: embed.author?.name || "",
        brand: embed.title || "",
        priceText: embed.description || "",
        url: embed.url || "",
        image: embed.image?.url || "",
        createdAt: m.timestamp,
        interested,
        read,
      });
    }
  }

  res.status(200).json({ alerts });
};
