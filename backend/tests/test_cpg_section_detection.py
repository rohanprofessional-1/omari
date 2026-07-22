import pytest
from app.services.cpg_service import _detect_cpg_sections, _fallback_chunking

def test_detect_cpg_sections_with_cpgprompt_markers():
    text = '''### symptoms
This is the symptoms section. It needs to be at least 60 characters long so that the section detector picks it up as a valid chunk.

### evaluation
This is the evaluation section. It also needs to be at least 60 characters long to satisfy the minimum length requirement.
'''
    sections = _detect_cpg_sections(text)
    assert len(sections) == 2
    assert sections[0][0] == "symptoms"
    assert "symptoms section" in sections[0][1]
    assert sections[1][0] == "evaluation"
    assert "evaluation section" in sections[1][1]

def test_detect_cpg_sections_with_recommendations():
    text = '''Recommendation 1: actions for patients with unexplained symptoms of metastatic prostate cancer
A man >=40 y should have a DRE and a PSA test if he has any unexplained symptoms suggestive of metastatic prostate cancer.

Recommendation 2: actions for patients with LUTS
For a man presenting with LUTS, a DRE should be performed and a discussion about benefits and risks of PSA testing should occur.

Recommendation 3: actions for patients with incidental elevated PSA results
For incidental elevated age-based PSA findings, DRE should be performed for all patients. This is to ensure it is long enough.
'''
    sections = _detect_cpg_sections(text)
    assert len(sections) == 3
    assert sections[0][0] == "Recommendation 1: actions for patients with unexplained symptoms of metastatic prostate cancer"
    assert "metastatic prostate cancer" in sections[0][1]
    assert sections[1][0] == "Recommendation 2: actions for patients with LUTS"
    assert "LUTS" in sections[1][1]
    assert sections[2][0] == "Recommendation 3: actions for patients with incidental elevated PSA results"
    assert "incidental elevated age-based PSA" in sections[2][1]

def test_fallback_chunking():
    # Generate a long text without explicit section markers
    paragraph = "This is a generic sentence used to build up a large block of text. " * 30
    sections = _detect_cpg_sections(paragraph)
    
    # Should fall back to generic chunking
    assert len(sections) > 0
    assert sections[0][0].startswith("Section 1:")
