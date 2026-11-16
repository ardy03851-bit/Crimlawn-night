#!/usr/bin/env python3
"""Build all deterministic Crimlawn Night room states from the AI source plates.

The room geometry is never regenerated: every room state is composited from the
same master photograph, so the bed, walls, carpet, baseboard and door frame stay
identical in all 48 exported room images.
"""

from __future__ import annotations

import json
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SOURCE = ASSETS / "source"
ROOMS = ASSETS / "rooms"
W, H = 1024, 768

DOORS = ("closed", "open")
LIGHTS = ("unlit", "dying", "weak", "lit")
LIGHT_LEVEL = {"unlit": 0.0, "dying": 0.30, "weak": 0.58, "lit": 1.0}
ANOMALIES = (
    "clear",
    "tyne_far",
    "tyne_mid",
    "tyne_near",
    "tyne_left",
    "tyne_reach",
)


def load_source(name: str) -> Image.Image:
    image = Image.open(SOURCE / name).convert("RGB")
    if image.size != (W, H):
        image = image.resize((W, H), Image.Resampling.LANCZOS)
    return image


def save_jpg(image: Image.Image, path: Path, quality: int = 88) -> None:
    image.convert("RGB").save(path, "JPEG", quality=quality, optimize=True, subsampling=1)


def save_png(image: Image.Image, path: Path) -> None:
    image.save(path, "PNG", optimize=True)


def chroma_key(image: Image.Image) -> Image.Image:
    """Remove the pure green photographic backdrop and soften only the cutout edge."""
    rgba = image.convert("RGBA")
    src = rgba.load()
    out = Image.new("RGBA", rgba.size)
    dst = out.load()
    alpha = Image.new("L", rgba.size)
    ap = alpha.load()

    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, _ = src[x, y]
            greenness = g - max(r, b)

            if greenness >= 34 and g >= 58:
                a = 0
            elif greenness >= 12 and g >= 48:
                a = int((34 - greenness) / 22 * 255)
                a = max(0, min(255, a))
            else:
                a = 255

            # Remove green spill from anti-aliased hair, skin and cloth edges.
            if a > 0 and greenness > 7:
                g = min(g, int(max(r, b) * 1.08) + 8)

            dst[x, y] = (r, g, b, a)
            ap[x, y] = a

    soft_alpha = alpha.filter(ImageFilter.GaussianBlur(0.45))
    out.putalpha(soft_alpha)
    return out


def tight_crop(image: Image.Image, padding: int = 10) -> Image.Image:
    mask = image.getchannel("A").point(lambda p: 255 if p > 9 else 0)
    box = mask.getbbox()
    if box is None:
        return image
    left, top, right, bottom = box
    return image.crop(
        (
            max(0, left - padding),
            max(0, top - padding),
            min(image.width, right + padding),
            min(image.height, bottom + padding),
        )
    )


def fill_enclosed_green(image: Image.Image) -> Image.Image:
    """Replace green pinholes trapped inside the phone/hand silhouette with blue light.

    Border-connected green is the legitimate chroma-key backdrop; green pixels that
    cannot be reached from the border are overexposed holes in the generated glow.
    """
    width, height = image.size
    source = image.convert("RGB")
    rp = source.load()
    green = bytearray(width * height)
    for y in range(height):
        row = y * width
        for x in range(width):
            r, g, b = rp[x, y]
            if g >= 65 and g - r >= 18 and g - b >= 18:
                green[row + x] = 1

    seen = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def seed(x: int, y: int) -> None:
        if 0 <= x < width and 0 <= y < height:
            idx = y * width + x
            if green[idx] and not seen[idx]:
                seen[idx] = 1
                queue.append((x, y))

    for x in range(width):
        seed(x, 0)
        seed(x, height - 1)
    for y in range(height):
        seed(0, y)
        seed(width - 1, y)

    while queue:
        x, y = queue.popleft()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx or dy:
                    seed(x + dx, y + dy)

    hole = Image.new("L", source.size, 0)
    hole_p = hole.load()
    for y in range(height):
        row = y * width
        for x in range(width):
            idx = row + x
            if green[idx] and not seen[idx]:
                hole_p[x, y] = 255
    hole = hole.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.4))

    fill = Image.new("RGB", source.size, (178, 211, 255))
    draw = ImageDraw.Draw(fill)
    for y in range(height):
        k = max(0.0, 1.0 - abs(y - 282) / 95.0)
        draw.line((0, y, width, y), fill=(int(142 + 72 * k), int(188 + 52 * k), 255))

    # Soft edges plus one exact pass prevent a thin green fringe surviving the blur.
    repaired = Image.composite(fill, source, hole)
    rp = repaired.load()
    hp = hole.load()
    for y in range(max(0, 235), min(height, 335)):
        for x in range(max(0, 520), min(width, 595)):
            r, g, b = rp[x, y]
            if hp[x, y] > 45 and g >= 65 and g - r >= 12 and g - b >= 12:
                rp[x, y] = (176, 214, 255)
    return repaired


