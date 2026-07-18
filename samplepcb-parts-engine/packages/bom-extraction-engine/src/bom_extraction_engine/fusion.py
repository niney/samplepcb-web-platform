# -*- coding: utf-8 -*-
"""방법 6 v2 — 융합 (claude m5a + gpt fuzzy 장점 결합) + 성능 리뷰 반영.

융합 요소:
- gpt: 전체 행 스캔, 타입별 데이터 증거, 전역 캐시, containment 매칭
- claude: exact+containment+fuzzy 실패 시에만 model2vec 임베딩 폴백
- 신규: 앵커 필드 규칙 ({reference, part_number, quantity} 중 1개 필수)
  — 리비전 History 표 오탐 차단

성능 리뷰 반영 (2026-07-14):
1. cold-start 차단: 구조 후보 행이 없으면(빈 시트, 본문-only, 메타데이터만)
   임베딩 모델을 로딩하지 않고 기권
2. 전처리 공유: prepare()에서 셀 정규화를 1회만 수행, 두 스캔이 공유
3. batch encode: 후보 행의 미등록 라벨을 모아 한 번에 인코딩
   (라벨당 개별 encode 호출 제거)
4. cell_to_str 빠른 경로 (normalize.py — pandas.isna 최소화)
5. 교차 확인 복구: 구조 후보 행에서 완화된 임베딩 임계값으로
   앵커+필드 요건을 만족하면 저신뢰로 수용
6. 모델 싱글턴 + lock (Flask 동시 요청 대비), bounded LRU 캐시,
   대형 시트 행/열 상한
"""
import re
import threading
from collections import OrderedDict
from typing import Dict, List, Optional, Tuple

import pandas as pd
from rapidfuzz import fuzz

from .field_lexicon import build_lexicon
from .normalize import cell_to_str, normalize_cell, label_form
from .probe_base import ProbeResult
from .row_features import (RE_NUMBER, RE_PACKAGE, is_data_like,
                           looks_designator_list)

_EXACT, _SYNS = build_lexicon()
_FUZZ_SYNS = [(f, w, s) for f, w, s in _SYNS if len(s) >= 3]
_CONTAIN_SYNS = [(f, w, s) for f, w, s in _SYNS if len(s) >= 4]

ANCHOR_FIELDS = {"reference", "part_number", "quantity"}
NUMERIC_FIELDS = {"quantity", "no", "price"}
ROW_TH = 0.50
CROSS_TH = 0.45        # 교차 확인 저신뢰 수용 하한
CROSS_MIN_DATA_ROWS = 2  # 교차 확인은 아래 데이터 행 2개 이상 요구 (History 차단)
RELAXED_EMB_TH = 0.42  # 교차 확인 시 완화된 임베딩 셀 임계값
MIN_NONEMPTY = 3
CONTEXT_K = 6
MAX_ROWS = 4000        # 대형 시트 스캔 상한
MAX_COLS = 120

_RE_PN = re.compile(r"^(?=.{3,40}$)(?=.*[a-z])(?=.*\d)[a-z0-9][a-z0-9 ._/#()+\-]*$")


class _LRU(OrderedDict):
    """bounded LRU — 무한 성장 방지."""

    def __init__(self, cap: int):
        super().__init__()
        self.cap = cap

    def lookup(self, key):
        if key in self:
            self.move_to_end(key)
            return True, self[key]
        return False, None

    def put(self, key, value):
        self[key] = value
        self.move_to_end(key)
        if len(self) > self.cap:
            self.popitem(last=False)


# 전역 캐시 — BOM 라벨/값은 파일이 달라도 심하게 반복된다
_norm_cache = _LRU(100_000)   # raw str -> (norm, label, data_like)
_lex_cache = _LRU(50_000)     # label -> (field, w, sim) | None  (임계값 미적용 원점수)
_emb_cache = _LRU(50_000)

# 임베딩 모델 싱글턴 (프로세스당 1개, 동시 로딩 방지)
_EMB_LOCK = threading.Lock()
_EMBEDDERS: dict = {}


def _get_embedder(backend: str):
    """임베딩 프로버 반환. 로딩 실패/비활성 시 None — 결과(None 포함)를
    캐시해 시트마다 재시도하지 않는다. fusion은 None이면 lexical-only."""
    with _EMB_LOCK:
        if backend in _EMBEDDERS:
            return _EMBEDDERS[backend]
        from .embedding import load_embedder
        emb = load_embedder()
        _EMBEDDERS[backend] = emb
        return emb


def _cell_info(raw) -> Tuple[str, str, bool]:
    s = cell_to_str(raw)
    if not s:
        return "", "", False
    found, hit = _norm_cache.lookup(s)
    if not found:
        norm = normalize_cell(s)
        lab = label_form(s)
        hit = (norm, lab, is_data_like(norm))
        _norm_cache.put(s, hit)
    return hit


