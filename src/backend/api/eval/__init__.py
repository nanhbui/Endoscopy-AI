"""Evaluation harness for the endoscopy VLM pipeline (Phase 4).

Modules:
    dataset_kvasir   — iterate HyperKvasir labeled-images
    schema_mapping   — map HyperKvasir class → expected dx / severity
    metrics          — compute diagnosis accuracy (macro-F1), recommendation rubric
    judge_faithfulness — LLM-as-judge for grounding faithfulness
"""
