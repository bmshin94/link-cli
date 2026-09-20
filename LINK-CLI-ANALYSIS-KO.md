# Link CLI 전수조사 & 활용 정리 (한국어)

> 작성: Claude Code 세션 대화 정리본
> 저장소(내 포크): https://github.com/bmshin94/link-cli
> 원본(업스트림): https://github.com/stripe/link-cli
> 기준 커밋: `40c10fb` / `@stripe/link-cli` v0.20.0, `@stripe/link-sdk` v0.5.0

---

## 1. 이게 뭐하는 프로젝트인가

**Stripe Link CLI = "AI 에이전트용 지갑(Agent Wallet)"**

AI 에이전트가 사용자를 대신해 결제해야 할 때, 사용자의 **진짜 카드번호를 주지 않고**
Link 지갑에서 **1회용(one-time-use) 결제 수단**을 발급받게 해주는 커맨드라인 도구다.

핵심 문제의식: "에이전트한테 내 카드 줄 수 있어?" → 못 준다.
해결: 에이전트는 *결제 요청(spend request)* 만 만들고, **사람이 Link 앱에서 승인**해야
그때 1회용 크리덴셜이 떨어진다. 한도·유효시간·용처가 묶여 있다.

### 발급 가능한 크리덴셜 3종

| 타입 | 용도 | 비고 |
|---|---|---|
| **Virtual Card (PAN)** | 일반 웹 체크아웃 폼 | 어디서나 사용 가능, Stripe 가맹점 아니어도 됨 |
| **Link Pay Token (LPT)** | Stripe 호스티드 체크아웃 | DOM의 `data-stripe-merchant-account` 필요, 30분 유효 |
| **Shared Payment Token (SPT)** | MPP(HTTP 402) 기계 결제 | `mpp pay`로 API 결제 자동화 |

---

## 2. 저장소 구조 (모노레포)

pnpm workspace + Turborepo.

```
link-cli/
├─ packages/
│  ├─ cli/            @stripe/link-cli v0.20.0  ← 실제 CLI (incur + Ink/React)
│  ├─ sdk/            @stripe/link-sdk v0.5.0   ← TypeScript API 클라이언트
│  ├─ sdk-go/         Go SDK (동일 리소스 미러링)
│  └─ typescript-config/  공용 tsconfig (비공개)
├─ skills/            Agent Skills 3종
│  ├─ link-cli/                 설치·인증 가이드
│  ├─ create-payment-credential/ 결제 크리덴셜 발급
│  └─ financial-insights/        읽기 전용 금융 데이터 조회
├─ plugins/
│  ├─ link/           Claude / Codex 플러그인 (.claude-plugin, .codex-plugin)
│  └─ cursor-link/    Cursor 플러그인
├─ .claude-plugin/    Claude 플러그인 마켓플레이스 매니페스트
├─ .cursor-plugin/ .codex-plugin/ .agents/   각 에이전트 생태계용 매니페스트
├─ .mcp.json          MCP 서버 등록용 (npx @stripe/link-cli --mcp)
├─ docs/  scripts/  .github/workflows/  (ci, release, jira)
└─ CLAUDE.md          에이전트용 저장소 가이드 (약 23KB)
```

총 TS/TSX/Go 소스 약 **26,600 라인**.

### 내 포크와 업스트림 차이
업스트림 `e104398` 대비 변경점은 **`CLAUDE.md` 26줄 추가(카리나 페르소나 가이드)** 뿐.
즉 코드 로직은 Stripe 원본 그대로다.

---

## 3. 전체 명령어 맵

```
link-cli
├─ auth login | upgrade | logout | status
├─ user-info retrieve
├─ payment-methods list | add
├─ shipping-address list
├─ spend-request create | update | retrieve | request-approval | cancel | list
├─ mpp pay | decode
├─ transactions list        (financial insights)
├─ balances list            (financial insights)
├─ sources list             (financial insights)
├─ report                   결제 시도 결과 리포팅 (/agent_observations)
├─ identity attestations request   (숨김: LINK_IDENTITY_COMMANDS=1)
├─ serve                    MCP를 HTTP로 노출 (기본 127.0.0.1:54321)
├─ demo / onboard           대화형 데모·초기설정 (TTY 필요, 항상 테스트모드)
└─ --mcp / --llms-full / --schema / --format
```

---

## 4. 핵심 플로우 (Spend Request 라이프사이클)

