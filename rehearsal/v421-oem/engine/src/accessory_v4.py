#!/usr/bin/env python3
"""BabyPark accessory V4: taxonomy-scoped deterministic A/B candidates.
Rehearsal only. V3.6 similarity data is copied byte-for-semantics unchanged.
"""
from __future__ import annotations
import collections, gzip, hashlib, json, re, sys, time, unicodedata
from pathlib import Path

D=Path("/opt/bp-v421-v36-full-category-decision-20261115/car_seat_correction_20261117/engine_root/work/accessories")
V39=D
V32=Path("/opt/bp-v421-v36-full-category-decision-20261115/car_seat_correction_20261117/engine_root/upstream/v32/engine")
sys.path.insert(0,str(V32))
sys.path.insert(0,str(V39/"src"))
import accessory_auto_v39 as v39
import v3_rules
import v3_rules_v421

UNIVERSAL_TERM=re.compile(r"(?i)\b(?:universal\w*|универсальн\w*|універсальн\w*)\b")
BROADNESS=re.compile(r"(?i)\b(?:all|most|вс(?:е|ех|і|іх|ім)|ус(?:і|іх|ім)|большинств\w*|більшост\w*)\b")
SCOPE={
 "stroller":re.compile(r"(?i)(?:\bfor\b|\bwith\b|\bto\b|\bfits?\b|для|до|к|на|"
     r"подходит\s+(?:ко|к|для)|підходить\s+(?:до|для)|совместим\w*\s+(?:с|со|для)|"
     r"сумісн\w*\s+(?:з|із|зі|для)|compatible\s+with|suitable\s+for|"
     r"підходить\s+(?:(?:майже|практично)\s+)?(?:усім|всім|більшості))\s+"
     r"(?:[\w-]+\s+){0,3}(?P<scope>коляс\w*|візк\w*|strollers?|prams?|bugg(?:y|ies))"),
 "car_seat":re.compile(r"(?i)(?:\bfor\b|\bwith\b|\bto\b|\bfits?\b|\bcompatible\s+with\b|"
     r"suitable\s+for|для|до|к|на|подходит\s+(?:к|для)|підходить\s+(?:до|для)|"
     r"совместим\w*\s+(?:с|со|для)|сумісн\w*\s+(?:з|із|зі|для))\s+"
     r"(?:[\w-]+\s+){0,3}(?P<scope>автокр[еі]сл\w*|car[ -]?seats?)")
}
SENTENCE=re.compile(r"(?<=[.!?;])\s+|[\r\n]+")
NARROW_SCOPE=re.compile(r"(?i)(?:прогулочн\w*|прогулянков\w*|трост\w*|люльк\w*|"
                        r"walking|cane|twin|double|ultra[- ]?compact|group\s*[0-3]|"
                        r"групп[аы]\s*[0-3])")
MECHANICAL={"adapter","bassinet","bumper","footrest","stroller_board",
            "safety_harness","second_seat","tray"}
STROLLER_BROAD={"bag","cup_holder","rain_cover","mosquito_net","seat_liner","textile_cover","handle_muff"}
CARSEAT_BROAD=set()  # General vehicle accessories are C diagnostics, never child-seat B.
HOOK_RE=re.compile(r"(?i)(?:крюч\w*|гач(?:ок|ка|ки|к\w*)|hook\w*|карабін\w*|карабин\w*)")
ROLE_MENTION={
 "bag":re.compile(r"(?i)(?:сумк\w*|органайзер\w*|\bbag\b|organizer)"),
 "cup_holder":re.compile(r"(?i)(?:подстаканник\w*|підсклянник\w*|cup\s*holder)"),
 "rain_cover":re.compile(r"(?i)(?:дождевик\w*|дощовик\w*|rain\s*cover)"),
 "mosquito_net":re.compile(r"(?i)(?:москитн\w*|москітн\w*|mosquito\s*net)"),
 "seat_liner":re.compile(r"(?i)(?:вкладыш\w*|вкладиш\w*|liner\b|вкладка)"),
 "textile_cover":re.compile(r"(?i)(?:чехол\w*|чохол\w*|cover\b|textile|текстил\w*)"),
 "handle_muff":re.compile(r"(?i)(?:муфт\w*|muff).{0,40}(?:ручк\w*|handle)|(?:ручк\w*|handle).{0,40}(?:муфт\w*|muff)")
}
CAR_SEAT_TARGET_TITLE=re.compile(r"(?i)(?:автокресл\w*|автокр[еі]сл\w*|\bcar[ -]?seats?\b|\bchild[ -]?seats?\b)")
STROLLER_TARGET_TITLE=re.compile(r"(?i)(?:коляск\w*|візк\w*|\bstrollers?\b|\bprams?\b|\bbugg(?:y|ies)\b)")
VEHICLE_ANY_CAR=re.compile(r"(?i)(?:\b(?:in|for)\s+any\s+(?:car|vehicle)\b|\bany\s+(?:car|vehicle)\b|\bв\s+любой\s+(?:машин\w*|автомобил\w*)|\b(?:в|у)\s+будь[- ]якій\s+(?:машин\w*|автомобіл\w*)|\b(?:fits?|compatible\s+with)\s+any\s+(?:car|vehicle)\b)")
HEADREST_MOUNT=re.compile(r"(?i)(?:подголовник\w*|підголівник\w*|head[ -]?rest)")
CARSEAT_SAFETY_INTERFACE=re.compile(r"(?i)(?:isofix|iso[ -]?fix|seat[ -]?belt|harness|top[ -]?tether|airbag|ремн\w*\s+безопасност|ремін\w*\s+безпек|креплен\w*\s+автокресл|кріплен\w*\s+автокріс)")

def read_rows(path):
    out={}
    with gzip.open(path,"rt",encoding="utf-8") as f:
        for line in f:
            row=json.loads(line); nid=int(row["nid"])
            if nid in out: raise ValueError("duplicate catalog NID")
            out[nid]=row
    return out

def cat_ids(row):
    result=set()
    for x in (row.get("cats") or "").split("|"):
        if ":" in x and x.split(":",1)[0].isdigit():
            result.add(int(x.split(":",1)[0]))
    return result

def taxonomy_policy(doc):
    terms=doc["terms"]; by_id={int(x["tid"]):x for x in terms}
    kids=collections.defaultdict(list)
    for x in terms:kids[int(x["parent"])].append(int(x["tid"]))
    def descend(roots):
        result=set(); todo=list(roots)
        while todo:
            tid=todo.pop()
            if tid in result:continue
            result.add(tid); todo.extend(kids[tid])
        return result
    stroller_tree=descend((109,1588)); seat_tree=descend((2,111))
    def labels(ids):return " ".join(by_id[i]["name"].casefold() for i in ids if i in by_id)
    def accessory_roots(tree):
        return [i for i in tree if i in by_id and re.search(r"аксессуар|аксесуар",by_id[i]["name"],re.I)]
    stroller_acc=descend(accessory_roots(stroller_tree))
    seat_acc=descend(accessory_roots(seat_tree))
    excluded=re.compile(r"запчаст|шасс|прогулочн\w*\s+блок|люльк|аксессуар|аксесуар|баз\w*\s+для|бустер",re.I)
    stroller_sources={i for i in stroller_tree if i in by_id and not excluded.search(by_id[i]["name"])}
    seat_sources={i for i in seat_tree if i in by_id and not excluded.search(by_id[i]["name"])}
    stroller_carrycots={i for i in stroller_tree if i in by_id and re.fullmatch(
        r"(?i)люльки?\s+(?:для|к)\s+колясок",by_id[i]["name"].strip())}
    seat_bases={i for i in seat_tree if i in by_id and re.fullmatch(
        r"(?i)баз[ыи]\s+для\s+автокр[еі]с[еі]л",by_id[i]["name"].strip())}
    return {"by_id":by_id,"stroller_tree":stroller_tree,"seat_tree":seat_tree,
            "stroller_accessories":stroller_acc,"seat_accessories":seat_acc,
            "stroller_sources":stroller_sources,"seat_sources":seat_sources,
            "stroller_carrycots":stroller_carrycots,"seat_bases":seat_bases}

