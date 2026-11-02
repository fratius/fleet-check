"""
Adds the Romanian letters Ș ș Ț ț (S and T with comma below, U+0218-U+021B) to Tessera, which lacks them.

Each one is a composite: the letter, plus the font's own comma, at 78% and centred under it, so it follows the
font's design and every weight. The SIL Open Font License allows modified versions; Tessera declares no Reserved
Font Name, so the family keeps its name. The licence stays next to the files (OFL.txt) and the change is noted in
the font's version string and in assets/fonts/tessera/README.md.

Run on the family's files after updating them (needs fonttools and brotli: pip install fonttools brotli):
  python3 scripts/tessera-romanian.py assets/fonts/tessera/Tessera-*.ttf website/fonts/tessera.woff2
Files that already have the letters are left as they are.
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent
from fontTools.pens.boundsPen import BoundsPen

SCALE = 0.78          # the comma below, relative to the font's comma
GAP = 40              # space between the baseline and the comma's top, in font units (1000 per em)
LETTERS = [('S', 'Scommaaccent', 0x0218), ('s', 'scommaaccent', 0x0219), ('T', 'Tcommaaccent', 0x021A), ('t', 'tcommaaccent', 0x021B)]
NOTE = 'Fratius: added U+0218-U+021B (Romanian S and T with comma below)'


def bounds(gs, name):
    pen = BoundsPen(gs)
    gs[name].draw(pen)
    return pen.bounds


def add(path):
    f = TTFont(path)
    cmap = f.getBestCmap()
    if all(u in cmap for _, _, u in LETTERS):
        print('already has them:', path)
        return
    gs = f.getGlyphSet()
    glyf, hmtx = f['glyf'], f['hmtx']
    comma = cmap[ord(',')]
    cx0, _, cx1, cy1 = bounds(gs, comma)
    order = f.getGlyphOrder()
    for base_ch, name, uni in LETTERS:
        base = cmap[ord(base_ch)]
        bx0, _, bx1, _ = bounds(gs, base)
        g = Glyph()
        g.numberOfContours = -1
        letter = GlyphComponent()
        letter.glyphName, letter.x, letter.y, letter.flags = base, 0, 0, 0x204  # the letter's advance and side bearings
        mark = GlyphComponent()
        mark.glyphName = comma
        mark.x = round((bx0 + bx1) / 2 - (cx1 - cx0) * SCALE / 2 - cx0 * SCALE)
        mark.y = round(-GAP - cy1 * SCALE)
        mark.flags = 0x4
        mark.transform = [[SCALE, 0], [0, SCALE]]
        g.components = [letter, mark]
        if name not in glyf.glyphs:
            order.append(name)
        glyf[name] = g
        hmtx[name] = hmtx[base]
        if 'gvar' in f:
            f['gvar'].variations[name] = []  # the letter and the comma carry the weight variation themselves
    f.setGlyphOrder(order)
    f['maxp'].numGlyphs = len(order)
    for table in f['cmap'].tables:
        if table.isUnicode():
            for _, name, uni in LETTERS:
                table.cmap[uni] = name
    for rec in f['name'].names:
        if rec.nameID == 5 and NOTE not in rec.toUnicode():
            rec.string = f'{rec.toUnicode()}; {NOTE}'
    f.save(path)
    print('added', ' '.join(chr(u) for _, _, u in LETTERS), 'to', path)


if __name__ == '__main__':
    for p in sys.argv[1:]:
        add(p)
