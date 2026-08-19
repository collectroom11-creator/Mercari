// "관심"/"읽음" 버튼 클릭 시 호출됨. 실제로는 해당 디스코드 메시지에
// 봇 계정의 이모지 반응을 추가/제거하는 것으로 상태를 저장한다
// (별도 DB 없음 - alerts.js가 다시 읽어올 때 이 반응으로 상태를 복원한다).
// 디스코드는 반응 추가/삭제에 특히 엄격하게 레이트리밋을 걸어서, 여러 개를
// 짧은 시간에 요청하면 뒤쪽 요청들이 429로 거부된다. 재시도 없이 무시하면
// "몇 개는 읽음 처리 안 됨" 문제가 생기므로, retry_after만큼 기다렸다
// 재시도한다(메루카리/야후옥션 봇의 디스코드 전송 로직과 동일한 패턴).
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setReaction(url, method, token, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const resp = await fetch(url, { method, headers: { Authorization: `Bot ${token}` } });
    if (resp.status !== 429) return resp;
    let retryAfter = 1;
    try {
      retryAfter = (await resp.json()).retry_after ?? 1;
    } catch {
      // 응답 본문이 없어도 기본값으로 재시도
    }
    await sleep((retryAfter + 0.2) * 1000);
  }
  return fetch(url, { method, headers: { Authorization: `Bot ${token}` } });
}

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

  const resp = await setReaction(url, on ? "PUT" : "DELETE", token);

  if (!resp.ok && resp.status !== 204) {
    const text = await resp.text();
    res.status(resp.status).json({ error: text });
    return;
  }

  res.status(200).json({ ok: true });
};
