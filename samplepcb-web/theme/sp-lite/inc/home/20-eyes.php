<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

/*
 * 홈 — 3 EYES (Smarter Manufacturing with AI) — Figma 「웹 메인」 y 2052~4856 (높이 2804)
 *   배경 2286:1276 · 제목 2286:1444 · 블록 Gerber Eyes 4.0(2286:1455) · Parts Eyes 2.0(2286:1784) · SMT Eyes(2286:1686)
 *   블록 = [화면 미디어 772(SMT 는 797)] + [카드 484(SMT 는 460)] 가로 한 줄, 가운데 블록만 좌우 반전.
 *   미디어(.sp-eyes__media): Gerber·Parts 는 피그마에 들어 있던 애니메이션 GIF(1920×1080), SMT 는 정지 합성 사진.
 *     디자이너 메모("3EYES gif 영상은 어떻게 전달드리면 될까요?") — 영상으로 바뀌면 <img> 를 <video> 로 갈아 끼우면 된다(컨테이너 치수 고정).
 *   피그마의 숨김 그룹(화면 위 떠 있는 말풍선 6개, 2286:1459 등 — 모션 2286:1460·1461 도 여기 안)은 숨김 그대로 두어 렌더하지 않는다.
 *   링크 없음(사용자 결정) — 버튼은 <span>.
 */
