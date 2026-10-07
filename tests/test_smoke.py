"""Unit tests for wildlife_nearby.

The HTTP layer is monkeypatched, so these run offline and make no calls against
iNaturalist's rate limit. The fixtures are trimmed copies of real responses.
"""

from __future__ import annotations

import json
from datetime import date, timedelta

import server

MERNDA = {"latitude": -37.635, "longitude": 145.095, "label": "Mernda"}


def _obs(name, common, iconic, days_ago, place="Blanch St, Preston, VIC, AU", tid=None):
    when = (date.today() - timedelta(days=days_ago)).isoformat()
    return {
        "observed_on": when,
        "place_guess": place,
        "user": {"login": "someone"},
        "taxon": {"id": tid if tid is not None else abs(hash(name)) % 10**6,
                  "name": name, "preferred_common_name": common,
                  "rank": "species", "iconic_taxon_name": iconic},
    }


def _install(monkeypatch, by_path):
    def fake(url):
        for frag, payload in by_path.items():
            if frag in url:
                return payload, None
        return {"results": [], "total_results": 0}, None
    monkeypatch.setattr(server, "_http_json", fake)


# ----- locality parsing ----------------------------------------------


def test_locality_prefers_the_suburb_over_the_street():
    assert server._locality("Blanch St, Preston, VIC, AU") == "Preston"


def test_locality_handles_a_two_field_place_without_taking_the_country():
    """'Bundoora VIC 3083, Australia' has two fields and the second is the
    country, so the suburb rule only applies from three fields up."""
    assert server._locality("Bundoora VIC 3083, Australia") == "Bundoora"
    assert server._locality("Bundoora VIC 3083") == "Bundoora"


def test_locality_drops_a_road_junction():
    assert server._locality("Stony Creek Rd/Research-Warrandyte Rd, North Warrandyte, VIC, AU") \
        == "North Warrandyte"
    assert server._locality("A Rd/B Rd") == ""


def test_locality_survives_nonsense():
    assert server._locality(None) == ""
    assert server._locality("") == ""


# ----- relative dates -------------------------------------------------


def test_ago_reads_naturally():
    today = date.today().isoformat()
    assert server._ago(today) == "today"
    assert server._ago((date.today() - timedelta(days=1)).isoformat()) == "yesterday"
    assert server._ago((date.today() - timedelta(days=3)).isoformat()) == "3 days ago"
    assert server._ago((date.today() - timedelta(days=14)).isoformat()) == "2 weeks ago"
    assert server._ago((date.today() - timedelta(days=200)).isoformat()).endswith("months ago")
    assert server._ago(None) == ""


# ----- modes ----------------------------------------------------------


def test_recent_mode_lists_one_row_per_species(monkeypatch, tmp_path):
    """A busy patch reports the same magpie over and over; a list of one species
    repeated is not a list."""
    results = [
        _obs("Gymnorhina tibicen", "Australian Magpie", "Aves", 1, tid=1),
        _obs("Gymnorhina tibicen", "Australian Magpie", "Aves", 1, tid=1),
        _obs("Gymnorhina tibicen", "Australian Magpie", "Aves", 2, tid=1),
        _obs("Anas castanea", "Chestnut Teal", "Aves", 2, tid=2),
        _obs("Macropus giganteus", "Eastern Grey Kangaroo", "Mammalia", 3, tid=3),
    ]
    _install(monkeypatch, {"/observations?": {"results": results, "total_results": 999}})
    out = server.fetch({**MERNDA, "mode": "recent", "count": "8"}, {},
                       ctx={"data_dir": str(tmp_path)})
    assert out.get("error") is None
    names = [r["name"] for r in out["items"]]
    assert names == ["Australian Magpie", "Chestnut Teal", "Eastern Grey Kangaroo"]
    assert out["items"][0]["ago"] == "yesterday"
    assert out["items"][0]["where"] == "Preston"
    assert out["mode_label"] == "Recently spotted"


