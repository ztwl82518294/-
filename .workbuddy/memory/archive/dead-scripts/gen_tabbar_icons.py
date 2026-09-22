# -*- coding: utf-8 -*-
# 生成 tabBar 图标：首页 / 收藏 / 我的，81x81 透明底，线性描边风格
# 灰色态 (#7A7E83) 与选中蓝色态 (#2563EB) 各一套
import math, os
from PIL import Image, ImageDraw

OUT = r"G:\workbuddy\logistics-line-query\assets\tabbar"
os.makedirs(OUT, exist_ok=True)
S = 81  # canvas size
LW = 4  # stroke width（PIL 要求整型）

GRAY = (122, 126, 131, 255)
BLUE = (37, 99, 235, 255)


def new_canvas():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def lp(*pts):
    return [(int(round(x)), int(round(y))) for x, y in pts]


def draw_home(d, color):
    # 房子：屋顶 + 房身 + 门
    d.line(lp((13, 40), (40.5, 15), (68, 40)), fill=color, width=LW, joint="curve")
    d.line(lp((20, 36), (20, 66), (61, 66), (61, 36)), fill=color, width=LW, joint="curve")
    d.rounded_rectangle((34, 48, 47, 66), radius=2, outline=color, width=LW)


def draw_star(d, color):
    # 五角星（描边）
    cx, cy, r1, r2 = 40.5, 43, 26, 11.5
    pts = []
    for i in range(10):
        ang = -math.pi / 2 + i * math.pi / 5
        r = r1 if i % 2 == 0 else r2
        pts.append((int(round(cx + r * math.cos(ang))), int(round(cy + r * math.sin(ang)))))
    d.polygon(pts, outline=color, width=LW)


def draw_user(d, color):
    # 人形：头 + 肩
    d.ellipse((29, 13, 52, 36), outline=color, width=LW)
    d.arc((14, 42, 67, 92), start=180, end=360, fill=color, width=LW)
    d.line(lp((14.6, 67), (66.4, 67)), fill=color, width=LW)


icons = {"home": draw_home, "star": draw_star, "user": draw_user}

for name, fn in icons.items():
    for suffix, color in (("", GRAY), ("-active", BLUE)):
        img, d = new_canvas()
        fn(d, color)
        p = os.path.join(OUT, f"{name}{suffix}.png")
        img.save(p)
        print("saved", p)
