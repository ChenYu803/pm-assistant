"""统一标题字体：把散落各处的 Georgia 衬线栈换成 var(--font-display)，并在 :root 定义它。
只替换"显示级"标题用的 Georgia 栈；正文与等宽字体不动。
"""
import io
import re

ROOT = "src/app/globals.css"

# 1) 在 :root 里补 --font-display（与 landing 现有的 --serif 同一套栈）
g = io.open(ROOT, encoding="utf-8").read()
if "--font-display" not in g:
    anchor = ":root {"
    i = g.index(anchor) + len(anchor)
    g = g[:i] + '\n  --font-display: "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", SimSun, Georgia, serif;' + g[i:]
    print("globals: --font-display 已加入 :root")

# 2) Georgia 栈 → var(--font-display)
pat = re.compile(r'Georgia\s*,\s*(?:"Times New Roman"\s*,\s*)?serif')
g2, n = pat.subn("var(--font-display)", g)
print("globals: Georgia 栈替换", n, "处")
io.open(ROOT, "w", encoding="utf-8", newline="\n").write(g2)

# 3) 组件 CSS 模块同样处理
for p in [
    "src/components/CareerAssessment.module.css",
    "src/components/OnboardingExperience.module.css",
    "src/components/ProfilePage.module.css",
]:
    s = io.open(p, encoding="utf-8").read()
    s2, n = pat.subn("var(--font-display)", s)
    io.open(p, "w", encoding="utf-8", newline="\n").write(s2)
    print(p, "替换", n, "处")

# 4) landing 的 --serif 直接指向同一变量，避免两套栈漂移
p = "src/components/LandingPage.module.css"
s = io.open(p, encoding="utf-8").read()
old = '--serif: "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", SimSun, Georgia, serif;'
if old in s:
    s = s.replace(old, "--serif: var(--font-display);")
    io.open(p, "w", encoding="utf-8", newline="\n").write(s)
    print("LandingPage: --serif → var(--font-display)")

# 5) 工作台把标题强行改成无衬线：只保留小号 UI 标签为无衬线，显示级标题回归衬线
p = "src/app/workbench-quality.css"
s = io.open(p, encoding="utf-8").read()
old = ".iteration-workbench .stage-empty h3 { font:600 23px/1.5 var(--font-app-sans); }"
if old in s:
    s = s.replace(old, ".iteration-workbench .stage-empty h3 { font:500 23px/1.42 var(--font-display); }")
    io.open(p, "w", encoding="utf-8", newline="\n").write(s)
    print("workbench-quality: stage-empty h3 回到衬线")
else:
    print("workbench-quality: 未命中 stage-empty h3")
