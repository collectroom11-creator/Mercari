# 메루카리 브랜드 알림 봇

지정한 브랜드(패션 > 남성 패션 카테고리, 10,000엔 이하)에 새 매물이 올라오면
디스코드 채널로 알려주는 스크립트예요. GitHub Actions로 15분마다 자동 실행됩니다.

## 1. 디스코드 웹훅 만들기

1. 알림 받을 디스코드 채널의 설정(톱니바퀴) → **연동(Integrations)** → **웹후크(Webhooks)** → **새 웹후크**
2. 이름/아이콘 원하는 대로 설정하고 **웹후크 URL 복사**
3. 이 URL은 절대 남에게 공유하지 마세요 (누구나 그 URL로 채널에 메시지를 보낼 수 있어요)

## 2. GitHub에 레포지토리 만들기

1. github.com에서 새 레포지토리 생성 (Private 추천)
2. 이 폴더(`main.py`, `requirements.txt`, `.github/`, `data/`) 전체를 업로드/푸시
3. 레포 **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `DISCORD_WEBHOOK_URL`
   - Value: 1번에서 복사한 웹훅 URL
4. **Settings → Actions → General → Workflow permissions**에서
   "Read and write permissions"로 설정 (seen.json을 커밋하기 위해 필요)

## 3. 확인

- **Actions** 탭 → `Mercari brand alert` 워크플로우 → **Run workflow**로 수동 실행해서
  에러 없이 도는지 먼저 확인하세요.
- 첫 실행에서는 알림이 오지 않아요 (현재 매물을 기준점으로만 저장). 그 다음 실행부터
  새로 올라온 매물만 알림이 와요.
- 이후로는 15분마다 자동으로 돕니다.

## 조건 수정하기

`main.py` 상단에서 다음을 고치면 돼요:

- `TARGET_BRANDS`: 브랜드 추가/삭제
- `PRICE_MAX`: 가격 상한 (엔)
- `.github/workflows/check.yml`의 `cron`: 확인 주기

## 참고 / 주의사항

- 이 스크립트는 mercari.jp의 비공식 오픈소스 래퍼인 [mercapi](https://github.com/take-kun/mercapi)를
  사용해요. 공식 API가 아니라서 Mercari 쪽 내부 변경으로 갑자기 동작하지 않게 될 수 있어요.
- 브랜드/카테고리 ID는 자동으로 조회하지만, 이름 매칭이 100% 정확하다고 보장할 수는 없어요.
  실행 로그(Actions 탭 → 최근 실행 → 로그)에서 "카테고리 매칭", "검색 대상 브랜드" 부분을 보고
  의도한 대로 잡혔는지 한 번 확인해보세요. 매칭 안 된 브랜드는 경고로 표시됩니다.
- 알림에는 상품 사진도 함께 오도록 되어있어요. 다만 라이브러리 버전에 따라 사진 URL이 담긴
  속성 이름이 다를 수 있어서, 혹시 첫 알림에 사진이 안 보이면 Actions 로그에서
  "이미지 URL을 찾지 못했습니다" 경고가 있는지 확인해주세요 — 있으면 알려주시면 고쳐드릴게요.
- 과도하게 자주 요청하면 계정/IP 제한을 받을 수 있으니 주기를 너무 짧게(예: 1분) 잡지 않는 걸
  권장해요.