```
 auth login  ──(OAuth 2.0 Device Authorization Grant)──►  login.link.com
    │            verification URL + 짧은 문구 → 사용자가 Link 앱에서 승인
    ▼
 spend-request create   (merchant_name, merchant_url, context≥100자, amount(센트))
    │
    ▼
 request-approval   ──► 사용자 폰에 푸시 알림 (10분 내 승인 필요)
    │
    ▼
 approved  ──► retrieve --include card  ──► { number, cvc, exp, billing_address, valid_until }
    │                                        (12시간 유효)
    └─ requires_action (3DS 등) → auto_resume면 계속 폴링
```

### 정책 한도

| 항목 | 값 |
|---|---|
| 건당 최대 | $500 (50,000 센트) |
| 승인 대기 창 | 10분 |
| 크리덴셜 유효기간 | 생성 후 12시간 |
| 일일 한도 | $500 |
| 30일 한도 | $20,000 |
| 동시 활성 요청 | 30건 (승인상태는 10건) |
| 생성 레이트 | 시간당 50건 / 60일간 200건 |

> ⚠️ 현재 **미국 Link 계정만** 지원. (`For now, this is only available to US Link accounts.`)

---

## 5. 아키텍처 포인트 — 배울 게 많은 부분

### 5-1. zod 스키마 = 단일 진실 공급원
`schema.ts`에 zod로 옵션을 정의하면 `incur` 프레임워크가
**CLI 플래그 + MCP 툴 정의 + `--schema` JSON + `--llms-full` 문서**를 자동 생성한다.
사람용 CLI와 에이전트용 MCP를 따로 안 짜도 되는 구조.

### 5-2. TTY 감지 기반 이중 출력
- TTY(사람) → Ink/React 인터랙티브 UI
- non-TTY(에이전트) → `toon` 포맷(LLM 친화 압축 텍스트) 기본,
  `--format json|yaml|md|jsonl` 선택 가능

### 5-3. `_next` 연속 실행 힌트
에이전트 모드에서 "다음에 이 명령을 실행하라"를 응답에 담아준다.
`_next.pay_argv = { command, args[] }`(권장) + `_next.pay_command`(문자열 호환용).

### 5-4. 보안 설계 (이게 진짜 하이라이트)
| 위협 | 대응 |
|---|---|
| 서버 응답의 ANSI 이스케이프로 터미널 승인 UI 위조 | `sanitizeDeep()` — 리소스 프록시 경계에서 전량 살균 |
| 에이전트가 실행하는 명령 문자열에 `$(...)`, `;` 주입 | `shellQuote()` / `shellCommand()` 강제, 서버 발급 ID까지 예외 없이 |
| `serve`의 HTTP 호출자 = CLI 소유자 아님 | 권한 경계로 취급, 경로 엄격 파싱, 기본 루프백 바인딩 |
| 카드정보가 에이전트 트랜스크립트에 남음 | `--output-file` (0600) + stdout 리댁션 |
| 업그레이드 도중 세션 유실 | *지연 세션 교체* — 승인 성공 시에만 새 토큰 스왑 + 구 grant 폐기 |
| 에이전트 신원 증명 | Privacy Pass Blind RSA (RFC 9578 type 0x0002) 어테스테이션 토큰 |

---

## 6. 설치 및 사용법

```bash
# 설치
npm i -g @stripe/link-cli
# 또는
npx @stripe/link-cli

# 가이드형 초기설정 + 데모 (테스트모드, 실제 결제 없음)
link-cli onboard

# 로그인
link-cli auth login --client-name "Claude Code"
link-cli auth status

# 결제수단 확인
link-cli payment-methods list

# 결제 요청 생성 + 승인 요청
link-cli spend-request create \
  --merchant-name "Stripe Press" \
  --merchant-url "https://press.stripe.com" \
  --context "100자 이상의 구매 맥락 설명..." \
  --amount 3500 \
  --request-approval

# 카드 받기 (파일로 안전하게)
link-cli spend-request retrieve lsrq_001 --include card \
  --output-file /tmp/card.json --format json
```

### 에이전트 연동 3가지 방식
```bash
# (1) Skills
npx skills add stripe/link-cli

# (2) MCP (stdio)  →  .mcp.json
{ "mcpServers": { "link": { "command": "npx", "args": ["@stripe/link-cli", "--mcp"] } } }

# (3) MCP (HTTP)
link-cli serve            # 127.0.0.1:54321, POST /mcp
```

---

## 7. 플러그인? 스킬? MCP? → **전부 다**

본체는 **npm CLI 바이너리**이고, 나머지는 배포 껍데기다.

