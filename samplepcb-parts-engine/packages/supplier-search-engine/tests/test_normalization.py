from __future__ import annotations

import pytest

from supplier_search_engine.normalization import (
    dielectric_notation,
    normalize_dielectric,
    normalize_package,
    packages_compatible,
    normalized_specs_from_parameters,
    normalized_specs_from_text,
)
from supplier_search_engine.normalizer import parse_voltage_v


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("16 V", 16.0),
        ("16 VDC", 16.0),
        ("250VAC", 250.0),
        ("500 mVDC", 0.5),
    ],
)
def test_voltage_normalization_accepts_supplier_vdc_and_vac_notation(value, expected):
    assert parse_voltage_v(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("C1005", "0402"),
        ("0402 (1005 Metric)", "0402"),
        ("0402/1005", "0402"),
        ("C1608", "0603"),
        ("R0402", "0402"),
        ("C3225", "1210"),
        ("SOIC-8", "SOIC8"),
        ("VQFN-16", "QFN16"),
        ("16-VFQFN", "QFN16"),
        ("SON-8", "DFN8"),
        ("8-WDFN", "DFN8"),
        ("64-TQFP", "TQFP64"),
        ("SC-74A, SOT-753", "SOT235"),
        ("SC-76, SOD-323", "SOD323"),
        ("SC-90, SOD-323F", "SC90"),
        ("TO-236-3, SC-59, SOT-23-3", "SOT23"),
    ],
)
def test_package_normalization_uses_imperial_canonical_codes(value, expected):
    assert normalize_package(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("CAP_C2012N", "0805"),
        ("RES_C2012N", "0805"),
        ("IND_C2012N", "0805"),
        ("CAP_ECAP_F55", ""),
        ("CAP_ECAP_H10", ""),
        ("RES_C3216ARRAY4", ""),
        ("RESC3216_ARRAY4", ""),
        ("PDA1_SSR", ""),
        ("SOT_23", "SOT23"),
    ],
)
def test_internal_cad_footprints_only_expose_verified_physical_sizes(
    value,
    expected,
):
    assert normalize_package(value) == expected


@pytest.mark.parametrize(
    ("value", "component_type", "expected"),
    [
        ("402", "resistor", "0402"),
        ("603", "capacitor", "0603"),
        ("805", "inductor", "0805"),
        ("C805", "capacitor", "0805"),
        ("R402", "resistor", "0402"),
        ("SMD1608", "resistor", "0603"),
        ("SMD2012", "capacitor", "0805"),
        ("SMD3216", "inductor", "1206"),
        ("CR2012", "resistor", "0805"),
        ("CC2012", "capacitor", "0805"),
        ("CT6032", "capacitor", "2312"),
        ("SMD", "capacitor", ""),
    ],
)
def test_legacy_passive_package_notation_is_contextually_normalized(
    value,
    component_type,
    expected,
):
    assert normalize_package(value, component_type) == expected


def test_legacy_passive_package_notation_is_not_guessed_outside_passive_context():
    assert normalize_package("402", "connector") == "402"
    assert normalize_package("SMD2012", "ic") == "SMD2012"


@pytest.mark.parametrize(
    "value",
    [
        "1612",
        "1.6 x 1.2 mm",
        "1.6mm x 1.2mm",
        "1.60 mm × 1.20 mm",
        "4-SMD(1.6x1.2)",
    ],
)
def test_crystal_package_normalization_uses_physical_metric_code(value):
    assert normalize_package(value, "crystal") == "1612"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("2.0 x 1.6 mm", "2016"),
        ("2.5mm x 2.0mm", "2520"),
        ("3.2 mm × 2.5 mm", "3225"),
        ("3225", "3225"),
    ],
)
def test_crystal_package_context_does_not_apply_passive_aliases(value, expected):
    assert normalize_package(value, "oscillator") == expected


def test_generic_crystal_smd_pin_count_has_no_physical_package():
    assert normalize_package("4-SMD", "crystal") == ""
    assert normalize_package("4-SMD") == "4SMD"


