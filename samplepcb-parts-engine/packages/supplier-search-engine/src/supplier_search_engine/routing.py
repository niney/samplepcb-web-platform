from __future__ import annotations

from .models import PlannedQuery, SearchMode, Supplier


_UNIKEYIC_PARAMETRIC_TYPES = {"resistor", "capacitor", "inductor", "crystal"}


def suppliers_for_query(query: PlannedQuery) -> tuple[Supplier, ...]:
    if query.mode == SearchMode.INSUFFICIENT:
        return ()
    suppliers = [Supplier.DIGIKEY, Supplier.MOUSER]
    if query.part_number or (
        query.mode == SearchMode.PARAMETRIC
        and (query.part_type or "").casefold() in _UNIKEYIC_PARAMETRIC_TYPES
    ):
        suppliers.append(Supplier.UNIKEYIC)
    return tuple(suppliers)
