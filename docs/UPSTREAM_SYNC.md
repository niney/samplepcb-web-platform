# 순정(그누보드5/영카트) 갱신 — subtree 방식

이 프로젝트는 **단일 repo**(`samplepcb-web-platform`)이고, 그누보드5/영카트 코어는 `samplepcb-web/` 에 **git subtree** 로 들어와 있다. 코어를 직접 수정하지 않고(커스텀은 `extend/`·별도 모노레포), 공식 패치를 subtree 로 받아 최신 유지한다.

---

## 1. 구조 / 리모트

```
samplepcb-web-platform/          ← 단일 git repo
├── samplepcb-web/               ← gnuboard5 subtree (prefix)
├── samplepcb-web-mono-app/      ← Vue+Node 모노레포 (일반 서브폴더)
└── ops/

remotes:
  origin   = github.com/niney/samplepcb-web-platform   (push 대상)
  gnuboard = github.com/gnuboard/gnuboard5  (subtree 소스, push 차단)
```

- 그누보드 코어는 `samplepcb-web/` 아래에만 있다. `master`(5.6.x 보안 라인)를 추적한다.
- 구 `youngcart5`(2021 archived)는 사용 금지.

## 2. 패치 받기 (최신 유지)

```bash
cd samplepcb-web-platform               # 단일 repo 루트
git fetch gnuboard master
git subtree pull --prefix=samplepcb-web gnuboard master --squash
```

- `--squash`: 그누보드 전체 이력을 끌어오지 않고 변경분만 1커밋으로 압축 병합.
- **충돌은 `samplepcb-web/` 안에서 내가 코어를 직접 수정한 파일에서만** 발생한다(= 코어 비수정 원칙을 지키면 거의 무충돌).
- 작업 트리가 깨끗해야 한다(uncommitted 변경 없을 것).

## 3. 절대 규칙

- ❌ `gnuboard` 리모트로 **push 금지**(no_push + pre-push 훅 3중 차단). 그누보드 갱신은 오직 `subtree pull`.
- ❌ `samplepcb-web/` 코어(`bbs/`,`lib/`,`adm/`,`shop/`, 루트 `*.php`) 직접 수정 최소화. 수정 시 `// [samplepcb]` 주석.
- ❌ `samplepcb-web/config.php` 수정 금지(`G5_DOMAIN=''` 유지). https 는 `proxy_fix.php`(auto_prepend)로.
- ✅ 커스텀: `samplepcb-web/extend/`·`plugin/`·별도 스킨/테마, 신규 기능은 `samplepcb-web-mono-app`.
- ✅ 비밀값은 `samplepcb-web/data/dbconfig.php`(gitignore).

## 4. 충돌/롤백

```bash
# subtree pull 중 충돌: 해당 파일 수동 병합 후
git add <파일> && git commit
# 잘못됐으면(머지 전 상태로)
git reset --hard ORIG_HEAD
```

## 5. 새 클론에서 1회 셋업

```bash
git remote add gnuboard https://github.com/gnuboard/gnuboard5.git
git remote set-url --push gnuboard no_push
git config core.hooksPath .githooks
```

## 6. 새 버전 확인

- sir.kr 자료실(`https://sir.kr/boards/g5_pds`) / GitHub `gnuboard/gnuboard5` master.
- 받을 게 있는지: `git fetch gnuboard master && git log --oneline samplepcb-web..gnuboard/master`  *(주: subtree 라 직접 비교는 제한적 — 보통 그냥 subtree pull 후 충돌로 판단)*