def add_rim_glow(on_arm: Image.Image, off_arm: Image.Image) -> Image.Image:
    """Add a restrained blue rim behind the cutout, matching the phone's far edge."""
    off_alpha = off_arm.getchannel("A")
    expanded = off_alpha.filter(ImageFilter.MaxFilter(13)).filter(ImageFilter.GaussianBlur(5))
    rim = ImageChops.subtract(expanded, off_alpha).filter(ImageFilter.GaussianBlur(2))

    region = Image.new("L", on_arm.size, 0)
    draw = ImageDraw.Draw(region)
    draw.ellipse((370, 110, 690, 520), fill=255)
    region = region.filter(ImageFilter.GaussianBlur(38))
    mask = ImageChops.multiply(rim, region).point(lambda p: min(255, int(p * 1.35)))

    glow = Image.new("RGBA", on_arm.size, (176, 214, 255, 0))
    glow.putalpha(mask)
    return Image.alpha_composite(glow, on_arm)


def door_patch(base: Image.Image, opened: Image.Image) -> tuple[Image.Image, Image.Image, Image.Image]:
    """Keep untouched base pixels and composite only the AI-generated door change."""
    diff = ImageChops.difference(base, opened).convert("L")
    diff_mask = diff.point(lambda p: 0 if p < 9 else min(255, (p - 9) * 11))

    # A soft envelope around the door: the open slab, frame, hallway and wall shadow.
    envelope = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(envelope)
    draw.rectangle((398, 28, 752, 594), fill=235)
    envelope = envelope.filter(ImageFilter.GaussianBlur(9))
    region = ImageChops.lighter(diff_mask, envelope)
    region = region.filter(ImageFilter.GaussianBlur(1.1))

    composite = Image.composite(opened, base, region)
    patch = opened.convert("RGBA")
    patch.putalpha(region)
    return composite, patch, region


def make_beam_layers(beam: Image.Image) -> tuple[Image.Image, Image.Image]:
    grey = ImageOps.grayscale(beam)
    mask = ImageOps.autocontrast(grey, cutoff=1)
    mask = mask.point(lambda p: int(255 * ((p / 255.0) ** 0.82)))
    mask = mask.filter(ImageFilter.GaussianBlur(4))

    reflection = beam.convert("RGBA")
    reflection.putalpha(mask.point(lambda p: int(p * 0.82)))
    return mask, reflection


def darken_room(background: Image.Image) -> Image.Image:
    dark = ImageEnhance.Brightness(background).enhance(0.29)
    dark = ImageChops.multiply(dark, Image.new("RGB", dark.size, (188, 204, 232)))
    return dark


def bright_room(background: Image.Image) -> Image.Image:
    bright = ImageEnhance.Brightness(background).enhance(0.94)
    bright = ImageChops.multiply(bright, Image.new("RGB", bright.size, (222, 235, 255)))
    return bright


