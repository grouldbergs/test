// Port of TinyDays template 03 and its approved divider at 4dbeac2.
import { initWasm, Resvg } from './month-age-assets/resvg.mjs';
const DIVIDER_SOURCE_START_X = 247;
const DIVIDER_SOURCE_END_X = 966;
const DIVIDER_SOURCE_BASELINE_Y = 292;
export function template01DividerSvg(startX, endX, baselineY, strokeWidth = 12) {
    const tailScale = strokeWidth / 12;
    const tailPath = `<path d="M 919 280 C 933 281, 949 286, 962 291 C 966 293, 966 295, 962 296 C 949 292, 933 290, 919 292 Z" fill="${BROWN}"/>`;
    // The original tail joins the source curve at y=286. When a consumer uses
    // a heavier stroke, scale only this approved path around that join so the
    // broad line resolves into the same fine hand-drawn tip instead of a seam.
    const scaledTail = tailScale === 1
        ? tailPath
        : `<g data-divider-tail-scale="${tailScale}" transform="translate(0 ${286 * (1 - tailScale)}) scale(1 ${tailScale})">${tailPath}</g>`;
    const sourcePaths = `<path d="M 247 292 C 370 258, 680 258, 925 286" fill="none" stroke="${BROWN}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
  ${scaledTail}`;
    // Preserve Template 01's rendered SVG verbatim at its approved coordinates.
    if (startX === DIVIDER_SOURCE_START_X && endX === DIVIDER_SOURCE_END_X && baselineY === DIVIDER_SOURCE_BASELINE_Y) {
        return sourcePaths;
    }
    const scaleX = (endX - startX) / (DIVIDER_SOURCE_END_X - DIVIDER_SOURCE_START_X);
    const translateX = startX - DIVIDER_SOURCE_START_X * scaleX;
    const translateY = baselineY - DIVIDER_SOURCE_BASELINE_Y;
    return `<g data-divider-source="template-01" transform="translate(${translateX} ${translateY}) scale(${scaleX} 1)">
    ${sourcePaths}
  </g>`;
}
const CANVAS_WIDTH = 2200;
const CANVAS_HEIGHT = 1150;
const BROWN = '#483A3A';
const WHITE = '#ffffff';
const HEADLINE_FONT_SIZE = 500;
const NUMBER_BASELINE = 575;
const UNIT_TOP = 195;
const UNIT_HEIGHT = 420;
const YEAR_FACE_HEIGHT = 400;
const YEAR_FACE_HORIZONTAL_SCALE = 0.92;
const YEAR_SOURCE_WIDTH = 1254;
const YEAR_SOURCE_HEIGHT = 1254;
const YEAR_SOURCE_LEFT = 190;
const YEAR_SOURCE_TOP = 127;
const YEAR_SOURCE_WIDTH_VISIBLE = 930;
const YEAR_SOURCE_HEIGHT_VISIBLE = 1064;
const YEAR_TOP = UNIT_TOP + UNIT_HEIGHT - YEAR_FACE_HEIGHT;
const YEAR_WIDTH = YEAR_FACE_HEIGHT
    * (YEAR_SOURCE_WIDTH_VISIBLE / YEAR_SOURCE_HEIGHT_VISIBLE)
    * YEAR_FACE_HORIZONTAL_SCALE;
