// "관심"/"읽음" 버튼 클릭 시 호출됨. 실제로는 해당 디스코드 메시지에
// 봇 계정의 이모지 반응을 추가/제거하는 것으로 상태를 저장한다
// (별도 DB 없음 - alerts.js가 다시 읽어올 때 이 반응으로 상태를 복원한다).
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 허용" });
    return;
  }

  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;
  if (!token || !channelId) {
    res.status(500).json({ error: "서버 설정 누락: DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID" });
    return;
  }

  const { messageId, emoji, on } = req.body || {};
  if (!messageId || !emoji) {
    res.status(400).json({ error: "messageId, emoji가 필요합니다" });
    return;
  }

  const encodedEmoji = encodeURIComponent(emoji);
  const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`;

  const resp = await fetch(url, {
    method: on ? "PUT" : "DELETE",
    headers: { Authorization: `Bot ${token}` },
  });

  if (!resp.ok && resp.status !== 204) {
    const text = await resp.text();
    res.status(resp.status).json({ error: text });
    return;
  }

  res.status(200).json({ ok: true });
};
