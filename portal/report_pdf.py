"""Render an internal, evidence-backed bug report from a sanitized run model."""
import argparse
import io
import json
import os
import re
from pathlib import Path
from datetime import datetime, timezone
from html import escape as html_escape

from PIL import Image as PillowImage, ImageStat
from reportlab import rl_config
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, LongTable,
                               TableStyle, PageBreak, CondPageBreak, Flowable, KeepTogether)

# Write image streams as binary. ReportLab's default ASCII85 text encoding runs in pure Python here and
# took longer than everything else in a screenshot-heavy report, and it makes the file about 25% bigger.
rl_config.useA85 = 0
# Screenshots are stored as JPEG, which ReportLab embeds without decoding it again. On run screenshots this
# encodes about 8x faster than PNG at about the same size. Wider images are scaled to this width
# (about 230 dpi at the report's body width; runner screenshots are 1600 px). The original PNG stays in the portal.
SCREENSHOT_MAX_WIDTH = 1600
SCREENSHOT_JPEG_QUALITY = 80

INK = colors.HexColor('#20263D')
PURPLE = colors.HexColor('#6654D9')
MUTED = colors.HexColor('#747D94')
LINE = colors.HexColor('#E3E7F0')
PALE = colors.HexColor('#F4F5FA')
RED = colors.HexColor('#B94860')
TEAL = colors.HexColor('#23846A')
AMBER = colors.HexColor('#A87730')
WHITE = colors.white
WIDTH, HEIGHT = A4
MARGIN = 46
BODY_WIDTH = WIDTH - 2 * MARGIN


def setup_fonts():
    windows = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'
    candidates = [
        (windows / 'segoeui.ttf', windows / 'segoeuib.ttf'),
        (Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')),
    ]
    for regular, bold in candidates:
        if regular.exists() and bold.exists():
            pdfmetrics.registerFont(TTFont('Studio', str(regular)))
            pdfmetrics.registerFont(TTFont('StudioBold', str(bold)))
            pdfmetrics.registerFontFamily('Studio', normal='Studio', bold='StudioBold', italic='Studio', boldItalic='StudioBold')
            return 'Studio', 'StudioBold'
    return 'Helvetica', 'Helvetica-Bold'


FONT, BOLD = setup_fonts()
FALLBACK = None
try:
    fallback_file = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / 'Nirmala.ttc'
    if fallback_file.exists():
        pdfmetrics.registerFont(TTFont('StudioFallback', str(fallback_file), subfontIndex=0))
        FALLBACK = 'StudioFallback'
except Exception:
    pass


def escape(value):
    """Escape paragraph markup and use a real glyph or a visible Unicode code point."""
    regular = getattr(pdfmetrics.getFont(FONT).face, 'charToGlyph', {})
    fallback = getattr(pdfmetrics.getFont(FALLBACK).face, 'charToGlyph', {}) if FALLBACK else {}
    out = []
    for char in str(value):
        point = ord(char)
        if point < 128 or point in regular:
            out.append(html_escape(char))
        elif point in fallback:
            out.append(f'<font name="{FALLBACK}">{html_escape(char)}</font>')
        else:
            out.append(f'[U+{point:04X}]')
    return ''.join(out)
STYLES = {
    'body': ParagraphStyle('Body', fontName=FONT, fontSize=9, leading=14, textColor=INK, spaceAfter=7, splitLongWords=True),
    'small': ParagraphStyle('Small', fontName=FONT, fontSize=7.5, leading=11, textColor=MUTED, spaceAfter=4, splitLongWords=True),
    'label': ParagraphStyle('Label', fontName=BOLD, fontSize=7, leading=10, textColor=MUTED, spaceAfter=5),
    'h1': ParagraphStyle('H1', fontName=BOLD, fontSize=22, leading=28, textColor=INK, spaceAfter=14),
    'h2': ParagraphStyle('H2', fontName=BOLD, fontSize=13, leading=18, textColor=INK, spaceBefore=17, spaceAfter=10, keepWithNext=True),
    'h3': ParagraphStyle('H3', fontName=BOLD, fontSize=10, leading=15, textColor=INK, spaceBefore=10, spaceAfter=7, keepWithNext=True),
    'h3t': ParagraphStyle('H3T', fontName=BOLD, fontSize=10, leading=15, textColor=INK, spaceBefore=10, spaceAfter=7),
    'white': ParagraphStyle('White', fontName=BOLD, fontSize=24, leading=30, textColor=WHITE, splitLongWords=True),
    'box': ParagraphStyle('Box', fontName=FONT, fontSize=9, leading=14, textColor=INK, backColor=PALE, borderPadding=11, spaceBefore=11, spaceAfter=16, splitLongWords=True),
    'badbox': ParagraphStyle('BadBox', fontName=FONT, fontSize=9, leading=14, textColor=RED, backColor=colors.HexColor('#FCF0F3'), borderPadding=11, spaceBefore=11, spaceAfter=16, splitLongWords=True),
}


def clean(value):
    # Normalize typographic dashes; retain the content and support wrapping long URLs/tokens.
    value = str(value if value is not None else '').replace('\u2011', '-').replace('\u2013', '-').replace('\u2014', '-')
    # Defence in depth: the model is already redacted upstream; never print credentials if one slips through.
    value = re.sub(r'\bBearer\s+[A-Za-z0-9._~+/-]+=*', 'Bearer [REDACTED]', value, flags=re.I)
    value = re.sub(r'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b', '[REDACTED TOKEN]', value)
    value = re.sub(r'((?:password|passwd|secret|access_token|refresh_token|api_key|authorization)\s*[=:]\s*)(?!\[REDACTED\])[^\s;,]+', r'\1[REDACTED]', value, flags=re.I)
    return ''.join(char for char in value if ord(char) >= 32 or char in '\n\t')


def p(value, style='body'):
    return Paragraph(escape(clean(value)).replace('\n', '<br/>'), STYLES[style])


def rich(value, style='body'):
    return Paragraph(value, STYLES[style])


def timestamp(value):
    if not value:
        return 'Not recorded'
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc).strftime('%d %b %Y, %H:%M UTC')
    except ValueError:
        return clean(value)


