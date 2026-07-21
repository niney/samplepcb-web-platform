from __future__ import annotations

import json
import time

import httpx

from supplier_search_engine.models import PlannedQuery, RawSupplierResponse, Requirement, SearchMode, Supplier
from supplier_search_engine.suppliers.digikey import DigiKeyClient
from supplier_search_engine.suppliers.mouser import MouserClient
from supplier_search_engine.suppliers.unikeyic import UniKeyICClient, normalize_unikeyic_packaging


def query() -> PlannedQuery:
    return PlannedQuery(
        component_id="a",
        mode=SearchMode.IDENTITY,
        part_number="RC0603-10K",
        part_type="resistor",
        currency="USD",
    )


def parametric_query() -> PlannedQuery:
    return PlannedQuery(
        component_id="c1",
        mode=SearchMode.PARAMETRIC,
        part_type="capacitor",
        package="0603",
        keywords="MLCC capacitor 100nF 10% 16V 0603",
        requirements={
            "capacitance_f": Requirement(
                name="capacitance_f",
                raw_value="100nF",
                normalized_value=100e-9,
                status="extracted",
                hard=True,
            ),
            "tolerance_percent": Requirement(
                name="tolerance_percent",
                raw_value="10%",
                normalized_value=10.0,
                status="extracted",
                hard=True,
                comparison="lte",
            ),
            "voltage_v": Requirement(
                name="voltage_v",
                raw_value="16V",
                normalized_value=16.0,
                status="extracted",
                hard=True,
                comparison="gte",
            ),
            "package": Requirement(
                name="package",
                raw_value="0603",
                normalized_value="0603",
                status="extracted",
                hard=True,
            ),
        },
    )


def test_digikey_normalizes_parameters_and_offers():
    client = DigiKeyClient(client_id=None, client_secret=None, account_id=None)
    raw = RawSupplierResponse(
        supplier=Supplier.DIGIKEY,
        ok=True,
        payload={
            "Product": {
                "ProductId": 4242,
                "ManufacturerProductNumber": "RC0603-10K",
                "Manufacturer": {"Name": "Acme"},
                "Description": {"ProductDescription": "10k Ohm resistor"},
                "Parameters": [
                    {"ParameterText": "Resistance", "ValueText": "10 kOhms"},
                    {"ParameterText": "Package / Case", "ValueText": "0603"},
                ],
                "ProductVariations": [
                    {
                        "DigiKeyProductNumber": "A-1-ND",
                        "QuantityAvailableforPackageType": 42,
                        "StandardPricing": [{"BreakQuantity": 1, "UnitPrice": 0.1}],
                    }
                ],
            }
        },
    )

    product = client.normalize(raw, query())[0]

    assert product.supplier_product_id == "4242"
    assert product.normalized_specs["resistance_ohm"] == 10_000
    assert product.normalized_specs["package"] == "0603"
    assert product.offers[0].stock == 42


def test_digikey_prefers_ferrite_impedance_over_dc_resistance():
    client = DigiKeyClient(client_id=None, client_secret=None, account_id=None)
    raw = RawSupplierResponse(
        supplier=Supplier.DIGIKEY,
        ok=True,
        payload={
            "Product": {
                "ManufacturerProductNumber": "BLM18KG121TN1D",
                "Description": {"ProductDescription": "Ferrite Bead"},
                "Parameters": [
                    {"ParameterText": "Impedance @ Frequency", "ValueText": "120 Ohms @ 100 MHz"},
                    {"ParameterText": "DC Resistance (DCR) (Max)", "ValueText": "30mOhm"},
                ],
            }
        },
    )
    ferrite_query = query().model_copy(
        update={"part_number": "BLM18KG121TN1D", "part_type": "inductor"}
    )

    product = client.normalize(raw, ferrite_query)[0]

    assert product.normalized_specs["resistance_ohm"] == 120.0


def test_mouser_normalizes_attributes_stock_and_price():
    client = MouserClient(api_key=None)
    raw = RawSupplierResponse(
        supplier=Supplier.MOUSER,
        ok=True,
        payload={
            "SearchResults": {
                "Parts": [
                    {
                        "MouserPartNumber": "603-RC0603-10K",
                        "ManufacturerPartNumber": "RC0603-10K",
                        "Manufacturer": "Acme",
                        "Description": "10k Ohm resistor",
                        "AvailabilityInStock": "1,234 In Stock",
                        "ProductAttributes": [{"AttributeName": "Resistance", "AttributeValue": "10 kOhms"}],
                        "PriceBreaks": [{"Quantity": 10, "Price": "$0.12", "Currency": "USD"}],
                    }
                ]
            }
        },
    )

    product = client.normalize(raw, query())[0]

    assert product.supplier_product_id == "603-RC0603-10K"
    assert product.normalized_specs["resistance_ohm"] == 10_000
    assert product.offers[0].stock == 1234
    assert product.offers[0].price_breaks[0].unit_price == 0.12