def car_seat_source_class(row):
    """Classify a catalog car-seat-domain item by the physical product named in its title."""
    title=(row.get("title") or "").strip()
    seat_match=CAR_SEAT_TARGET_TITLE.search(title)
    seat_pos=seat_match.start() if seat_match else -1
    if re.search(r"(?i)(?:\bbase\b|\bбаз[аы]\b|база\s+(?:isofix|изофикс|ізофікс)|isofix\s+base)",title):
        return "isofix_base"
    if re.search(r"(?i)(?:\badapter\b|\bадаптер\w*\b)",title):
        return "adapter"
    if re.search(r"(?i)(?:\bbooster\b|\bбустер\w*\b)",title):
        return "booster_restraint"
    if re.search(r"(?i)(?:\bset\b|\bкомплект\w*\b|\bнабор\w*\b|\bнабір\w*\b)",title) and seat_match:
        return "primary_seat_set"
    accessory=re.search(r"(?i)(?:\bliner\b|\binlay\b|\binsert\b|\bcover\b|\bчехол\w*\b|\bчохол\w*\b|\bвкладыш\w*\b|\bвкладиш\w*\b|\bмоскитн\w*\b|\bмоскітн\w*\b|\brain\s*cover\b)",title)
    if accessory and (seat_pos < 0 or accessory.start() < seat_pos):
        return "accessory"
    if seat_match:
        return "primary_car_seat"
    if accessory:
        return "accessory"
    if re.search(r"(?i)(?:\bheadrest\b|\bподголовник\w*\b|\bпідголівник\w*\b|\bремн\w*\b|\bремін\w*\b|\bзапчаст\w*\b)",title):
        return "other_component"
    return "other_car_seat_domain_item"

def source_head(row,policy):
    ids=cat_ids(row)
    if row.get("type")=="kol" and ids & policy["stroller_sources"]:return "stroller"
    if row.get("type")=="kreslo" and ids & policy["seat_sources"]:
        if car_seat_source_class(row) in {"primary_car_seat","booster_restraint","primary_seat_set"}:
            return "car_seat"
    return None

def taxonomy_target_heads(row,policy):
    """Return taxonomy-only domains; this records catalog placement separately from use."""
    if row.get("type") in ("product_kit","help"):
        return set()
    ids=cat_ids(row)
    heads=set()
    if ids & policy["stroller_accessories"] or ids & policy["stroller_carrycots"]:
        heads.add("stroller")
    if ids & policy["seat_accessories"] or ids & policy["seat_bases"]:
        heads.add("car_seat")
    return heads

def target_heads(row,policy):
    """Union explicit physical use with taxonomy; an explicit car-seat title overrides a stroller-only filing."""
    heads=taxonomy_target_heads(row,policy)
    title=(row.get("title") or "")
    if (row.get("type")=="kreslo" and CAR_SEAT_TARGET_TITLE.search(title)
            and v39.explicit_accessory(row)):
        heads.add("car_seat")
        if STROLLER_TARGET_TITLE.search(title):
            heads.add("stroller")
        else:
            # A stroller accessory taxonomy path alone does not establish that
            # an explicitly titled child-car-seat part also serves strollers.
            heads.discard("stroller")
    return heads

def target_in_head(row,head,policy):
    return head in target_heads(row,policy)

def target_head(row,policy):
    """Primary actual-use head for legacy consumers; taxonomy remains queryable separately."""
    heads=target_heads(row,policy)
    if "car_seat" in heads and (CAR_SEAT_TARGET_TITLE.search(row.get("title") or "") or
                                 "car_seat" in taxonomy_target_heads(row,policy)):
        return "car_seat"
    if "stroller" in heads:
        return "stroller"
    if "car_seat" in heads:
        return "car_seat"
    return None

def target_role(target,head):
    title=(target.get("title") or "")
    body=(target.get("body") or "")
    # Keep two Russian/Ukrainian textile items functionally distinct.
    if head=="stroller" and re.search(r"(?i)(?:муфт\w*|muff)\s+(?:на|для)\s+(?:ручк\w*|handle)|(?:ручк\w*|handle)\s+(?:муфт\w*|muff)",title):
        return "handle_muff"
    if head=="stroller" and re.search(r"(?i)(?:чехол|чохол)\s+(?:для|на)\s+(?:ног|ніг)|foot[ -]?muff",title):
        return "footmuff"
    return v3_rules.accessory_class(title,body,v39.pipe.categories(target))

def _text_without_markup(value):
    return re.sub(r"<[^>]*>"," ",str(value or ""))

def source_supports_isofix(source):
    text=_text_without_markup((source.get("title") or "")+" "+(source.get("body") or ""))
    term=r"(?:isofix|iso[ -]?fix|изофикс|ізофікс)"
    negative=re.compile(r"(?i)(?:\b(?:не|нет|без|відсутн\w*|відсутн\w*|no|not|without|absent|отсутств\w*)\b.{0,100}\b"+term+r"\b|\b"+term+r"\b.{0,100}\b(?:не|нет|без|відсутн\w*|no|not|without|absent|отсутств\w*)\b)")
    other_model=re.compile(r"(?i)(?:только|лише|лишь|only)\s+(?:у|в|для|на)?\s*(?:друг\w*|інш\w*|other)\s+(?:модел\w*|model\w*)|(?:у|в|для)\s+(?:друг\w*|інш\w*)\s+модел\w*")
    question=re.compile(r"(?i)(?:\?|можно\s+ли|чи\s+можна|може\s+ли|можна\s+чи|под\s+вопрос\w*|під\s+питан\w*|is\s+it\s+possible|can\s+.{0,20}\?)")
    for sentence in SENTENCE.split(text):
        if not re.search(r"(?i)\b"+term+r"\b",sentence):
            continue
        if negative.search(sentence) or other_model.search(sentence) or question.search(sentence):
            continue
        # A neutral mention, a competitor comparison, or a safety question is
        # not proof of this model's installation hardware.
        if re.search(r"(?i)(?:установка|креплен\w*|оснащ\w*|систем\w*|fit(?:ted)?\s+with|mounts?\s+with|equipped\s+with).{0,80}\b"+term+r"\b|\b"+term+r"\b.{0,80}(?:систем\w*|креплен\w*|крепеж\w*|mounts?|fitted)",sentence):
            return True
    return False

def seat_liner_age_group_compatible(source,target):
    """Fail closed on original inserts unless the product age/weight group fits the seat."""
    sig=source.get("function_signature") or {}
    weight=sig.get("weight_range")
    if not isinstance(weight,(list,tuple)) or len(weight)!=2:
        return False
    try:
        source_min,source_max=float(weight[0]),float(weight[1])
    except (TypeError,ValueError):
        return False
    title=(target.get("title") or "")
    body=_text_without_markup(target.get("body") or "")
    text=(title+" "+body).casefold()
    group1=bool(re.search(r"(?i)(?:\bgroup\s*1\b|авто\s*group\s*1|групп[аы]\s*1|група\s*1)",text))
    if group1:
        # ECE group 1 is 9–18 kg; require the source's recorded range to cover
        # the complete group, not merely overlap at one boundary.
        return source_min<=9 and source_max>=18
    kg_range=re.search(r"(?i)(\d+(?:[.,]\d+)?)\s*(?:-|–|to|до)\s*(\d+(?:[.,]\d+)?)\s*(?:kg|кг)",body)
    if kg_range:
        low=float(kg_range.group(1).replace(",","."))
        high=float(kg_range.group(2).replace(",","."))
        return source_min<=low and source_max>=high
    from_birth=bool(re.search(r"(?i)(?:from\s+birth|с\s+самого\s+рождения|з\s+самого\s+народження|\b0\s*\+)",text))
    if from_birth:
        return source_min<=0 and source_max>0
    return False

