"""Make `from backend.services...` work from the repo root.

Backend tests use absolute imports; this puts the repo root on the path so
pytest resolves them without an installed package.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