def test_unikeyic_preserves_returned_variants_for_the_matcher():
    client = UniKeyICClient(api_key=None, base_url="")
    raw = RawSupplierResponse(
        supplier=Supplier.UNIKEYIC,
        ok=True,
        payload={
            "err_code": "Com:Success",
            "data": {
                "products": [
                    {
                        "goods_id": 9876,
                        "pro_sno": "RC0603-10K",
                        "std_mfr_name": "Acme",
                        "short_desc": "10k Ohm resistor 0603",
                        "package": "0603",
                        "stock": 5,
                        "nums": [1, 10],
                        "calc_sale_usd_price": [0.2, 0.1],
                    },
                    {"pro_sno": "RC0603-10K-OTHER", "std_mfr_name": "Other"},
                ]
            },
        },
    )

    product = client.normalize(raw, query())[0]

    assert product.supplier_product_id == "9876"
    assert product.manufacturer == "Acme"
    assert len(client.normalize(raw, query())) == 2
    assert product.package == "0603"
    assert product.offers[0].packaging == "0603"
    assert product.offers[0].stock == 5
    assert len(product.offers[0].price_breaks) == 2


async def test_unikeyic_parametric_search_uses_verified_supplier_keywords():
    request_bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        request_bodies.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "err_code": "Com:Success",
                "data": {
                    "products": [
                        {
                            "goods_id": 10,
                            "pro_sno": "MLCC-100N-16V-0603",
                            "short_desc": "MLCC 0.1uF 16V 10% 0603",
                        }
                    ]
                },
            },
        )

    reservations = 0

    async def reserve() -> None:
        nonlocal reservations
        reservations += 1

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler)
    ) as http_client:
        client = UniKeyICClient(
            api_key="not-a-real-key",
            base_url="https://example.invalid",
            client=http_client,
        )
        raw = await client.fetch(parametric_query(), reserve_call=reserve)

    assert raw.ok is True
    assert reservations == 1
    assert request_bodies == [
        {"pro_sno": "100nF 16V 10% 0603 capacitor"}
    ]
    assert raw.request_trace[0].strategy == "parametric_full"


async def test_unikeyic_preserves_hybrid_part_number_discovery():
    request_bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        request_bodies.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={"err_code": "Com:Success", "data": {"products": []}},
        )

    hybrid = query().model_copy(update={"mode": SearchMode.HYBRID})
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler)
    ) as http_client:
        client = UniKeyICClient(
            api_key="not-a-real-key",
            base_url="https://example.invalid",
            client=http_client,
        )
        raw = await client.fetch(hybrid)

    assert raw.ok is True
    assert request_bodies == [{"pro_sno": "RC0603-10K"}]
    assert raw.request_trace[0].strategy == "hybrid_keyword"


def test_unikeyic_translates_supply_packaging_to_english():
    assert normalize_unikeyic_packaging("卷带装") == "Tape & Reel"
    assert normalize_unikeyic_packaging("Cut T&R, 卷带装") == "Cut T&R, Tape & Reel"
    assert normalize_unikeyic_packaging(", 卷带装") == "Tape & Reel"
    assert normalize_unikeyic_packaging("托盘装, Tube") == "Tray, Tube"
    assert normalize_unikeyic_packaging("0603") == "0603"
    assert normalize_unikeyic_packaging("") is None
    assert normalize_unikeyic_packaging(None) is None


def test_parametric_cache_payload_tracks_generated_supplier_keywords():
    original = parametric_query()
    changed = original.model_copy(deep=True)
    changed.requirements["voltage_v"].normalized_value = 50.0
    clients = [
        DigiKeyClient(client_id=None, client_secret=None, account_id=None),
        MouserClient(api_key=None),
        UniKeyICClient(api_key=None, base_url=""),
    ]

    for client in clients:
        assert client.cache_payload(original) != client.cache_payload(changed)