def lit_room(background: Image.Image, mask: Image.Image, beam: Image.Image, level: float) -> Image.Image:
    dark = darken_room(background)
    if level <= 0:
        return dark

    bright = bright_room(background)
    local_mask = mask.point(lambda p: int(p * min(1.0, 0.52 + level * 0.48)))
    result = Image.composite(bright, dark, local_mask)

    cool_beam = ImageChops.multiply(
        beam, Image.new("RGB", beam.size, (204, 226, 255))
    )
    cool_beam = ImageEnhance.Brightness(cool_beam).enhance(0.31 * level)
    result = ImageChops.screen(result, cool_beam)

    haze = Image.new("RGBA", (W, H), (82, 126, 180, 0))
    haze.putalpha(mask.point(lambda p: int(p * 0.055 * level)))
    return Image.alpha_composite(result.convert("RGBA"), haze).convert("RGB")


def tint_sprite(sprite: Image.Image, brightness: float) -> Image.Image:
    rgb = Image.merge("RGB", sprite.split()[:3])
    rgb = ImageEnhance.Brightness(rgb).enhance(brightness)
    rgb = ImageChops.multiply(rgb, Image.new("RGB", rgb.size, (218, 231, 250)))
    out = rgb.convert("RGBA")
    out.putalpha(sprite.getchannel("A"))
    return out


