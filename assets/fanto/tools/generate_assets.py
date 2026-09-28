#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Callable

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
SOURCE_DIR = ROOT / "public"
OUT = ROOT / "assets" / "fanto"
H5_OUT = ROOT / "apps" / "h5" / "public" / "assets" / "fanto"
IOS_CATALOG = ROOT / "apps" / "ios" / "fanto" / "fanto" / "Assets.xcassets"

SRC_DEFAULT = SOURCE_DIR / "app-icon-default-1024_transparent.png"
SRC_DARK = SOURCE_DIR / "app-icon-dark-1024_transparent.png"
SRC_TINTED = SOURCE_DIR / "app-icon-tinted-1024_transparent.png"

INK = (18, 18, 18, 255)
INK_SOFT = (30, 30, 30, 210)
CREAM = (244, 236, 223, 255)
SALMON = (230, 145, 119, 255)
BLUE = (105, 153, 180, 255)
SAGE = (167, 181, 155, 255)
AMBER = (239, 190, 103, 255)
PAPER = (250, 248, 243, 255)

STATE_NAMES = ["idle", "thinking", "remembering", "creating", "reminding", "done"]
PROP_NAMES = ["note", "bell", "magnifier", "calendar", "photo", "thread-ball"]


def ensure_dirs() -> None:
    for p in [
        OUT / "avatar",
        OUT / "character",
        OUT / "states",
        OUT / "props",
        OUT / "references",
        OUT / "line",
        H5_OUT / "avatar",
        H5_OUT / "states",
        H5_OUT / "props",
    ]:
        p.mkdir(parents=True, exist_ok=True)


def true_rgba(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def alpha_crop(img: Image.Image, padding: int = 0) -> Image.Image:
    alpha = img.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return img.copy()
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - padding)
    y0 = max(0, y0 - padding)
    x1 = min(img.width, x1 + padding)
    y1 = min(img.height, y1 + padding)
    return img.crop((x0, y0, x1, y1))


def fit_rgba(img: Image.Image, size: int, margin: int) -> Image.Image:
    src = alpha_crop(img, padding=4)
    target = size - margin * 2
    scale = min(target / src.width, target / src.height)
    new_size = (max(1, round(src.width * scale)), max(1, round(src.height * scale)))
    src = src.resize(new_size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - src.width) // 2
    y = (size - src.height) // 2
    canvas.alpha_composite(src, (x, y))
    return canvas


def isolate_character(src: Image.Image) -> Image.Image:
    # The source artwork is fixed at 1024x1024. This keep-mask intentionally
    # removes the surrounding long thread and floating note while preserving
    # the mascot, walking feet, and floor shadow.
    keep = Image.new("L", src.size, 0)
    d = ImageDraw.Draw(keep)
    polygon = [
        (220, 330),
        (360, 300),
        (560, 330),
        (690, 430),
        (690, 590),
        (655, 710),
        (680, 820),
        (620, 930),
        (355, 930),
        (290, 865),
        (290, 770),
        (275, 690),
        (275, 590),
        (225, 510),
    ]
    d.polygon(polygon, fill=255)
    # Preserve the soft shadow under the feet.
    d.ellipse((280, 825, 690, 925), fill=255)
    keep = keep.filter(ImageFilter.GaussianBlur(2.0))

    out = src.copy()
    out.putalpha(ImageChops.multiply(src.getchannel("A"), keep))
    return alpha_crop(out, padding=20)


def build_avatar(src: Image.Image) -> Image.Image:
    # Head + upper torso, without the external line/note. This crop is
    # intentionally closer than the full-body state art for 40-64pt UI use.
    isolated = isolate_character(src)
    h = isolated.height
    crop = isolated.crop((0, 0, isolated.width, min(h, round(h * 0.72))))
    return fit_rgba(crop, 1024, 72)


def rounded_line(draw: ImageDraw.ImageDraw, pts, fill, width: int) -> None:
    draw.line(pts, fill=fill, width=width, joint="curve")
    r = width // 2
    for x, y in (pts[0], pts[-1]):
        draw.ellipse((x-r, y-r, x+r, y+r), fill=fill)


def prop_canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def draw_note() -> Image.Image:
    im, d = prop_canvas()
    d.rounded_rectangle((110, 86, 406, 426), radius=34, fill=PAPER, outline=INK, width=22)
    rounded_line(d, [(170, 205), (345, 205)], INK, 20)
    rounded_line(d, [(170, 274), (321, 274)], INK, 20)
    rounded_line(d, [(170, 343), (290, 343)], INK, 20)
    return im


