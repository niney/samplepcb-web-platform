# -*- coding: utf-8 -*-
"""헤더 탐지 임베딩 폴백 — model2vec 정적 임베딩 (potion-multilingual-128M).

header_probing_claude/m3_embedding.py의 m2v 백엔드만 프로덕션용으로 발췌.
sentence-transformers(st) 분기는 제외했다.

로딩 순서: ① configure()로 주입된 로컬 경로 → ② HF 모델 id(로컬 캐시
우선, 없으면 다운로드) → ③ 실패 시 None — fusion이 lexical-only로
동작한다(엔진은 죽지 않고, 사전 밖 표현의 헤더만 기권이 늘어난다).
"""
import logging
import threading
from typing import Callable, Dict, List, Optional

import numpy as np

from .field_lexicon import build_lexicon

logger = logging.getLogger(__name__)

_EXACT, _SYNS = build_lexicon()

MODEL_ID = "minishlab/potion-multilingual-128M"

_LOCK = threading.Lock()
_local_path: str = ""
_status: str = "unloaded"  # unloaded | local | hub | disabled | failed
_on_load: Optional[Callable[[], None]] = None


def configure(local_path: str = "", on_load: Callable[[], None] | None = None) -> None:
    """엔진 진입 시 설정 주입.

    local_path: 로컬 모델 디렉터리. 빈 값이면 HF id(캐시 우선),
                "off"면 임베딩 폴백 비활성.
    on_load: 실제 모델 로딩 직전에 1회 호출되는 훅 — 수 초 걸릴 수 있는
             유일한 구간이라 진행 메시지 노출에 쓴다.
    """
    global _local_path, _on_load
    with _LOCK:
        _local_path = (local_path or "").strip()
        _on_load = on_load


def status() -> str:
    """summary 보고용: unloaded | local | hub | disabled | failed."""
    return _status


def _normalize_rows(m: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(m, axis=1, keepdims=True)
    norm[norm == 0] = 1.0
    return m / norm


class EmbeddingProber:
    """라벨 → (field, weight, similarity). m3a_model2vec 등가."""

    name = "m3a_model2vec"

    def __init__(self, model):
        self._encode = lambda texts: np.asarray(model.encode(texts))
        # 동의어(2자 이하는 exact 전용) 임베딩 사전 계산
        self._syn_meta = [(f, w) for f, w, s in _SYNS if len(s) >= 3]
        syn_texts = [s for f, w, s in _SYNS if len(s) >= 3]
        self._syn_mat = _normalize_rows(self._encode(syn_texts))

    def score_labels(self, labels: List[str]) -> Dict[str, tuple]:
        out = {}
        pending = []
        for lab in labels:
            hit = _EXACT.get(lab)
            if hit:
                out[lab] = (hit[0], hit[1], 1.0)
            elif len(lab) >= 3:
                pending.append(lab)
        if pending:
            emb = _normalize_rows(self._encode(pending))
            sims = emb @ self._syn_mat.T  # (labels, synonyms)
            best_idx = sims.argmax(axis=1)
            for lab, bi, row in zip(pending, best_idx, sims):
                f, w = self._syn_meta[int(bi)]
                out[lab] = (f, w, float(row[int(bi)]))
        return out


def load_embedder() -> Optional[EmbeddingProber]:
    """모델 로딩 — 실패해도 예외를 올리지 않고 None을 반환한다."""
    global _status
    with _LOCK:
        if _local_path.lower() == "off":
            _status = "disabled"
            return None
        if _on_load is not None:
            try:
                _on_load()
            except Exception:  # 진행 훅 실패가 로딩을 막으면 안 된다
                pass
        try:
            from model2vec import StaticModel
            if _local_path:
                model = StaticModel.from_pretrained(_local_path)
                _status = "local"
            else:
                model = StaticModel.from_pretrained(MODEL_ID)
                _status = "hub"
            return EmbeddingProber(model)
        except Exception as exc:  # 오프라인 + 무캐시 등
            _status = "failed"
            logger.warning(
                "임베딩 모델 로딩 실패 — lexical-only 헤더 탐지로 동작: %s", exc)
            return None