def validate_variant_profiles(profile_rows):
    profiles={}
    for item in profile_rows:
        digest=item.get("option_digest")
        if not digest or digest in profiles:raise ValueError("missing/duplicate option profile digest")
        oids=sorted(item.get("oids",[]),key=lambda x:int(x["oid"]))
        payload=";".join("%s:%s:%.5f"%(int(o["oid"]),int(o["weight"]),float(o["price"])) for o in oids)
        actual=hashlib.sha256(payload.encode("utf-8")).hexdigest()
        if actual!=digest:raise ValueError("OID profile digest mismatch")
        if not oids or any(int(o["weight"])!=1 for o in oids):
            item=dict(item);item["all_oids_available"]=False
        profiles[digest]=item
    return profiles

def _option_profile(row,profiles,expected):
    digest=str(row.get("option_digest") or "")
    if expected=="no_options":
        return {"ok":not digest,"class":"none","digest":digest}
    profile=profiles.get(digest) if digest else None
    if not profile or not profile.get("all_oids_available") or profile.get("fitment_critical"):
        return {"ok":False,"class":None,"digest":digest}
    if expected and profile.get("variant_class")!=expected:
        return {"ok":False,"class":profile.get("variant_class"),"digest":digest}
    return {"ok":True,"class":profile.get("variant_class"),"digest":digest}

def _exact_title_model_hit(title,model,excluded_suffixes=()):
    hit,_=v39.match_exact_model(title,model)
    if hit!="candidate":return False
    tokens=re.findall(r"[A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9]+",model or "")
    if tokens and excluded_suffixes:
        model_pattern=r"[\s/-]+".join(map(re.escape,tokens))
        for suffix in excluded_suffixes:
            suffix_tokens=re.findall(r"[A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9]+",suffix)
            if not suffix_tokens:continue
            suffix_pattern=r"[\s/-]+".join(map(re.escape,suffix_tokens))
            if re.search(r"(?<![\w])"+model_pattern+r"[\s/-]+"+suffix_pattern+r"(?![\w])",title,re.I):
                return False
    return True

_OEM_DASH={"-", "\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2212"}
_OEM_CONTINUATION={"pro","plus","max","renew","slide","cabin","modular","isize","size"}
# Cyrillic letters that look like Latin. Used only to refuse a match, never to prove one.
_OEM_CONFUSABLE={
    "а":"a","е":"e","о":"o","р":"p","с":"c","х":"x","у":"y","к":"k","м":"m",
    "т":"t","в":"b","н":"h","і":"i","ї":"i","ё":"e","ѕ":"s",
}
_OEM_LABELS={
    "confirmed_conditional":"Модель есть в списке производителя. Это не безусловная рекомендация.",
    "confirmed_unconditional":"Модель и переданные условия совпали с доказательством производителя.",
    "abstain_not_listed":"Для этой модели нет явного подтверждения производителя. Совпадение не заявляется.",
    "abstain_ambiguous_model_span":"Название модели неоднозначно. Совпадение не заявляется.",
    "abstain_unknown_chassis":"Рама коляски не указана. Для адаптера совместимость не заявляется.",
    "abstain_ambiguous_chassis":"Указано несколько разных рам. Совместимость не заявляется.",
    "abstain_incomplete_interface":"У адаптера не подтверждены оба физических конца. Совместимость не заявляется.",
    "abstain_identity":"Артикул карточки не связан с артикулом производителя. Совместимость не заявляется.",
    "reject_explicit":"Производитель прямо не рекомендует эту комбинацию.",
    "reject_condition":"Модель указана, но условие использования не выполнено.",
    "reject_wrong_component":"Эта часть кресла не является подтверждённым концом адаптера.",
    "reject_class_c":"Автомобильный товар общего назначения не входит в совместимость A/B.",
}

class _OemDecision(dict):
    """Falsy unless an unconditional recommendation is actually admitted.

    build_catalog() treats a truthy manufacturer proof as an A link. OEM model
    fit must not become that link while a required condition, Stage1, the
    document hash, or a variant profile is still open.
    """
    def __bool__(self):
        return bool(self.get("unconditional_recommendation"))

def normalize_oem_model_span(value):
    """NFKC, casefold, collapse space, drop a hyphen only between alphanumeric characters.

    Generations, digits, and letter suffixes stay. Latin and Cyrillic lookalikes
    are not folded. This is not a fuzzy match.
    """
    chars=list(unicodedata.normalize("NFKC", str(value or "")).casefold())
    out=[]
    for i,ch in enumerate(chars):
        if ch in _OEM_DASH and i>0 and i+1<len(chars) and chars[i-1].isalnum() and chars[i+1].isalnum():
            continue
        if unicodedata.category(ch).startswith("P"):
            out.append(" ")
        else:
            out.append(ch)
    return " ".join("".join(out).split())

def _oem_tokens(value):
    return normalize_oem_model_span(value).split()

def _oem_fold_token(token):
    return "".join(_OEM_CONFUSABLE.get(ch, ch) for ch in token)

def _oem_continuation(token):
    return bool(token) and (token.isdigit() or len(token)==1 or token in _OEM_CONTINUATION)

def _oem_records(rules):
    if not isinstance(rules, list):
        return []
    return [r for r in rules if isinstance(r, dict) and r.get("record_type")=="oem_evidence"]

def _oem_target_skus(target):
    found=[]
    for key in ("sku","oem_article","target_sku"):
        value=target.get(key) if isinstance(target, dict) else None
        if value is None:
            continue
        text=str(value).strip()
        if text and text not in found:
            found.append(text)
    return found

def _oem_span_search(text, models):
    """Return ('hit', (start, end, model)), ('ambiguous', hits), or ('none', None).

    A listed model matches only as a whole token span. A following generation
    digit, single letter, or generation word blocks a shorter span unless that
    longer span is itself listed. NID is not read.
    """
    hay=_oem_tokens(text)
    listed=[(model,_oem_tokens(model)) for model in models or [] if _oem_tokens(model)]
    hits=[]
    for model,needle in listed:
        span=len(needle)
        for i in range(len(hay)-span+1):
            if hay[i:i+span]!=needle:
                continue
            if i+span<len(hay) and _oem_continuation(hay[i+span]):
                extended=hay[i:i+span+1]
                if not any(tokens==extended for _,tokens in listed):
                    continue
            hits.append((i,i+span,model))
    kept=[]
    for hit in hits:
        if any(hit[0]>=other[0] and hit[1]<=other[1] and (hit[0],hit[1])!=(other[0],other[1]) for other in hits):
            continue
        kept.append(hit)
    if not kept:
        return "none",None
    if len(kept)>1:
        return "ambiguous",kept
    return "hit",kept[0]

def _oem_confusable_model(text, models):
    hay=_oem_tokens(text)
    for model in models or []:
        needle=_oem_tokens(model)
        span=len(needle)
        if not needle or len(hay)<span:
            continue
        for i in range(len(hay)-span+1):
            window=hay[i:i+span]
            if window==needle:
                continue
            if i+span<len(hay) and _oem_continuation(hay[i+span]):
                continue
            if [_oem_fold_token(tok) for tok in window]==[_oem_fold_token(tok) for tok in needle]:
                return model
    return None

def _oem_classify_model(text, confirmed, absent, rejected):
    kind,hit=_oem_span_search(text, rejected or [])
    if kind=="ambiguous":
        return {"state":"ambiguous"}
    if kind=="hit":
        return {"state":"reject","model":hit[2]}
    kind,hit=_oem_span_search(text, confirmed or [])
    if kind=="ambiguous":
        return {"state":"ambiguous"}
    if kind=="hit":
        return {"state":"confirmed","model":hit[2]}
    pool=list(confirmed or [])+list(absent or [])+list(rejected or [])
    if _oem_confusable_model(text, pool):
        return {"state":"ambiguous"}
    kind,hit=_oem_span_search(text, absent or [])
    if kind=="hit":
        return {"state":"absent","model":hit[2]}
    return {"state":"unlisted"}

