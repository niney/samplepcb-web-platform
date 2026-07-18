from __future__ import annotations

from .cache import stable_cache_key
from .models import PlannedQuery
from .suppliers.base import SupplierClient


def supplier_cache_coordinates(client: SupplierClient, query: PlannedQuery) -> tuple[str, str]:
    namespace = f"raw:{client.supplier.value}:{client.api_version}:{client.cache_scope}"
    return namespace, stable_cache_key(client.cache_payload(query))
