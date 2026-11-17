# OEM fitment — unresolved blockers

Rehearsal only. Nothing here is a publishable A/B link.

| Blocker | File | Reason |
|---|---|---|
| Full catalog replay was not run | `grok-handoff/BabyPark_V421_OEM_Grok_Source_20261117.zip` (`README_GROK.md`) | The 8,129-source / 28,769-row snapshot, Stage1 file, and T2 manifest are not in the archive. No replay was invented. |
| DUALFIX PRO M title is not confirmed | `rehearsal/v421-oem/fixtures/OEM_VERIFIED_MISSED_PAIRS.csv` | RU and UK titles end in Cyrillic `М` (U+041C). The OEM list uses Latin `M`. Lookalike folding is forbidden, so the pair abstains instead of matching DUALFIX PRO or DUALFIX PRO M. |
| OEM page bytes are absent | `rehearsal/v421-oem/engine/input/manufacturer_fitment_evidence_v42.json` | Every shipped record has `content_sha256: null`. A missing hash blocks an unconditional recommendation. |
| Relax Insert has no catalog join | same evidence file, article `ACCSFCC207` | Seller SKU `2000040775` is listed under `unjoined_seller_skus`. Title similarity is not a join. |
| Britax allow-list is a subset | evidence key `britax-comfort-insert-2000030111` | The manufacturer page has 21 models. This handoff names 11 confirmed models and the absences KIDFIX PRO and SWIVEL. Any other model abstains. |
| Coral Slide Pro on the Bugaboo Fox 5 adapter | evidence key `bugaboo-fox-adapter-400019001` | The Fox 5 list names the seat, but not whether the end is the soft carrier or the safety shell. The model match stays conditional until the component is known. A safety shell is rejected. |
| Fox 2 positive list is not in the handoff | same Bugaboo Fox record | Only the named absence of Pebble 360 Pro 2 is recorded for Fox 2. Other Fox 2 pairs abstain. The Fox 5 list is not copied onto Fox 2. |
| Stage1 was not run for the new pairs | fixtures `HOLDOUT_RESULTS.csv` and `OEM_VERIFIED_MISSED_PAIRS.csv` | `stage1_new_pair_checked` is `no`. Purchasability of H01 and the Fox frames cannot be rechecked without the snapshot. |
| Maxi-Cosi Pocket has no model list | evidence key `maxi-cosi-pocket-74203550` | The control says the manual lists older models and not RodiFix Air Protect. Those older names are not in the zip, so the record does not generalize. |