def _oem_model_text(source):
    if not isinstance(source, dict):
        return ""
    return source.get("title") or ""

def _oem_component(source, use_context):
    if isinstance(use_context, dict) and use_context.get("component"):
        return str(use_context.get("component"))
    title=normalize_oem_model_span(source.get("title") if isinstance(source, dict) else "")
    if "safety shell" in title or "protective shell" in title:
        return "safety_shell"
    if "soft carrier" in title:
        return "soft_carrier"
    return None

def _oem_chassis_text(chassis):
    if chassis is None:
        return ""
    if isinstance(chassis, str):
        return chassis
    if isinstance(chassis, dict):
        return chassis.get("model") or chassis.get("title") or ""
    return ""

def _oem_use_limits(record, use_context, target):
    limits=record.get("use_limits") or {}
    ctx=use_context or {}
    missing=[]
    failed=[]
    kind=limits.get("kind")
    if kind=="britax_comfort_insert":
        if record.get("catalog_newborn_wording_is_not_evidence"):
            # Seller wording such as "для новорожденных" is not a child measurement.
            pass
        if ctx.get("purpose")=="newborn_insert":
            failed.append("newborn_insert")
        standard=ctx.get("standard") or ctx.get("approval_standard")
        if not standard:
            missing.extend(["approval_standard","integrated_harness","infant_carrier","child_measure"])
            return missing,failed
        if "integrated_harness" not in ctx:
            missing.append("integrated_harness")
        elif ctx.get("integrated_harness") is not True:
            failed.append("integrated_harness")
        if "infant_carrier" not in ctx:
            missing.append("infant_carrier")
        elif ctx.get("infant_carrier") is True:
            failed.append("infant_carrier")
        if str(standard).upper()=="R129":
            if "height_cm" not in ctx:
                missing.append("height_cm")
            if "direction" not in ctx:
                missing.append("direction")
            else:
                direction=str(ctx.get("direction"))
                height=ctx.get("height_cm")
                if height is not None and direction=="rearward" and float(height)<60:
                    failed.append("height_cm")
                elif height is not None and direction=="forward" and float(height)<76:
                    failed.append("height_cm")
                elif direction not in ("rearward","forward"):
                    failed.append("direction")
        elif str(standard).upper()=="R44":
            if "weight_kg" not in ctx:
                missing.append("weight_kg")
            elif float(ctx.get("weight_kg"))<9:
                failed.append("weight_kg")
        else:
            failed.append("approval_standard")
    elif kind=="outdoor_only":
        if "in_vehicle" not in ctx:
            missing.append("in_vehicle")
        elif ctx.get("in_vehicle") is True:
            failed.append("in_vehicle")
    elif kind=="height_band":
        if "height_cm" not in ctx:
            missing.append("height_cm")
        else:
            low,high=limits.get("height_cm") or (None,None)
            height=float(ctx.get("height_cm"))
            if low is None or high is None or height<float(low) or height>float(high):
                failed.append("height_cm")
        if limits.get("forbid_other_insert"):
            if "other_insert_fitted" not in ctx:
                missing.append("other_insert_fitted")
            elif ctx.get("other_insert_fitted") is True:
                failed.append("other_insert_fitted")
        allowed=limits.get("models") or record.get("confirmed_models") or []
        seat=ctx.get("seat_model") or _oem_model_text({"title":ctx.get("seat_model") or ""})
        if ctx.get("seat_model"):
            found=_oem_classify_model(ctx.get("seat_model"), allowed, [], [])
            if found["state"]!="confirmed":
                failed.append("seat_model")
    return missing,failed

def _oem_base_payload(record, source, target, decision, model_fit, matched_model, reason, chassis_text):
    return {
        "record_type":"oem_evidence",
        "decision":decision,
        "model_fit":model_fit,
        "matched_model":matched_model,
        "reason":reason,
        "evidence_key":record.get("evidence_key"),
        "oem_article":record.get("oem_article"),
        "accessory_type":record.get("accessory_type"),
        "accessory_class":record.get("accessory_class"),
        "document_url":(record.get("document") or {}).get("url"),
        "document_version":(record.get("document") or {}).get("version"),
        "catalog_tier":None,
        "newborn_insert_recommended":False,
        "missing_required_conditions":[],
        "failed_conditions":[],
        "link":{
            "state":decision,
            "source_sku":source.get("sku") if isinstance(source, dict) else None,
            "target_sku":target.get("sku") if isinstance(target, dict) else None,
            "oem_article":record.get("oem_article"),
            "matched_model":matched_model,
            "chassis":chassis_text or None,
        },
    }

def _oem_finish(payload, record, source, target, profiles, use_context):
    blockers=[]
    document=record.get("document") or {}
    if not document.get("content_sha256"):
        blockers.append("document_hash_missing")
    if not (isinstance(use_context, dict) and use_context.get("stage1_passed") is True):
        blockers.append("stage1_not_run")
    if not eligible_source(source) or not eligible_source(target):
        blockers.append("not_currently_purchasable")
    digest=str((target or {}).get("option_digest") or "")
    if digest:
        profile=_option_profile(target, profiles or {}, None)
        if not profile["ok"]:
            blockers.append("variant_profile_not_cleared")
    if payload.get("missing_required_conditions"):
        blockers.append("missing_required_conditions")
    if payload.get("failed_conditions"):
        blockers.append("failed_use_conditions")
    if payload.get("decision") not in ("confirmed_conditional","confirmed_unconditional"):
        blockers.append(payload.get("decision"))
    payload["publication_blockers"]=list(dict.fromkeys([item for item in blockers if item]))
    admit=bool(
        payload.get("model_fit") is True
        and not payload["publication_blockers"]
        and record.get("accessory_class") in ("A","B")
        and not payload.get("missing_required_conditions")
        and not payload.get("failed_conditions")
    )
    if admit:
        payload["decision"]="confirmed_unconditional"
        payload["link"]["state"]="confirmed_unconditional"
    payload["unconditional_recommendation"]=admit
    payload["ab_eligible"]=admit
    payload["human_label"]=_OEM_LABELS.get(payload["decision"], _OEM_LABELS["abstain_not_listed"])
    return _OemDecision(payload)

def _oem_from_model_state(state, record, source, target, chassis_text, profiles, use_context, extra_missing=None):
    code=state["state"]
    if code=="reject":
        payload=_oem_base_payload(record, source, target, "reject_explicit", False, state.get("model"), "oem_explicit_rejection", chassis_text)
        return _oem_finish(payload, record, source, target, profiles, use_context)
    if code=="ambiguous":
        payload=_oem_base_payload(record, source, target, "abstain_ambiguous_model_span", None, None, "confusable_or_multiple_model_span", chassis_text)
        return _oem_finish(payload, record, source, target, profiles, use_context)
    if code!="confirmed":
        reason="named_absent_from_oem_list" if code=="absent" else "not_in_oem_allow_list"
        payload=_oem_base_payload(record, source, target, "abstain_not_listed", None, None, reason, chassis_text)
        return _oem_finish(payload, record, source, target, profiles, use_context)
    missing,failed=_oem_use_limits(record, use_context, target)
    if extra_missing:
        missing.extend(extra_missing)
    decision="reject_condition" if failed else "confirmed_conditional"
    payload=_oem_base_payload(record, source, target, decision, True, state.get("model"), "oem_model_listed", chassis_text)
    payload["missing_required_conditions"]=list(dict.fromkeys(missing))
    payload["failed_conditions"]=list(dict.fromkeys(failed))
    payload["link"]["matched_model"]=state.get("model")
    return _oem_finish(payload, record, source, target, profiles, use_context)

