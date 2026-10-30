// 개별 메뉴 AI 맞춤 질문 프로빙 — 예시 의뢰(메뉴별 3건 + 복수 메뉴 2건). 실제 의뢰가 아니라 지어낸 것이다.
// 일부러 정보량을 갈랐다: 짧음(거의 다 물어야 함) · 자세함(대부분 채워야 함) · 첨부 텍스트(첨부에서 읽어야 함).
// 첨부는 추출 텍스트만 흉내 낸다(이미지 판독 단계는 프로빙 범위 밖).

export interface AreaFollowupProbeCase {
  id: string;
  menu: string;
  areas: string[];
  title: string;
  description: string;
  attachments: { name: string; text: string }[];
}

export const AREA_FOLLOWUP_PROBE_CASES: readonly AreaFollowupProbeCase[] = [
  // ── 회로 설계 ──
  {
    id: 'c1-short',
    menu: '회로 설계',
    areas: ['circuit'],
    title: '온습도 측정기 회로 설계',
    description: '온습도 센서가 들어간 작은 측정기 회로 설계를 맡기고 싶습니다. 처음 만드는 제품입니다.',
    attachments: [],
  },
  {
    id: 'c2-rich',
    menu: '회로 설계',
    areas: ['circuit'],
    title: '스마트 화분 컨트롤러 회로',
    description:
      '스마트 화분 컨트롤러를 새로 만들려고 합니다. 토양 수분 센서와 조도 센서 값을 읽어서 물이 부족하면 소형 워터펌프(DC 5V 모터)를 돌립니다. ' +
      '1.3인치 OLED 화면에 수분 상태를 보여 주고 버튼 2개로 설정합니다. 전원은 18650 충전식 배터리이고 USB-C로 충전합니다. ' +
      '스마트폰 앱과 BLE로 연결해 상태를 보냅니다. 국내 판매 예정이라 KC 인증이 필요합니다. 결과물은 Altium 회로도 원본과 PDF, BOM 모두 받고 싶습니다. ' +
      'MCU는 nRF52832로 정해 두었습니다.',
    attachments: [],
  },
  {
    id: 'c3-attach',
    menu: '회로 설계',
    areas: ['circuit'],
    title: '단종 MCU 대체 회로 수정',
    description: '기존 제품 제어보드에 들어간 MCU가 단종되어 대체 부품으로 회로를 바꾸고 싶습니다. 기존 회로도 PDF를 첨부합니다.',
    attachments: [
      {
        name: '제어보드_회로도_v3.pdf',
        text:
          'TITLE: MAIN CONTROL BOARD REV3 / U1 ATMEGA128A-AU (EOL) / J1 DC JACK 12V INPUT, U3 LM2596 12V->5V, U4 AMS1117-3.3 / ' +
          'K1,K2 RELAY G5LE-1 12V (VALVE OUT1, OUT2) / U5 MAX485 RS-485 (J4 TERMINAL A,B) / SW1~SW3 TACT SWITCH / LCD1 16x2 CHARACTER LCD / ' +
          'NTC1,NTC2 10K THERMISTOR INPUT / NOTE: CE MARKED PRODUCT (EXPORT EU)',
      },
    ],
  },
  // ── PCB 설계 ──
  {
    id: 'p1-rich',
    menu: 'PCB 설계',
    areas: ['pcb'],
    title: '모터 드라이버 보드 PCB 아트웍',
    description:
      'OrCAD로 그린 회로도와 BOM이 준비되어 있고 PCB 아트웍만 필요합니다. 신규 설계이고 4층, 크기는 100x80mm 고정에 모서리 M3 고정홀 4개입니다. ' +
      '모터 구동부에 10A 정도 전류가 흐릅니다. 설계는 OrCAD/Allegro로 해 주시고 Gerber, 설계 원본, 부품 배치 좌표 파일을 받고 싶습니다.',
    attachments: [],
  },
  {
    id: 'p2-short',
    menu: 'PCB 설계',
    areas: ['pcb'],
    title: 'PCB 설계 의뢰',
    description: 'PCB 설계를 의뢰합니다. 자세한 내용은 상담하면서 정하고 싶어요.',
    attachments: [],
  },
  {
    id: 'p3-attach',
    menu: 'PCB 설계',
    areas: ['pcb'],
    title: 'Wi-Fi 센서 허브 PCB',
    description: '회로도는 PDF로만 있습니다. 케이스 도면에 맞춰 PCB를 만들어야 하고, 결과물은 KiCad 파일로 받고 싶습니다.',
    attachments: [
      {
        name: 'sensor_hub_schematic.pdf',
        text:
          'SENSOR HUB V1 / U1 ESP32-WROOM-32E (PCB ANTENNA) / U2 BME280 / U3 TPS62160 / J1 USB-C 5V / J2~J5 JST-PH 4P SENSOR PORT / ' +
          'NOTE: KEEP ANTENNA AREA CLEAR OF COPPER',
      },
      {
        name: '케이스_도면.dxf',
        text: 'PCB OUTLINE 60 x 45 mm, CORNER R3 / MOUNTING HOLE Ø3.2 x2 / MAX COMPONENT HEIGHT TOP 8mm / USB-C OPENING ON SHORT EDGE',
      },
    ],
  },
  // ── 펌웨어 개발 ──
  {
    id: 'f1-rich',
    menu: '펌웨어 개발',
    areas: ['firmware'],
    title: '컨베이어 제어 펌웨어',
    description:
      'STM32F407 보드는 이미 만들어져 동작합니다. 컨베이어 모터를 센서 신호에 따라 정지·저속·고속으로 바꾸는 펌웨어가 필요합니다. ' +
      '상위 PLC와 RS-485 Modbus RTU 슬레이브로 통신합니다. 업데이트는 현장에서 USB 케이블로 합니다. 통신이 끊기면 모터를 즉시 멈추고 경고등을 켜야 합니다. ' +
      '소스 코드와 실행 파일, 다운로드 방법 문서를 받고 싶습니다. 개발 환경은 STM32CubeIDE입니다.',
    attachments: [],
  },
  {
    id: 'f2-short',
    menu: '펌웨어 개발',
    areas: ['firmware'],
    title: 'ESP32 IoT 펌웨어',
    description: 'ESP32로 만드는 IoT 기기 펌웨어 개발을 원합니다.',
    attachments: [],
  },
  {
    id: 'f3-attach',
    menu: '펌웨어 개발',
    areas: ['firmware'],
    title: 'BLE 자산 추적 태그 펌웨어',
    description: '보드는 지금 개발 중이고, 동작 사양서를 첨부합니다. 배터리로 1년 이상 버텨야 합니다.',
    attachments: [
      {
        name: '태그_동작사양서.docx',
        text:
          '1. MCU: nRF52840 / 2. 1초마다 BLE 광고(iBeacon) 송출, 가속도 센서(LIS2DH12) 움직임 감지 시 0.2초 주기로 변경 / ' +
          '3. 배터리 CR2032, 전압 2.2V 이하이면 저전압 플래그 광고 / 4. 펌웨어는 스마트폰 앱으로 무선 업데이트(DFU) 필요 / 5. 버튼 길게 누르면 초기화',
      },
    ],
  },
  // ── 역설계 ──
  {
    id: 'r1-rich',
    menu: '역설계',
    areas: ['reverse'],
    title: '단종 컨트롤러 보드 복원',
    description:
      '저희 회사가 10년 전 판매한 장비의 컨트롤러 보드입니다. 설계 자료가 유실되어 유지보수용으로 회로도, BOM, Gerber를 복원하고 싶습니다. ' +
      '동작하는 샘플 3장을 보낼 수 있고, 필요하면 1장은 분해해도 됩니다. 2층 기판으로 보이고 부품 표기는 대부분 읽힙니다.',
    attachments: [],
  },
  {
    id: 'r2-short',
    menu: '역설계',
    areas: ['reverse'],
    title: '오래된 장비 보드 복원',
    description: '오래된 장비 보드를 복원하고 싶습니다.',
    attachments: [],
  },
  {
    id: 'r3-attach',
    menu: '역설계',
    areas: ['reverse'],
    title: '계측기 메인보드 역설계 및 재제작',
    description: '계측기 메인보드를 분석해서 같은 보드를 다시 만들고 동작까지 확인하고 싶습니다. 보드 사진을 첨부합니다. 프로그램도 가능하면 추출해 주세요.',
    attachments: [
      {
        name: 'board_top.jpg(판독)',
        text:
          '[이미지 판독] 녹색 PCB 약 120x90mm, 부품 밀도 중간. 주 IC 표기 "PIC18F4620-I/PT". 표기가 지워진 20핀 IC 1개. 8핀 EEPROM 24LC256. ' +
          '비아가 많고 양면 실장, 내층 존재 가능성(4층 추정). BGA 부품은 보이지 않음. ICSP 5핀 헤더 있음.',
      },
    ],
  },
  // ── 앱 및 서버 ──
  {
    id: 'a1-app',
    menu: '앱 및 서버 개발',
    areas: ['app', 'server'],
    title: 'BLE 체중계 앱',
    description:
      '이미 만든 BLE 체중계와 연결되는 스마트폰 앱이 필요합니다. Android와 iOS 모두이고, 측정값 표시와 기록 그래프, 목표 체중 알림 정도입니다. ' +
      '서버는 필요 없고 기록은 폰에만 저장합니다. 디자인은 피그마로 완성되어 있습니다.',
    attachments: [],
  },
  {
    id: 'a2-both',
    menu: '앱 및 서버 개발',
    areas: ['app', 'server'],
    title: '공장 설비 모니터링 서버·앱',
    description:
      '공장 설비 500대에서 온도·진동 데이터를 MQTT로 서버에 모으고, 관리자 웹 화면에서 실시간 상태와 이력 그래프를 보고 싶습니다. 이상 시 담당자 스마트폰 앱으로 푸시 알림을 보내야 합니다. ' +
      '서버는 AWS에 올릴 예정이고 구축 후 1년 운영·유지보수도 맡기고 싶습니다. 관리자와 작업자 계정을 나눠야 합니다.',
    attachments: [],
  },
  {
    id: 'a3-short',
    menu: '앱 및 서버 개발',
    areas: ['app', 'server'],
    title: '기존 앱 리뉴얼',
    description: '5년 된 기존 앱을 리뉴얼하고 서버도 새로 옮기고 싶습니다.',
    attachments: [],
  },
  // ── 복수 메뉴 ──
  {
    id: 'm1-circuit-fw',
    menu: '회로 설계 + 펌웨어 개발',
    areas: ['circuit', 'firmware'],
    title: '산업용 온도 컨트롤러',
    description:
      '열처리 설비용 온도 컨트롤러를 새로 만들려고 합니다. K타입 열전대 2채널을 읽어 SSR로 히터를 PID 제어합니다. 7세그먼트 표시와 버튼 4개, ' +
      '상위 PC와 RS-485 Modbus 통신이 필요합니다. 전원은 AC 220V 입력입니다. 회로와 펌웨어 모두 맡기고 싶습니다.',
    attachments: [],
  },
  {
    id: 'm2-pcb-fw',
    menu: 'PCB 설계 + 펌웨어 개발',
    areas: ['pcb', 'firmware'],
    title: 'LoRa 원격 검침기',
    description: '회로도는 직접 만들었습니다(KiCad). PCB와 펌웨어를 맡기고 싶습니다. 수도 계량기 펄스를 세서 하루 한 번 LoRa로 보냅니다.',
    attachments: [
      {
        name: 'meter_kicad_bom.csv',
        text: 'Ref,Value,Footprint / U1,STM32L072CZ,LQFP48 / U2,SX1276 module RFM95W,SMD / BT1,ER14505 3.6V,AA holder / J1,u.FL,antenna / R1-R12,..., 0603',
      },
    ],
  },
];
