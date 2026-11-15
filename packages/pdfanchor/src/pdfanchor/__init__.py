"""pdfanchor: turn any PDF into text a language model or a vector index can use, with every
line anchored to its place on the page and a rule-based verdict on whether to trust it."""

__version__ = "0.0.1"

from .config import Config, Policy  # noqa: E402
from .model import Document  # noqa: E402
from .pipeline import ConversionError, convert, write  # noqa: E402

__all__ = ["Config", "ConversionError", "Document", "Policy", "convert", "write", "__version__"]
