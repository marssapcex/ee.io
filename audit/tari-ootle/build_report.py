"""Build the Tari Ootle stealth-audit whitepaper PDF (fpdf2, DejaVu fonts, offline).

Layout: dark cover with verdict tiles, a computed contents page (contents, reading guide,
findings at a glance), editorial body pages with running header/footer, amber accents,
code panels, striped tables, note/quote blocks, two-column coverage panel, inline mono chips.
"""
import re
import sys

from fpdf import FPDF
from fpdf.enums import XPos, YPos

sys.path.insert(0, "/home/user/ee.io/audit/tari-ootle")
from report_content import BLOCKS, COVER  # noqa: E402

FONTS = "/usr/share/fonts/truetype/dejavu"

INK = (18, 22, 28)
INK_SOFT = (78, 88, 100)
RULE = (208, 201, 188)
PAPER = (253, 252, 249)
AMBER = (198, 140, 24)
AMBER_DEEP = (146, 100, 14)
CODE_BG = (243, 241, 234)
CODE_INK = (34, 40, 48)
TABLE_HEAD = (24, 29, 36)
STRIPE = (247, 245, 239)
PANEL = (250, 248, 242)
COVER_BG = (15, 19, 25)
GREEN = (86, 168, 120)
BROWN = (158, 102, 62)

LM = RM = 20.0
TM = 25.0
BM = 20.0
TOKEN = re.compile(r"(\*\*.+?\*\*|`[^`]+`)")


