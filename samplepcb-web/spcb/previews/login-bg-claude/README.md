# login-bg-claude — 로그인 배경 애니메이션 프로빙 (Claude 세션)

- URL: `https://local-web.samplepcb.co.kr/spcb/previews/login-bg-claude/`
- 그누보드와 무관한 독립 정적 페이지. Figma `일반고객_로그인`(2077:15)의 헤더 + `bg img 리소스`(2001:55) 배경만 그리고 로그인 카드는 뺐다.
- 목적: 배경 아트 위에 애니메이션 프리셋·조합·강도를 실험하고 채택안을 고른다. 검토가 끝나면 폴더째 지운다.
- 형제 폴더 `../login-background/` 는 다른 세션의 실험실이다. 의존하지 않도록 필요한 파일을 이 폴더에 복사해 뒀다.

## 구성

| 파일 | 내용 |
|---|---|
| `index.html` | 페이지 전체(마크업·CSS·JS). 컨트롤 패널 포함 |
| `motion-path.js` | Figma Vector 윤곽을 연속 변형하는 모듈. `login-background/motion-path.js` 2026-09-06 스냅샷 + `center-swap`(연속 회전) |
| `assets/blob.svg` `lines.svg` `mask-outer.svg` `mask-strip.svg` | Figma MCP design-context export 원본(레이어 분리) |
| `assets/figma-background.svg` | Figma `exportAsync` 원본 2740×1124 — 윤곽 변형 모드가 Vector path 를 fetch |

## 프리셋

- CSS 프리셋: OFF · 드리프트 · 레이어 · 블롭 유영 · 글로우 펄스 · 기울기 · 줌
- JS 생성 선: 파동 흐름 · 파동 드로잉 (sin 곡선 재창작)
- 원본 윤곽 변형(`motion-path.js`): 유기적 흐름(기본) · 흐르는 물결 · 시차 웨이브 · 펼침·수렴 · 리본 비틀림 · 퍼지는 파동 · 상하 교차 · **연속 회전**(`center-swap`, 리본이 한 방향으로 360° 계속 돎, 흐름 방향 선택)
- 조합 토글: 마우스 패럴랙스 · 블롭 색 순환 · 선 반짝임 · 베이스 출렁임 · 진입 페이드인
- 강도: 속도·움직임 배수, 블롭·선 농도 / 윤곽 변형: 주기·변형 강도·밀도·시차·빛 움직임·교차 기준·흐름 방향

## 프리셋 추가 방법

1. CSS 계열: `index.html` 의 `/* ── 프리셋 */` 블록에 `.m-<key>` 규칙 + `@keyframes`, 라디오 `value="<key>"`, `DESC[key]` 한 줄.
2. 윤곽 변형 계열: `motion-path.js` `deform(p)` 에 `settings.effect === '<key>'` 분기, `index.html` 의 `OP['o-<key>']` 기본값 + 라디오 `value="o-<key>"` + `DESC`.
   - 점 속성: `p.flowCenter`/`p.flowBand`(매끄러운 중심선·높이 -1..1), `p.flowFade`(크롭 끝 고정), `p.u`(0..1 가로), `p.edge`.
   - 새 조절값은 `OP` 기본값 → `organicSettings()` 에서 settings 로 전달 → `<input data-o="...">` 로 노출.
3. 브라우저 캐시: `import ... './motion-path.js?v=N'` 의 N 을 올린다.

## 저장

- 설정은 `localStorage['login-bg-claude.v1']`. 스키마가 바뀌면 키 버전을 올린다.
- `prefers-reduced-motion: reduce` 면 첫 진입 기본 OFF.