def draw_bell() -> Image.Image:
    im, d = prop_canvas()
    d.pieslice((126, 112, 386, 392), start=188, end=352, fill=AMBER, outline=INK, width=22)
    d.rounded_rectangle((152, 325, 360, 382), radius=28, fill=AMBER, outline=INK, width=22)
    d.ellipse((224, 374, 288, 438), fill=SALMON, outline=INK, width=20)
    rounded_line(d, [(256, 90), (256, 132)], INK, 18)
    return im


def draw_magnifier() -> Image.Image:
    im, d = prop_canvas()
    d.ellipse((92, 86, 326, 320), fill=(0, 0, 0, 0), outline=INK, width=24)
    d.ellipse((128, 122, 290, 284), fill=(255, 255, 255, 40), outline=BLUE, width=12)
    rounded_line(d, [(294, 292), (418, 416)], INK, 34)
    return im


def draw_calendar() -> Image.Image:
    im, d = prop_canvas()
    d.rounded_rectangle((88, 112, 424, 418), radius=36, fill=PAPER, outline=INK, width=22)
    d.rounded_rectangle((88, 112, 424, 205), radius=30, fill=BLUE, outline=INK, width=22)
    rounded_line(d, [(168, 78), (168, 142)], INK, 20)
    rounded_line(d, [(344, 78), (344, 142)], INK, 20)
    for y in (255, 325):
        for x in (158, 256, 354):
            d.ellipse((x-15, y-15, x+15, y+15), fill=INK_SOFT)
    return im


def draw_photo() -> Image.Image:
    im, d = prop_canvas()
    d.rounded_rectangle((84, 96, 428, 416), radius=34, fill=PAPER, outline=INK, width=22)
    d.ellipse((292, 155, 350, 213), fill=AMBER, outline=INK, width=10)
    d.polygon([(118, 366), (213, 250), (270, 318), (326, 254), (397, 366)], fill=SAGE)
    d.line([(118, 366), (213, 250), (270, 318), (326, 254), (397, 366)], fill=INK, width=18, joint="curve")
    return im


def draw_thread_ball() -> Image.Image:
    im, d = prop_canvas()
    d.ellipse((116, 106, 392, 382), fill=SALMON, outline=INK, width=22)
    # Curved-looking thread strokes approximated by nested arcs.
    for box, start, end in [
        ((152, 142, 356, 346), 28, 318),
        ((178, 164, 340, 328), 122, 430),
        ((146, 190, 368, 324), 188, 492),
    ]:
        d.arc(box, start=start, end=end, fill=CREAM, width=16)
    d.arc((100, 92, 414, 404), 210, 510, fill=INK_SOFT, width=12)
    rounded_line(d, [(350, 342), (426, 392), (454, 442)], INK, 14)
    return im


PROP_BUILDERS: dict[str, Callable[[], Image.Image]] = {
    "note": draw_note,
    "bell": draw_bell,
    "magnifier": draw_magnifier,
    "calendar": draw_calendar,
    "photo": draw_photo,
    "thread-ball": draw_thread_ball,
}


def paste_scaled(canvas: Image.Image, art: Image.Image, box: tuple[int, int, int, int]) -> None:
    x0, y0, x1, y1 = box
    fitted = fit_rgba(art, max(x1 - x0, y1 - y0), 12)
    fitted = fitted.resize((x1 - x0, y1 - y0), Image.Resampling.LANCZOS)
    canvas.alpha_composite(fitted, (x0, y0))


