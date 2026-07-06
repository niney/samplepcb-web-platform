<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

define('KGINICIS_USE_CERT_SEED', isset($config['cf_cert_use_seed']) ? (int) $config['cf_cert_use_seed'] : 1);

// 유저 사이드뷰에서 아이콘 지정 안했을시 기본 no 프로필 이미지
define('G5_NO_PROFILE_IMG', '<span class="profile_img"><img src="'.G5_IMG_URL.'/no_profile.gif" alt="no_profile" width="'.$config['cf_member_icon_width'].'" height="'.$config['cf_member_icon_height'].'"></span>');

define('G5_USE_MEMBER_IMAGE_FILETIME', TRUE);

// [sp] 위시리스트(관심상품) 노출 토글 — PCB 거버 견적 중심 사이트라 기본 숨김(false).
//   견적관리(/shop/quotes)가 "저장 → 나중에 주문" 역할을 대체한다. 위시 처리 코드·DB(g5_shop_wish)·
//   wishlist.php/wishupdate.php/lib 함수는 그대로 두고, 진입점(계정 사이드바·마이페이지·상품 하트·
//   목록/메인 하트)만 이 플래그로 숨긴다. 다시 노출하려면 true.
//   상세 근거·영향 파일 목록·복구법: docs/wishlist-hidden.md
if (!defined('SP_USE_WISHLIST')) define('SP_USE_WISHLIST', false);

// 썸네일 처리 방식, 비율유지 하지 않고 썸네일을 생성하려면 주석을 풀고 값은 false 입력합니다. ( true 또는 주석으로 된 경우에는 비율 유지합니다. )
//define('G5_USE_THUMB_RATIO', false);