#!/usr/bin/env python3
"""Create test JPEGs with known EXIF DateTimeOriginal / orientation tags."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw
from PIL.ExifTags import IFD

OUT = Path(__file__).resolve().parent / "fixtures"
OUT.mkdir(parents=True, exist_ok=True)


def attach_exif(img: Image.Image, *, orientation: int | None = None,
                dt_original: str | None = None, dt_digitized: str | None = None,
                dt_ifd0: str | None = None) -> Image.Exif:
    exif = Image.Exif()
    if orientation is not None:
        exif[0x0112] = orientation
    if dt_ifd0 is not None:
        exif[0x0132] = dt_ifd0
    ifd = exif.get_ifd(IFD.Exif)
    if dt_original is not None:
        ifd[0x9003] = dt_original
    if dt_digitized is not None:
        ifd[0x9004] = dt_digitized
    return exif


def save(name: str, img: Image.Image, exif: Image.Exif | None = None) -> None:
    path = OUT / name
    kwargs = {"quality": 92, "subsampling": 0}
    if exif is not None:
        kwargs["exif"] = exif
    img.save(path, "JPEG", **kwargs)
    print(f"wrote {path} ({path.stat().st_size} bytes)")


def dark_base(w: int, h: int, color=(20, 40, 80)) -> Image.Image:
    img = Image.new("RGB", (w, h), color)
    draw = ImageDraw.Draw(img)
    # faint grid so it's visually a photo, still dark enough for white text
    for x in range(0, w, 80):
        draw.line([(x, 0), (x, h)], fill=(28, 50, 95), width=1)
    for y in range(0, h, 80):
        draw.line([(0, y), (w, y)], fill=(28, 50, 95), width=1)
    return img


def main() -> None:
    # DAY 1: start == shoot == 2024-03-15
    img = dark_base(1200, 800)
    save("day1.jpg", img, attach_exif(
        img, orientation=1, dt_original="2024:03:15 08:30:00",
    ))

    # Cross-month: shoot 2024-02-03, start 2024-01-28 => DAY 7
    img = dark_base(1000, 750, (16, 48, 32))
    save("cross_month.jpg", img, attach_exif(
        img, orientation=1, dt_original="2024:02:03 21:00:00",
    ))

    # Year crossing: shoot 2024-01-01, start 2023-12-31 => DAY 2
    img = dark_base(800, 600, (40, 20, 50))
    save("year_cross.jpg", img, attach_exif(
        img, orientation=1, dt_original="2024:01:01 00:10:00",
    ))

    # CreateDate only (no DateTimeOriginal) => fallback source
    img = dark_base(900, 700, (30, 30, 30))
    save("createdate_only.jpg", img, attach_exif(
        img, orientation=1, dt_digitized="2024:06:10 12:00:00",
    ))

    # IFD0 DateTime only — must NOT be treated as the shoot date
    img = dark_base(640, 480, (25, 25, 40))
    save("ifd0_datetime_only.jpg", img, attach_exif(
        img, orientation=1, dt_ifd0="2020:01:01 00:00:00",
    ))

    # No EXIF at all
    img = dark_base(800, 600, (18, 22, 40))
    save("no_exif.jpg", img, None)

    # Orientation 6 (rotate 90 CW to display).
    # Stored 600x400, red bar on the LEFT, so after 90 CW the displayed
    # image is 400x600 with a red bar on TOP.
    w, h = 600, 400
    img = Image.new("RGB", (w, h), (20, 40, 80))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, 79, h - 1], fill=(210, 16, 16))
    # stored bottom-right corner mark (yellow) -> displayed bottom-left
    # 90 CW: (x, y) -> (h-1-y, x)
    # (w-30, h-30)=(570,370) -> (400-1-370, 570)=(29, 570)
    draw.rectangle([w - 40, h - 40, w - 1, h - 1], fill=(240, 220, 40))
    save("orient6.jpg", img, attach_exif(
        img, orientation=6, dt_original="2024:04:20 15:00:00",
    ))

    # Same pixels, orientation 1, for contrast
    save("orient1.jpg", img.copy(), attach_exif(
        img, orientation=1, dt_original="2024:04:20 15:00:00",
    ))

    # Not a JPEG. Decode must fail per file without discarding the rest.
    bad = OUT / "not_image.jpg"
    bad.write_bytes(b"this is not a jpeg\n")
    print(f"wrote {bad} ({bad.stat().st_size} bytes)")

    manifest = {
        "day1": {"file": "day1.jpg", "shoot": "2024-03-15", "start": "2024-03-15", "day": 1,
                 "source": "EXIF DateTimeOriginal"},
        "cross_month": {"file": "cross_month.jpg", "shoot": "2024-02-03", "start": "2024-01-28", "day": 7,
                        "source": "EXIF DateTimeOriginal"},
        "year_cross": {"file": "year_cross.jpg", "shoot": "2024-01-01", "start": "2023-12-31", "day": 2,
                       "source": "EXIF DateTimeOriginal"},
        "createdate_only": {"file": "createdate_only.jpg", "shoot": "2024-06-10", "start": "2024-06-01", "day": 10,
                            "source": "EXIF CreateDate"},
        "ifd0_datetime_only": {"file": "ifd0_datetime_only.jpg", "expect_manual": True},
        "no_exif": {"file": "no_exif.jpg", "expect_manual": True, "manual_shoot": "2024-05-01",
                    "start": "2024-05-01", "day": 1},
        "orient6": {"file": "orient6.jpg", "shoot": "2024-04-20", "start": "2024-04-20", "day": 1,
                    "expect_size": [400, 600], "top_is_red": True},
        "not_image": {"file": "not_image.jpg", "expect_decode_error": True},
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("manifest written")


if __name__ == "__main__":
    main()