def state_canvas(character: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    char = fit_rgba(character, 760, 32)
    canvas.alpha_composite(char, ((1024 - 760) // 2, 235))
    return canvas


def add_thought_dots(canvas: Image.Image) -> None:
    d = ImageDraw.Draw(canvas)
    dots = [(710, 250, 30), (770, 205, 23), (818, 166, 16)]
    for x, y, r in dots:
        d.ellipse((x-r, y-r, x+r, y+r), fill=INK)


def add_done_mark(canvas: Image.Image) -> None:
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((690, 188, 892, 390), radius=46, fill=PAPER, outline=INK, width=18)
    rounded_line(d, [(736, 290), (786, 336), (852, 244)], SAGE, 26)
    for x, y in [(673, 166), (904, 219), (877, 405)]:
        rounded_line(d, [(x, y-18), (x, y+18)], AMBER, 12)
        rounded_line(d, [(x-18, y), (x+18, y)], AMBER, 12)


def build_state(name: str, character: Image.Image, props: dict[str, Image.Image]) -> Image.Image:
    canvas = state_canvas(character)
    if name == "idle":
        return canvas
    if name == "thinking":
        paste_scaled(canvas, props["magnifier"], (690, 310, 900, 520))
        add_thought_dots(canvas)
    elif name == "remembering":
        paste_scaled(canvas, props["photo"], (690, 290, 900, 500))
    elif name == "creating":
        paste_scaled(canvas, props["thread-ball"], (690, 520, 910, 740))
    elif name == "reminding":
        paste_scaled(canvas, props["bell"], (705, 270, 900, 465))
        d = ImageDraw.Draw(canvas)
        rounded_line(d, [(886, 258), (920, 226)], AMBER, 12)
        rounded_line(d, [(902, 300), (946, 292)], AMBER, 12)
    elif name == "done":
        add_done_mark(canvas)
    return canvas


def save_sizes(master: Image.Image, output_dir: Path, stem: str, sizes: list[int]) -> None:
    for size in sizes:
        im = master.resize((size, size), Image.Resampling.LANCZOS)
        im.save(output_dir / f"{stem}-{size}.png", optimize=True)


def write_imageset(name: str, master: Image.Image, base_pt: int) -> None:
    imageset = IOS_CATALOG / f"{name}.imageset"
    imageset.mkdir(parents=True, exist_ok=True)
    images = []
    for scale in (1, 2, 3):
        px = base_pt * scale
        filename = f"{name.lower()}@{scale}x.png"
        master.resize((px, px), Image.Resampling.LANCZOS).save(imageset / filename, optimize=True)
        images.append({"idiom": "universal", "filename": filename, "scale": f"{scale}x"})
    contents = {"images": images, "info": {"author": "xcode", "version": 1}}
    (imageset / "Contents.json").write_text(json.dumps(contents, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def export_runtime(avatar: Image.Image, states: dict[str, Image.Image], props: dict[str, Image.Image]) -> None:
    # H5: a small, explicit set of runtime-ready images.
    avatar.resize((512, 512), Image.Resampling.LANCZOS).save(H5_OUT / "avatar" / "fanto-avatar-512.png", optimize=True)
    for name, art in states.items():
        art.resize((512, 512), Image.Resampling.LANCZOS).save(H5_OUT / "states" / f"{name}.png", optimize=True)
    for name, art in props.items():
        art.resize((256, 256), Image.Resampling.LANCZOS).save(H5_OUT / "props" / f"{name}.png", optimize=True)

    manifest = {
        "avatar": "/assets/fanto/avatar/fanto-avatar-512.png",
        "states": {name: f"/assets/fanto/states/{name}.png" for name in STATE_NAMES},
        "props": {name: f"/assets/fanto/props/{name}.png" for name in PROP_NAMES},
    }
    (H5_OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # iOS: create imagesets that can be referenced directly from SwiftUI Image(...).
    write_imageset("FantoAvatar", avatar, 128)
    for name, art in states.items():
        write_imageset("FantoState" + "".join(part.title() for part in name.split("-")), art, 256)
    for name, art in props.items():
        write_imageset("FantoProp" + "".join(part.title() for part in name.split("-")), art, 96)


def main() -> None:
    ensure_dirs()
    default = true_rgba(SRC_DEFAULT)
    character = isolate_character(default)
    avatar = build_avatar(default)

    # Canonical references preserve the three current app-icon renderings.
    shutil.copy2(SRC_DEFAULT, OUT / "references" / "app-icon-default-1024.png")
    shutil.copy2(SRC_DARK, OUT / "references" / "app-icon-dark-1024.png")
    shutil.copy2(SRC_TINTED, OUT / "references" / "app-icon-tinted-1024.png")

    character_master = fit_rgba(character, 1024, 64)
    character_master.save(OUT / "character" / "default-1024.png", optimize=True)

    avatar.save(OUT / "avatar" / "avatar-master-1024.png", optimize=True)
    save_sizes(avatar, OUT / "avatar", "avatar", [512, 256, 128, 64])

    props: dict[str, Image.Image] = {}
    for name, builder in PROP_BUILDERS.items():
        art = builder()
        props[name] = art
        art.save(OUT / "props" / f"{name}-512.png", optimize=True)

    states: dict[str, Image.Image] = {}
    for name in STATE_NAMES:
        art = build_state(name, character_master, props)
        states[name] = art
        art.save(OUT / "states" / f"{name}-1024.png", optimize=True)

    export_runtime(avatar, states, props)

    print("Generated Fanto IP assets")
    print(f"  canonical: {OUT}")
    print(f"  h5 runtime: {H5_OUT}")
    print(f"  ios catalog: {IOS_CATALOG}")


if __name__ == "__main__":
    main()