class Doc(FPDF):
    def __init__(self):
        super().__init__(format="A4", unit="mm")
        self.set_margins(LM, TM, RM)
        self.set_auto_page_break(True, BM + 4)
        self.add_font("DJ", "", f"{FONTS}/DejaVuSans.ttf")
        self.add_font("DJ", "B", f"{FONTS}/DejaVuSans-Bold.ttf")
        self.add_font("Mono", "", f"{FONTS}/DejaVuSansMono.ttf")
        self.add_font("Mono", "B", f"{FONTS}/DejaVuSansMono-Bold.ttf")
        self.body_started = False
        self.page_numbers = {}

    # ---------------------------------------------------------------- page furniture
    def paint_bg(self):
        self.set_fill_color(*PAPER)
        self.rect(0, 0, self.w, self.h, style="F")

    def header(self):
        if not self.body_started:
            return
        self.paint_bg()
        self.set_font("DJ", "", 7.0)
        self.set_text_color(*INK_SOFT)
        self.set_xy(LM, 12.0)
        self.cell(120, 4, "TARI OOTLE L2  \u2014  STEALTH PATH SECURITY ASSESSMENT", align="L")
        self.set_xy(self.w - RM - 72, 12.0)
        self.cell(72, 4, "commit 3460b2ff  \u00b7  2026-10-30", align="R")
        self.set_draw_color(*RULE)
        self.set_line_width(0.2)
        self.line(LM, 17.4, self.w - RM, 17.4)
        self.set_y(TM + 1.5)
        self.set_text_color(*INK)

    def footer(self):
        if not self.body_started:
            return
        self.set_y(-15)
        self.set_draw_color(*RULE)
        self.set_line_width(0.2)
        self.line(LM, self.get_y(), self.w - RM, self.get_y())
        self.set_font("DJ", "", 6.8)
        self.set_text_color(*INK_SOFT)
        self.set_xy(LM, self.get_y() + 1.4)
        self.cell(120, 4, "Independent assessment  \u00b7  reproducible PoC  \u00b7  no unverified claims", align="L")
        self.set_xy(self.w - RM - 40, self.get_y())
        self.cell(40, 4, f"{self.page_no()} / {{nb}}", align="R")

    # ---------------------------------------------------------------- inline rich text
    @staticmethod
    def _stream(text):
        out, pos = [], 0
        for m in TOKEN.finditer(text):
            out.extend((ch, False, False) for ch in text[pos:m.start()])
            tok = m.group(0)
            if tok.startswith("**"):
                inner, bold, mono = tok[2:-2], True, False
            else:
                inner, bold, mono = tok[1:-1], False, True
            out.extend((ch, bold, mono) for ch in inner)
            pos = m.end()
        out.extend((ch, False, False) for ch in text[pos:])
        return out

    @classmethod
    def _parse(cls, text):
        """-> [(run_text, bold, mono, space_before)]; runs are space-free same-style chunks."""
        runs, cur, style, sb, pending = [], "", None, False, False
        for (ch, bold, mono) in cls._stream(text):
            if ch == " ":
                if cur:
                    runs.append((cur, style[0], style[1], sb))
                    cur, style = "", None
                pending = True
                continue
            st = (bold, mono)
            if cur and st != style:
                runs.append((cur, style[0], style[1], sb))
                cur, style, sb = "", None, False
            if not cur:
                style = st
                sb = pending if runs else False
                pending = False
            cur += ch
        if cur:
            runs.append((cur, style[0], style[1], sb))
        return runs

    def _rw(self, txt, bold, mono, size):
        self.set_font("Mono" if mono else "DJ", "B" if bold else "", size)
        return self.get_string_width(txt)

    def layout(self, text, width, size):
        runs = self._parse(text)
        space = self._rw(" ", False, False, size)
        lines, cur, acc = [], [], 0.0
        for (txt, bold, mono, sb) in runs:
            gap = space if sb else 0.0
            w = self._rw(txt, bold, mono, size)
            if w > width:  # character-split pathological runs
                pieces, pacc = [], ""
                for ch in txt:
                    if self._rw(pacc + ch, bold, mono, size) > width - 1:
                        pieces.append(pacc)
                        pacc = ch
                    else:
                        pacc += ch
                if pacc:
                    pieces.append(pacc)
                first = True
                for pc in pieces:
                    pw = self._rw(pc, bold, mono, size)
                    if cur and acc + (gap if first else 0.0) + pw > width:
                        lines.append(cur)
                        cur, acc = [], 0.0
                    g = gap if (first and cur) else 0.0
                    cur.append((pc, bold, mono, pw, g))
                    acc += g + pw
                    first = False
                continue
            if cur and acc + gap + w > width:
                lines.append(cur)
                cur, acc = [], 0.0
                gap = 0.0
            cur.append((txt, bold, mono, w, gap))
            acc += gap + w
        if cur:
            lines.append(cur)
        return lines or [[]]

    @staticmethod
    def _advance(line):
        return sum(wd + gap for (_, _, _, wd, gap) in line)

    def draw(self, lines, x, y, width, lead, size, align="J", color=INK,
             mono_color=(44, 52, 62), justify_ratio=0.55, force_text=False):
        for idx, line in enumerate(lines):
            if not line:
                y += lead
                continue
            natural = self._advance(line)
            gaps = [g for (*_, g) in line if g > 0]
            avg = sum(gaps) / len(gaps) if gaps else 0.0
            extra = 0.0
            if align == "J" and gaps and idx != len(lines) - 1 and natural >= justify_ratio * width:
                extra = max(-0.35 * avg, min(1.6 * avg, (width - natural) / len(gaps) - avg))
            cx = x
            for i, (txt, bold, mono, wd, gap) in enumerate(line):
                mono_here = mono and not force_text
                self.set_font("Mono" if mono_here else "DJ", "B" if bold else "", size)
                if mono_here:
                    self.set_fill_color(240, 237, 229)
                    self.rect(cx - 0.45, y + 0.4, wd + 0.95, lead - 0.95, style="F")
                self.set_text_color(*(mono_color if mono_here else color))
                self.set_xy(cx, y)
                self.cell(wd + 0.3, lead, txt, align="L")
                nxt = line[i + 1][4] if i + 1 < len(line) else 0.0
                cx += wd + nxt + (extra if nxt > 0 else 0.0)
            y += lead
        return y

    def rich(self, text, size=9.2, lead=4.95, align="J", color=INK, width=None, x=None,
             mono_color=(44, 52, 62)):
        x = LM if x is None else x
        width = (self.w - RM - x) if width is None else width
        bottom = self.h - BM - 1
        auto = self.auto_page_break
        self.set_auto_page_break(False)
        for para in str(text).split("\n"):
            lines = self.layout(para, width, size)
            i = 0
            while i < len(lines):
                if self.get_y() + lead > bottom:
                    self.add_page()
                room = max(1, int((bottom - self.get_y()) // lead))
                if room < 2 and i + 1 < len(lines):
                    self.add_page()
                    room = max(1, int((bottom - self.get_y()) // lead))
                chunk = lines[i:i + room]
                self.set_y(self.draw(chunk, x, self.get_y(), width, lead, size, align, color, mono_color))
                i += len(chunk)
        self.set_auto_page_break(auto, BM + 4)
        return self.get_y()

    # ---------------------------------------------------------------- blocks
    def h1(self, title):
        if self.get_y() > self.h - 62:
            self.add_page()
        self.ln(3.0)
        num, _, rest = title.partition(" ")
        self.set_font("Mono", "B", 12.6)
        self.set_text_color(*AMBER)
        self.set_xy(LM, self.get_y())
        self.cell(11, 8, num)
        self.set_font("DJ", "B", 13.2)
        self.set_text_color(*INK)
        self.set_xy(LM + 11, self.get_y())
        self.cell(self.w - LM - RM - 11, 8, rest, align="L", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_draw_color(*AMBER)
        self.set_line_width(0.7)
        y = self.get_y() + 1.4
        self.line(LM, y, LM + 16, y)
        self.set_draw_color(*RULE)
        self.set_line_width(0.25)
        self.line(LM + 18, y, self.w - RM, y)
        self.ln(5.4)
        self.page_numbers.setdefault(title, self.page_no())

    def h2(self, title):
        if self.get_y() + 32 > self.h - BM:
            self.add_page()
        self.ln(2.4)
        self.set_font("DJ", "B", 10.2)
        self.set_text_color(*INK)
        self.multi_cell(self.w - LM - RM, 5.3, title, align="L",
                        new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(2.2)

    def ensure(self, h):
        if self.get_y() + h > self.h - BM - 2:
            self.add_page()

    def body(self, text, size=9.2, lead=4.95):
        # keep a paragraph from being orphaned under a heading on the next page
        if self.get_y() > self.h - BM - 14:
            self.add_page()
        self.rich(text, size=size, lead=lead)
        self.ln(2.6)

    def bullets(self, items, size=9.0, lead=4.75):
        width = self.w - LM - RM - 5.4
        for it in items:
            lines = self.layout(it, width, size)
            if self.get_y() + len(lines) * lead + 2 > self.h - BM - 1:
                self.add_page()
            y0 = self.get_y()
            self.set_fill_color(*AMBER)
            self.rect(LM + 0.7, y0 + 1.85, 1.5, 1.5, style="F")
            self.set_y(self.draw(lines, LM + 5.4, y0, width, lead, size, "J"))
            self.ln(1.6)
        self.ln(1.4)

    def code(self, text, size=6.9, pad=2.8):
        lead = size * 0.53
        avail = self.w - LM - RM - 2 * pad - 1.2
        self.set_font("Mono", "", size)
        rows = []
        for ln in text.split("\n"):
            if not ln:
                rows.append(" ")
                continue
            acc = ""
            for ch in ln:
                if self.get_string_width(acc + ch) > avail:
                    rows.append(acc)
                    acc = "    " + ch
                else:
                    acc += ch
            rows.append(acc)
        block = len(rows) * lead + 2 * pad
        if self.get_y() + block > self.h - BM:
            self.add_page()
        y0 = self.get_y()
        self.set_fill_color(*CODE_BG)
        self.rect(LM, y0, self.w - LM - RM, block, style="F")
        self.set_fill_color(*AMBER)
        self.rect(LM, y0, 1.0, block, style="F")
        self.set_font("Mono", "", size)
        self.set_text_color(*CODE_INK)
        y = y0 + pad - 0.6
        for r in rows:
            self.set_xy(LM + pad + 1.4, y)
            self.cell(avail, lead, r, align="L")
            y += lead
        self.set_y(y0 + block + 3.4)
        self.set_text_color(*INK)

    def note(self, text, size=8.7):
        lh = 4.6
        inner = self.w - LM - RM - 8.0
        lines = self.layout(text, inner, size)
        block = len(lines) * lh + 6.4
        if self.get_y() + block > self.h - BM:
            self.add_page()
        y0 = self.get_y()
        self.set_fill_color(250, 246, 233)
        self.rect(LM, y0, self.w - LM - RM, block, style="F")
        self.set_fill_color(*AMBER)
        self.rect(LM, y0, 1.4, block, style="F")
        y = self.draw(lines, LM + 6.0, y0 + 3.2, inner, lh, size, "J")
        self.set_y(max(y, y0 + block) + 3.6)
        self.set_text_color(*INK)

    def quote(self, text):
        lh = 4.75
        inner = self.w - LM - RM - 8.0
        lines = self.layout(text, inner, 8.7)
        block = len(lines) * lh + 4.0
        if self.get_y() + block > self.h - BM:
            self.add_page()
        y0 = self.get_y()
        self.set_draw_color(*INK_SOFT)
        self.set_line_width(0.8)
        self.line(LM + 1.4, y0 + 1.0, LM + 1.4, y0 + block - 1.0)
        y = self.draw(lines, LM + 5.4, y0, inner, lh, 8.7, "L", color=INK_SOFT,
                      mono_color=INK_SOFT)
        self.set_y(max(y, y0 + block) + 3.2)

    def kv(self, rows):
        self.ensure(22)
        width = self.w - LM - RM - 34
        for k, v in rows:
            lines = []
            for vv in str(v).split("\n"):
                lines += self.layout(vv, width, 7.6)
            h = len(lines) * 4.05 + 1.6
            if self.get_y() + h > self.h - BM:
                self.add_page()
            y0 = self.get_y()
            self.set_font("DJ", "B", 7.0)
            self.set_text_color(*INK_SOFT)
            self.set_xy(LM, y0 + 0.5)
            self.cell(32, 4.0, k.upper(), align="L")
            self.draw(lines, LM + 34, y0, width, 4.05, 7.6, "L", mono_color=CODE_INK)
            self.set_y(y0 + h)
            self.set_draw_color(232, 228, 219)
            self.set_line_width(0.15)
            self.line(LM, self.get_y(), self.w - RM, self.get_y())
            self.ln(1.9)
        self.ln(0.6)

    def table(self, spec):
        widths = [w * (self.w - LM - RM) for w in spec["widths"]]
        header, rows = spec["header"], spec["rows"]
        lh, size = 3.45, 7.0

        def band(y):
            self.set_fill_color(*TABLE_HEAD)
            self.rect(LM, y, self.w - LM - RM, 7.0, style="F")
            x = LM
            self.set_font("DJ", "B", 7.0)
            self.set_text_color(255, 255, 255)
            for w, hh in zip(widths, header):
                self.set_xy(x + 1.8, y + 1.9)
                self.cell(w - 3.0, 3.4, hh.upper(), align="L")
                x += w
            return y + 7.0

        if self.get_y() > self.h - BM - 30:
            self.add_page()
        self.set_y(band(self.get_y()))
        for i, row in enumerate(rows):
            cells = [self.layout(cell, w - 3.2, size) for w, cell in zip(widths, row)]
            h = max(len(c) for c in cells) * lh + 2.4
            if self.get_y() + h > self.h - BM:
                self.add_page()
                self.set_y(band(self.get_y()))
            y = self.get_y()
            if i % 2 == 1:
                self.set_fill_color(*STRIPE)
                self.rect(LM, y, self.w - LM - RM, h, style="F")
            x = LM
            for idx, (w, lines) in enumerate(zip(widths, cells)):
                self.draw(lines, x + 1.6, y + 1.2, w - 3.2, lh, size, "L",
                          mono_color=(52, 60, 70), force_text=(idx > 0))
                x += w
            self.set_y(y + h)
            self.set_draw_color(230, 226, 218)
            self.set_line_width(0.15)
            self.line(LM, self.get_y(), self.w - RM, self.get_y())
        self.ln(4.2)

    def coverage(self, spec):
        col = (self.w - LM - RM - 8) / 2
        lead, size = 4.0, 7.4
        heights = [6.0 + sum(len(self.layout(it, col - 4.6, size)) * lead + 1.6
                             for it in items) for _, items, _ in spec]
        block = max(heights) + 8.0
        if self.get_y() + block > self.h - BM:
            self.add_page()
        y0 = self.get_y()
        self.set_fill_color(*PANEL)
        self.rect(LM, y0, self.w - LM - RM, block, style="F")
        self.set_fill_color(*AMBER)
        self.rect(LM, y0, 1.0, block, style="F")
        for i, (title, items, tone) in enumerate(spec):
            x = LM + 5.0 + i * (col + 6)
            accent = GREEN if tone == "ok" else BROWN
            self.set_font("DJ", "B", 7.2)
            self.set_text_color(*accent)
            self.set_xy(x, y0 + 3.4)
            self.cell(col, 4, title)
            yy = y0 + 9.6
            for it in items:
                lines = self.layout(it, col - 4.6, size)
                self.set_fill_color(*accent)
                self.rect(x, yy + 1.3, 1.2, 1.2, style="F")
                self.draw(lines, x + 4.2, yy, col - 4.6, lead, size, "L", color=INK_SOFT)
                yy += len(lines) * lead + 1.6
        self.set_y(y0 + block + 4.5)

    def closing(self, spec):
        """Dark end-card: three columns of short facts."""
        block = 54.0
        if self.get_y() + block > self.h - BM:
            self.add_page()
        y0 = self.get_y() + 2
        self.set_fill_color(*COVER_BG)
        self.rect(LM, y0, self.w - LM - RM, block, style="F")
        self.set_fill_color(*AMBER)
        self.rect(LM, y0, 1.4, block, style="F")
        self.set_xy(LM + 7, y0 + 7)
        self.set_font("DJ", "B", 9.2)
        self.set_text_color(255, 255, 255)
        self.cell(0, 5, spec["title"])
        self.set_xy(LM + 7, y0 + 14)
        self.set_font("DJ", "", 7.6)
        self.set_text_color(176, 182, 192)
        self.multi_cell(self.w - LM - RM - 14, 4.3, spec["body"], align="L",
                        new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        colw = (self.w - LM - RM - 14) / len(spec["cols"])
        for i, (k, v) in enumerate(spec["cols"]):
            x = LM + 7 + i * colw
            self.set_xy(x, y0 + block - 19)
            self.set_font("DJ", "B", 6.2)
            self.set_text_color(*AMBER)
            self.cell(colw - 4, 3.6, k.upper())
            self.set_xy(x, y0 + block - 14.4)
            self.set_font("Mono", "", 7.0)
            self.set_text_color(226, 230, 236)
            self.multi_cell(colw - 5, 3.8, v, align="L", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_y(y0 + block + 4)
        self.set_text_color(*INK)

    # ---------------------------------------------------------------- cover
    def cover(self):
        self.add_page()
        w, h = self.w, self.h
        self.set_fill_color(*COVER_BG)
        self.rect(0, 0, w, h, style="F")
        self.set_draw_color(24, 29, 36)
        self.set_line_width(0.25)
        for i in range(52):
            self.line(w * 0.44, h - 40 + i * 2.4, w + 12, h - 130 + i * 2.4)
        self.set_fill_color(*COVER_BG)
        self.rect(0, 0, w * 0.43, h, style="F")
        self.set_fill_color(*AMBER)
        self.rect(0, 0, w, 3.6, style="F")

        self.set_xy(LM, 42)
        self.set_font("DJ", "B", 8.0)
        self.set_text_color(*AMBER)
        self.cell(0, 4, "I N D E P E N D E N T   S E C U R I T Y   A S S E S S M E N T")
        self.ln(11)
        self.set_xy(LM - 0.8, self.get_y())
        self.set_font("DJ", "B", 40)
        self.set_text_color(255, 255, 255)
        self.cell(0, 16, COVER["title"], new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_draw_color(*AMBER)
        self.set_line_width(1.3)
        self.line(LM, self.get_y() + 2.4, LM + 46, self.get_y() + 2.4)
        self.ln(9)
        self.set_xy(LM, self.get_y())
        self.set_font("DJ", "", 12.8)
        self.set_text_color(216, 219, 224)
        self.multi_cell(w - 2 * LM - 14, 6.4, COVER["subtitle"], align="L",
                        new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        y = self.get_y() + 12
        self.set_draw_color(52, 58, 66)
        self.set_line_width(0.3)
        self.line(LM, y, w - RM, y)
        y += 8
        self.set_font("DJ", "", 8.6)
        self.set_text_color(182, 188, 196)
        self.set_xy(LM, y)
        self.multi_cell(w - 2 * LM - 30, 5.4, COVER["abstract"], align="L",
                        new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        y = h - 126
        self.set_draw_color(52, 58, 66)
        self.set_line_width(0.3)
        self.line(LM, y, w - RM, y)
        y += 7
        for k, v in COVER["meta"]:
            self.set_xy(LM, y)
            self.set_font("DJ", "B", 6.9)
            self.set_text_color(146, 152, 162)
            self.cell(42, 4.4, k.upper(), align="L")
            self.set_font("DJ", "", 7.8)
            self.set_text_color(236, 238, 242)
            self.set_xy(LM + 44, y)
            self.cell(0, 4.4, v, align="L")
            y += 6.2

        y = h - 66
        n = len(COVER["verdict"])
        tw = (w - 2 * LM) / n
        for i, (k, v) in enumerate(COVER["verdict"]):
            x = LM + i * tw
            accent = GREEN if k in ("Critical", "High", "Medium") else AMBER
            self.set_fill_color(*accent)
            self.rect(x, y, 0.9, 17, style="F")
            self.set_xy(x + 4, y + 1.2)
            self.set_font("DJ", "", 6.1)
            self.set_text_color(146, 152, 162)
            self.cell(tw - 6, 3.6, k.upper(), align="L")
            self.set_xy(x + 4, y + 6.4)
            self.set_font("DJ", "B", 12.6)
            self.set_text_color(255, 255, 255)
            self.cell(tw - 6, 8, v, align="L")

    # ---------------------------------------------------------------- contents page
    def toc_page(self, entries):
        self.add_page()
        self.paint_bg()
        self.set_y(TM + 6)
        self.set_font("DJ", "B", 7.8)
        self.set_text_color(*AMBER_DEEP)
        self.cell(0, 4, "C O N T E N T S")
        self.ln(9)
        for title, page in entries:
            num, _, rest = title.partition(" ")
            self.set_font("Mono", "B", 8.4)
            self.set_text_color(*AMBER)
            self.set_xy(LM, self.get_y())
            self.cell(12, 6, num)
            self.set_font("DJ", "", 9.4)
            self.set_text_color(*INK)
            self.cell(self.w - LM - RM - 26, 6, rest, align="L")
            self.set_font("Mono", "", 8.4)
            self.set_text_color(*INK_SOFT)
            self.cell(12, 6, str(page), align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            self.ln(1.2)

        self.ln(4.0)
        self.set_draw_color(*RULE)
        self.set_line_width(0.25)
        self.line(LM, self.get_y(), self.w - RM, self.get_y())
        self.ln(5.5)
        self.set_font("DJ", "B", 7.4)
        self.set_text_color(*AMBER_DEEP)
        self.cell(0, 4, "H O W   T O   R E A D   T H I S   D O C U M E N T")
        self.ln(6.5)
        for para in COVER["howto"]:
            self.set_text_color(*INK)
            self.rich(para, size=8.6, lead=4.55)
            self.ln(1.6)

        self.ln(3.0)
        self.set_font("DJ", "B", 7.4)
        self.set_text_color(*AMBER_DEEP)
        self.cell(0, 4, "F I N D I N G S   A T   A   G L A N C E")
        self.ln(7.0)
        self.table({
            "widths": [0.09, 0.61, 0.15, 0.15],
            "header": ["ID", "Finding", "Severity", "Status"],
            "rows": COVER["glance"],
        })


def render(path, toc=None):
    doc = Doc()
    doc.set_title("Tari Ootle L2 \u2014 Stealth Path Security Assessment")
    doc.set_author("Independent security assessment")
    doc.set_subject("Stealth transfer execution path and client SDK audit")
    doc.set_keywords("Tari, Ootle, stealth, confidential assets, MAST, bulletproofs, audit")
    doc.cover()
    if toc:
        doc.toc_page(toc)
    doc.body_started = True
    doc.add_page()
    for kind, payload in BLOCKS:
        if kind == "h1":
            doc.h1(payload)
        elif kind == "h2":
            doc.h2(payload)
        elif kind == "p":
            doc.body(payload)
        elif kind == "bullets":
            doc.bullets(payload)
        elif kind == "code":
            doc.code(payload)
        elif kind == "note":
            doc.note(payload)
        elif kind == "quote":
            doc.quote(payload)
        elif kind == "kv":
            doc.kv(payload)
        elif kind == "table":
            doc.table(payload)
        elif kind == "coverage":
            doc.coverage(payload)
        elif kind == "closing":
            doc.closing(payload)
        elif kind == "pagebreak":
            doc.add_page()
        else:
            raise ValueError(kind)
    doc.output(path)
    return doc


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else \
        "/home/user/ee.io/audit/tari-ootle/whitepaper/TariOotle_Stealth_Audit.pdf"
    entries = [(t, 1) for (k, t) in BLOCKS if k == "h1"]
    for _ in range(6):
        d = render("/tmp/_pass.pdf", toc=entries)
        got = list(d.page_numbers.items())
        if got == entries:
            break
        entries = got
    render(out, toc=entries)
    print("toc:", [(t, p) for t, p in entries])
    print("pages:", d.page_no(), "->", out)
