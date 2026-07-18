from __future__ import annotations

from supplier_search_engine.models import PlannedQuery, Requirement, SearchMode
from supplier_search_engine.supplier_query import supplier_core_keywords, supplier_spec_keywords


def requirement(name: str, value: float | str) -> Requirement:
    return Requirement(
        name=name,
        raw_value=str(value),
        normalized_value=value,
        status="extracted",
        hard=True,
    )


def test_resistor_query_uses_full_verified_spec_then_core_fallback():
    query = PlannedQuery(
        component_id="r1",
        mode=SearchMode.PARAMETRIC,
        part_type="resistor",
        requirements={
            "resistance_ohm": requirement("resistance_ohm", 10_000.0),
            "power_w": requirement("power_w", 0.0625),
            "tolerance_percent": requirement("tolerance_percent", 1.0),
            "package": requirement("package", "0402"),
        },
    )

    assert supplier_spec_keywords(query) == "10k 0.0625W 1% 0402"
    assert supplier_core_keywords(query) == "10k 0402"


def test_capacitor_query_uses_dielectric_in_precise_search_but_not_broad_fallback():
    query = PlannedQuery(
        component_id="c1",
        mode=SearchMode.PARAMETRIC,
        part_type="capacitor",
        requirements={
            "capacitance_f": requirement("capacitance_f", 100e-9),
            "voltage_v": requirement("voltage_v", 50.0),
            "tolerance_percent": requirement("tolerance_percent", 10.0),
            "package": requirement("package", "C1005"),
            "dielectric": requirement("dielectric", "X5R"),
        },
    )

    assert supplier_spec_keywords(query) == "100nF 50V 10% X5R 0402"
    assert supplier_core_keywords(query) == "100nF 0402"