def table(rows, widths, header=False, compact=False):
    result = LongTable(rows, colWidths=widths, repeatRows=1 if header else 0, hAlign='LEFT')
    commands = [('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 10),
                ('RIGHTPADDING', (0, 0), (-1, -1), 10), ('TOPPADDING', (0, 0), (-1, -1), 4 if compact else 9),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4 if compact else 9), ('LINEBELOW', (0, 0), (-1, -1), .5, LINE)]
    if header:
        commands += [('BACKGROUND', (0, 0), (-1, 0), PALE), ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, colors.HexColor('#FBFCFE')])]
    result.setStyle(TableStyle(commands))
    return result


class Hero(Flowable):
    def __init__(self, model):
        super().__init__()
        self.model = model
        self.title = p(model['title'], 'white')

    def wrap(self, width, height):
        self.width = width
        _, self.title_height = self.title.wrap(width - 42, height)
        self.height = self.title_height + 87
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(INK)
        c.roundRect(0, 0, self.width, self.height, 12, stroke=0, fill=1)
        c.setFillColor(PURPLE)
        c.roundRect(0, 0, 6, self.height, 3, stroke=0, fill=1)
        c.setFillColor(colors.HexColor('#C1B9FA'))
        c.setFont(BOLD, 7)
        c.drawString(22, self.height - 24, 'QUALITY REVIEW / EVIDENCE SNAPSHOT')
        self.title.drawOn(c, 21, 41)
        c.setFont(FONT, 8)
        c.setFillColor(colors.HexColor('#D1D5E5'))
        c.drawString(22, 20, f"{self.model['run']['module']}  /  {self.model['run']['status'].upper()}")


def metric_grid(counts):
    cells = []
    for label, key, color in [('Assertion failures', 'failed', RED), ('Rule reviews', 'assumptions', AMBER),
                              ('Execution issues', 'errors', PURPLE), ('Blocked cases', 'blocked', MUTED)]:
        cells.append([rich(f'<font color="{color.hexval()}"><b>{counts[key]}</b></font>', 'h1'), p(label, 'small')])
    result = Table([cells], colWidths=[BODY_WIDTH / 4] * 4)
    result.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BACKGROUND', (0, 0), (-1, -1), PALE),
                               ('BOX', (0, 0), (-1, -1), .5, LINE), ('INNERGRID', (0, 0), (-1, -1), .5, LINE),
                               ('LEFTPADDING', (0, 0), (-1, -1), 13), ('TOPPADDING', (0, 0), (-1, -1), 13), ('BOTTOMPADDING', (0, 0), (-1, -1), 8)]))
    return result


def add_map(story, title, values):
    if not values:
        return
    story.append(p(title, 'h3'))
    for row in values:
        # A paragraph can split across pages, unlike an oversized table row.
        story.append(rich(f'<b>{escape(clean(row["key"]))}</b>  {escape(clean(row["value"])).replace(chr(10), "<br/>")}', 'body'))