def _lex_raw(lab: str) -> Optional[Tuple[str, float, float]]:
    """exact -> containment -> fuzzy 원점수. 전역 LRU 캐시."""
    found, hit = _lex_cache.lookup(lab)
    if found:
        return hit

    result = None
    exact = _EXACT.get(lab)
    if exact:
        result = (exact[0], exact[1], 1.0)
    elif len(lab) >= 2:
        padded = f" {lab} "
        best = None
        for f, w, syn in _CONTAIN_SYNS:
            if len(lab) > len(syn) * 2 + 2:
                continue
            if f" {syn} " in padded:
                sim = min(0.95, 0.88 + 0.07 * len(syn) / max(len(lab), 1))
                if best is None or sim > best[2]:
                    best = (f, w, sim)
        if best is None and len(lab) >= 3:
            allow_ts = len(lab.split()) <= 3
            for f, w, syn in _FUZZ_SYNS:
                r = fuzz.ratio(lab, syn) / 100.0
                if allow_ts and len(syn) >= 4 and len(lab) >= 4:
                    r = max(r, fuzz.token_set_ratio(lab, syn) * 0.99 / 100.0)
                if best is None or r > best[2]:
                    best = (f, w, r)
        result = best

    _lex_cache.put(lab, result)
    return result


def _type_score(field: str, norm: str) -> float:
    """매칭된 필드 열의 아래 데이터 값이 타입과 맞는가 (gpt식 타입 증거)."""
    if field in NUMERIC_FIELDS:
        return 1.0 if RE_NUMBER.match(norm) else 0.15
    if field == "reference":
        return 1.0 if looks_designator_list(norm) or re.fullmatch(
            r"[a-z]{1,4}\d{1,4}", norm) else 0.15
    if field == "part_number":
        return 1.0 if _RE_PN.match(norm) else 0.4
    if field == "package":
        return 1.0 if RE_PACKAGE.match(norm) else (
            0.5 if any(c.isdigit() for c in norm) else 0.25)
    return 0.85 if not RE_NUMBER.match(norm) else 0.15


