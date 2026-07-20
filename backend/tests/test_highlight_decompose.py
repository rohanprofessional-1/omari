"""Deterministic highlight decomposition tests (_match_ground_truth_all).

The matcher must return EVERY planted variable found inside a highlighted
span — with located sub-spans, word-boundary numeric matching, and one
observation per key. Run: pytest backend/tests -q (or inside the container:
docker compose exec backend python -m pytest tests -q).
"""
from app.api.v1.gen import _match_ground_truth_all

TARGET_SPAN = "8 months he's had numbness and tingling in the right thumb, index and middle fingers"
TARGET_GT = {
    "symptom_duration_months": 8,
    "dominant_symptom": "numbness_tingling",
    "symptom_location": "hand_wrist",
    "mass_present": False,
}


def keys(obs):
    return {o["key"] for o in obs}


def test_target_sentence_deterministic_part():
    """The numeric duration is matched deterministically (word-boundary).
    'numbness_tingling' and 'hand_wrist' don't appear verbatim in prose —
    those are the LLM's to propose — and booleans never text-match."""
    obs = _match_ground_truth_all(TARGET_SPAN, TARGET_GT, "routing", span_start=None)
    assert keys(obs) == {"symptom_duration_months"}
    duration = obs[0]
    assert duration["value"] == 8
    assert duration["spanText"] == "8"
    assert duration["source"] == "ground_truth"


def test_single_variable_highlight_returns_exactly_one():
    obs = _match_ground_truth_all(
        "burning pain below the knee since spring",
        {"symptom_location": "below the knee", "emg_status": "not_done"},
        "routing",
        span_start=None,
    )
    assert keys(obs) == {"symptom_location"}


def test_multi_variable_highlight_returns_all_overlaps():
    obs = _match_ground_truth_all(
        "below the knee weakness with foot drop for 5 months",
        {
            "symptom_location": "below the knee",
            "dominant_symptom": "foot drop",
            "symptom_duration_months": 5,
            "unrelated_var": "acute trauma",
        },
        "routing",
        span_start=None,
    )
    assert keys(obs) == {"symptom_location", "dominant_symptom", "symptom_duration_months"}


def test_numeric_word_boundary_no_false_positive():
    """'8' must match '8 months' but never the '8' inside '2018'."""
    gt = {"symptom_duration_months": 8}
    assert keys(_match_ground_truth_all("pacemaker placed in 2018", gt, "workup", None)) == set()
    assert keys(_match_ground_truth_all("about 8 months now", gt, "workup", None)) == {
        "symptom_duration_months"
    }


def test_snake_case_value_matches_prose():
    """Planted 'neck_radiating' should match 'neck radiating' in prose."""
    obs = _match_ground_truth_all(
        "pain radiating from the neck radiating down the arm",
        {"symptom_location": "neck_radiating"},
        "routing",
        None,
    )
    assert keys(obs) == {"symptom_location"}


def test_key_mention_catches_bool_variables():
    """Bool values never text-match; the key-mention pass still finds them."""
    obs = _match_ground_truth_all(
        "no mass present on examination",
        {"mass_present": False},
        "workup",
        None,
    )
    assert keys(obs) == {"mass_present"}
    assert obs[0]["value"] is False


def test_one_observation_per_key_dedup():
    """A span hitting both the value AND the key mention yields ONE observation."""
    obs = _match_ground_truth_all(
        "emg status: the EMG status was done_abnormal",
        {"emg_status": "done_abnormal"},
        "routing",
        None,
    )
    assert len(obs) == 1
    assert obs[0]["key"] == "emg_status"
    # Value match ran first, so it wins over the key mention.
    assert obs[0]["value"] == "done_abnormal"


def test_absolute_offsets_derived_from_span_start():
    span = "about 8 months now"
    obs = _match_ground_truth_all(span, {"symptom_duration_months": 8}, "routing", span_start=100)
    o = obs[0]
    local = span.index("8")
    assert o["spanStart"] == 100 + local
    assert o["spanEnd"] == 100 + local + 1


def test_axis_is_the_surgeons_tag():
    obs = _match_ground_truth_all("about 8 months now", {"symptom_duration_months": 8}, "both", None)
    assert obs[0]["axis"] == "both"
