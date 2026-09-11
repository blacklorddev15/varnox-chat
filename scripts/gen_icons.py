"""Generate the Varnox PWA icons (PNG) from the same geometry as public/icon.svg."""

from PIL import Image, ImageDraw

OUT = "public"


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(img)
    c1 = (0x19, 0xC0, 0x8E)
    c2 = (0x0B, 0x7D, 0x5E)
    for y in range(size):
        for_x = y / max(1, size - 1)
        row = tuple(int(c1[i] + (c2[i] - c1[i]) * for_x) for i in range(3))
        draw.line([(0, y), (size, y)], fill=row)
    return img


def logo(size: int, radius_ratio: float, content_scale: float) -> Image.Image:
    ss = 4  # supersample for smooth edges
    s = size * ss
    base = gradient(s).convert("RGBA")

    if radius_ratio > 0:
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * radius_ratio), fill=255)
        base.putalpha(mask)

    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    k = s / 512.0 * content_scale
    off = (s - 512 * k) / 2.0

    def p(x: float, y: float):
        return (off + x * k, off + y * k)

    v = [p(122, 148), p(174, 148), p(240, 264), p(316, 148), p(368, 148), p(288, 356), p(228, 356)]
    d.polygon(v, fill=(255, 255, 255, 255))
    d.ellipse([*p(352, 332), *p(444, 424)], fill=(4, 53, 42, 90))
    d.ellipse([*p(378, 358), *p(418, 398)], fill=(255, 255, 255, 235))

    out = Image.alpha_composite(base, layer)
    return out.resize((size, size), Image.LANCZOS)


def main() -> None:
    logo(192, 0.2265, 1.0).save(f"{OUT}/icon-192.png")
    logo(512, 0.2265, 1.0).save(f"{OUT}/icon-512.png")
    logo(512, 0.0, 0.72).save(f"{OUT}/icon-maskable-512.png")
    logo(180, 0.2265, 1.0).save(f"{OUT}/apple-touch-icon.png")
    print("icons written")


if __name__ == "__main__":
    main()