def _oem_adapter_decision(record, source, target, profiles, use_context, chassis):
    interface=record.get("interface") or {}
    chassis_text=_oem_chassis_text(chassis if chassis is not None else (use_context or {}).get("chassis_model") or (use_context or {}).get("chassis"))
    component=_oem_component(source, use_context)
    rejected=set(interface.get("rejected_components") or [])
    if interface.get("mode")=="chassis_specific_lists":
        if not chassis_text:
            payload=_oem_base_payload(record, source, target, "abstain_unknown_chassis", None, None, "adapter_chassis_unknown", "")
            return _oem_finish(payload, record, source, target, profiles, use_context)
        matched=[]
        for entry in interface.get("lists") or []:
            kind,hit=_oem_span_search(chassis_text, entry.get("chassis_models") or [])
            if kind=="ambiguous":
                payload=_oem_base_payload(record, source, target, "abstain_ambiguous_chassis", None, None, "multiple_chassis_spans", chassis_text)
                return _oem_finish(payload, record, source, target, profiles, use_context)
            if kind=="hit":
                matched.append((hit[2], entry))
        if len(matched)>1:
            payload=_oem_base_payload(record, source, target, "abstain_ambiguous_chassis", None, None, "chassis_matches_several_lists", chassis_text)
            return _oem_finish(payload, record, source, target, profiles, use_context)
        if not matched:
            payload=_oem_base_payload(record, source, target, "abstain_not_listed", None, None, "chassis_not_on_this_adapter", chassis_text)
            return _oem_finish(payload, record, source, target, profiles, use_context)
        chassis_model,entry=matched[0]
        state=_oem_classify_model(
            _oem_model_text(source),
            entry.get("confirmed_models") or [],
            entry.get("explicit_absent_models") or [],
            entry.get("explicit_reject_models") or [],
        )
        extra=[]
        if state["state"]=="confirmed" and component in rejected:
            payload=_oem_base_payload(record, source, target, "reject_wrong_component", False, state.get("model"), "component_is_not_the_confirmed_end", chassis_text)
            payload["component"]=component
            payload["matched_chassis"]=chassis_model
            return _oem_finish(payload, record, source, target, profiles, use_context)
        if state["state"]=="confirmed" and state.get("model") in (entry.get("component_confirmation_required_models") or []):
            if component is None:
                extra.append("component")
            elif component!=entry.get("confirmed_component", "soft_carrier"):
                payload=_oem_base_payload(record, source, target, "reject_wrong_component", False, state.get("model"), "component_is_not_the_confirmed_end", chassis_text)
                payload["component"]=component
                payload["matched_chassis"]=chassis_model
                return _oem_finish(payload, record, source, target, profiles, use_context)
        result=_oem_from_model_state(state, record, source, target, chassis_text, profiles, use_context, extra)
        result["matched_chassis"]=chassis_model
        result["link"]["chassis"]=chassis_model
        return result
    seat_state=_oem_classify_model(_oem_model_text(source), interface.get("seat_models") or [], interface.get("explicit_absent_models") or [], [])
    if seat_state["state"]!="confirmed":
        return _oem_from_model_state(seat_state, record, source, target, chassis_text, profiles, use_context)
    if not chassis_text or component is None:
        payload=_oem_base_payload(record, source, target, "abstain_incomplete_interface", None, seat_state.get("model"), "adapter_requires_both_ends", chassis_text)
        missing=[]
        if component is None:
            missing.append("component")
        if not chassis_text:
            missing.append("chassis")
        payload["missing_required_conditions"]=missing
        payload["seat_name_listed"]=True
        return _oem_finish(payload, record, source, target, profiles, use_context)
    seat_state=_oem_classify_model(_oem_model_text(source), interface.get("seat_models") or [], interface.get("explicit_absent_models") or [], [])
    if seat_state["state"]!="confirmed":
        return _oem_from_model_state(seat_state, record, source, target, chassis_text, profiles, use_context)
    if interface.get("required_component") and component!=interface.get("required_component"):
        payload=_oem_base_payload(record, source, target, "reject_wrong_component", False, seat_state.get("model"), "component_is_not_the_confirmed_end", chassis_text)
        payload["component"]=component
        return _oem_finish(payload, record, source, target, profiles, use_context)
    chassis_entries=interface.get("chassis") or []
    kind,hit=_oem_span_search(chassis_text, [item.get("model") for item in chassis_entries])
    if kind=="ambiguous":
        payload=_oem_base_payload(record, source, target, "abstain_ambiguous_chassis", None, seat_state.get("model"), "multiple_chassis_spans", chassis_text)
        return _oem_finish(payload, record, source, target, profiles, use_context)
    if kind!="hit":
        payload=_oem_base_payload(record, source, target, "abstain_not_listed", None, None, "chassis_not_on_this_adapter", chassis_text)
        return _oem_finish(payload, record, source, target, profiles, use_context)
    chosen=next(item for item in chassis_entries if item.get("model")==hit[2])
    extra=[]
    failed_extra=[]
    if chosen.get("attachment")=="extension_adapter_required":
        present=(use_context or {}).get("extension_adapter_present") if isinstance(use_context, dict) else None
        if present is None:
            extra.append("extension_adapter")
        elif present is not True:
            failed_extra.append("extension_adapter")
    result=_oem_from_model_state(seat_state, record, source, target, chosen.get("model"), profiles, use_context, extra)
    if failed_extra:
        result["failed_conditions"]=list(dict.fromkeys(list(result.get("failed_conditions") or [])+failed_extra))
        result["decision"]="reject_condition"
        result["model_fit"]=True
        result["unconditional_recommendation"]=False
        result["ab_eligible"]=False
        result["link"]["state"]="reject_condition"
        result["publication_blockers"]=list(dict.fromkeys(list(result.get("publication_blockers") or [])+["failed_use_conditions","reject_condition"]))
        result["human_label"]=_OEM_LABELS["reject_condition"]
    result["matched_chassis"]=chosen.get("model")
    result["attachment"]=chosen.get("attachment")
    result["component"]=component
    result["link"]["chassis"]=chosen.get("model")
    return result

def _oem_fitment_decision(source, target, rules, use_context, chassis, profiles):
    records=_oem_records(rules)
    if not records or not isinstance(source, dict) or not isinstance(target, dict):
        return None
    skus=_oem_target_skus(target)
    if not skus:
        return None
    matched=[]
    for record in records:
        article=str(record.get("oem_article") or "").strip()
        catalog=[str(item).strip() for item in record.get("catalog_skus") or []]
        unjoined=[str(item).strip() for item in record.get("unjoined_seller_skus") or []]
        if any(sku==article or sku in catalog or sku in unjoined for sku in skus):
            matched.append(record)
    if not matched:
        return None
    if len(matched)>1:
        payload=_oem_base_payload(matched[0], source, target, "abstain_identity", None, None, "conflicting_oem_article_joins", "")
        return _oem_finish(payload, matched[0], source, target, profiles, use_context)
    record=matched[0]
    # Article identity is the join. Source and target NIDs are ignored on purpose.
    if record.get("accessory_class")=="C" or record.get("never_ab"):
        payload=_oem_base_payload(record, source, target, "reject_class_c", None, None, "class_c_not_in_ab", "")
        payload["ab_eligible"]=False
        return _oem_finish(payload, record, source, target, profiles, use_context)
    if any(sku in [str(item).strip() for item in record.get("unjoined_seller_skus") or []] for sku in skus):
        payload=_oem_base_payload(record, source, target, "abstain_identity", None, None, "catalog_sku_not_joined_to_oem_article", "")
        return _oem_finish(payload, record, source, target, profiles, use_context)
    if record.get("interface"):
        return _oem_adapter_decision(record, source, target, profiles, use_context, chassis)
    if record.get("completeness_state")=="partial_no_generalization" and not record.get("confirmed_models"):
        payload=_oem_base_payload(record, source, target, "abstain_not_listed", None, None, "no_generalization_from_partial_list", "")
        return _oem_finish(payload, record, source, target, profiles, use_context)
    state=_oem_classify_model(
        _oem_model_text(source),
        record.get("confirmed_models") or [],
        record.get("explicit_absent_models") or [],
        record.get("explicit_reject_models") or [],
    )
    return _oem_from_model_state(state, record, source, target, "", profiles, use_context)

