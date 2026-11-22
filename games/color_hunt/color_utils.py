"""컬러헌트용 색 계산 도구 (게임 규칙과 분리해 단독으로 테스트할 수 있게 함)."""
import io

from PIL import Image, ImageDraw, ImageStat

# 두 색의 거리(deltaE)가 이 값 이상이면 0점. 클수록 점수가 관대해진다.
MAX_DELTA_E = 70.0


def hex_to_rgb(hex_color):
    """'#ff0000' -> (255, 0, 0)"""
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_to_lab(rgb):
    """RGB(0~255)를 Lab 색공간으로 바꾼다. Lab은 '사람 눈이 느끼는 색 차이'에 가깝다."""
    def lin(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (lin(c) for c in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def color_distance(rgb1, rgb2):
    """두 색의 Lab 거리. 0이면 같은 색, 클수록 다른 색."""
    l1, l2 = rgb_to_lab(rgb1), rgb_to_lab(rgb2)
    return sum((a - b) ** 2 for a, b in zip(l1, l2)) ** 0.5


def similarity_score(target_rgb, photo_rgb):
    """0~100점. 같은 색이면 100, 많이 다르면 0."""
    d = color_distance(target_rgb, photo_rgb)
    return round(max(0.0, 100.0 * (1 - d / MAX_DELTA_E)))


# 화면의 동그라미 지름 = 사진 가로 길이의 이 비율 (games/color_hunt/client/colorhunt.css 의 .ch-aim width 와 같아야 한다)
CIRCLE_RATIO = 0.28


def center_average_color(image_bytes, ratio=CIRCLE_RATIO):
    """사진 가운데 '원' 안쪽의 평균색을 (r, g, b)로 돌려준다. 지름 = 가로 길이 x ratio."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    w, h = img.size
    d = max(2, min(int(w * ratio), w, h))          # 원의 지름(픽셀)
    left, top = (w - d) // 2, (h - d) // 2
    crop = img.crop((left, top, left + d, top + d))
    mask = Image.new("L", (d, d), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, d - 1, d - 1), fill=255)   # 원 안쪽만 255
    r, g, b = ImageStat.Stat(crop, mask).mean
    return (round(r), round(g), round(b))
