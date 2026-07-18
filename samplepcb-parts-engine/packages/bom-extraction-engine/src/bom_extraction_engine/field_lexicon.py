# -*- coding: utf-8 -*-
"""BOM 표준 필드와 한/영 동의어 사전.

KEY 필드는 'BOM 헤더 행'임을 강하게 시사하는 필드,
AUX 필드는 메타데이터 행에도 나타날 수 있어 약하게만 반영한다.
"""
from .normalize import label_form

KEY = 1.0
AUX = 0.4

FIELDS = {
    "part_number": (KEY, [
        "part number", "part no", "part num", "partnumber", "p/n", "pn",
        "mpn", "manufacturer part number", "maker part number",
        "company part number", "part#", "order code",
        "파트넘버", "품번", "부품번호", "자재번호", "자재코드", "발주코드",
    ]),
    "reference": (KEY, [
        "reference", "references", "designator", "designators",
        "reference designator", "ref", "ref des", "refdes", "location",
        "components", "위치기호", "레퍼런스", "부호", "위치",
    ]),
    "part_name": (KEY, [
        "name", "part name", "partname", "part type", "parttype", "type",
        "device", "libref", "lib ref", "item name",
        "품명", "부품명", "자재명", "명칭", "종류",
    ]),
    "value": (KEY, [
        "value", "comment", "spec", "specification", "rating",
        "값", "사양", "규격", "정격", "스펙",
    ]),
    "description": (KEY, [
        "description", "desc", "설명", "상세", "내역",
    ]),
    "package": (KEY, [
        "package", "footprint", "pattern", "geometry", "case",
        "case/package", "pcb footprint",
        "패키지", "풋프린트", "패턴", "외형", "케이스", "사이즈",
    ]),
    "quantity": (KEY, [
        "quantity", "qty", "quantities", "count", "total qty",
        "수량", "필요수량", "총수량", "소요량", "개수", "ea", "pcs",
    ]),
    "manufacturer": (KEY, [
        "manufacturer", "maker", "mfr", "mfg", "vendor", "vender", "brand",
        "제조사", "제조업체", "제조원", "메이커", "브랜드",
    ]),
    "no": (AUX, [
        "no", "no.", "num", "#", "item", "item no", "item number", "seq",
        "id", "index", "순번", "번호", "연번", "항번",
    ]),
    "note": (AUX, [
        "note", "notes", "remark", "remarks", "memo", "etc",
        "비고", "참고", "메모", "기타",
    ]),
    "price": (AUX, [
        "price", "unit price", "cost", "moq",
        "단가", "금액", "가격",
    ]),
    "supplier": (AUX, [
        "supplier", "distributor", "구매처", "공급사", "구입처", "판매처",
    ]),
    "date": (AUX, [
        "date", "날짜", "일자",
    ]),
}


def build_lexicon():
    """(exact_dict, synonym_list) 반환.

    exact_dict: label_form(synonym) -> (field, weight)
    synonym_list: [(field, weight, label_form(synonym)), ...]  # 퍼지/임베딩용
    """
    exact = {}
    syns = []
    for fname, (weight, synonyms) in FIELDS.items():
        for syn in synonyms:
            norm = label_form(syn)
            if not norm:
                # '#' 처럼 label_form에서 소실되는 토큰은 원형 유지
                norm = syn.lower().strip()
            if norm and norm not in exact:
                exact[norm] = (fname, weight)
            syns.append((fname, weight, norm))
    return exact, syns