def manufacturer_fitment_match(source,target,policy,rules,profiles,use_context=None,chassis=None):
    oem=_oem_fitment_decision(source,target,rules,use_context,chassis,profiles)
    if oem is not None:
        return oem
    if not eligible_source(source) or not eligible_source(target):return None
    if source.get("type")=="product_kit" or target.get("type")=="product_kit":return None
    if source.get("lang")!=target.get("lang") or source.get("brand_tid")!=target.get("brand_tid"):return None
    if source.get("nid")==target.get("nid") or source.get("tnid")==target.get("tnid"):return None
    source_head_value=source_head(source,policy)
    if not source_head_value:return None
    for rule in rules:
        if (source.get("brand_tid")!=rule["brand_tid"] or
            source_head_value!=rule["source_head"] or not target_in_head(target,rule["target_head"],policy) or
            source.get("type")!=rule["source_type"] or target.get("type")!=rule["target_type"]):
            continue
        model_hit,_=v39.match_exact_model(source.get("title",""),rule["source_model"])
        target_model_hit=_exact_title_model_hit(target.get("title",""),rule.get("target_model",rule["source_model"]),rule.get("target_excluded_suffixes",()))
        if model_hit!="candidate" or not target_model_hit:continue
        sig=source.get("function_signature") or {}
        if any(sig.get(k)!=v for k,v in rule.get("source_variant",{}).items()):continue
        if rule["target_role"]=="bassinet" and (target.get("function_signature") or {}).get("child_capacity")!="double":continue
        if not re.search(rule["target_title_pattern"],target.get("title","")):continue
        source_prof=_option_profile(source,profiles,rule["variant_policy"].get("source_class"))
        target_expected=rule["variant_policy"].get("target")
        if target_expected=="no_options":
            target_prof=_option_profile(target,profiles,"no_options")
        else:
            target_prof=_option_profile(target,profiles,rule["variant_policy"].get("target_class"))
        if not source_prof["ok"] or not target_prof["ok"]:continue
        if rule["target_head"]=="car_seat" and rule["target_role"]=="seat_liner" and not seat_liner_age_group_compatible(source,target):continue
        option_policy=rule["variant_policy"].get("option_sets")
        if option_policy=="identical" and source_prof["digest"]!=target_prof["digest"]:continue
        return {"evidence_key":rule["evidence_key"],"manufacturer_evidence":rule["evidence"],
                "role":rule["target_role"],
                "variant_gate":{"source":source_prof,"target":target_prof,"policy":option_policy or "independent_color"}}
    return None

def brand_in_sentence(target,sentence):
    raw=(target.get("brand") or "").split("(",1)[0].strip()
    tokens=re.findall(r"[A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9]+",raw)
    if not tokens:return False
    pattern=r"(?i)(?<!\w)"+r"[-\s]+".join(map(re.escape,tokens))+r"(?!\w)"
    return bool(re.search(pattern,sentence))

def broad_scope(target,head):
    role=target_role(target,head)
    if role=="vehicle_seat_protector":
        # Safety-sensitive under-seat mats require exact model-maker approval
        # and are never admitted as category-universal B from seller wording.
        return None
    allowed=STROLLER_BROAD if head=="stroller" else CARSEAT_BROAD
    if role not in allowed or role in MECHANICAL:return None
    title=(target.get("title") or "").strip()
    # The V3 role classifier can see a bag noun in a hook title. Do not let
    # hook compatibility prose turn that different physical item into a bag.
    if HOOK_RE.search(title):return None
    # A cover intended for the separate bassinet/cot attachment is not a
    # universally fitting main stroller rain cover.
    if re.search(r"(?i)(?:для|до|for)\s+(?:[\w-]+\s+){0,2}(?:люльк\w*|bassinet|carrycot|\bcot\b)",title):
        return None
    # Explicit lists of a limited selection of physical model names
    # are evidence of MODEL-SPECIFIC scope, not full-brand universality.
    if re.search(r"(?<!\d)[a-zа-яёіїєґ0-9]+\s*/\s*[a-zа-яёіїєґ0-9]+",title,re.I):
        return None
    # A carrier bag for a specific stroller generation is not a generic
    # mother/organizer bag; the source model is a hard fitment constraint.
    if re.search(r"(?i)(?:сумк[а-яіїєґ-]*[- ]переноск\w*|сумк[а-яіїєґ-]*[- ]переносн\w*|carry\s*bag|transport\s*bag)", title):
        return None
    body=_text_without_markup(target.get("body") or "")
    chunks=[title]+SENTENCE.split(body)
    if head=="car_seat":
        # General vehicle accessories (including headrest-mounted organizers)
        # are diagnostic class C, not child-seat accessories. They are reported
        # separately and never count as A/B coverage for a child car seat.
        return None
    scope=SCOPE[head]
    best_scope=None
    for sentence in chunks:
        if not sentence or len(sentence)>1200:continue
        if v39.NEGATIVE.search(sentence):continue
        if HOOK_RE.search(sentence):continue
        other_roles=[name for name,pattern in ROLE_MENTION.items()
                     if name!=role and pattern.search(sentence)]
        if other_roles:continue
        match=scope.search(sentence)
        if not match:continue
        relation=match.group(0)
        if NARROW_SCOPE.search(relation):continue
        tail=sentence[match.end():match.end()+60]
        if re.match(r"\s*(?:групп[аы]\s*[0-3]|group\s*[0-3])",tail,re.I):continue
        # A proper model or series after the category noun narrows the claim.
        same_brand=brand_in_sentence(target,sentence)
        # A category noun qualified by a named model/series is *not*
        # "all strollers". E.g. "для всех колясок багги IQ".
        # If it is followed by the seller's brand, restrict to that brand
        # and only when there is no further model qualifier.
        tail_clean=tail.lstrip()
        if tail_clean and tail_clean[0].isalnum():
            bname=(target.get("brand") or "").split("(",1)[0].strip().casefold()
            tail_lower=tail_clean.casefold()
            if same_brand and bname and tail_lower.startswith(bname) and (
                len(tail_lower)==len(bname) or not tail_lower[len(bname)].isalnum()):
                rest=tail_lower[len(bname):].lstrip()
                if rest and rest[0].isalnum():continue
            elif not re.match(r"(?i)^(?:любого\s+тип[ау]|будь-як\w*\s+тип\w*|разных\s+типов|різних\s+типів)\b",tail_clean):
                continue
        quantified_scope=bool(BROADNESS.search(relation))
        title_claim=bool(UNIVERSAL_TERM.search(title))
        sentence_claim=bool(UNIVERSAL_TERM.search(sentence))
        # Cross-brand claims need a quantified whole-category scope or an
        # explicit universal label on the product title. Body-only adjectives
        # stay brand-limited and cannot silently travel across manufacturers.
        if not (quantified_scope or title_claim or (same_brand and sentence_claim)):continue
        # Manufacturer-wide claims stay within that brand; they never cross brands.
        candidate={"role":role,"evidence":sentence[:400],
                   "scope":"brand_wide" if same_brand else "category_wide",
                   "capacity":"standard_only" if re.search(r"(?i)(?:стандартн\w*|standard)\b",relation) else "unspecified",
                   "brand_tid":int(target.get("brand_tid") or 0) if same_brand else None}
        # Prefer the exact quantified sentence ("most/all strollers") over a
        # generic relation sentence that is only made broad by the title.
        if quantified_scope:return candidate
        if best_scope is None:best_scope=candidate
    return best_scope

