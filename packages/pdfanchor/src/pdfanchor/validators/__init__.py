"""Rule checks on text. A validator only ever raises a flag; it never changes text."""

from collections.abc import Callable

from ..model import Flag
from .dates import check_dates
from .encoding import check_encoding

Validator = Callable[[str], list[Flag]]

DEFAULT: tuple[Validator, ...] = (check_encoding, check_dates)


def run(text: str, validators: tuple[Validator, ...] = DEFAULT) -> list[Flag]:
    return [flag for validator in validators for flag in validator(text)]