async def test_retry_reserves_every_physical_supplier_call():
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(500, headers={"Retry-After": "0"}, json={"error": "temporary"})
        return httpx.Response(
            200,
            json={"SearchResults": {"Parts": [{"ManufacturerPartNumber": "RC0603-10K"}]}},
        )

    reservations = 0

    async def reserve() -> None:
        nonlocal reservations
        reservations += 1

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = MouserClient(api_key="not-a-real-key", client=http_client)
        raw = await client.fetch(query(), reserve_call=reserve)

    assert raw.ok is True
    assert attempts == 2
    assert reservations == 2


async def test_digikey_exact_404_falls_back_to_keyword_and_counts_both_calls():
    attempts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(request.url.path)
        if request.method == "GET":
            return httpx.Response(404, json={"error": "not found"})
        return httpx.Response(
            200,
            json={
                "Products": [
                    {
                        "ManufacturerProductNumber": "RC0603-10K",
                        "Manufacturer": {"Name": "Acme"},
                    }
                ]
            },
        )

    reservations = 0

    async def reserve() -> None:
        nonlocal reservations
        reservations += 1

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = DigiKeyClient(
            client_id="client",
            client_secret="secret",
            account_id=None,
            client=http_client,
        )
        client._access_token = "test-token"
        client._token_expiry = time.time() + 3_600
        raw = await client.fetch(query(), reserve_call=reserve)

    assert raw.ok is True
    assert len(attempts) == 2
    assert attempts[0].endswith("/productdetails")
    assert attempts[1].endswith("/keyword")
    assert reservations == 2


async def test_digikey_parametric_search_discovers_then_applies_response_filter_ids():
    request_bodies: list[dict] = []

    def option(parameter_id: int, name: str, values: list[tuple[str, str]]) -> dict:
        return {
            "Category": {"Id": 60, "Value": "세라믹 커패시터"},
            "ParameterId": parameter_id,
            "ParameterName": name,
            "FilterValues": [
                {"ValueId": value_id, "ValueName": value_name}
                for value_id, value_name in values
            ],
        }

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        request_bodies.append(body)
        if len(request_bodies) == 1:
            return httpx.Response(
                200,
                json={
                    "Products": [{"ManufacturerProductNumber": "DISCOVERY-ONLY"}],
                    "FilterOptions": {
                        "ParametricFilters": [
                            option(2049, "정전용량", [("100 nF", "100 nF"), ("1 uF", "1 uF")]),
                            option(3, "허용 오차", [("1133", "±10%"), ("1131", "±1%")]),
                            option(14, "전압 - 정격", [("16", "16V"), ("25", "25V")]),
                            option(16, "패키지/케이스", [("39246", "0603(1608 미터법)")]),
                        ]
                    },
                },
            )
        return httpx.Response(
            200,
            json={
                "Products": [
                    {
                        "ManufacturerProductNumber": "GRM188R71C104KA01D",
                        "Manufacturer": {"Name": "Murata"},
                    }
                ]
            },
        )

    reservations = 0

    async def reserve() -> None:
        nonlocal reservations
        reservations += 1

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = DigiKeyClient(
            client_id="client",
            client_secret="secret",
            account_id=None,
            client=http_client,
        )
        client._access_token = "test-token"
        client._token_expiry = time.time() + 3_600
        raw = await client.fetch(parametric_query(), reserve_call=reserve)

    assert raw.ok is True
    assert reservations == 2
    assert request_bodies[0]["Keywords"] == (
        "0.1uF 16V 10% 0603 capacitor"
    )
    parameter_request = request_bodies[1]["FilterOptionsRequest"]["ParameterFilterRequest"]
    assert parameter_request["CategoryFilter"] == {"Id": "60"}
    assert parameter_request["ParameterFilters"] == [
        {"ParameterId": 2049, "FilterValues": [{"Id": "100 nF"}]},
        {"ParameterId": 3, "FilterValues": [{"Id": "1133"}]},
        {"ParameterId": 14, "FilterValues": [{"Id": "16"}]},
        {"ParameterId": 16, "FilterValues": [{"Id": "39246"}]},
    ]
    assert raw.payload["SearchProbeDiscovery"]["Keywords"] == (
        "0.1uF 16V 10% 0603 capacitor"
    )
    assert raw.payload["Products"][0]["ManufacturerProductNumber"] == "GRM188R71C104KA01D"