CAPACITY_EVIDENCE=[{
    "brand":"Lionelo", "model":"Elia", "capacity":"single",
    "evidence":"Lionelo Elia is a one-child stroller; the V4.2 function signature was triggered by double suspension/wheels, not passenger capacity.",
    "source":"https://lionelo.pl/products/wozek-spacerowy-elia-beige-taupe"
}]

def stroller_capacity(row):
    title=row.get("title") or ""
    text=title+" "+(row.get("body") or "")
    title_multi=bool(v3_rules_v421.MULTI_CHILD_STROLLER_RE.search(title))
    title_single=bool(v3_rules_v421.SINGLE_CHILD_STROLLER_RE.search(title))
    # The product title is the strongest catalogue-level capacity cue; body
    # text can describe a separate carrycot/feature and must not override it.
    if title_multi and not title_single:return "double"
    if title_single and not title_multi:return "single"
    if title_multi and title_single:return None
    multi=bool(v3_rules_v421.MULTI_CHILD_STROLLER_RE.search(text))
    single=bool(v3_rules_v421.SINGLE_CHILD_STROLLER_RE.search(text))
    for rule in CAPACITY_EVIDENCE:
        brand=(row.get("brand") or "").split("(",1)[0].strip().casefold()
        if brand.casefold()!=rule["brand"].casefold():continue
        hit,_=v39.match_exact_model(title,rule["model"])
        if hit=="candidate" and not multi:
            return rule["capacity"]
    if multi and single:return None
    if multi:return "double"
    if single:return "single"
    return "single_unspecified"

def eligible_source(row):
    return (row and int(row.get("published") or 0)==1 and
            int(row.get("field_status") or 0)==1 and float(row.get("price") or 0)>0)

def commercial_accessory_order(ids,source,rows,evidence_by_id,head):
    """Stable preferred-brand ordering within, never across, A/B and role."""
    buckets=collections.OrderedDict()
    for tid in ids:
        row=rows[tid]
        reason=evidence_by_id.get(str(tid),{})
        role=reason.get("role") or target_role(row,head) or "unknown"
        buckets.setdefault(role,[]).append(tid)
    result=[]
    for role,group in buckets.items():
        base={65:0,67:1}
        preferred=sorted([x for x in group if int(rows[x].get("brand_tid") or 0) in base],
                         key=lambda x:base[int(rows[x].get("brand_tid") or 0)])
        result.extend(preferred+[x for x in group if x not in preferred])
    return result

def build_catalog(rows,original,index,policy,fitment_rules=None,option_profiles=None):
    start=time.perf_counter()
    fitment_rules=fitment_rules or []
    option_profiles=option_profiles or {}
    metrics={"sources":len(original),"edges":{"A_model":0,"B_universal":0,"A_manufacturer_verified":0},
             "cross_type_B_edges":0,"manufacturer_A_edges":0,"B_target_type_edges":{},
             "sources_with_A":0,"sources_with_B":0,"sources_with_any":0,
             "available_sources":{},"available_with_A":{},"available_with_B":{},
             "eligible_accessory_inventory":{},"universal_scope_inventory":{}}
    pool_a=v39.build_pool(rows)
    pool={}; universal_pool=collections.defaultdict(list)
    for key,items in pool_a.items():
        pool[key]=[r for r in items if target_heads(r,policy)]
    # B inventory uses functional target classification, not the source Drupal
    # type. Existing exported bundles may provide relevant accessory targets.
    for target in rows.values():
        for head in sorted(target_heads(target,policy)):
            if not eligible_source(target):continue
            metrics_key="|".join((head,target["lang"],target["type"]))
            metrics["eligible_accessory_inventory"][metrics_key]=metrics["eligible_accessory_inventory"].get(metrics_key,0)+1
            if target.get("type")=="help" and not _option_profile(target,option_profiles,None)["ok"]:
                continue
            scope=broad_scope(target,head)
            if scope:
                universal_pool[(head,target["lang"])].append((target,scope))
                metrics["universal_scope_inventory"][metrics_key]=metrics["universal_scope_inventory"].get(metrics_key,0)+1
    mechanical_pool=collections.defaultdict(list)
    if fitment_rules:
        for target in rows.values():
            if not eligible_source(target):continue
            for target_head_value in sorted(target_heads(target,policy)):
                for rule in fitment_rules:
                    if (target_head_value==rule["target_head"] and
                        target.get("type")==rule["target_type"] and
                        target.get("brand_tid")==rule["brand_tid"]):
                        mechanical_pool[(target_head_value,target.get("lang"),target.get("brand_tid"))].append(target)
                        break
    sources={}; evidence={}
    brand=collections.defaultdict(lambda:{"sources":0,"available":0,"A_sources":0,"B_sources":0,"A_edges":0,"B_edges":0})
    by_locale=collections.defaultdict(lambda:{"sources":0,"available":0,"A_sources":0,"B_sources":0,"A_edges":0,"B_edges":0})
    for sid,record in original.items():
        nid=int(sid); source=rows.get(nid)
        if not source:raise ValueError("missing manifest source "+sid)
        head=source_head(source,policy)
        a_ids=[]; a_reasons={}
        if head and eligible_source(source):
            choices,info=v39.rank_source(source,index,pool)
            for tid in choices:
                target=rows[tid]
                if not target_in_head(target,head,policy):continue
                why=v39.reason_for(source,target,v39.group_model(source,index))
                if not why.startswith("accepted_"):continue
                if head=="car_seat" and target_role(target,head)=="seat_liner" and not seat_liner_age_group_compatible(source,target):continue
                a_ids.append(int(tid))
                a_reason={"tier":"A_model","reason":why}
                taxonomy_heads=taxonomy_target_heads(target,policy)
                if head=="car_seat" and head not in taxonomy_heads:
                    a_reason.update({"cross_taxonomy":"explicit car-seat accessory title in stroller taxonomy; exact same-brand source-model match",
                                     "taxonomy_heads":sorted(taxonomy_heads),
                                     "functional_head":"car_seat"})
                a_reasons[str(tid)]=a_reason
        # Manufacturer-confirmed mechanical fitment is an explicit evidence
        # class with model + functional-role + variant/OID gates. No NID list.
        if head and eligible_source(source) and fitment_rules:
            for target in mechanical_pool.get((head,source.get("lang"),source.get("brand_tid")),()):
                proof=manufacturer_fitment_match(source,target,policy,fitment_rules,option_profiles)
                if proof:
                    tid=int(target["nid"])
                    if tid not in a_ids:
                        a_ids.append(tid)
                        a_reasons[str(tid)]={"tier":"A_model","reason":"accepted_manufacturer_verified_fitment",
                                             **proof}
        a_ids=list(dict.fromkeys(a_ids))
        a_ids=commercial_accessory_order(a_ids,source,rows,a_reasons,head)
        old_similar=list(record["similar"])
        b_ids=[]; b_reasons={}
        if head and eligible_source(source):
            candidates=[]
            # An exact-model accessory outranks a generic product serving
            # the same purpose; avoid duplicate functional roles in A/B.
            covered_a_roles=set()
            for current_a in a_ids:
                original_a=rows[current_a]
                role_a=target_role(original_a,head)
                if role_a:covered_a_roles.add(role_a)
            for target,scope in universal_pool.get((head,source["lang"]),()):
                if scope["role"] in covered_a_roles:continue
                tid=int(target["nid"])
                if tid==nid or int(target["tnid"])==int(source["tnid"]):continue
                if scope.get("brand_tid") and scope["brand_tid"]!=int(source.get("brand_tid") or 0):continue
                if scope.get("requires_isofix") and not source_supports_isofix(source):continue
                # Normal/twin stroller capacity is a safety property, not
                # a reason to fill the block with an unfitted rain cover.
                if head=="stroller":
                    capacity=stroller_capacity(source)
                    if capacity in ("double",None):
                        # A confirmed double/twin source or conflicting capacity
                        # cues requires explicit double-stroller fit evidence.
                        if scope.get("capacity")!="double_confirmed":
                            continue
                if tid in old_similar or tid in a_ids:continue
                candidates.append((scope["role"],tid,scope))
            role_priority={"bag":0,"cup_holder":1,"handle_muff":2,"rain_cover":3,
                           "mosquito_net":4,"seat_liner":5,"textile_cover":6}
            # First retain V4.2's safe base order, then move only eligible
            # Joolz/Maxi-Cosi products ahead within the same B role.
            candidates.sort(key=lambda x:(
                0 if int(rows[x[1]].get("brand_tid") or 0)==int(source.get("brand_tid") or 0) else 1,
                role_priority.get(x[0],99),x[1]))
            base_by_role=collections.OrderedDict()
            for item in candidates:base_by_role.setdefault(item[0],[]).append(item)
            candidates=[]
            for role,group_items in base_by_role.items():
                pref={65:0,67:1}
                preferred=sorted([x for x in group_items if int(rows[x[1]].get("brand_tid") or 0) in pref],
                                 key=lambda x:pref[int(rows[x[1]].get("brand_tid") or 0)])
                candidates.extend(preferred+[x for x in group_items if x not in preferred])
            seen_roles=set()
            for role,tid,scope in candidates:
                if tid in b_ids or role in seen_roles:continue
                b_ids.append(tid);seen_roles.add(role)
                b_reasons[str(tid)]={"tier":"B_universal","role":role,
                                     "label_key":"may_fit","scope":scope["scope"],
                                     "evidence":scope["evidence"]}
                if scope.get("compatibility_basis"):
                    b_reasons[str(tid)]["compatibility_basis"]=scope["compatibility_basis"]
                    b_reasons[str(tid)]["independent_of_child_seat_model"]=True
                if len(b_ids)>=3:break
        # A has precedence; the existing similar field also has precedence.
        b_ids=[tid for tid in b_ids if tid not in set(old_similar) and tid not in set(a_ids)]
        a_ids=[tid for tid in a_ids if tid not in set(old_similar)]
        total=(a_ids+b_ids)[:20]
        a_ids=[tid for tid in a_ids if tid in total]
        b_ids=[tid for tid in b_ids if tid in total]
        if len(total)!=len(set(total)) or set(total)&set(old_similar):
            raise ValueError("duplicate/overlap invariant failed "+sid)
        if list(record["similar"])!=old_similar:raise ValueError("similar changed "+sid)
        sources[sid]={"language":record["language"],"similar":old_similar,
                      "accessories":total}
        if a_ids or b_ids:
            evidence[sid]={"head":head,"A_model":a_ids,"B_universal":b_ids,
                           "targets":{**{k:v for k,v in a_reasons.items() if int(k) in a_ids},
                                      **{k:v for k,v in b_reasons.items() if int(k) in b_ids}}}
        typ=source.get("type","?")
        locale=source.get("lang","?")
        group=brand[(source.get("brand_tid"),source.get("brand") or "unknown",typ,locale)]
        group["sources"]+=1
        lg=by_locale[(head or "excluded",typ,locale)]
        lg["sources"]+=1
        if eligible_source(source):
            group["available"]+=1;lg["available"]+=1
            key=f"{head or 'excluded'}|{typ}|{locale}"
            metrics["available_sources"][key]=metrics["available_sources"].get(key,0)+1
        group["A_edges"]+=len(a_ids);group["B_edges"]+=len(b_ids)
        if a_ids:group["A_sources"]+=1;lg["A_sources"]+=1;metrics["sources_with_A"]+=1
        if b_ids:group["B_sources"]+=1;lg["B_sources"]+=1;metrics["sources_with_B"]+=1
        if a_ids or b_ids:
            lg["A_edges"]+=len(a_ids);lg["B_edges"]+=len(b_ids)
            metrics["sources_with_any"]+=1
            if eligible_source(source):
                key=f"{head or 'excluded'}|{typ}|{locale}"
                if a_ids:metrics["available_with_A"][key]=metrics["available_with_A"].get(key,0)+1
                if b_ids:metrics["available_with_B"][key]=metrics["available_with_B"].get(key,0)+1
        metrics["edges"]["A_model"]+=len(a_ids)
        metrics["edges"]["B_universal"]+=len(b_ids)
        manufacturer_ids=[tid for tid in a_ids if a_reasons.get(str(tid),{}).get("reason")=="accepted_manufacturer_verified_fitment"]
        metrics["edges"]["A_manufacturer_verified"]+=len(manufacturer_ids)
        metrics["manufacturer_A_edges"]+=len(manufacturer_ids)
        for tid in b_ids:
            target_type=rows[tid].get("type","?")
            key=target_type
            metrics["B_target_type_edges"][key]=metrics["B_target_type_edges"].get(key,0)+1
            if target_type!=source.get("type"):
                metrics["cross_type_B_edges"]+=1
    metrics["elapsed_seconds"]=round(time.perf_counter()-start,3)
    metrics["by_type_locale"]=[{"head":k[0],"type":k[1],"lang":k[2],**v} for k,v in sorted(by_locale.items())]
    metrics["by_brand_type_locale"]=[{"brand_tid":k[0],"brand":k[1],"type":k[2],"lang":k[3],**v} for k,v in sorted(brand.items(),key=lambda x:(str(x[0][2]),str(x[0][3]),str(x[0][1])))]
    return sources,evidence,metrics

