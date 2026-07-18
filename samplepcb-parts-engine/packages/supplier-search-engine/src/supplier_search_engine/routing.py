from __future__ import annotations

from .models import PlannedQuery, SearchMode, Supplier


def suppliers_for_query(query: PlannedQuery) -> tuple[Supplier, ...]:
    if query.mode == SearchMode.INSUFFICIENT:
        return ()
    suppliers = [Supplier.DIGIKEY, Supplier.MOUSER]
    if query.part_number:
        suppliers.append(Supplier.UNIKEYIC)
    return tuple(suppliers)
