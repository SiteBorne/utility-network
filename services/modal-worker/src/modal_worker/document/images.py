"""PNG/JPEG single-page image document handling."""

from __future__ import annotations

import io

from PIL import Image, UnidentifiedImageError

from .failures import FailureCode, WorkerError
from .models import MAX_IMAGE_DIMENSION_PX, MAX_IMAGE_PIXELS

# Guards against decompression bombs even before Pillow's own
# MAX_IMAGE_PIXELS check runs (belt and suspenders — see the module-level
# Image.MAX_IMAGE_PIXELS setting applied in open_bounded_image).
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


def open_bounded_image(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()  # force full decode now, not lazily later (fail fast, fail here)
    except UnidentifiedImageError as exc:
        raise WorkerError(FailureCode.MALFORMED_DOCUMENT, str(exc)) from exc
    except Image.DecompressionBombError as exc:
        raise WorkerError(FailureCode.IMAGE_DIMENSION_LIMIT_EXCEEDED, str(exc)) from exc
    except Exception as exc:
        raise WorkerError(FailureCode.MALFORMED_DOCUMENT, str(exc)) from exc

    width, height = img.size
    if width > MAX_IMAGE_DIMENSION_PX or height > MAX_IMAGE_DIMENSION_PX:
        raise WorkerError(
            FailureCode.IMAGE_DIMENSION_LIMIT_EXCEEDED,
            f"{width}x{height} exceeds {MAX_IMAGE_DIMENSION_PX}px",
        )
    if width * height > MAX_IMAGE_PIXELS:
        raise WorkerError(
            FailureCode.IMAGE_DIMENSION_LIMIT_EXCEEDED,
            f"{width}x{height}={width * height}px exceeds {MAX_IMAGE_PIXELS}px",
        )
    return img