| 형태 | 위치 | 설명 |
|---|---|---|
| CLI | `packages/cli` → `link-cli` bin | 본체 |
| MCP 서버 | `--mcp` (stdio) / `serve` (HTTP) | 같은 CLI가 MCP로 변신 |
| Agent Skills | `skills/*/SKILL.md` | `allowed-tools`로 `Bash(link-cli:*)`만 허용 |
| Claude 플러그인 | `.claude-plugin/marketplace.json`, `plugins/link` | 스킬+MCP 묶음 |
| Cursor / Codex 플러그인 | `plugins/cursor-link`, `.codex-plugin` | 동일 패턴 |
| SDK | `@stripe/link-sdk` (TS), `packages/sdk-go` (Go) | 직접 코딩용 |

**하나의 CLI를 네 가지 생태계에 동시 유통하는 패키징 전략** — 이 구조 자체가 참고 자산.

---

## 8. API 토큰이 필요한가?

- **Stripe 시크릿 키(sk_live_...)는 필요 없다.** 가맹점 계정 불필요.
- 대신 **Link 개인 계정 + OAuth 2.0 Device Flow** 로 로그인한다.
  - 인증 서버: `https://login.link.com`, API: `https://api.link.com`
  - `client_id`는 CLI에 하드코딩(`lwlpk_U7Qy7ThG69STZk`) — 공개 클라이언트
  - 토큰은 `conf` 패키지로 로컬 저장, `--auth <path>` / `LINK_AUTH_FILE`로 경로 변경 가능
- CI/서버용 오버라이드: `LINK_ACCESS_TOKEN`, `LINK_REFRESH_TOKEN`, `LINK_NO_REFRESH`
- 권한(scope)은 `auth upgrade`로 나중에 확대 가능 (기존 세션 유지한 채)
- **진짜 진입장벽은 토큰이 아니라 "미국 Link 계정"**

### 환경변수 정리
| 변수 | 효과 |
|---|---|
| `LINK_AUTH_FILE` | 인증 파일 경로 |
| `LINK_ACCESS_TOKEN` | 저장소 무시하고 이 토큰 사용 |
| `LINK_REFRESH_TOKEN` | 만료 시 갱신용 |
| `LINK_NO_REFRESH` | 자동 갱신 금지 |
| `LINK_API_BASE_URL` / `LINK_AUTH_BASE_URL` | 엔드포인트 오버라이드 |
| `LINK_HTTP_PROXY` | 프록시 경유 (undici 필요) |
| `LINK_IDENTITY_COMMANDS` | 숨김 identity 명령 활성화 |
| `NO_UPDATE_NOTIFIER` | 업데이트 알림 끄기 |

---

## 9. 왜 GitHub에서 화제인가

1. **Stripe 공식** 저장소 — 결제 1티어 회사가 직접 낸 에이전트 결제 표준 구현체
2. **타이밍** — 2025~2026 agentic commerce 붐 (ACP, AP2, MPP/x402, HTTP 402 부활)
3. **가장 큰 미해결 문제를 건드림** — "에이전트에게 결제 권한을 어떻게 안전하게 주나"
4. **레퍼런스 품질** — CLI+MCP+Skills+Plugin 4중 패키징, zod 단일 소스, 보안 주석까지 교과서급
5. **MIT 라이선스** — 통째로 참고·차용 가능
6. **이미 실사용처 명시** — Muse by Meta, Grok Bot, Instinct, Browser Use

---

## 10. 로컬 에이전트 구축에 도움이 되나 → **매우 그렇다 (두 갈래)**

**(A) 기능적 도움** — 에이전트에 실제 "결제 팔다리"를 달아줄 수 있다.
다만 US Link 계정 제약 때문에, 한국에서는 당장은 데모/테스트모드 용도가 현실적.

**(B) 설계 교본으로서의 도움** — 이쪽이 더 크다. 그대로 훔쳐올 패턴들:
- zod 스키마 하나로 CLI 플래그 + MCP 툴 + 문서 자동 생성 (`incur`)
- TTY 분기 이중 출력 (사람=Ink UI / 에이전트=toon)
- `_next` 연속 실행 힌트 프로토콜
- `sanitizeDeep()` / `shellQuote()` 보안 경계
- `SKILL.md` + `allowed-tools`로 에이전트 권한 최소화
- 위험 동작 전 **사람 승인(human-in-the-loop)** 게이트 설계
- `serve`를 명시적 "권한 경계"로 취급하는 사고방식

---

## 11. React / PHP로 만들 수 있나?

**나눠서 보자.**

| 레이어 | React/PHP 가능? | 설명 |
|---|---|---|
| 카드 발급 엔진 자체 | ❌ | Stripe Issuing 수준 라이선스·KYC·BIN 스폰서 필요 |
| Link API 클라이언트 | ✅ | 그냥 REST + Bearer 토큰. PHP/Laravel 포팅 쉬움 |
| OAuth Device Flow | ✅ | 표준 스펙, PHP로 구현 가능 |
| 승인 대시보드 / 지출 콘솔 | ✅✅ | React/Next의 주 무대 |
| 정책 엔진 (예산·화이트리스트·이상탐지) | ✅✅ | PHP/Node 백엔드로 충분 |
| 에이전트 오케스트레이션 | ✅ | `link-cli`를 child process로 호출하거나 MCP HTTP 호출 |

