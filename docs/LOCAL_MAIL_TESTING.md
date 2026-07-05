# 로컬 메일 발송 테스트 — Mailpit

주문 처리 메일(입금/배송 안내)을 **로컬에서 실제 외부 발송 없이** 확인하는 방법. 개발 PC에서 `127.0.0.1:25` 로 나가는 메일을 Mailpit 이 가로채 웹 UI(`http://localhost:8025`)로 보여준다.

---

## 1. 핵심 — 이 프로젝트는 "SMTP 발송 모드"다

`samplepcb-web/config.php:181-184` 에 SMTP 상수가 **무조건 정의**돼 있다.

```php
// config.php — SMTP (lib/mailer.lib.php 에서 사용)
define('G5_SMTP',      '127.0.0.1');
define('G5_SMTP_PORT', '25');
```

`lib/mailer.lib.php:29` 는 `G5_SMTP` 가 정의돼 있으면 PHPMailer 를 `IsSMTP()` 모드로 돌린다. 즉 이 프로젝트의 모든 메일은 **`127.0.0.1:25` 로 SMTP 연결**을 시도한다. 그 포트에 받는 SMTP 서버가 없으면 `apache/logs/error.log` 에 `Mail sending error: SMTP connect() failed` 만 남고 조용히 실패한다(코어가 `mailer()` 반환값을 검사하지 않음).

> ⚠️ **XAMPP 의 mailtodisk / fake sendmail 은 안 통한다.** 그건 PHP `mail()` 모드(`php.ini` 의 `sendmail_path`)에서만 쓰이는데, 이 프로젝트는 위 `G5_SMTP` 때문에 `mail()` 을 아예 타지 않는다. 로컬에는 **SMTP 서버(Mailpit)** 가 필요하다.

---

## 2. Mailpit 설치·실행 (수동)

```powershell
winget install axllent.mailpit
mailpit --smtp 127.0.0.1:25 --listen 127.0.0.1:8025
```

- `--smtp 127.0.0.1:25` → `config.php` 의 `G5_SMTP:PORT` 와 반드시 일치.
- `--listen 127.0.0.1:8025` → 받은 메일을 보는 웹 UI.
- `mailer.lib.php` 는 SMTP 인증(`SMTPAuth`/`Username`/`Password`)을 붙이지 않는다. Mailpit 은 인증 없이 받으므로 궁합이 맞다(반대로 Gmail 등 인증형 SMTP 는 코어 `mailer()` 만으로는 못 쓴다).
- `config.php` 는 코어 파일이므로 **건드리지 않는다.** 포트를 Mailpit 에 맞추는 게 아니라 Mailpit 을 `25` 에 맞춘다.

---

## 3. 서비스 등록 (부팅 시 자동 실행, nssm)

매번 수동 실행이 번거로우면 Windows 서비스로 등록한다. `nssm` 은 이미 설치돼 있다(`C:\WINDOWS\system32\nssm.exe`).

**관리자 PowerShell** 에서:

```powershell
# 1) 수동 실행 중인 Mailpit 이 있으면 종료 (포트 25/8025 비우기)
Get-Process mailpit -ErrorAction SilentlyContinue | Stop-Process -Force

# 2) 서비스 등록
nssm install Mailpit "C:\Users\User\AppData\Local\Microsoft\WinGet\Links\mailpit.exe"
nssm set Mailpit AppParameters "--smtp 127.0.0.1:25 --listen 127.0.0.1:8025"
nssm set Mailpit Start SERVICE_AUTO_START
nssm start Mailpit

# 3) 확인
Get-Service Mailpit
```

- 제거: `nssm stop Mailpit; nssm remove Mailpit confirm`
- 받은 메일 영속화(재시작해도 유지)를 원하면 AppParameters 에 `--database "C:\xampp\mailpit.db"` 추가. 기본은 인메모리라 서비스 재시작 시 비워진다(개발용으론 무방).
- mailpit.exe 경로는 winget 심볼릭(`WinGet\Links\mailpit.exe`)이다. winget 업데이트 후에도 유지되지만, 경로가 바뀌면 `nssm set Mailpit Application <새 경로>` 로 갱신.