def test_crystal_text_and_parameters_receive_component_context():
    text = normalized_specs_from_text(
        "32MHz crystal, 4-SMD, body 1.6mm x 1.2mm",
        "crystal",
    )
    parameters, _raw = normalized_specs_from_parameters(
        [("Size / Dimension", "1.60 mm × 1.20 mm")],
        "crystal",
    )

    assert text["package"] == "1612"
    assert parameters["package"] == "1612"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("X5R", "X5R"),
        ("x7r", "X7R"),
        ("C0G (NP0)", "C0G"),
        ("NP0", "C0G"),
        ("12pF CH 0402", "CH"),
    ],
)
def test_dielectric_normalization(value, expected):
    assert normalize_dielectric(value) == expected


def test_dielectric_notation_preserves_alias_for_comparison_display():
    assert dielectric_notation("MLCC 100pF NP0 0402") == "NP0"
    assert normalize_dielectric("MLCC 100pF NP0 0402") == "C0G"


def test_supplier_text_and_parameters_extract_dielectric():
    text = normalized_specs_from_text("0.1uF 50V X5R 0402", "capacitor")
    parameters, _raw = normalized_specs_from_parameters(
        [("Temperature Characteristic", "X7R")]
    )

    assert text["dielectric"] == "X5R"
    assert text["package"] == "0402"
    assert parameters["dielectric"] == "X7R"


def test_diode_parameter_normalization_prefers_reverse_rating_over_forward_drop():
    parameters, _raw = normalized_specs_from_parameters(
        [
            ("Voltage - Forward (Vf) (Max)", "0.63 V @ 3 A"),
            ("Voltage - DC Reverse (Vr) (Max)", "60 V"),
        ],
        "diode",
    )

    assert parameters["voltage_v"] == 60.0


def test_package_compatibility_accepts_dimension_only_bom_notation():
    assert packages_compatible("10X10", "176-UFBGA-10X10")


def test_parameter_normalization_prefers_output_ratings_over_dropout_and_quiescent_values():
    parameters, _raw = normalized_specs_from_parameters(
        [
            ("Voltage - Input (Max)", "6V"),
            ("Voltage - Output (Min/Fixed)", "3.3V"),
            ("Voltage Dropout (Max)", "0.315V @ 1A"),
            ("Current - Output", "1A"),
            ("Current - Quiescent (Iq)", "40uA"),
        ]
    )

    assert parameters["voltage_v"] == 3.3
    assert parameters["current_a"] == 1.0

    excluded, _raw = normalized_specs_from_parameters(
        [("Voltage Dropout (Max)", "0.315V"), ("Current - Quiescent (Iq)", "40uA")]
    )
    assert "voltage_v" not in excluded
    assert "current_a" not in excluded


def test_digikey_pin_header_parameters_keep_metric_pitch_and_connector_family():
    parameters, _raw = normalized_specs_from_parameters(
        [
            ("Connector Type", "Header"),
            ("Contact Type", "Male Pin"),
            ("Number of Positions", "2"),
            ("Number of Rows", "1"),
            ("Pitch - Mating", '0.100" (2.54mm)'),
            ("Mounting Type", "Through Hole"),
        ],
        "connector",
    )

    assert parameters["connector_family"] == "pin_header"
    assert parameters["pin_count"] == 2
    assert parameters["row_count"] == 1
    assert parameters["pitch_mm"] == pytest.approx(2.54)


def test_connector_text_normalization_distinguishes_header_and_ffc_geometry():
    header = normalized_specs_from_text(
        "ECONOSTIK HEADER SR VT TH 1X5, 2.54mm Pitch",
        "connector",
    )
    ffc = normalized_specs_from_text(
        "FFC/FPC Single Row, 6 Positions, 2.54mm (.100in) Pitch",
        "connector",
    )

    assert header == {
        "connector_family": "pin_header",
        "pin_count": 5,
        "pitch_mm": 2.54,
        "row_count": 1,
    }
    assert ffc["connector_family"] == "ffc_fpc"
    assert ffc["pin_count"] == 6
    assert ffc["row_count"] == 1
    assert ffc["pitch_mm"] == pytest.approx(2.54)


@pytest.mark.parametrize(
    ("description", "pin_count", "row_count"),
    [
        ("M20 02 SIL HORIZONTAL PIN HEADER", 2, 1),
        ("M20 05+05 DIL VERTICAL PIN HEADER", 10, 2),
    ],
)
def test_connector_text_normalization_understands_supplier_sil_dil_notation(
    description,
    pin_count,
    row_count,
):
    specs = normalized_specs_from_text(description, "connector")

    assert specs["connector_family"] == "pin_header"
    assert specs["pin_count"] == pin_count
    assert specs["row_count"] == row_count
