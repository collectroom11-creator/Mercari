"""테스트용 더미 알림을 실제 알림과 동일한 embed 형식으로 디스코드에 보낸다."""
import os
import httpx

env = {}
env_path = os.path.join(os.path.dirname(__file__), ".env")
with open(env_path, encoding="utf-8") as f:
    for line in f:
        if "=" in line:
            key, _, value = line.strip().partition("=")
            env[key] = value

webhook_url = env.get("DISCORD_WEBHOOK_URL")
if not webhook_url:
    raise SystemExit("scripts/.env에 DISCORD_WEBHOOK_URL이 없습니다.")

embed = {
    "author": {"name": "메루카리"},
    "title": "Dior Homme (테스트 더미 3:4)",
    "url": "https://kenzpost.com/mercari/bid.s/https://jp.mercari.com/item/m00000000001",
    "description": "💴 12345円",
    "color": 0x2ECC71,
    "image": {"url": "https://placehold.co/600x800/4C1D95/fff?text=3:4"},
}

resp = httpx.post(webhook_url, json={"embeds": [embed]}, timeout=15)
print("status:", resp.status_code)
if resp.status_code >= 300:
    print(resp.text)
