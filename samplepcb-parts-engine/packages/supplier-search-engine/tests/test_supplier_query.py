from __future__ import annotations

from supplier_search_engine.models import (
    PlannedQuery,
    Requirement,
    SearchMode,
    Supplier,
)
from supplier_search_engine.supplier_query import (
    supplier_core_keywords,
    supplier_spec_keywords,
)


def requirement(name: str, value: float | str) -> Requirement:
    return Requirement(
        name=name,
        raw_value=str(value),
        normalized_value=value,
        status="extracted",
        hard=True,
    )


def user_hint(name: str, value: str) -> Requirement:
    return Requirement(
        name=name,
        raw_value=value,
        normalized_value=value,
        status="user",
        hard=False,
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
    assert supplier_spec_keywords(query, Supplier.DIGIKEY) == (
        "10k 0.0625W 1% 0402 resistor"
    )


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
    assert supplier_spec_keywords(query, Supplier.DIGIKEY) == (
        "0.1uF 50V 10% X5R 0402 capacitor"
    )
    assert supplier_spec_keywords(query, Supplier.MOUSER) == (
        "100nF 50V 10% X5R 0402 capacitor"
    )


def test_ferrite_bead_query_uses_impedance_and_avoids_inductor_value_tokens():
    query = PlannedQuery(
        component_id="bd1",
        mode=SearchMode.PARAMETRIC,
        part_type="inductor",
        description="2012 BEAD / 470 ~ 680 ohm",
        requirements={
            "resistance_ohm": requirement("resistance_ohm", 680.0),
            "package": requirement("package", "0805"),
        },
    )

    assert supplier_spec_keywords(query, Supplier.DIGIKEY) == (
        "0805 680 Ohms ferrite bead"
    )
    assert supplier_spec_keywords(query, Supplier.MOUSER) == ("0805 680R ferrite bead")


def test_supplier_queries_keep_large_electrolytics_in_microfarads():
    query = PlannedQuery(
        component_id="c2",
        mode=SearchMode.PARAMETRIC,
        part_type="capacitor",
        category_policy="electrolytic",
        requirements={
            "capacitance_f": requirement("capacitance_f", 1e-3),
            "voltage_v": requirement("voltage_v", 10.0),
        },
    )

    assert supplier_spec_keywords(query, Supplier.DIGIKEY) == (
        "1000uF 10V aluminum electrolytic capacitor"
    )
    assert supplier_spec_keywords(query, Supplier.MOUSER) == (
        "1000uF 10V electrolytic capacitor"
    )


def test_new_category_queries_include_user_classification_hints():
    transistor = PlannedQuery(
        component_id="q1",
        mode=SearchMode.PARAMETRIC,
        part_type="transistor",
        category_policy="transistor",
        requirements={
            "package": requirement("package", "SOT-23"),
            "device_kind": user_hint("device_kind", "mosfet"),
            "polarity": user_hint("polarity", "n-channel"),
        },
    )
    connector = PlannedQuery(
        component_id="j1",
        mode=SearchMode.PARAMETRIC,
        part_type="connector",
        category_policy="connector",
        requirements={
            "pin_count": requirement("pin_count", 4),
            "pitch_mm": requirement("pitch_mm", 2.54),
            "gender": user_hint("gender", "male"),
            "orientation": user_hint("orientation", "right-angle"),
        },
    )

    assert supplier_spec_keywords(transistor, Supplier.DIGIKEY) == (
        "SOT23 mosfet n channel transistor"
    )
    assert supplier_spec_keywords(connector, Supplier.DIGIKEY) == (
        "4 pin 2.54mm pitch male right angle connector"
    )


def test_pin_header_query_uses_supplier_probed_array_notation_for_both_rungs():
    query = PlannedQuery(
        component_id="j2",
        mode=SearchMode.PARAMETRIC,
        part_type="connector",
        category_policy="connector",
        requirements={
            "connector_family": requirement("connector_family", "pin_header"),
            "pin_count": requirement("pin_count", 5),
            "row_count": requirement("row_count", 1),
            "pitch_mm": requirement("pitch_mm", 2.54),
            "mount_style": requirement("mount_style", "through-hole"),
        },
    )

    assert supplier_spec_keywords(query, Supplier.DIGIKEY) == (
        "2.54mm 1x5 pin header through hole"
    )
    assert supplier_spec_keywords(query, Supplier.MOUSER) == (
        "2.54mm 1x5 pin header through hole"
    )
    assert supplier_core_keywords(query, Supplier.DIGIKEY) == (
        "2.54mm 1x5 pin header through hole"
    )