---

## 4. 발송 조건 — 메일이 실제로 나가려면

발송 스위치와 주문 데이터 조건을 모두 만족해야 한다(`spcb/api/order-notify.php:70,83-84`).

| 조건 | 내용 |
|---|---|
| `cf_email_use` | 그누보드 `g5_config` 의 "메일발송 사용" = `1` (미충족 시 `mailer.lib.php:14` 에서 즉시 return). `/adm/config_form.php` 또는 SQL. |
| 이벤트 | `입금` 또는 `배송` 전이만 알림. **`준비`·`완료` 는 아예 안 보냄.** |
| 입금 메일 | `od_receipt_price > 0` (신용카드/무통장) **또는** `od_receipt_point > 0`. |
| 배송 메일 | `od_delivery_company` + `od_invoice`(택배사 + 송장번호) 둘 다 존재. |

조건 미충족이면 브리지가 `{"mail":"skipped"}` 로 응답하고 메일은 생성되지 않는다.

---

## 5. 발송 경로 (sp-vue → 레거시 메일 템플릿)

Node 는 직접 메일을 보내지 않고, 레거시 영카트 주문메일 템플릿을 재사용하려 sp-php 브리지로 위임한다.

```
OrderActionBar.vue ("메일 발송" 체크)
  → PATCH /api/admin/orders/status            apps/api/src/routes/admin-orders.ts
  → notifyOrderEvent()                        apps/api/src/lib/php-bridge.ts  (POST, JWT svc:'sp-node')
  → POST /spcb/api/order-notify               samplepcb-web/spcb/api/order-notify.php
  → include adm/shop_admin/ordermail.inc.php  (커스텀 메일 템플릿)
  → mailer()                                  samplepcb-web/lib/mailer.lib.php  → PHPMailer(IsSMTP) → 127.0.0.1:25
  → Mailpit 수신 → http://localhost:8025
```

- 브리지 인증: `apps/api/.env` 의 `JWT_SECRET` 과 `samplepcb-web/spcb/lib/secret.php` 의 `SPCB_JWT_SECRET` 이 **동일**해야 한다(HS256 대칭키).
- 브리지 대상: `apps/api/.env` 의 `SPCB_BRIDGE_URL`(기본 `http://127.0.0.1:8888`, 로컬 XAMPP).

---

## 6. 트러블슈팅

| 증상 | 원인 / 확인 |
|---|---|
| 메일이 안 옴, `error.log` 에 `SMTP connect() failed` | `127.0.0.1:25` 에 Mailpit 이 안 떠 있음. `netstat -ano \| findstr :25` 로 확인. |
| 브리지 응답은 `sent` 인데 메일 없음 | `order-notify.php` 는 `mailer()` 반환을 검사하지 않고 무조건 `sent` 응답. 실제 실패는 `apache/logs/error.log` 로만 확인 가능. |
| 브리지 응답이 `skipped` | 4장 발송 조건 미충족(이벤트가 준비/완료거나, 입금/배송 정보 없음, `cf_email_use=0`). |
| 브리지 호출 자체가 없음 | Node 미기동 또는 `SPCB_BRIDGE_URL`/JWT 불일치. `apache/logs/access.log` 에 `POST /spcb/api/order-notify` 기록 여부 확인. |
| 메일이 실제 고객에게 나갈까 걱정 | Mailpit 은 외부로 0통 발송. 전부 로컬에서만 잡힌다(개발 환경 안전장치). |

---

## 7. 실서버 전환

운영에서 실제 고객이 받게 하려면 `127.0.0.1:25`(Mailpit) 대신 **진짜 SMTP 서버**로 연결해야 한다. 코어 `mailer.lib.php` 는 SMTP 인증을 노출하지 않으므로, 인증형 릴레이(SES/SendGrid/회사 메일서버)를 쓰려면 인증 없는 내부 릴레이를 두거나 `mail_options` 이벤트(`run_replace('mail_options', ...)`, `mailer.lib.php:55`)로 `SMTPAuth`/`Username`/`Password` 를 주입하는 커스텀이 필요하다. 이는 로컬 테스트가 아니라 배포 단계의 작업이다.