def asset_path(root, relative):
    target = (root / relative).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        return None
    return target if target.is_file() else None


def add_evidence_inventory(story, item):
    inventory = [p('Evidence inventory', 'h3')]
    attachments = item.get('attachments') or []
    warnings = item.get('evidenceWarnings') or []
    images = [a for a in attachments if str(a.get('contentType', '')).startswith('image/')]
    if attachments:
        inventory.extend(p(f"{a.get('name', 'Attachment')}: {Path(a.get('path', '')).name} (original available in the portal)", 'small') for a in attachments)
    if warnings:
        for warning in warnings:
            inventory.append(p(f'Screenshot capture warning: {warning}', 'badbox'))
    if item.get('executed', True) and not images:
        reason = '; '.join(warnings) if warnings else 'No screenshot attachment was recorded during execution.'
        inventory.append(p(f"Screenshot could not be captured for {item.get('caseId') or item['id']}: {reason}", 'badbox'))
    elif not attachments and not warnings:
        inventory.append(p('No screenshot or trace was attached to this result.', 'small'))
    story.append(KeepTogether(inventory))


class Screenshot(Flowable):
    """One prepared JPEG slice of a screenshot. While render() is still counting pages
    (draw_images is False) it only takes up its space, so each image is written to the PDF once."""
    draw_images = True

    def __init__(self, data, width, height):
        super().__init__()
        self.data, self.width, self.height = data, width, height
        self.hAlign = 'CENTER'

    def wrap(self, width, height):
        return self.width, self.height

    def draw(self):
        if Screenshot.draw_images:
            self.canv.drawImage(ImageReader(io.BytesIO(self.data)), 0, 0, self.width, self.height)


PREPARED = {}


def prepare_screenshot(target, segment_points):
    """Decode, check and slice a screenshot once; later layout passes reuse the result.
    Returns None when the image shows no UI, otherwise a list of (jpeg bytes, width px, height px)."""
    key = (str(target), segment_points)
    if key not in PREPARED:
        try:
            PREPARED[key] = _prepare_screenshot(target, segment_points)
        except Exception as error:
            PREPARED[key] = error
    if isinstance(PREPARED[key], Exception):
        raise PREPARED[key]
    return PREPARED[key]


def _prepare_screenshot(target, segment_points):
    with PillowImage.open(target) as source:
        if source.width * source.height > 60000000:
            raise ValueError('Image is too large for report rendering')
        screenshot = source.convert('RGB')
    if all(high - low <= 2 and low >= 250 for low, high in ImageStat.Stat(screenshot).extrema):
        return None
    if screenshot.width > SCREENSHOT_MAX_WIDTH:
        scaled_height = max(1, round(screenshot.height * SCREENSHOT_MAX_WIDTH / screenshot.width))
        screenshot = screenshot.resize((SCREENSHOT_MAX_WIDTH, scaled_height), PillowImage.LANCZOS)
    segment_height = max(1, int(screenshot.width * segment_points / BODY_WIDTH))
    segments = []
    for top in range(0, screenshot.height, segment_height):
        crop = screenshot.crop((0, top, screenshot.width, min(top + segment_height, screenshot.height)))
        buffer = io.BytesIO()
        crop.save(buffer, format='JPEG', quality=SCREENSHOT_JPEG_QUALITY)
        segments.append((buffer.getvalue(), crop.width, crop.height))
    return segments


def add_screenshots(story, item, root):
    images = [a for a in (item.get('attachments') or []) if str(a.get('contentType', '')).startswith('image/')]
    label_id = item.get('id', '')
    for attachment in images:
        name = attachment.get('name', 'Screenshot')
        target = asset_path(root, attachment.get('path', ''))
        if not target:
            story.append(p(f"Screenshot could not be embedded ({name}): file is unavailable at {attachment.get('path', '')}.", 'badbox'))
            continue
        try:
            header = [back_link(), p(f'EVIDENCE / {label_id}', 'label'), p(item['title'], 'h2'), p(name + ' - image 999 of 999', 'small')]
            footer = [p(f"Original artifact: {attachment.get('path', '')}", 'small'), p('Screenshot evidence supports the recorded result; it does not by itself establish the root cause.', 'small')]
            text_height = sum(item_f.wrap(BODY_WIDTH, HEIGHT)[1] + item_f.getSpaceBefore() + item_f.getSpaceAfter() for item_f in header + footer)
            image_budget = max(100, HEIGHT - 70 - 54 - text_height - 35)
            segments = prepare_screenshot(target, min(BODY_WIDTH * 1.12, image_budget))
        except Exception:
            story.append(p(f"Screenshot could not be embedded: {name}. The original is available in the portal.", 'badbox'))
            continue
        if segments is None:
            story.append(p(f"The captured screenshot ({name}) contains no visible UI. Its original file remains available in the portal; it is not evidence of the asserted behavior.", 'badbox'))
            continue
        for index, (data, width, height) in enumerate(segments):
            draw_width = min(BODY_WIDTH, width)
            draw_height = draw_width * height / width
            story.extend([PageBreak(), back_link(), p(f'EVIDENCE / {label_id}', 'label'), p(item['title'], 'h2'),
                          p(f"{name} - image {index + 1} of {len(segments)}" if len(segments) > 1 else name, 'small'),
                          Spacer(1, 8), Screenshot(data, draw_width, draw_height), Spacer(1, 8),
                          p(f"Original artifact: {attachment.get('path', '')}", 'small'),
                          p('Screenshot evidence supports the recorded result; it does not by itself establish the root cause.', 'small')])




