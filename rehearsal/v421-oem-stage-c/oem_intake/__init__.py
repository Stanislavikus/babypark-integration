"""BabyPark V4.2.1 OEM-fitment Stage C (S5-S6): consumer-side intake of verified OEM relations.

Rehearsal only. stdlib-only. Reuses the independently accepted Stage B package ``oem_stage`` unchanged (import path helper in
``_stage_b``). Nothing here publishes a recommendation, writes to the V4.2.1 engine tree or touches production: the gate turns Stage B
relations into a typed envelope of accepted catalog edges plus a ledger of everything held; the optional engine seam
(``engine_seam/accessory_v4_stage_c.py``, default OFF) is the only consumer of that envelope.
"""