$sp_eyes = G5_THEME_URL.'/img/home/eyes';
?>
<section class="sp-eyes" id="sp-eyes" aria-labelledby="sp-eyes-title">
    <div class="sp-inner">
        <header class="sp-eyes__head">
            <p class="sp-eyes__brand" aria-label="3 EYES"><span>3</span><span>EYES</span><img src="<?php echo $sp_eyes; ?>/ico-eye.svg" alt="" width="65" height="65"></p>
            <h2 class="sp-eyes__title sp-grad" id="sp-eyes-title">Smarter Manufacturing with AI</h2>
            <p class="sp-eyes__sub">AI와 데이터로 설계부터 조달·제조·양산까지 연결하여 전자제품 개발을 더 빠르고 정확하게 지원합니다.</p>
        </header>

        <!-- 1. Gerber Eyes 4.0 (2286:1455) — 화면 GIF 왼쪽 · 카드 오른쪽 -->
        <article class="sp-eyes__block sp-eyes__block--gerber">
            <div class="sp-eyes__media sp-eyes__media--gerber">
                <img src="<?php echo $sp_eyes; ?>/gerber-screen.gif" alt="Gerber Eyes 4.0 DFM 분석 화면" width="702" height="395" loading="lazy">
            </div>
            <div class="sp-eyes__card">
                <div class="sp-eyes__card-body">
                    <span class="sp-eyes__tag"><img src="<?php echo $sp_eyes; ?>/dot-pcb.svg" alt="" width="6" height="6">PCB</span>
                    <h3 class="sp-eyes__name">Gerber Eyes 4.0</h3>
                    <p class="sp-eyes__desc">제작 전 검토가 PCB의 완성도를 높입니다. <br>DFM 분석으로 잠재 오류를 미리 확인하고 견적까지 빠르게 진행하세요.</p>
                    <ul class="sp-eyes__feats">
                        <li><span class="sp-eyes__ico"><img src="<?php echo $sp_eyes; ?>/ico-gerber-fast.png" alt="" width="54" height="54"></span><span class="sp-eyes__feat">더 빠른 Gerber 파일 확인</span></li>
                        <li><span class="sp-eyes__ico"><img src="<?php echo $sp_eyes; ?>/ico-gerber-dfm.png" alt="" width="54" height="54"></span><span class="sp-eyes__feat">DFM 오류 자동 분석</span></li>
                        <li><span class="sp-eyes__ico"><img src="<?php echo $sp_eyes; ?>/ico-gerber-quote.png" alt="" width="54" height="54"></span><span class="sp-eyes__feat">실시간 견적 확인</span></li>
                    </ul>
                </div>
                <div class="sp-eyes__btns"><span class="sp-eyes__btn">자세히 보기 →</span></div>
            </div>
        </article>

        <!-- 2. Parts Eyes 2.0 (2286:1784) — 카드 왼쪽 · 화면 GIF 오른쪽 -->
        <article class="sp-eyes__block sp-eyes__block--parts">
            <div class="sp-eyes__card sp-eyes__card--narrow">
                <div class="sp-eyes__card-body">
                    <span class="sp-eyes__tag"><img src="<?php echo $sp_eyes; ?>/dot-parts.svg" alt="" width="6" height="6">PARTS</span>
                    <h3 class="sp-eyes__name">Parts Eyes 2.0</h3>
                    <p class="sp-eyes__desc">기존에 일일이 확인하던 BOM을 AI가 빠르게 분석해 <br>부품 검색부터 재고·가격 확인, 견적까지 걸리는 시간을 크게 단축합니다.</p>
                    <ul class="sp-eyes__feats">
                        <li><span class="sp-eyes__ico"><img src="<?php echo $sp_eyes; ?>/ico-parts-bom.png" alt="" width="54" height="54"></span><span class="sp-eyes__feat">BOM 분석, 단 몇 초 만에</span></li>
                        <li><span class="sp-eyes__ico"><img src="<?php echo $sp_eyes; ?>/ico-parts-search.png" alt="" width="54" height="54"></span><span class="sp-eyes__feat">2,000만+ 부품을 한 번에 검색</span></li>
                        <li><span class="sp-eyes__ico"><img src="<?php echo $sp_eyes; ?>/ico-parts-search.png" alt="" width="54" height="54"></span><span class="sp-eyes__feat">재고·가격을 실시간으로 비교</span></li>
                    </ul>
                </div>
                <div class="sp-eyes__btns"><span class="sp-eyes__btn">자세히 보기 →</span><span class="sp-eyes__btn sp-eyes__btn--outline">파트너사 등록하기 →</span></div>
            </div>
            <div class="sp-eyes__media sp-eyes__media--parts">
                <img src="<?php echo $sp_eyes; ?>/parts-screen.gif" alt="Parts Eyes 2.0 BOM 분석 화면" width="1191" height="670" loading="lazy">
            </div>
        </article>

        <!-- 3. SMT Eyes (2286:1686) — 모니터 사진 왼쪽(797) · 카드 오른쪽(460) -->
        <article class="sp-eyes__block sp-eyes__block--smt">
            <div class="sp-eyes__media sp-eyes__media--smt">
                <img src="<?php echo $sp_eyes; ?>/smt-photo.png" alt="SMT Eyes 3D 조립 미리보기 화면이 띄워진 모니터" width="797" height="670" loading="lazy">
            </div>
            <div class="sp-eyes__card sp-eyes__card--narrow sp-eyes__card--smt">
                <div class="sp-eyes__card-body">
                    <span class="sp-eyes__tag"><img src="<?php echo $sp_eyes; ?>/dot-smt.svg" alt="" width="6" height="6">SMT</span>
                    <h3 class="sp-eyes__name sp-eyes__name--smt">SMT Eyes</h3>
                    <p class="sp-eyes__desc">SMT 조립 결과를 3D로 미리 확인하고, 부품별 정보와 배치 위치·간격을 직관적으로 검토하여 실장 오류를 사전에 줄일 수 있습니다.</p>
                    <ul class="sp-eyes__feats">
                        <li><span class="sp-eyes__ico"><img class="sp-eyes__ico-img--tall" src="<?php echo $sp_eyes; ?>/ico-smt-3d.png" alt="" width="54" height="57"></span><span class="sp-eyes__feat">3D 조립 미리보기</span></li>
                        <li><span class="sp-eyes__ico"><img src="<?php echo $sp_eyes; ?>/ico-smt-part.png" alt="" width="54" height="54"></span><span class="sp-eyes__feat">부품 정보 즉시 확인</span></li>
                        <li><span class="sp-eyes__ico"><img src="<?php echo $sp_eyes; ?>/ico-smt-part.png" alt="" width="54" height="54"></span><span class="sp-eyes__feat">위치·간격 정밀 검토</span></li>
                    </ul>
                </div>
                <div class="sp-eyes__btns"><span class="sp-eyes__btn sp-eyes__btn--bordered">자세히 보기 →</span></div>
            </div>
        </article>
    </div>
</section>