class FusionProber:
    name = "m6_fusion"

    def __init__(self, backend: str = "m2v", fallback_th: float = 0.475,
                 match_th: float = 0.87):
        self.match_th = match_th
        self.fallback_th = fallback_th
        self._backend = backend

    # --- 탐지 인터페이스 ---
    def prepare(self, df: pd.DataFrame) -> List[tuple]:
        """셀 정규화를 1회만 수행 — 이후 모든 스캔이 이 결과를 공유."""
        if len(df) > MAX_ROWS or df.shape[1] > MAX_COLS:
            df = df.iloc[:MAX_ROWS, :MAX_COLS]
        prep = []
        for row in df.itertuples(index=False, name=None):
            cells = []
            labelish = 0
            for c, v in enumerate(row):
                norm, lab, data = _cell_info(v)
                if not norm:
                    continue
                cells.append((c, norm, lab, data))
                if lab and not data:
                    labelish += 1
            prep.append((cells, labelish))
        return prep

    def detect(self, df: pd.DataFrame, match_th: float = None) -> ProbeResult:
        return self.decide(self.prepare(df), match_th=match_th)

    def decide(self, prep: List[tuple], match_th: float = None) -> ProbeResult:
        th = self.match_th if match_th is None else match_th

        # 1) lexical 스캔 (exact + containment + fuzzy)
        def lex_scorer(lab):
            r = _lex_raw(lab)
            return r if r and r[2] >= th else None

        res = self._scan(prep, lex_scorer)
        if res.found:
            return res

        # 2) 구조 게이트: 후보 행이 전혀 없으면 모델 로딩 없이 기권
        #    (빈 시트, 본문-only, 메타데이터-only가 여기서 걸러진다)
        candidates = self._structural_candidates(prep)
        if not candidates:
            return res

        # 3) 후보 행의 미등록 라벨을 모아 한 번에 인코딩 (batch)
        pending = set()
        for i in candidates:
            for c, norm, lab, data in prep[i][0]:
                if data or not lab:
                    continue
                lex = _lex_raw(lab)
                if lex and lex[2] >= th:
                    continue
                found, _ = _emb_cache.lookup(lab)
                if not found:
                    pending.add(lab)
        if pending:
            emb = _get_embedder(self._backend)
            if emb is None:
                # 임베딩 모델 없음/비활성 — lexical 결과로 기권 (엔진 생존)
                return res
            scored = emb.score_labels(sorted(pending))
            for lab in pending:
                _emb_cache.put(lab, scored.get(lab))

        # 4) 임베딩 폴백 스캔 (전처리 공유 — 재정규화 없음)
        def emb_scorer_at(th_emb):
            def scorer(lab):
                hit = lex_scorer(lab)
                if hit:
                    return hit
                found, cached = _emb_cache.lookup(lab)
                if found and cached and cached[2] >= th_emb:
                    return cached
                return None
            return scorer

        res2 = self._scan(prep, emb_scorer_at(self.fallback_th))
        if res2.found:
            res2.reason = f"임베딩 폴백 ({res2.reason})"
            return res2

        # 5) 교차 확인 (저신뢰 복구): 구조 후보 행을 완화된 임베딩 임계값으로
        #    재채점 — 앵커 + 필드 2종 + 데이터 증거 요건은 유지
        relaxed = emb_scorer_at(RELAXED_EMB_TH)
        best = None
        for i in candidates:
            cells, labelish = prep[i]
            if labelish / len(cells) < 0.6:
                continue
            ev = self._eval_row(prep, i, relaxed)
            if ev is None:
                continue
            score, matches, fields, key_fields, anchor, data_rows = ev
            if (anchor and len(fields) >= 2 and key_fields >= 1
                    and data_rows >= CROSS_MIN_DATA_ROWS and score >= CROSS_TH):
                if best is None or score > best[1][0]:
                    best = (i, ev)
        if best:
            i, (score, matches, fields, key_fields, anchor, data_rows) = best
            return ProbeResult(
                found=True, header_row=i, confidence=round(score, 4),
                candidates=[(i, round(score, 4))],
                column_map={c: {"field": f, "weight": w, "score": round(s, 4)}
                            for c, (f, w, s) in matches.items()},
                reason="교차 확인 복구 (저신뢰)",
            )
        return res2

    # --- 내부 ---
    def _structural_candidates(self, prep) -> List[int]:
        """라벨성 행 + 아래 비어있지 않은 행 — 임베딩을 시도할 가치가 있는 행."""
        out = []
        for i, (cells, labelish) in enumerate(prep):
            if len(cells) < MIN_NONEMPTY or labelish < 2:
                continue
            if labelish / len(cells) < 0.5:
                continue
            if any(prep[j][0] for j in range(i + 1, min(i + 4, len(prep)))):
                out.append(i)
        return out

    def _eval_row(self, prep, i, scorer):
        cells, labelish = prep[i]
        if len(cells) < MIN_NONEMPTY:
            return None
        matches = {}
        for c, norm, lab, data in cells:
            if data or not lab:
                continue
            hit = scorer(lab)
            if hit:
                matches[c] = hit
        if len(matches) < 2:
            return None

        fields: Dict[str, float] = {}
        for f, w, s in matches.values():
            fields[f] = max(fields.get(f, 0.0), w)
        key_fields = sum(1 for w in fields.values() if w >= 0.99)
        anchor = bool(ANCHOR_FIELDS & set(fields))
        field_score = min(sum(fields.values()), 4.0) / 4.0
        coverage = len(matches) / len(cells)
        data_pen = sum(1 for _, _, _, d in cells if d) / len(cells)
        data_rows, data_strength = self._typed_evidence(prep, i, matches)

        score = (0.40 * field_score + 0.20 * coverage
                 + 0.10 * (1 - data_pen) + 0.30 * data_strength)
        return score, matches, fields, key_fields, anchor, data_rows

    def _scan(self, prep, scorer) -> ProbeResult:
        accepted = []
        best_rejected = (None, 0.0)
        for i in range(len(prep)):
            ev = self._eval_row(prep, i, scorer)
            if ev is None:
                continue
            score, matches, fields, key_fields, anchor, data_rows = ev
            ok = (score >= ROW_TH and key_fields >= 2 and anchor
                  and data_rows >= 1)
            if ok:
                accepted.append((i, score, matches, key_fields))
            elif score > best_rejected[1]:
                best_rejected = (i, score)

        if not accepted:
            return ProbeResult(found=False, header_row=None,
                               confidence=round(best_rejected[1], 4),
                               reason="앵커/KEY/데이터 증거 요건 미달")

        # 인접 행 억제 (2행 병합 헤더 → 점수 높은 쪽)
        merged = []
        for cand in accepted:
            if merged and cand[0] - merged[-1][0] <= 1:
                if cand[1] > merged[-1][1]:
                    merged[-1] = cand
            else:
                merged.append(cand)

        best = max(merged, key=lambda a: a[1])
        return ProbeResult(
            found=True, header_row=best[0], confidence=round(best[1], 4),
            candidates=[(i, round(s, 4)) for i, s, _, _ in merged],
            column_map={c: {"field": f, "weight": w, "score": round(s, 4)}
                        for c, (f, w, s) in best[2].items()},
            reason=f"KEY {best[3]}개 + 앵커 + 타입 증거",
        )

    @staticmethod
    def _typed_evidence(prep, i, matches):
        sampled = []
        blank_run = 0
        j = i + 1
        while j < len(prep) and len(sampled) < CONTEXT_K:
            cells_j = prep[j][0]
            if not cells_j:
                blank_run += 1
                if blank_run >= 2:
                    break
            else:
                blank_run = 0
                if len(cells_j) >= max(2, len(matches) * 0.3):
                    sampled.append({c: norm for c, norm, _, _ in cells_j})
            j += 1
        if not sampled:
            return 0, 0.0

        occ_scores, type_scores = [], []
        for row_map in sampled:
            occupied = 0
            for c, (f, w, s) in matches.items():
                norm = row_map.get(c)
                if norm:
                    occupied += 1
                    type_scores.append(_type_score(f, norm))
            occ_scores.append(occupied / max(len(matches), 1))
        occupancy = sum(occ_scores) / len(occ_scores)
        strength = sum(type_scores) / len(type_scores) if type_scores else 0.0
        return len(sampled), occupancy * 0.5 + strength * 0.5