# ---------------------------------------------------------------------------
# Navigation helpers: bookmarks, outline, internal links, page registry
# ---------------------------------------------------------------------------
def key_for(prefix, value):
    return prefix + '_' + re.sub(r'[^A-Za-z0-9]+', '_', str(value)).strip('_')


class Dest(Flowable):
    """Zero-size marker: PDF destination + optional outline entry; records the page it lands on."""

    def __init__(self, key, title=None, level=0, pages=None):
        super().__init__()
        self.key, self.title, self.level, self.pages = key, title, level, pages

    def wrap(self, width, height):
        return 0, 0

    def draw(self):
        c = self.canv
        c.bookmarkPage(self.key)
        if self.title:
            c.addOutlineEntry(self.title, self.key, self.level, closed=0)
        if self.pages is not None:
            self.pages[self.key] = c.getPageNumber()


def link(key, text, color=PURPLE):
    return f'<a href="#{key}" color="{color.hexval()}">{text}</a>'


def back_link():
    return rich(f'<font size="7.5">{link("index", "&lt; Back to index")}</font>', 'small')


class StackedBar(Flowable):
    """One horizontal bar split into coloured segments, with a legend underneath."""

    def __init__(self, segments, caption=None):
        super().__init__()
        self.segments = [s for s in segments if s[1] > 0]
        self.total = sum(s[1] for s in self.segments)
        self.caption = caption

    def wrap(self, width, height):
        self.width = width
        self.cols = max(1, int(width // 120))
        rows = (len(self.segments) + self.cols - 1) // self.cols
        self.height = 30 + rows * 14 + (14 if self.caption else 0)
        return self.width, self.height

    def draw(self):
        c = self.canv
        top = self.height
        if self.caption:
            c.setFont(BOLD, 7)
            c.setFillColor(MUTED)
            c.drawString(0, top - 8, self.caption.upper())
            top -= 14
        if not self.total:
            c.setFont(FONT, 8)
            c.setFillColor(MUTED)
            c.drawString(0, top - 16, 'Nothing to chart.')
            return
        x, bar_y = 0, top - 20
        for _, count, color in self.segments:
            w = self.width * count / self.total
            c.setFillColor(color)
            c.rect(x, bar_y, w, 16, stroke=0, fill=1)
            if w > 16:
                c.setFillColor(WHITE)
                c.setFont(BOLD, 8)
                c.drawCentredString(x + w / 2, bar_y + 4.5, str(count))
            x += w
        col_w = self.width / self.cols
        for i, (label, count, color) in enumerate(self.segments):
            cx, cy = (i % self.cols) * col_w, bar_y - 16 - (i // self.cols) * 14
            c.setFillColor(color)
            c.rect(cx, cy, 8, 8, stroke=0, fill=1)
            c.setFillColor(INK)
            c.setFont(FONT, 8)
            c.drawString(cx + 13, cy + 0.5, f'{label}: {count}')


SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low', 'Not assessed', 'Not applicable']
SEVERITY_COLOR = {'Critical': colors.HexColor('#8F1D36'), 'High': RED, 'Medium': AMBER, 'Low': TEAL,
                  'Not assessed': MUTED, 'Not applicable': colors.HexColor('#B5BBCB')}
KIND_WHY = {
    'failure': 'The application did not behave as the requirement says. Users can hit this until it is fixed.',
    'assumption': 'The rule behind this check was assumed, not confirmed. The business must confirm what is correct before this counts as a defect.',
    'execution': 'The test could not finish, so the behaviour is unverified. It may be an environment or tooling problem, not an application defect.',
    'blocked': 'A missing dependency stopped this test. The behaviour is unverified until the blocker is cleared.',
}
KIND_BY_LABEL = {'Failed assertion': 'failure', 'Business rule review': 'assumption', 'Execution issue': 'execution', 'Blocked test': 'blocked'}
SECRET_KEY = re.compile(r'password|passwd|secret|token|authorization|cookie|session|api[-_]?key', re.I)


def duration_text(ms):
    if not ms:
        return None
    seconds = ms / 1000
    if seconds < 60:
        return f'{seconds:.1f} s'
    minutes, rest = divmod(int(round(seconds)), 60)
    return f'{minutes} min {rest} s' if minutes < 60 else f'{minutes // 60} h {minutes % 60} min'


def parse_time(value):
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return None


def wall_time_ms(run):
    for key in ('wallTimeMs', 'wallClockMs', 'durationMs'):
        if isinstance(run.get(key), (int, float)) and run[key] > 0:
            return run[key]
    start, end = parse_time(run.get('startedAt') or run.get('createdAt')), parse_time(run.get('finishedAt'))
    if start and end and end >= start:
        return (end - start).total_seconds() * 1000
    return None


def finding_kind(f):
    return f.get('kind') or KIND_BY_LABEL.get(f.get('classification'), 'failure')


def what_was_tested(item):
    parts = [clean(item.get('title', '')).rstrip('.') + '.']
    req = item.get('requirement')
    if req and req != 'Not linked':
        parts.append(f'It checks requirement {req}.')
    if item.get('variant'):
        parts.append(f"Form: {item['variant']}.")
    if item.get('preconditions'):
        parts.append(f"Starting condition: {item['preconditions']}")
    return ' '.join(parts)


def kv_table(rows, label_width=150):
    return table([[p(k, 'label'), p(v)] for k, v in rows], [label_width, BODY_WIDTH - label_width], compact=True)


def cut(value, limit=700):
    value = str(value)
    return value if len(value) <= limit else value[:limit] + ' ... (shortened; full value is in the portal)'


def input_table(values):
    rows = [[p('FIELD', 'label'), p('VALUE', 'label')]]
    for row in values:
        value = '[REDACTED]' if SECRET_KEY.search(str(row['key'])) else row['value']
        rows.append([p(row['key'], 'small'), p(cut(value), 'small')])
    return table(rows, [150, BODY_WIDTH - 150], header=True, compact=True)


def section_map(story, title, values):
    if values:
        story.extend([CondPageBreak(90), p(title, 'h3t'), input_table(values)])


def steps_block(story, steps, note=None):
    story.append(p('Steps run', 'h3'))
    if note:
        story.append(p(note, 'small'))
    for i, step in enumerate(steps):
        story.append(rich(f'<b>{i + 1}. {escape(clean(step["action"]))}</b><br/><font color="#747D94">Expect: {escape(clean(step["expected"]))}</font>', 'body'))


def case_detail(story, f, root, finding=False):
    """Shared layout for a finding or a passed/observed case."""
    meta = [('Case / suite', f"{f.get('caseId') or f['id']} / {f.get('suite', 'General')}"),
            ('Requirement', f.get('requirement') or 'Not linked'),
            ('Priority', f.get('priority', 'Not set'))]
    if finding:
        meta.append(('Severity', f.get('severity', 'Not assessed')))
    meta.append(('Result', f.get('classification') if finding else f.get('status', '')))
    meta.append(('Run time', duration_text(f.get('durationMs')) or 'Not captured'))
    story.append(kv_table(meta))
    story.extend([p('What was tested', 'h3'), p(what_was_tested(f))])
    steps_block(story, f.get('steps') or [], 'From the case definition. A failed run may have stopped before the last step.' if finding else None)
    section_map(story, 'Inputs used', f.get('input') or [])
    if f.get('inputSource'):
        story.append(p(f['inputSource'], 'small'))
    story.extend([p('Expected', 'h3'), p(f.get('expected', ''), 'box'), p('Actual', 'h3'), p(f.get('actual', ''), 'badbox' if finding else 'box')])
    if f.get('mismatches'):
        story.append(p('What did not match', 'h3'))
        story.extend(p(f'{i + 1}. {value}') for i, value in enumerate(f['mismatches']))
    section_map(story, 'Configured checks', f.get('checks') or [])
    section_map(story, 'Values seen on screen', f.get('observedValues') or [])
    section_map(story, 'Field errors seen', f.get('fieldErrors') or [])
    if f.get('toasts'):
        story.extend([p('Messages shown', 'h3'), *[p(v) for v in f['toasts']]])
    if finding:
        impact = f.get('impact')
        why = KIND_WHY[finding_kind(f)] + (f' Team assessment: {impact}' if impact and impact != 'Not assessed' else '')
        story.extend([p('Why it matters', 'h3'), p(why)])
        story.extend([p('Triage', 'h3'), kv_table([('Severity', f.get('severity', 'Not assessed')), ('Owner', f.get('owner', 'Unassigned')),
                                                  ('Ticket', f.get('reference', 'Not linked')), ('Notes', f.get('triageNotes') or 'None recorded')])])
        if f.get('classificationNote'):
            story.append(p(f['classificationNote'], 'small'))
    add_evidence_inventory(story, f)
    add_screenshots(story, f, root)


def outcome_segments(counts):
    return [('Passed', counts.get('passed', 0), TEAL), ('Failed', counts.get('failed', 0), RED), ('Rule review', counts.get('assumptions', 0), AMBER),
            ('Execution issue', counts.get('errors', 0), PURPLE), ('Blocked', counts.get('blocked', 0), colors.HexColor('#4B5470')),
            ('Observed', counts.get('observed', 0), colors.HexColor('#5B8DB8')), ('Skipped', counts.get('skipped', 0), colors.HexColor('#B5BBCB')),
            ('Not executed', counts.get('unexecuted', 0), colors.HexColor('#D6DAE6'))]


def severity_segments(findings):
    tally = {}
    for f in findings:
        s = f.get('severity', 'Not assessed')
        tally[s] = tally.get(s, 0) + 1
    ordered = [s for s in SEVERITY_ORDER if s in tally] + sorted(s for s in tally if s not in SEVERITY_ORDER)
    return [(s, tally[s], SEVERITY_COLOR.get(s, MUTED)) for s in ordered]


def build_story(model, root, prev, pages):
    """prev: page numbers from the previous layout pass (for the index); pages: filled by Dest markers in this pass."""
    run, counts = model['run'], model['counts']
    findings, cases = model.get('findings') or [], model.get('cases') or []
    pg = lambda key: str(prev.get(key, '00'))
    ev = model.get('evidenceCounts') or {
        'executed': sum(1 for c in cases if c.get('executed')),
        'withScreenshots': sum(1 for c in cases if c.get('executed') and c.get('screenshotCount', 0) > 0),
        'missingScreenshots': sum(1 for c in cases if c.get('executed') and c.get('screenshotCount', 0) == 0),
        'warnings': sum(1 for c in cases if c.get('executed') and c.get('evidenceWarnings')),
        'totalScreenshots': sum(c.get('screenshotCount', 0) for c in cases if c.get('executed')),
    }
    non_finding = [c for c in cases if c.get('executed') and not c.get('inFindings')]
    case_target = {c['id']: key_for('finding', f['id']) for f in findings for c in cases if c['id'] == f.get('caseId')}
    case_target.update({c['id']: key_for('case', c['id']) for c in non_finding})

    # --- Page 1: cover + summary
    story = [Dest('summary', 'Summary', 0, pages), Hero(model), Spacer(1, 16), metric_grid(counts), Spacer(1, 12)]
    executed = ev['executed']
    story.append(p('At a glance', 'h2'))
    lines = [f"{counts.get('passed', 0)} of {executed} executed cases passed." if executed else 'No cases were executed.',
             f"{len(findings)} finding(s) need attention." if findings else 'No findings were recorded.',
             f"{counts.get('unexecuted', 0)} case(s) were not executed." if counts.get('unexecuted') else None]
    story.append(p(' '.join(x for x in lines if x), 'body'))
    story.append(StackedBar(outcome_segments(counts), f"Outcome of {counts['total']} selected cases"))
    if findings:
        story += [Spacer(1, 6), StackedBar(severity_segments(findings), f'{len(findings)} finding(s) by severity')]
    story.append(p('Run details', 'h2'))
    case_time = duration_text(sum((c.get('durationMs') or 0) for c in cases))
    details = [('Module', f"{run['module']} / {run['area']}"), ('Environment', f"{run['environment']} - {run['url']}"),
               ('Release / build', f"{model['release']} / {model['build']}"), ('Tester', model['preparedBy']),
               ('Run', f"{run['name']} ({run['mode'].capitalize()}, {run['status'].upper()})"),
               ('Started', timestamp(run.get('startedAt') or run.get('createdAt'))), ('Finished', timestamp(run.get('finishedAt'))),
               ('Wall time', duration_text(wall_time_ms(run)) or 'Not recorded')]
    if run.get('productName'):
        details.insert(0, ('Product', run['productName']))
    if run.get('workers'):
        details.append(('Parallel workers', str(run['workers'])))
    if case_time:
        details.append(('Total case time', case_time))
    story.append(kv_table(details, 110))
    if model.get('notes'):
        story.extend([p('Review notes', 'h3'), p(model['notes'])])
    if run.get('error'):
        story.extend([p('Run stopped early or had an error', 'h3'), p(run['error'], 'badbox')])

    # --- Index (table of contents)
    story += [PageBreak(), Dest('index', 'Index', 0, pages), p('CONTENTS', 'label'), p('Index', 'h1'),
              p('Select any entry to jump to its page. Every page has a link back to this index.', 'small')]
    toc = [[p('SECTION', 'label'), p('PAGE', 'label')],
           [rich(link('summary', 'Summary and run details'), 'small'), rich(link('summary', pg('summary')), 'small')]]
    story.append(table(toc, [BODY_WIDTH - 44, 44], header=True, compact=True))
    story.append(p(f'Findings ({len(findings)})', 'h2'))
    if findings:
        rows = [[p('ID', 'label'), p('FINDING', 'label'), p('SEVERITY', 'label'), p('PAGE', 'label')]]
        for f in findings:
            k = key_for('finding', f['id'])
            rows.append([rich(link(k, escape(f['id'])), 'small'),
                         rich(link(k, escape(clean(f['title']))) + f'<br/><font color="#747D94" size="7">{escape(f["classification"])}</font>', 'small'),
                         p(f.get('severity', 'Not assessed'), 'small'), rich(link(k, pg(k)), 'small')])
        story.append(table(rows, [118, BODY_WIDTH - 118 - 78 - 44, 78, 44], header=True, compact=True))
    else:
        story.append(p('No findings were recorded in this run.', 'box'))
    other = [[p('OTHER SECTIONS', 'label'), p('PAGE', 'label')]]
    if non_finding:
        other.append([rich(link('passed', f'Passed and observed cases ({len(non_finding)})'), 'small'), rich(link('passed', pg('passed')), 'small')])
    other.append([rich(link('appendix', f'Appendix: all {len(cases)} selected cases'), 'small'), rich(link('appendix', pg('appendix')), 'small')])
    story += [Spacer(1, 12), table(other, [BODY_WIDTH - 44, 44], header=True, compact=True)]

    story += [Spacer(1, 10), p('About this report', 'h3')]
    story.append(p(f"Screenshots: {ev['withScreenshots']} of {executed} executed case(s) have one ({ev['totalScreenshots']} in total). {ev['missingScreenshots']} without a screenshot, {ev['warnings']} with a capture warning.", 'small'))
    scope = run.get('scope')
    if scope:
        story.append(p(f"Scope: {scope['plannedCases']} cases selected from {scope['enabledCases']} enabled ({scope['repositoryCases']} defined). {scope['disabledCases']} disabled cases were outside this run.", 'small'))
    else:
        story.append(p('Scope: the selected cases listed in the appendix. The full case count was not captured for this run.', 'small'))
    story.append(p(model.get('scopeNote', ''), 'small'))
    if model.get('assumedCases'):
        story.append(p(f"{model['assumedCases']} selected case(s) use assumed business rules. A pass does not confirm those rules.", 'small'))

    # --- Findings
    for n, f in enumerate(findings):
        k = key_for('finding', f['id'])
        story.append(PageBreak())
        if n == 0:
            story.append(Dest('findings', 'Findings', 0, pages))
        story += [Dest(k, f"{f['id']} - {clean(f['title'])[:80]}", 1, pages), back_link(),
                  p(f"{f['id']} / {f['classification'].upper()}", 'label'), p(f['title'], 'h1')]
        case_detail(story, f, root, finding=True)

    # --- Passed / observed evidence
    if non_finding:
        story += [PageBreak(), Dest('passed', 'Passed and observed cases', 0, pages), back_link(), p('EXECUTED CASES / PASSED & OBSERVED', 'label'),
                  p('Passed and observed cases', 'h1'),
                  p('Executed cases outside the findings. Each shows what ran, the inputs, expected and actual results and screenshot status.', 'small')]
        for c in non_finding:
            story += [CondPageBreak(260), Dest(key_for('case', c['id']), f"{c['id']} - {clean(c['title'])[:80]}", 1, pages), Spacer(1, 10), back_link(),
                      p(f"{c['id']} / {c['status']}", 'label'), p(c['title'], 'h2')]
            case_detail(story, c, root)

    # --- Appendix
    story += [PageBreak(), Dest('appendix', 'Appendix: all cases', 0, pages), back_link(), p('APPENDIX / ALL SELECTED CASES', 'label'), p('All cases', 'h1'),
              p('Every selected case with its result and screenshot status. Not-executed, skipped and observation-only cases are not passes. Case IDs link to the detail page where one exists.', 'small'),
              p(f"Full run reference: {run['id']}", 'small')]
    rows = [[p('CASE / REQUIREMENT', 'label'), p('TEST CASE', 'label'), p('RESULT', 'label'), p('EVIDENCE', 'label')]]
    for c in cases:
        evidence_text = c.get('evidenceSummary') or ('Captured' if c.get('screenshotCount', 0) > 0 else 'Screenshot could not be captured' if c.get('executed') else 'Not executed')
        target = case_target.get(c['id'])
        ident = (link(target, escape(c['id'])) if target else escape(c['id'])) + (f'<br/>{escape(clean(c["requirement"]))}' if c.get('requirement') else '')
        rows.append([rich(ident, 'small'), p(c['title']), p(c['status'], 'small'), p(evidence_text, 'small')])
    story.append(table(rows, [96, BODY_WIDTH - 296, 88, 112], header=True))
    return story


def render(model, output, root):
    output.parent.mkdir(parents=True, exist_ok=True)
    run = model['run']
    generated_at = timestamp(datetime.now(timezone.utc).isoformat())
    state = {'total': None}

    def chrome(canvas, document):
        canvas.saveState()
        canvas.setFillColor(PURPLE)
        canvas.roundRect(MARGIN, HEIGHT - 43, 17, 17, 5, stroke=0, fill=1)
        canvas.setStrokeColor(WHITE)
        canvas.setLineWidth(1.4)
        canvas.line(MARGIN + 4, HEIGHT - 35, MARGIN + 7, HEIGHT - 38)
        canvas.line(MARGIN + 7, HEIGHT - 38, MARGIN + 13, HEIGHT - 31)
        canvas.setFillColor(INK)
        canvas.setFont(BOLD, 9)
        canvas.drawString(MARGIN + 25, HEIGHT - 37, 'AUGASTAM')
        canvas.setFont(FONT, 7)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(WIDTH - MARGIN, HEIGHT - 37, 'TEST STUDIO / BUG & TEST REPORT')
        canvas.setStrokeColor(LINE)
        canvas.line(MARGIN, 40, WIDTH - MARGIN, 40)
        canvas.setFont(FONT, 6.5)
        canvas.drawString(MARGIN, 26, f"Internal - run {run['id'][:8]} - generated {generated_at}")
        label = f"Page {document.page}" + (f" of {state['total']}" if state['total'] else '')
        canvas.drawRightString(WIDTH - MARGIN, 26, label)
        if document.page > 1:
            right = WIDTH - MARGIN - pdfmetrics.stringWidth(label, FONT, 6.5) - 14
            left = right - pdfmetrics.stringWidth('Back to index', FONT, 6.5)
            canvas.setFillColor(PURPLE)
            canvas.drawRightString(right, 26, 'Back to index')
            canvas.linkRect('', 'index', (left, 22, right, 34), relative=0, thickness=0)
        if document.page == 1:
            canvas.showOutline()
        canvas.restoreState()

    def build(target, prev, pages):
        doc = SimpleDocTemplate(target, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=70, bottomMargin=54,
                                title=model['title'], author=model['preparedBy'], subject='Test findings, execution scope and reproduction evidence', pageCompression=1)
        doc.build(build_story(model, root, prev, pages), onFirstPage=chrome, onLaterPages=chrome)
        return doc.page

    # Layout passes find the index page numbers and the page total. They lay out every page but skip
    # drawing screenshots and write to memory; the final pass writes the file with the same layout.
    prev = {}
    Screenshot.draw_images = False
    try:
        for _ in range(4):
            pages = {}
            total = build(io.BytesIO(), prev, pages)
            # Stable when the index already showed the right page numbers and total.
            if pages == prev and state['total'] == total:
                break
            prev, state['total'] = pages, total
    finally:
        Screenshot.draw_images = True
    build(str(output), prev, {})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--assets-dir', required=True)
    arguments = parser.parse_args()
    render(json.loads(__import__('sys').stdin.buffer.read().decode('utf-8')), Path(arguments.output), Path(arguments.assets_dir))