결론: **"발급"은 못 만들고 "그 위의 제품"은 얼마든지 만든다.**
현실적 조합 = `Next.js(React) 프론트 + Node/PHP 백엔드 + link-cli serve(MCP)` 래핑.

---

## 12. 수익화 아이디어

### Tier 1 — 지금 바로 (US 계정 없이도 가능)
1. **AI 에이전트 결제 도입 컨설팅 / 구축 외주**
   Stripe 공식 레퍼런스를 읽은 사람이 아직 적다. MCP+Skills 패키징 노하우 자체가 상품.
2. **한국어 기술 콘텐츠 / 강의**
   "에이전틱 커머스 완전정복", 블로그·유튜브·인프런. 트래픽 선점 효과.
3. **오픈소스 스타터킷 배포 → 유료 Pro**
   `agent-payments-starter` (Next.js 승인 대시보드 + 정책 엔진 + link-cli 래퍼).
   무료 OSS로 인지도, Pro(멀티테넌트·감사로그·SSO)는 유료.

### Tier 2 — 3~6개월
4. **에이전트 지출 거버넌스 SaaS**
   여러 에이전트의 spend request를 중앙에서 승인/한도/화이트리스트/이상탐지.
   B2B 시트당 과금. link-cli는 하위 실행기로만 사용.
5. **승인 UX 제품 (Slack / KakaoTalk / 디스코드 봇)**
   "에이전트가 3,500원 결제 요청 → 채널에서 버튼 승인". 팀 단위 SaaS.
6. **자동 구매 에이전트 + 제휴 수수료**
   반복 구매(소모품·구독) 자동화. 수익은 어필리에이트 커미션.
7. **MCP 호스팅 / 에이전트 게이트웨이**
   `serve`를 멀티테넌트로 감싼 관리형 엔드포인트 + 감사 로그. 사용량 과금.

### Tier 3 — 장기·고난도
8. **머천트 사이드: MPP/HTTP 402 수익화 툴킷**
   "당신의 API를 에이전트에게 유료 판매하세요". 거래 수수료 모델.
9. **에이전트 구매 데이터 인텔리전스**
   `report` 커맨드처럼 에이전트 체크아웃 실패 패턴(캡차·WAF·3DS) 수집 → 리포트 판매.
10. **한국형 에이전트 지갑**
    국내 PG/카드사 제휴로 동일 UX 구현. 진입장벽 높지만 선점 가치 큼.

### 리스크 체크
- 🚨 미국 Link 계정 한정 → 한국 사용자 직접 대상 결제 제품은 당장 불가
- 🚨 결제 취급 시 전금법·PG 라이선스 검토 필수 (직접 자금 이동은 피하고 "오케스트레이션"에 머물 것)
- 🚨 한도($500/건, $500/일)가 낮음 → 고액 상거래엔 부적합, 소액·반복이 스윗스팟
- 💡 상향 한도·임베디드 승인은 `agent-spend@stripe.com` 문의 가능 (README 명시)

---

## 13. 개발 커맨드 치트시트

```bash
pnpm install
pnpm run build       # turbo build + 스킬 버전 동기화
pnpm run dev         # watch
pnpm run test        # TS + Go 테스트
pnpm run test:go
pnpm run typecheck
pnpm biome check .   # CI와 동일
pnpm run check       # 자동 수정

node packages/cli/dist/cli.js <command>
```

- Node **22+**, Go 1.23+ 필요
- 릴리스는 Changesets → "Version Packages" PR 머지 시 npm 배포 (trusted publishing + provenance)
- CI: build → typecheck → biome → test → gofmt/vet/go test

---

## 14. 한 줄 요약

> **Link CLI는 "AI 에이전트에게 카드번호 대신 1회용 결제권을 사람 승인 하에 쥐여주는" Stripe 공식 도구이고,
> 한국 개발자에게는 당장의 결제 수단이라기보다 *에이전트 도구를 설계·유통·보안하는 방법의 교과서* 로서 값어치가 더 크다.**

---

### 참고 링크
- 내 포크: https://github.com/bmshin94/link-cli
- 원본: https://github.com/stripe/link-cli
- Link 앱: https://app.link.com
- 에이전트 소개: https://link.com/agents
- MPP 스펙: https://mpp.dev
- Shared Payment Tokens: https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens
- 문의(한도 상향 등): agent-spend@stripe.com