async def test_digikey_parametric_search_skips_filter_when_discovery_is_fully_verified():
    request_bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        request_bodies.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "Products": [
                    {
                        "ManufacturerProductNumber": "GRM188R71C104KA01D",
                        "Manufacturer": {"Name": "Murata"},
                        "Category": {"Name": "Ceramic Capacitors"},
                        "Parameters": [
                            {"ParameterText": "Capacitance", "ValueText": "100 nF"},
                            {"ParameterText": "Tolerance", "ValueText": "±10%"},
                            {"ParameterText": "Voltage - Rated", "ValueText": "16 V"},
                            {"ParameterText": "Package / Case", "ValueText": "0603"},
                        ],
                    }
                ],
                "FilterOptions": {"ParametricFilters": []},
            },
        )

    reservations = 0

    async def reserve() -> None:
        nonlocal reservations
        reservations += 1

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = DigiKeyClient(
            client_id="client",
            client_secret="secret",
            account_id=None,
            client=http_client,
        )
        client._access_token = "test-token"
        client._token_expiry = time.time() + 3_600
        raw = await client.fetch(parametric_query(), reserve_call=reserve)

    assert raw.ok is True
    assert reservations == 1
    assert len(request_bodies) == 1
    assert request_bodies[0]["Keywords"] == (
        "0.1uF 16V 10% 0603 capacitor"
    )
    assert raw.payload["Products"][0]["ManufacturerProductNumber"] == "GRM188R71C104KA01D"


async def test_digikey_parametric_search_falls_back_from_full_to_core_keywords():
    request_bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        request_bodies.append(body)
        if len(request_bodies) == 1:
            return httpx.Response(200, json={"Products": [], "FilterOptions": {}})
        return httpx.Response(
            200,
            json={"Products": [{"ManufacturerProductNumber": "GRM188R71C104KA01D"}]},
        )

    reservations = 0

    async def reserve() -> None:
        nonlocal reservations
        reservations += 1

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = DigiKeyClient(
            client_id="client",
            client_secret="secret",
            account_id=None,
            client=http_client,
        )
        client._access_token = "test-token"
        client._token_expiry = time.time() + 3_600
        raw = await client.fetch(parametric_query(), reserve_call=reserve)

    assert raw.ok is True
    assert reservations == 2
    assert [body["Keywords"] for body in request_bodies] == [
        "0.1uF 16V 10% 0603 capacitor",
        "0.1uF 0603 capacitor",
    ]
    assert raw.payload["SearchProbeDiscovery"]["FallbackKeywords"] == (
        "0.1uF 0603 capacitor"
    )
    assert raw.payload["Products"][0]["ManufacturerProductNumber"] == "GRM188R71C104KA01D"


async def test_mouser_empty_exact_falls_back_to_keyword():
    requests: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request.url.path)
        if request.url.path.endswith("/partnumber"):
            return httpx.Response(200, json={"SearchResults": {"Parts": []}})
        return httpx.Response(
            200,
            json={"SearchResults": {"Parts": [{"ManufacturerPartNumber": "RC0603-10K"}]}},
        )

    reservations = 0

    async def reserve() -> None:
        nonlocal reservations
        reservations += 1

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = MouserClient(api_key="not-a-real-key", client=http_client)
        raw = await client.fetch(query(), reserve_call=reserve)

    assert raw.ok is True
    assert requests == ["/api/v1/search/partnumber", "/api/v1/search/keyword"]
    assert reservations == 2


async def test_mouser_parametric_search_falls_back_from_full_to_core_keywords():
    request_bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        request_bodies.append(body)
        if len(request_bodies) == 1:
            return httpx.Response(200, json={"SearchResults": {"Parts": []}})
        return httpx.Response(
            200,
            json={"SearchResults": {"Parts": [{"ManufacturerPartNumber": "GRM188R71C104KA01D"}]}},
        )

    reservations = 0

    async def reserve() -> None:
        nonlocal reservations
        reservations += 1

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = MouserClient(api_key="not-a-real-key", client=http_client)
        raw = await client.fetch(parametric_query(), reserve_call=reserve)

    assert raw.ok is True
    assert reservations == 2
    keywords = [next(iter(body.values()))["keyword"] for body in request_bodies]
    assert keywords == [
        "100nF 16V 10% 0603 capacitor",
        "100nF 0603 capacitor",
    ]
    assert raw.payload["SearchResults"]["Parts"][0]["ManufacturerPartNumber"] == "GRM188R71C104KA01D"
