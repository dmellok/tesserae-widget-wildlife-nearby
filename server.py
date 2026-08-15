"""wildlife_nearby — what has actually been seen around this panel.

Runs on the Tesserae side, never the client. Returns a JSON-serialisable dict,
or {"error": "friendly message"}; never raises — helpers hand back
``(value, error)`` tuples so the failure path stays a plain return.

Source is iNaturalist's public API (no key). Two modes come off two endpoints
that share the same geography and filters:

  recent  /v1/observations                 what was last spotted, newest first
  common  /v1/observations/species_counts  what turns up most often here

GBIF was the obvious alternative and is the bigger archive, but its freshest
record for a Melbourne suburb was five weeks old — the aggregation lag makes
"recently spotted" meaningless. iNaturalist had observations from yesterday.

Caches in ctx["data_dir"]:
  result_<slug>.json    assembled payload (TTL = refresh_min)
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime
from pathlib import Path
from typing import Any

API = "https://api.inaturalist.org/v1"
# iNaturalist asks callers to identify themselves and holds you to 60 requests
# a minute; one fetch per refresh is nowhere near that.
USER_AGENT = "tesserae-wildlife-nearby/0.1 (+https://github.com/dmellok/tesserae)"
HTTP_TIMEOUT_S = 20

GROUPS = {
    "all": None,
    "birds": "Aves",
    "mammals": "Mammalia",
    "insects": "Insecta",
    "spiders": "Arachnida",
    "plants": "Plantae",
    "fungi": "Fungi",
    "reptiles": "Reptilia",
    "amphibians": "Amphibia",
    "fish": "Actinopterygii",
}

# Only the groups with an icon that genuinely depicts them. Phosphor has no
# mushroom, frog, lizard or snake, and an approximation is worse than nothing —
# a prawn standing in for a frog reads as a mistake, which it was. Fungi,
# Reptilia and Amphibia therefore fall to the generic binoculars, along with
# Animalia, Protozoa, Chromista and unknown, which iNaturalist also returns.
# Resolving that here rather than in the client keeps the choice in the payload
# where it can be tested.
ICON_GROUPS = frozenset({
    "Aves", "Mammalia", "Insecta", "Arachnida", "Plantae",
    "Mollusca", "Actinopterygii",
})

ERR_NO_LOCATION = "Set a location in this cell's settings to see what lives there."
ERR_UNREACHABLE = "Couldn't reach iNaturalist right now."


def _http_json(url: str) -> tuple[Any | None, str | None]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT,
                                               "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
            return json.loads(resp.read().decode("utf-8")), None
    except urllib.error.HTTPError as err:
        if err.code == 429:
            return None, "iNaturalist is rate-limiting us. Try a slower refresh."
        return None, f"iNaturalist returned HTTP {err.code}."
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        return None, ERR_UNREACHABLE


def _title(s: str) -> str:
    """iNaturalist common names arrive in mixed case ('hop goodenia')."""
    s = (s or "").strip()
    return s[:1].upper() + s[1:] if s else ""


def _ago(iso: str | None) -> str:
    if not iso:
        return ""
    try:
        seen = date.fromisoformat(iso[:10])
    except ValueError:
        return ""
    days = (date.today() - seen).days
    if days <= 0:
        return "today"
    if days == 1:
        return "yesterday"
    if days < 7:
        return f"{days} days ago"
    if days < 60:
        weeks = days // 7
        return f"{weeks} week{'s' if weeks > 1 else ''} ago"
    months = days // 30
    return f"{months} month{'s' if months > 1 else ''} ago"


def _locality(place: str | None) -> str:
    """A suburb out of iNaturalist's free-text place string.

    place_guess is whatever the observer's device produced: "Blanch St,
    Preston, VIC, AU" or "Bundoora VIC 3083" or a road junction. The street is
    never the interesting part and can be enormous, so prefer the second comma
    field and fall back to the first with any state or postcode trimmed.
    """
    parts = [p.strip() for p in (place or "").split(",") if p.strip()]
    if not parts:
        return ""
    # "Blanch St, Preston, VIC, AU" -> the second field is the suburb, but
    # "Bundoora VIC 3083, Australia" only has two, where the second is the
    # country. Three or more fields means a street came first.
    town = parts[1] if len(parts) >= 3 else parts[0]
    town = re.sub(r"\s+(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\b.*$", "", town, flags=re.I)
    town = re.sub(r"\s*\d{4,}\s*$", "", town).strip()
    if len(town) > 22 or "/" in town:
        return ""
    return town


def _photo(node: dict[str, Any] | None, url_key: str = "url") -> dict[str, str]:
    """Photo URLs plus the attribution the CC licences require.

    iNaturalist serves square/small/medium/large off one path, so the size is a
    substitution rather than a separate field.
    """
    node = node or {}
    url = node.get(url_key) or node.get("medium_url") or node.get("square_url") or ""
    if not url:
        return {}
    base = url
    for size in ("square", "small", "medium", "large", "original"):
        base = base.replace(f"/{size}.", "/{SIZE}.")
    return {
        "photo": base.replace("{SIZE}", "large"),
        "thumb": base.replace("{SIZE}", "medium"),
        "credit": (node.get("attribution") or "").replace("(c) ", "\u00a9 ").strip(),
    }


def _entry(taxon: dict[str, Any]) -> dict[str, Any]:
    common = _title(taxon.get("preferred_common_name") or "")
    sci = taxon.get("name") or ""
    rank = taxon.get("rank") or ""
    return {
        "name": common or sci,
        # only worth printing the binomial when it is not already the headline
        "sci": sci if common else "",
        "rank": rank,
        "group": taxon.get("iconic_taxon_name") or "unknown",
        "icon": (taxon.get("iconic_taxon_name")
                 if taxon.get("iconic_taxon_name") in ICON_GROUPS else "other"),
        "id": taxon.get("id"),
        **_photo(taxon.get("default_photo")),
    }


def _recent(base: str, want: int) -> tuple[list | None, str | None]:
    """Newest observations, one row per species.

    Over-fetches because a busy patch will report the same magpie a dozen times
    in a row, and a list of one species repeated is not a list.
    """
    url = f"{base}&order_by=observed_on&order=desc&per_page={min(200, want * 8)}"
    payload, err = _http_json(f"{API}/observations?{url}")
    if err or payload is None:
        return None, err
    seen: dict[int, dict[str, Any]] = {}
    for obs in payload.get("results") or []:
        taxon = obs.get("taxon") or {}
        tid = taxon.get("id")
        if not tid or tid in seen:
            continue
        row = _entry(taxon)
        row["when"] = obs.get("observed_on") or ""
        row["ago"] = _ago(row["when"])
        row["by"] = ((obs.get("user") or {}).get("login")) or ""
        row["where"] = _locality(obs.get("place_guess"))
        shot = _photo((obs.get("photos") or [None])[0])
        if shot:                       # the sighting's own photo beats the taxon's
            row.update(shot)
        seen[tid] = row
        if len(seen) >= want:
            break
    return list(seen.values()), None


def _common(base: str, want: int) -> tuple[list | None, str | None]:
    payload, err = _http_json(f"{API}/observations/species_counts?{base}&per_page={want}")
    if err or payload is None:
        return None, err
    rows = []
    for r in payload.get("results") or []:
        row = _entry(r.get("taxon") or {})
        row["count"] = int(r.get("count") or 0)
        rows.append(row)
    return rows, None


def fetch(
    options: dict[str, Any], settings: dict[str, Any], *, ctx: dict[str, Any]
) -> dict[str, Any]:
    try:
        lat = float(options.get("latitude"))
        lon = float(options.get("longitude"))
    except (TypeError, ValueError):
        return {"error": ERR_NO_LOCATION}

    label = str(options.get("label") or options.get("location") or "").strip()
    mode = str(options.get("mode") or "recent").strip()
    mode = mode if mode in ("recent", "common") else "recent"
    group_key = str(options.get("group") or "all").strip().lower()
    group_key = group_key if group_key in GROUPS else "all"
    research = options.get("research_only", True) is not False
    try:
        radius = max(1, min(200, int(float(options.get("radius_km") or 15))))
    except (TypeError, ValueError):
        radius = 15
    try:
        want = max(3, min(20, int(options.get("count") or 8)))
    except (TypeError, ValueError):
        want = 8
    try:
        refresh_min = max(5, int(options.get("refresh_min") or 60))
    except (TypeError, ValueError):
        refresh_min = 60

    params = {
        "lat": f"{lat:.5f}", "lng": f"{lon:.5f}", "radius": str(radius),
        "verifiable": "true",
    }
    if research:
        params["quality_grade"] = "research"
    if GROUPS[group_key]:
        params["iconic_taxa"] = GROUPS[group_key]
    base = urllib.parse.urlencode(params)

    data_dir = Path(ctx.get("data_dir") or ".")
    with contextlib.suppress(OSError):
        data_dir.mkdir(parents=True, exist_ok=True)
    slug = hashlib.sha1(f"{base}|{mode}|{want}".encode()).hexdigest()[:12]
    cache = data_dir / f"result_{slug}.json"

    now = int(time.time())
    if cache.exists() and now - int(cache.stat().st_mtime) < refresh_min * 60:
        with contextlib.suppress(OSError, json.JSONDecodeError):
            cached = json.loads(cache.read_text(encoding="utf-8"))
            if isinstance(cached, dict):
                # dates are relative, so they have to be recomputed on a cache hit
                for row in cached.get("items", []):
                    if row.get("when"):
                        row["ago"] = _ago(row["when"])
                cached["label"] = label or cached.get("label", "")
                return cached

    items, err = (_recent if mode == "recent" else _common)(base, want)
    if err or items is None:
        return {"error": err or ERR_UNREACHABLE, "label": label}

    totals, _terr = _http_json(f"{API}/observations?{base}&per_page=0")
    total = int((totals or {}).get("total_results") or 0)

    groups_present: dict[str, int] = {}
    for row in items:
        groups_present[row["group"]] = groups_present.get(row["group"], 0) + 1

    result = {
        "label": label or f"{abs(lat):.2f}°{'S' if lat < 0 else 'N'}",
        "lat": round(lat, 4),
        "lon": round(lon, 4),
        "radius_km": radius,
        "mode": mode,
        "mode_label": "Recently spotted" if mode == "recent" else "Most recorded",
        "group": group_key,
        "group_label": "All wildlife" if group_key == "all" else group_key.capitalize(),
        "research_only": research,
        "items": items,
        "shown": len(items),
        "total_observations": total,
        "species_top": items[0]["name"] if items else "",
        "groups_present": groups_present,
        "with_photos": sum(1 for r in items if r.get("photo")),
        "layout": str(options.get("layout") or "list"),
        "empty": not items,
        "fetched_at": now,
        "date": datetime.now().strftime("%a %d %b"),
    }
    with contextlib.suppress(OSError):
        cache.write_text(json.dumps(result), encoding="utf-8")
    return result
