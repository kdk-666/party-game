import io

from PIL import Image

from server.games.color_utils import (
    center_average_color, color_distance, hex_to_rgb, similarity_score)


def make_png(color, size=(100, 100)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def test_hex_to_rgb():
    assert hex_to_rgb("#ff8000") == (255, 128, 0)


def test_same_color_is_100():
    assert similarity_score((200, 30, 30), (200, 30, 30)) == 100


def test_near_color_scores_high():
    assert similarity_score((200, 30, 30), (210, 40, 35)) >= 85


def test_different_color_scores_low():
    assert similarity_score((255, 0, 0), (0, 0, 255)) <= 10


def test_order_red_closer_than_green():
    target = (255, 0, 0)
    assert color_distance(target, (230, 40, 40)) < color_distance(target, (0, 200, 0))


def test_center_average_ignores_border():
    img = Image.new("RGB", (100, 100), (0, 0, 255))      # 파란 배경
    img.paste((255, 0, 0), (30, 30, 70, 70))             # 가운데만 빨강
    buf = io.BytesIO()
    img.save(buf, "PNG")
    r, g, b = center_average_color(buf.getvalue())
    assert r > 240 and b < 15


def test_center_average_of_flat_image():
    assert center_average_color(make_png((10, 200, 50))) == (10, 200, 50)