def main():
    rows=read_rows(D/"input/current_catalog_records.jsonl.gz")
    core_rows=len(rows)
    original=json.loads((D/"input/current_v36_similarity_only_manifest.json").read_text())["sources"]
    index=json.loads((D/"input/v36_worker_state.json").read_text())["index"]
    taxonomy=json.loads((D/"input/taxonomy_terms_v4.json").read_text())
    if core_rows!=28011 or len(original)!=8471:raise ValueError("unexpected accepted snapshot dimensions")
    policy=taxonomy_policy(taxonomy)
    # No type=help import. Existing public export already contains a narrow
    # cross-type set in the exported Drupal bundles, gated by exact taxonomy.
    help_rows=[]
    profiles_doc=json.loads((D/"input/variant_option_profiles_v42.json").read_text())
    option_profiles=validate_variant_profiles(profiles_doc["profiles"])
    fitment_doc=json.loads((D/"input/manufacturer_fitment_evidence_v42.json").read_text())
    fitment_rules=fitment_doc["rules"]
    sources,evidence,metrics=build_catalog(rows,original,index,policy,fitment_rules,option_profiles)
    header={"schema":"babypark-recommendations-v42-rehearsal-candidate-v1",
            "generation_id":"v42-candidate-rehearsal-only","sources":sources}
    metrics.update({"schema":"babypark-v42-catalog-metrics-v1","catalog_rows":core_rows,
                    "core_catalog_rows":core_rows,"supplemental_help_rows":len(help_rows),
                    "calculation_catalog_rows":len(rows),
                    "manifest_sources":len(original),"manual_fields_read":False,
                    "manual_fallback":False,"similar_lists_preserved":True,
                    "taxonomy_snapshot":taxonomy["schema"],"groups":"A_model_then_B_universal",
                    "no_oem_certification":True,"help_rows_imported":0,
                    "cross_type_policy":"existing_export_taxonomy_branch_and_functional_role"})
    def write_new(path,data):
        if path.exists():raise FileExistsError(path)
        path.write_text(json.dumps(data,ensure_ascii=False,sort_keys=True,separators=(",",":"))+"\n")
    write_new(D/"output/v4_candidate_manifest.json",header)
    write_new(D/"output/v4_candidate_evidence.json",evidence)
    write_new(D/"output/v4_metrics.json",metrics)
    print(json.dumps({k:v for k,v in metrics.items() if k not in ("by_brand_type_locale",)},ensure_ascii=False,indent=2))
if __name__=="__main__":main()