def test_common_mode_reports_counts(monkeypatch, tmp_path):
    counts = {"results": [
        {"count": 2065, "taxon": {"id": 9, "name": "Heteronympha merope",
                                  "preferred_common_name": "Common Brown",
                                  "rank": "species", "iconic_taxon_name": "Insecta"}},
        {"count": 1985, "taxon": {"id": 10, "name": "Macropus giganteus",
                                  "preferred_common_name": "Eastern Grey Kangaroo",
                                  "rank": "species", "iconic_taxon_name": "Mammalia"}},
    ]}
    _install(monkeypatch, {"species_counts": counts,
                           "/observations?": {"results": [], "total_results": 164861}})
    out = server.fetch({**MERNDA, "mode": "common"}, {}, ctx={"data_dir": str(tmp_path)})
    assert out["mode_label"] == "Most recorded"
    assert out["items"][0]["count"] == 2065
    assert out["items"][0]["group"] == "Insecta"
    assert out["total_observations"] == 164861


def test_common_names_are_capitalised(monkeypatch, tmp_path):
    """iNaturalist stores them lower case ('hop goodenia')."""
    _install(monkeypatch, {"/observations?": {
        "results": [_obs("Goodenia ovata", "hop goodenia", "Plantae", 1, tid=5)],
        "total_results": 1}})
    out = server.fetch({**MERNDA, "mode": "recent"}, {}, ctx={"data_dir": str(tmp_path)})
    assert out["items"][0]["name"] == "Hop goodenia"


def test_a_taxon_without_a_common_name_falls_back_to_the_binomial(monkeypatch, tmp_path):
    _install(monkeypatch, {"/observations?": {
        "results": [_obs("Ambigolimax", None, "Mollusca", 1, tid=6)], "total_results": 1}})
    out = server.fetch({**MERNDA, "mode": "recent"}, {}, ctx={"data_dir": str(tmp_path)})
    assert out["items"][0]["name"] == "Ambigolimax"
    assert out["items"][0]["sci"] == ""      # never printed twice


def test_groups_without_an_icon_resolve_to_the_generic_one(monkeypatch, tmp_path):
    """Anything without an icon that genuinely depicts it gets the binoculars.
    That covers iNaturalist's Animalia/Protozoa/Chromista/unknown and also
    fungi, reptiles and amphibians, for which Phosphor has nothing suitable."""
    rows = [_obs("Thing one", "Thing one", "Animalia", 1, tid=11),
            _obs("Thing two", "Thing two", "Protozoa", 1, tid=12),
            _obs("Thing three", "Thing three", "Chromista", 1, tid=13),
            # no mushroom, frog or snake icon exists, so these use the generic
            _obs("A fungus", "A fungus", "Fungi", 1, tid=17),
            _obs("A frog", "A frog", "Amphibia", 1, tid=18),
            _obs("A skink", "A skink", "Reptilia", 1, tid=19),
            _obs("Magpie", "Australian Magpie", "Aves", 1, tid=14)]
    _install(monkeypatch, {"/observations?": {"results": rows, "total_results": 4}})
    out = server.fetch({**MERNDA, "mode": "recent"}, {}, ctx={"data_dir": str(tmp_path)})
    icons = {r["name"]: r["icon"] for r in out["items"]}
    assert icons["Thing one"] == "other"
    assert icons["Thing two"] == "other"
    assert icons["Thing three"] == "other"
    assert icons["A fungus"] == "other"
    assert icons["A frog"] == "other"
    assert icons["A skink"] == "other"
    assert icons["Australian Magpie"] == "Aves"


def test_a_taxon_with_no_iconic_group_at_all_still_gets_an_icon(monkeypatch, tmp_path):
    obs = _obs("Mystery", "Mystery", None, 1, tid=15)
    obs["taxon"]["iconic_taxon_name"] = None
    _install(monkeypatch, {"/observations?": {"results": [obs], "total_results": 1}})
    out = server.fetch({**MERNDA, "mode": "recent"}, {}, ctx={"data_dir": str(tmp_path)})
    assert out["items"][0]["icon"] == "other"