def place_sprite(room: Image.Image, sprite: Image.Image, *, x: int, bottom: int, height: int, brightness: float,
                 mirror: bool = False) -> Image.Image:
    art = sprite
    if mirror:
        art = ImageOps.mirror(art)
    scale = height / art.height
    width = max(1, int(art.width * scale))
    art = art.resize((width, height), Image.Resampling.LANCZOS)
    art = tint_sprite(art, brightness)

    x0 = int(x - width / 2)
    y0 = int(bottom - height)
    layer = Image.new("RGBA", room.size, (0, 0, 0, 0))

    # A sparse contact shadow keeps the photographic body grounded; the flat head
    # remains unnaturally crisp because it is pasted after all room grain/light.
    shadow_h = max(8, int(height * 0.035))
    shadow_w = max(30, int(width * 0.62))
    shadow = Image.new("RGBA", room.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sx = int(x - shadow_w / 2)
    sy = min(room.height - shadow_h - 1, max(0, bottom - shadow_h // 2))
    sd.ellipse((sx, sy, sx + shadow_w, sy + shadow_h), fill=(0, 0, 0, 72))
    shadow = shadow.filter(ImageFilter.GaussianBlur(7))

    layer.alpha_composite(shadow)
    layer.alpha_composite(art, (x0, y0))
    return Image.alpha_composite(room.convert("RGBA"), layer).convert("RGB")


SPRITE_PLACEMENT = {
    "tyne_far": {"sprite": "standing", "x": 620, "bottom": 548, "height": 210, "brightness": 0.78},
    "tyne_mid": {"sprite": "standing", "x": 612, "bottom": 606, "height": 310, "brightness": 0.84},
    "tyne_near": {"sprite": "close", "x": 610, "bottom": 742, "height": 570, "brightness": 0.90},
    "tyne_left": {"sprite": "reaching", "x": 430, "bottom": 628, "height": 355, "brightness": 0.82},
    "tyne_reach": {"sprite": "reaching", "x": 615, "bottom": 698, "height": 455, "brightness": 0.88},
}


def main() -> None:
    ROOMS.mkdir(parents=True, exist_ok=True)

    base = load_source("room_master.png")
    opened = load_source("door_open_master.png")
    beam = load_source("phone_beam_master.png")

    door_composite, patch, door_mask = door_patch(base, opened)
    save_png(patch, ASSETS / "door_open_patch.png")
    save_png(door_mask, ASSETS / "door_open_mask.png")
    save_jpg(base, ASSETS / "room_master_clean.jpg", quality=92)
    save_jpg(door_composite, ASSETS / "room_master_open.jpg", quality=92)

    beam_mask, reflection = make_beam_layers(beam)
    save_png(reflection, ASSETS / "phone_light_reflection.png")
    save_png(beam_mask, ASSETS / "phone_light_mask.png")
    save_jpg(ImageChops.screen(darken_room(base), ImageEnhance.Brightness(beam).enhance(0.34)),
             ASSETS / "phone_light_on_room.jpg", quality=90)

    # Transparent arm PNGs requested explicitly; these retain the full 4:3 stage coordinates.
    off_arm = chroma_key(load_source("arm_off_master.png"))
    on_arm = chroma_key(fill_enclosed_green(load_source("arm_on_master_v2.png")))
    on_arm = add_rim_glow(on_arm, off_arm)
    save_png(off_arm, ASSETS / "arm_phone_off.png")
    save_png(on_arm, ASSETS / "arm_phone_on.png")

    sprites = {
        "standing": tight_crop(chroma_key(load_source("beckton_tyne_master.png"))),
        "reaching": tight_crop(chroma_key(load_source("beckton_tyne_lean_master.png"))),
        "close": tight_crop(chroma_key(load_source("beckton_tyne_close_master.png"))),
    }
    for name, sprite in sprites.items():
        save_png(sprite, ASSETS / f"beckton_tyne_{name}.png")

    # Additional stand-alone Beckton Tyne variants, useful as additional room-state plates.
    variant_specs = {
        "beckton_tyne_distant": ("standing", 210, 0.78),
        "beckton_tyne_at_door": ("standing", 310, 0.84),
        "beckton_tyne_leaning": ("reaching", 355, 0.82),
        "beckton_tyne_closer": ("reaching", 455, 0.88),
        "beckton_tyne_too_close": ("close", 570, 0.90),
    }
    for filename, (sprite_name, height, brightness) in variant_specs.items():
        canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        spec = {
            "sprite": sprite_name,
            "x": W // 2,
            "bottom": min(H - 8, int(height * 1.02)),
            "height": height,
            "brightness": brightness,
        }
        source = sprites[spec["sprite"]]
        art = source.resize((max(1, int(source.width * height / source.height)), height), Image.Resampling.LANCZOS)
        art = tint_sprite(art, brightness)
        canvas.alpha_composite(art, (int(spec["x"] - art.width / 2), int(spec["bottom"] - height)))
        save_png(canvas, ASSETS / f"{filename}.png")

    manifest: dict[str, object] = {
        "title": "Crimlawn Night",
        "size": [W, H],
        "same_room_source": "source/room_master.png",
        "doors": list(DOORS),
        "lights": list(LIGHTS),
        "anomalies": list(ANOMALIES),
        "anomalyTypes": ["Beckton Tyne", "the open door"],
        "files": {},
    }

    backgrounds = {"closed": base, "open": door_composite}
    for door in DOORS:
        background = backgrounds[door]
        for light in LIGHTS:
            level = LIGHT_LEVEL[light]
            clean_room = lit_room(background, beam_mask, beam, level)
            for anomaly in ANOMALIES:
                room = clean_room
                if anomaly != "clear":
                    spec = dict(SPRITE_PLACEMENT[anomaly])
                    sprite = sprites[spec.pop("sprite")]
                    # In an unlit room the anomaly is almost impossible to read;
                    # the phone light is what makes it countable.
                    visibility = {"unlit": 0.16, "dying": 0.50, "weak": 0.72, "lit": 1.0}[light]
                    spec["brightness"] *= visibility
                    room = place_sprite(room, sprite, **spec)
                filename = f"room_{door}_{light}_{anomaly}.jpg"
                save_jpg(room, ROOMS / filename)
                manifest["files"][f"{door}|{light}|{anomaly}"] = f"rooms/{filename}"

    (ASSETS / "states.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(DOORS) * len(LIGHTS) * len(ANOMALIES)} room state images and cutout assets.")


if __name__ == "__main__":
    main()