// The cropped transparent asset's antialiased outer pixels sit asymmetrically
// inside its source viewBox; this keeps the rendered 1岁 face group centred.
const YEAR_ONLY_CENTERING_NUDGE = 13;
const DATE_FONT_SIZE = 300;
const DATE_BASELINE = 980;
const UNDERLINE_Y = 710;
const RIGHT_SAFETY_MARGIN = 56;
const HEADLINE_SHADOW_DX = 10;
const HEADLINE_SHADOW_DY = 12;
const HEADLINE_SHADOW_STD_DEVIATION = 4;
const DATE_SHADOW_DX = 10;
const DATE_SHADOW_DY = 12;
const DATE_SHADOW_STD_DEVIATION = 4;
const DATE_SHADOW_BASE_OPACITY = 0.95;
const DIVIDER_STROKE_WIDTH = 24;
// Resvg's raw bbox describes source geometry, not the visual filter extent.
const SHADOW_BLUR_EXTENT = Math.max(HEADLINE_SHADOW_STD_DEVIATION, DATE_SHADOW_STD_DEVIATION) * 7;
const CROP_EDGE_PADDING = 8;
const CROP_HORIZONTAL_PADDING = SHADOW_BLUR_EXTENT + Math.max(HEADLINE_SHADOW_DX, DATE_SHADOW_DX) + 2 + CROP_EDGE_PADDING;
const CROP_VERTICAL_PADDING = SHADOW_BLUR_EXTENT + Math.max(HEADLINE_SHADOW_DY, DATE_SHADOW_DY) + 2 + CROP_EDGE_PADDING;
const HEADLINE_MEASUREMENT_PADDING = 100;
const NUMBER_REFERENCE_X = 200;
const NUMBER_REFERENCE_Y = 650;
const geAspectRatio = 333 / 358;
const monthAspectRatio = 216 / 368;
const dayAspectRatio = 328 / 343;
let fontBytes;
let glyphData;
let yearGlyphData;
async function loadAsset(name) {
    const response = await fetch(new URL('./month-age-assets/' + name, import.meta.url));
    if (!response.ok)
        throw new Error('无法加载月龄印章素材');
    return response.arrayBuffer();
}
async function loadGlyph(name) {
    const bytes = new Uint8Array(await loadAsset(name));
    let binary = '';
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return 'data:image/png;base64,' + btoa(binary);
}
let ready;
async function loadRenderer() {
    const [wasm, font, ge, month, day, year] = await Promise.all([
        loadAsset('resvg.wasm'),
        loadAsset('Kalam-Regular.ttf'),
        loadGlyph('unit-ge-face-only-v1.png'),
        loadGlyph('unit-month-face-only-v1.png'),
        loadGlyph('unit-day-face-only-v1.png'),
        loadGlyph('unit-year-face-only-v2.png'),
    ]);
    await initWasm(wasm);
    fontBytes = new Uint8Array(font);
    glyphData = { ge, month, day };
    yearGlyphData = year;
}
const numberBoundsCache = new Map();
const glyphBoundsCache = new Map();
const headlineInkBoundsCache = new Map();
function escapeXml(value) {
    return value.replace(/[<>&'"]/g, (character) => {
        const entities = {
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            "'": '&apos;',
            '"': '&quot;',
        };
        return entities[character];
    });
}
function createRenderer(svg) {
    return new Resvg(svg, {
        font: { fontBuffers: [fontBytes], defaultFontFamily: 'Kalam' },
        fitTo: { mode: 'original' },
    });
}
function alphaBounds(svg, originX = 0) {
    const renderer = createRenderer(svg);
    const image = renderer.render();
    const { pixels, width, height } = image;
    let left = width;
    let right = -1;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (pixels[(y * width + x) * 4 + 3] >= 1) {
                left = Math.min(left, x);
                right = Math.max(right, x);
            }
        }
    }
    image.free();
    renderer.free();
    if (right < left)
        throw new Error('Template 03 measurement has no visible ink.');
    return { left: left + originX, right: right + originX };
}
/** Returns Kalam’s actual rendered face bounds relative to its text x anchor. */
function measureKalamNumber(value) {
    const cached = numberBoundsCache.get(value);
    if (cached)
        return cached;
    // This canvas is deliberately derived from the complete numeric string. It
    // is only a measuring surface (never a layout estimate), so long values do
    // not silently hit an arbitrary right edge before Resvg reports their ink.
    const measurementWidth = NUMBER_REFERENCE_X * 2 + String(value).length * HEADLINE_FONT_SIZE * 1.5;
    const bounds = alphaBounds(`<svg xmlns="http://www.w3.org/2000/svg" width="${measurementWidth}" height="900" viewBox="0 0 ${measurementWidth} 900">
      <text x="${NUMBER_REFERENCE_X}" y="${NUMBER_REFERENCE_Y}" font-family="Kalam" font-weight="400" font-size="${HEADLINE_FONT_SIZE}" fill="${WHITE}">${value}</text>
    </svg>`);
    const measured = {
        left: bounds.left - NUMBER_REFERENCE_X,
        right: bounds.right - NUMBER_REFERENCE_X,
    };
    numberBoundsCache.set(value, measured);
    return measured;
}
/** Returns a transparent unit asset’s actual face bounds relative to image x. */
function measureGlyph(name, width) {
    const cacheKey = `${name}:${width}`;
    const cached = glyphBoundsCache.get(cacheKey);
    if (cached)
        return cached;
    const referenceX = 700;
    const bounds = alphaBounds(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1150" viewBox="0 0 1600 1150">
      <image href="${glyphData[name]}" x="${referenceX}" y="${UNIT_TOP}" width="${width}" height="${UNIT_HEIGHT}" preserveAspectRatio="xMidYMid meet"/>
    </svg>`);
    const measured = {
        left: bounds.left - referenceX,
        right: bounds.right - referenceX,
    };
    glyphBoundsCache.set(cacheKey, measured);
    return measured;
}
function yearUnitMarkup(x) {
    return `<svg id="unit-year" x="${x}" y="${YEAR_TOP}" width="${YEAR_WIDTH}" height="${YEAR_FACE_HEIGHT}" viewBox="${YEAR_SOURCE_LEFT} ${YEAR_SOURCE_TOP} ${YEAR_SOURCE_WIDTH_VISIBLE} ${YEAR_SOURCE_HEIGHT_VISIBLE}" preserveAspectRatio="none"><image href="${yearGlyphData}" x="0" y="0" width="${YEAR_SOURCE_WIDTH}" height="${YEAR_SOURCE_HEIGHT}"/></svg>`;
}
/** Returns the approved 岁 asset's actual rendered face bounds. */
function measureYearGlyph() {
    const cacheKey = 'year';
    const cached = glyphBoundsCache.get(cacheKey);
    if (cached)
        return cached;
    const referenceX = 700;
    const bounds = alphaBounds(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1150" viewBox="0 0 1600 1150">
      ${yearUnitMarkup(referenceX)}
    </svg>`);
    const measured = {
        left: bounds.left - referenceX,
        right: bounds.right - referenceX,
    };
    glyphBoundsCache.set(cacheKey, measured);
    return measured;
}
function defsSvg() {
    return `<defs>
    <filter id="date-shadow" x="-20%" y="-20%" width="160%" height="180%">
      <feDropShadow dx="${DATE_SHADOW_DX}" dy="${DATE_SHADOW_DY}" stdDeviation="${DATE_SHADOW_STD_DEVIATION}" flood-color="${BROWN}" flood-opacity="0.4"/>
      <feDropShadow dx="${DATE_SHADOW_DX}" dy="${DATE_SHADOW_DY}" stdDeviation="1" flood-color="${BROWN}" flood-opacity="0.7"/>
      <feDropShadow dx="${DATE_SHADOW_DX}" dy="${DATE_SHADOW_DY}" stdDeviation="0" flood-color="${BROWN}" flood-opacity="${DATE_SHADOW_BASE_OPACITY}"/>
    </filter>
    <filter id="headline-shadow" x="-20%" y="-20%" width="160%" height="180%">
      <feDropShadow dx="10" dy="12" stdDeviation="4" flood-color="${BROWN}" flood-opacity="0.4"/>
      <feDropShadow dx="10" dy="12" stdDeviation="1" flood-color="${BROWN}" flood-opacity="0.7"/>
      <feDropShadow dx="10" dy="12" stdDeviation="0" flood-color="${BROWN}" flood-opacity="0.95"/>
    </filter>
    <filter id="headline-glyph-shadow" x="-20%" y="-20%" width="160%" height="180%">
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0" result="white-face"/>
      <feDropShadow in="white-face" dx="10" dy="12" stdDeviation="4" flood-color="${BROWN}" flood-opacity="0.4"/>
      <feDropShadow dx="10" dy="12" stdDeviation="1" flood-color="${BROWN}" flood-opacity="0.7"/>
      <feDropShadow dx="10" dy="12" stdDeviation="0" flood-color="${BROWN}" flood-opacity="0.95"/>
    </filter>
  </defs>`;
}
function headlineMarkup(content, layout, translateX = 0) {
    const geWidth = UNIT_HEIGHT * geAspectRatio;
    const monthWidth = UNIT_HEIGHT * monthAspectRatio;
    const dayWidth = UNIT_HEIGHT * dayAspectRatio;
    const yearNumber = layout.yearNumberX === undefined
        ? ''
        : `<text x="${layout.yearNumberX}" y="${NUMBER_BASELINE}" font-size="${HEADLINE_FONT_SIZE}" fill="${WHITE}">${content.years}</text>`;
    const monthNumber = layout.monthNumberX === undefined
        ? ''
        : `<text x="${layout.monthNumberX}" y="${NUMBER_BASELINE}" font-size="${HEADLINE_FONT_SIZE}" fill="${WHITE}">${content.months}</text>`;
    const dayNumber = layout.dayNumberX === undefined
        ? ''
        : `<text x="${layout.dayNumberX}" y="${NUMBER_BASELINE}" font-size="${HEADLINE_FONT_SIZE}" fill="${WHITE}">${content.days}</text>`;
    const dayUnit = layout.dayX === undefined
        ? ''
        : `<image id="unit-day" href="${glyphData.day}" x="${layout.dayX}" y="${UNIT_TOP}" width="${dayWidth}" height="${UNIT_HEIGHT}" preserveAspectRatio="xMidYMid meet"/>`;
    const geUnit = layout.geX === undefined
        ? ''
        : `<image id="unit-ge" href="${glyphData.ge}" x="${layout.geX}" y="${UNIT_TOP}" width="${geWidth}" height="${UNIT_HEIGHT}" preserveAspectRatio="xMidYMid meet"/>`;
    const monthUnit = layout.monthX === undefined
        ? ''
        : `<image id="unit-month" href="${glyphData.month}" x="${layout.monthX}" y="${UNIT_TOP}" width="${monthWidth}" height="${UNIT_HEIGHT}" preserveAspectRatio="xMidYMid meet"/>`;
    const yearUnit = layout.yearX === undefined
        ? ''
        : yearUnitMarkup(layout.yearX);
    return `<g data-layout="${layout.branch}" transform="translate(${translateX} 0)">
    <g font-family="Kalam" font-weight="400" filter="url(#headline-shadow)">
      ${yearNumber}
      ${monthNumber}
      ${dayNumber}
    </g>
    <g filter="url(#headline-glyph-shadow)">
      ${yearUnit}
      ${geUnit}
      ${monthUnit}
      ${dayUnit}
    </g>
  </g>`;
}
function planHeadline(content) {
    const geWidth = UNIT_HEIGHT * geAspectRatio;
    const monthWidth = UNIT_HEIGHT * monthAspectRatio;
    const dayWidth = UNIT_HEIGHT * dayAspectRatio;
    const geBounds = measureGlyph('ge', geWidth);
    const monthBounds = measureGlyph('month', monthWidth);
    const dayBounds = measureGlyph('day', dayWidth);
    if ((content.years ?? 0) > 0) {
        const yearBounds = measureYearGlyph();
        const yearNumber = measureKalamNumber(content.years);
        const yearX = 0;
        const yearNumberX = yearX + yearBounds.left - 80 - yearNumber.right;
        if (content.months === 0) {
            const faceLeft = Math.min(yearNumberX + yearNumber.left, yearX + yearBounds.left);
            const faceRight = yearX + yearBounds.right;
            const shift = CANVAS_WIDTH / 2 - (faceLeft + faceRight) / 2 + YEAR_ONLY_CENTERING_NUDGE;
            return {
                branch: 'year-only',
                yearNumberX: yearNumberX + shift,
                yearX: yearX + shift,
                headlineLeft: faceLeft + shift,
                headlineRight: faceRight + shift,
            };
        }
        const monthNumber = measureKalamNumber(content.months);
        const monthNumberX = yearX + yearBounds.right + 70 - monthNumber.left;
        const geX = monthNumberX + monthNumber.right + 42 - geBounds.left;
        const monthX = geX + geBounds.right + 40 - monthBounds.left;
        const faceLeft = Math.min(yearNumberX + yearNumber.left, yearX + yearBounds.left, monthNumberX + monthNumber.left);
        const faceRight = Math.max(yearX + yearBounds.right, geX + geBounds.right, monthX + monthBounds.right);
        const shift = CANVAS_WIDTH / 2 - (faceLeft + faceRight) / 2;
        return {
            branch: 'year-and-month',
            yearNumberX: yearNumberX + shift,
            yearX: yearX + shift,
            monthNumberX: monthNumberX + shift,
            geX: geX + shift,
            monthX: monthX + shift,
            headlineLeft: faceLeft + shift,
            headlineRight: faceRight + shift,
        };
    }
    if (content.months === 0) {
        const dayNumber = measureKalamNumber(content.days);
        const dayX = 0;
        const dayNumberX = dayX + dayBounds.left - 80 - dayNumber.right;
        const faceLeft = Math.min(dayNumberX + dayNumber.left, dayX + dayBounds.left);
        const faceRight = Math.max(dayNumberX + dayNumber.right, dayX + dayBounds.right);
        const shift = CANVAS_WIDTH / 2 - (faceLeft + faceRight) / 2;
        return {
            branch: 'day-only',
            dayNumberX: dayNumberX + shift,
            dayX: dayX + shift,
            headlineLeft: faceLeft + shift,
            headlineRight: faceRight + shift,
        };
    }
    const monthNumber = measureKalamNumber(content.months);
    if (content.days === 0) {
        const geX = 0;
        const monthX = geX + geBounds.right + 40 - monthBounds.left;
        const monthNumberX = geX + geBounds.left - 42 - monthNumber.right;
        const faceLeft = Math.min(monthNumberX + monthNumber.left, geX + geBounds.left, monthX + monthBounds.left);
        const faceRight = Math.max(monthNumberX + monthNumber.right, geX + geBounds.right, monthX + monthBounds.right);
        const shift = CANVAS_WIDTH / 2 - (faceLeft + faceRight) / 2;
        return {
            branch: 'month-only',
            monthNumberX: monthNumberX + shift,
            geX: geX + shift,
            monthX: monthX + shift,
            headlineLeft: faceLeft + shift,
            headlineRight: faceRight + shift,
        };
    }
    const dayNumber = measureKalamNumber(content.days);
    // Fixed unit anchors by day digit count; all relationships use face bounds.
    const geVisibleLeft = String(content.days).length === 1 ? 760 : 700;
    const geX = geVisibleLeft - geBounds.left;
    const monthX = geX + geBounds.right + 40 - monthBounds.left;
    const monthNumberX = geX + geBounds.left - 42 - monthNumber.right;
    const dayNumberX = monthX + monthBounds.right + 70 - dayNumber.left;
    const dayX = dayNumberX + dayNumber.right + 80 - dayBounds.left;
    const faceLeft = Math.min(monthNumberX + monthNumber.left, geX + geBounds.left);
    const faceRight = Math.max(dayX + dayBounds.right, dayNumberX + dayNumber.right);
    return {
        branch: 'month-and-day', monthNumberX, dayNumberX, geX, monthX, dayX,
        headlineLeft: faceLeft, headlineRight: faceRight,
    };
}
function measureHeadlineInk(content, layout) {
    const cacheKey = `${content.years ?? 0}:${content.months}:${content.days}`;
    const cached = headlineInkBoundsCache.get(cacheKey);
    if (cached)
        return cached;
    const originX = Math.floor(layout.headlineLeft - HEADLINE_MEASUREMENT_PADDING);
    const rightEdge = Math.ceil(layout.headlineRight + HEADLINE_MEASUREMENT_PADDING);
    const width = rightEdge - originX;
    const measured = alphaBounds(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CANVAS_HEIGHT}" viewBox="${originX} 0 ${width} ${CANVAS_HEIGHT}">
      ${defsSvg()}
      ${headlineMarkup(content, layout)}
    </svg>`, originX);
    headlineInkBoundsCache.set(cacheKey, measured);
    return measured;
}
export function template03Svg(content, layoutName = 'number-emphasis') {
    void layoutName;
    const layout = planHeadline(content);
    const headlineInk = measureHeadlineInk(content, layout);
    const headlineTranslateX = Math.min(0, CANVAS_WIDTH - RIGHT_SAFETY_MARGIN - headlineInk.right);
    const headlineLeft = layout.headlineLeft + headlineTranslateX;
    const headlineRight = layout.headlineRight + headlineTranslateX;
    const underlineLeft = headlineLeft + 10;
    const underlineRight = headlineRight - 10;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}">
  ${defsSvg()}
  ${headlineMarkup(content, layout, headlineTranslateX)}
  <g font-family="Kalam" font-weight="400" filter="url(#date-shadow)">
    <text x="1100" y="${DATE_BASELINE}" font-size="${DATE_FONT_SIZE}" fill="${WHITE}" text-anchor="middle">${escapeXml(content.dateText)}</text>
  </g>
  ${template01DividerSvg(underlineLeft, underlineRight, UNDERLINE_Y, DIVIDER_STROKE_WIDTH)}
</svg>`;
}
export async function renderTemplate03(content) {
    ready ??= loadRenderer().catch(error => {
        ready = undefined;
        throw error;
    });
    await ready;
    const renderer = createRenderer(template03Svg(content));
    try {
        const bounds = renderer.getBBox();
        if (!bounds)
            throw new Error('月龄印章没有可见内容');
        try {
            bounds.x -= CROP_HORIZONTAL_PADDING;
            bounds.y -= CROP_VERTICAL_PADDING;
            bounds.width += CROP_HORIZONTAL_PADDING * 2;
            bounds.height += CROP_VERTICAL_PADDING * 2;
            renderer.cropByBBox(bounds);
            const image = renderer.render();
            try {
                return image.asPng().slice();
            }
            finally {
                image.free();
            }
        }
        finally {
            bounds.free();
        }
    }
    finally {
        renderer.free();
    }
}