def test_photos_are_offered_at_two_sizes_with_credit(monkeypatch, tmp_path):
    obs = _obs("Anas castanea", "Chestnut Teal", "Aves", 1, tid=16)
    obs["photos"] = [{"url": "https://inaturalist-open-data.s3.amazonaws.com/photos/1/square.jpg",
                      "attribution": "(c) Someone, some rights reserved (CC BY-NC)"}]
    _install(monkeypatch, {"/observations?": {"results": [obs], "total_results": 1}})
    out = server.fetch({**MERNDA, "mode": "recent"}, {}, ctx={"data_dir": str(tmp_path)})
    row = out["items"][0]
    assert row["photo"].endswith("/large.jpg")
    assert row["thumb"].endswith("/medium.jpg")
    assert row["credit"].startswith("\u00a9 Someone")
    assert out["with_photos"] == 1


# ----- options and failure --------------------------------------------


def test_group_filter_reaches_the_query(monkeypatch, tmp_path):
    seen = {}

    def fake(url):
        seen["url"] = url
        return {"results": [], "total_results": 0}, None

    monkeypatch.setattr(server, "_http_json", fake)
    server.fetch({**MERNDA, "group": "birds", "radius_km": "25"}, {},
                 ctx={"data_dir": str(tmp_path)})
    assert "iconic_taxa=Aves" in seen["url"]
    assert "radius=25" in seen["url"]
    assert "quality_grade=research" in seen["url"]


def test_missing_location_is_a_friendly_error(tmp_path):
    out = server.fetch({}, {}, ctx={"data_dir": str(tmp_path)})
    assert out["error"] == server.ERR_NO_LOCATION


def test_upstream_failure_returns_a_message_not_an_exception(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "_http_json", lambda url: (None, server.ERR_UNREACHABLE))
    out = server.fetch({**MERNDA}, {}, ctx={"data_dir": str(tmp_path)})
    assert out["error"] == server.ERR_UNREACHABLE


def test_cache_avoids_a_second_call_but_still_reages_the_dates(monkeypatch, tmp_path):
    calls = {"n": 0}

    def fake(url):
        calls["n"] += 1
        return {"results": [_obs("Anas castanea", "Chestnut Teal", "Aves", 1, tid=2)],
                "total_results": 5}, None

    monkeypatch.setattr(server, "_http_json", fake)
    args = ({**MERNDA, "mode": "recent"}, {})
    first = server.fetch(*args, ctx={"data_dir": str(tmp_path)})
    before = calls["n"]
    second = server.fetch(*args, ctx={"data_dir": str(tmp_path)})
    assert calls["n"] == before                       # served from cache
    # "yesterday" is relative, so a cached payload must not keep yesterday's word
    assert second["items"][0]["ago"] == first["items"][0]["ago"] == "yesterday"
    assert json.loads((tmp_path / next(p.name for p in tmp_path.iterdir())).read_text())


# ----- location time --------------------------------------------------


def test_today_is_the_locations_today(monkeypatch, tmp_path):
    """A sighting dated the location's today reads "today" and the header
    shows the location's date, whatever the server's own zone says."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    for zone in ("Pacific/Kiritimati", "Pacific/Pago_Pago"):   # UTC+14 and UTC-11
        local_today = datetime.now(ZoneInfo(zone)).date()
        obs = _obs("Corvus", "Raven", "Aves", 0)
        obs["observed_on"] = local_today.isoformat()
        _install(monkeypatch, {"/observations?": {"results": [obs], "total_results": 1}})
        loc = {**MERNDA, "location": {"name": "Somewhere", "timezone": zone}}
        out = server.fetch({**loc, "mode": "recent"}, {}, ctx={"data_dir": str(tmp_path / zone)})
        assert out["items"][0]["ago"] == "today"
        assert out["date"] == datetime.now(ZoneInfo(zone)).strftime("%a %d %b")
        again = server.fetch({**loc, "mode": "recent"}, {}, ctx={"data_dir": str(tmp_path / zone)})
        assert again["items"][0]["ago"] == "today"


def test_location_zone_falls_back_to_the_server():
    assert server._location_tz({}) is None
    assert server._location_tz({"location": {"timezone": "Not/AZone"}}) is None
    assert str(server._location_tz({"timezone": "Australia/Melbourne"})) == "Australia/Melbourne"
