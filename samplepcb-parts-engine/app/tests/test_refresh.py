from parts_engine_app.refresh import _catalog_search_batch


def test_catalog_search_batch_preserves_exact_capacitance_and_voltage_specs():
    batch = _catalog_search_batch("560nF 16V", 150)

    assert len(batch.components) == 1
    component = batch.components[0]
    assert component.fields["part_type"].value == "capacitor"
    assert component.fields["capacitance"].normalized_value == 560e-9
    assert component.fields["voltage"].normalized_value == 16.0
    assert component.fields["part_number"].value is None
    assert component.fields["quantity"].value == 150
    assert component.required_quantity == 150


def test_catalog_search_batch_keeps_plain_text_as_identity_search():
    batch = _catalog_search_batch("GRM155R71C104KA88D")

    component = batch.components[0]
    assert component.fields["part_number"].value == "GRM155R71C104KA88D"
    assert component.fields["part_number"].status == "extracted"
