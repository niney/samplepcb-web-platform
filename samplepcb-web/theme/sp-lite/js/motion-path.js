// 원본 윤곽(Figma Vector) 연속 변형 모듈 — spcb/previews/login-bg-claude/motion-path.js 의 2026-09-06 스냅샷.
// 홈 히어로(theme/sp-lite/js/home.js)가 center-swap(연속 회전) 만 쓴다. 프리셋 실험은 프로빙 폴더에서.

// Continuous deformations of the original Figma outline. A shared deformation
// field keeps merged/intersecting contours together, instead of assigning
// unrelated motion to the arbitrary subpaths of the flattened vector.
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const delta = (phase, offset) => Math.sin(phase + offset) - Math.sin(offset);

export function preparePath(source, sampleSpacing = 8) {
    const segments = [];
    let cursorX = 0;
    let cursorY = 0;
    let startX = 0;
    let startY = 0;

    function point(x, y) {
        const u = clamp((x - 189) / 2382.014, 0, 1);
        // Anchor the original crest and soften motion near the crop edges.
        const v = clamp((y - 80) / 964, 0, 1);
        const midY = 580 - 180 * Math.sin(Math.PI * u) + 200 * u;
        const rx = (x - 1370) / 1190;
        const ry = (y - 540) / 562;
        return { x, y, u, midY, band: (y - midY) / 420, rx, ry,
            radius: Math.hypot(rx, ry), edge: Math.sin(Math.PI * u) * Math.sin(Math.PI * v) };
    }

    // A nonlinear warp of only Bezier handles creates corners at segment joins.
    // Sample the actual source curves first, so adjacent contours follow the
    // same continuous field even at the highest intensity and spatial frequency.
    const distance = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
    function lineTo(x, y, points) {
        const count = Math.max(1, Math.ceil(distance(cursorX, cursorY, x, y) / sampleSpacing));
        for (let step = 1; step <= count; step++) {
            const t = step / count;
            points.push(point(cursorX + (x - cursorX) * t, cursorY + (y - cursorY) * t));
        }
        cursorX = x;
        cursorY = y;
    }

    for (const match of source.matchAll(/([MCLHVZ])([^MCLHVZ]*)/g)) {
        const command = match[1];
        const values = (match[2].match(/[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) || []).map(Number);
        const points = [];
        if (command === 'Z') {
            lineTo(startX, startY, points);
            segments.push({ command: 'L', points }, { command: 'Z', points: [] });
            continue;
        }
        if (command === 'M') {
            cursorX = startX = values[0];
            cursorY = startY = values[1];
            points.push(point(cursorX, cursorY));
            segments.push({ command: 'M', points });
            continue;
        }
        if (command === 'C') {
            for (let index = 0; index < values.length; index += 6) {
                const [x1, y1, x2, y2, x3, y3] = values.slice(index, index + 6);
                const length = distance(cursorX, cursorY, x1, y1) + distance(x1, y1, x2, y2) + distance(x2, y2, x3, y3);
                const count = Math.max(2, Math.ceil(length / sampleSpacing));
                for (let step = 1; step <= count; step++) {
                    const t = step / count;
                    const s = 1 - t;
                    points.push(point(
                        s * s * s * cursorX + 3 * s * s * t * x1 + 3 * s * t * t * x2 + t * t * t * x3,
                        s * s * s * cursorY + 3 * s * s * t * y1 + 3 * s * t * t * y2 + t * t * t * y3,
                    ));
                }
                cursorX = x3;
                cursorY = y3;
            }
        } else if (command === 'H' || command === 'V') {
            for (const value of values) lineTo(command === 'H' ? value : cursorX, command === 'V' ? value : cursorY, points);
        } else {
            for (let index = 0; index < values.length; index += 2) lineTo(values[index], values[index + 1], points);
        }
        segments.push({ command: 'L', points });
    }

    // Measure the original outline around the central hinge as well as the
    // right wing. The transition straddles the canvas midpoint, so its crossing
    // sits at x=1370 rather than drifting right by half the transition width.
    const crossingX = 1370;
    const envelopeStart = 189;
    const rightEnd = 2571.02;
    const columnCount = 384;
    const columnStep = (rightEnd - envelopeStart) / (columnCount - 1);
    const upper = new Float64Array(columnCount).fill(Infinity);
    const lower = new Float64Array(columnCount).fill(-Infinity);
    let previous = null;
    for (const segment of segments) {
        for (const p of segment.points) {
            if (segment.command !== 'M' && previous && p.x !== previous.x) {
                const first = Math.max(0, Math.ceil((Math.min(previous.x, p.x) - envelopeStart) / columnStep));
                const last = Math.min(columnCount - 1, Math.floor((Math.max(previous.x, p.x) - envelopeStart) / columnStep));
                for (let column = first; column <= last; column++) {
                    const x = envelopeStart + column * columnStep;
                    const t = (x - previous.x) / (p.x - previous.x);
                    const y = previous.y + (p.y - previous.y) * t;
                    upper[column] = Math.min(upper[column], y);
                    lower[column] = Math.max(lower[column], y);
                }
            }
            previous = p;
        }
    }
    // The exported path can end a fraction before the final column.
    for (let column = 1; column < columnCount; column++) {
        if (!Number.isFinite(upper[column])) {
            upper[column] = upper[column - 1];
            lower[column] = lower[column - 1];
        }
    }
    for (let column = columnCount - 2; column >= 0; column--) {
        if (!Number.isFinite(upper[column])) {
            upper[column] = upper[column + 1];
            lower[column] = lower[column + 1];
        }
    }
    // Smooth the guide used by the bilateral flow. Raw silhouette extrema can
    // switch between contours and otherwise introduce small corners on reflection.
    const flowGuide = new Float64Array(columnCount);
    const kernel = Array.from({ length: 49 }, (_, i) => Math.exp(-.5 * ((i - 24) / 8) ** 2));
    const kernelSum = kernel.reduce((sum, weight) => sum + weight, 0);
    for (let column = 0; column < columnCount; column++) {
        for (let i = 0; i < kernel.length; i++) {
            const sample = clamp(column + i - 24, 0, columnCount - 1);
            flowGuide[column] += (upper[sample] + lower[sample]) / 2 * kernel[i] / kernelSum;
        }
    }
    for (const segment of segments) {
        for (const p of segment.points) {
            const position = clamp((p.x - envelopeStart) / columnStep, 0, columnCount - 1);
            const column = Math.min(Math.floor(position), columnCount - 2);
            const t = position - column;
            const top = upper[column] + (upper[column + 1] - upper[column]) * t;
            const bottom = lower[column] + (lower[column + 1] - lower[column]) * t;
            p.rightCenter = (top + bottom) / 2;
            p.rightBand = clamp((p.y - p.rightCenter) / Math.max(1, (bottom - top) / 2), -1, 1);
            p.flowCenter = flowGuide[column] + (flowGuide[column + 1] - flowGuide[column]) * t;
            p.flowBand = clamp((p.y - p.flowCenter) / Math.max(1, (bottom - top) / 2), -1, 1);
            const fadeLeft = clamp((p.x - envelopeStart) / 220, 0, 1);
            const fadeRight = clamp((rightEnd - p.x) / 220, 0, 1);
            p.flowFade = fadeLeft ** 2 * (3 - 2 * fadeLeft) * fadeRight ** 2 * (3 - 2 * fadeRight);
        }
    }

    let detailedCrossing = null;
    return (phase, settings) => {
        // The continuous rotation has a spatially twisted pose at phase zero.
        // Returning the source there would flash the original at every wrap.
        if (settings.intensity === 0 || (phase === 0 && settings.effect !== 'right-swap')) return source;
        // Thin outline sides need denser sampling during a full two-wing fold.
        // Keep the other effects' original sampling and initialize this lazily.
        if ((settings.effect === 'right-swap' || settings.effect === 'center-swap') && sampleSpacing > 4) {
            detailedCrossing ??= preparePath(source, 4);
            return detailedCrossing(phase, settings);
        }
        const amount = settings.intensity;
        const density = settings.density;
        const lag = settings.lag / 100;

        function deform(p) {
            if (settings.effect === 'right-swap') {
                // Advance around a complete orbit, rather than easing a fold
                // forward/back. A smooth distance delays the wings so the twist
                // travels out from the center without a cusp at the pivot.
                const distance = (p.x - crossingX) / 1191;
                const travel = Math.hypot(distance, .08) - .08;
                const theta = phase - Math.PI * density * travel + lag * .9 * p.flowBand;
                const gain = amount / 100 * p.flowFade;
                const scale = 1 - gain + gain * Math.cos(theta);
                const y = p.flowCenter + (p.y - p.flowCenter) * scale;
                // Sine supplies the depth projection. The 90° and 270° poses
                // pass on opposite sides, so the second half never retraces
                // the first half as a flat up/down motion would.
                const x = p.x + 82 * gain * p.flowBand * Math.sin(theta);
                return `${x.toFixed(3)} ${y.toFixed(3)}`;
            }
            if (settings.effect === 'center-swap') {
                // Continuous ribbon twist. The bundle rotates about its smoothed
                // centerline in ONE direction (θ advances with phase and never
                // reverses), and the twist travels away from the pivot, so the
                // crossings keep flowing outward instead of swapping and bouncing
                // back. `density` = twists per wing, `lag` offsets θ by a line's
                // height so the crossing is a diagonal weave, `flow` picks the
                // travel direction ('out' from the pivot, 'right', or 'left').
                const pivot = Number.isFinite(settings.pivot) ? settings.pivot : crossingX;
                const reach = 1191;
                const dir = settings.flow === 'right' ? p.x - pivot
                    : settings.flow === 'left' ? pivot - p.x
                    : Math.abs(p.x - pivot);
                const theta = phase - Math.PI * density * dir / reach + lag * .9 * p.flowBand;
                const gain = amount / 100 * p.flowFade;
                const scale = 1 - gain * (1 - Math.cos(theta));
                const y = p.flowCenter + (p.y - p.flowCenter) * scale;
                // Oblique depth cue: the "far" side of the ribbon slides sideways.
                const x = p.x + 26 * gain * Math.sin(theta) * p.flowBand;
                return `${x.toFixed(3)} ${y.toFixed(3)}`;
            }
            const strength = amount * p.edge;
            const offset = -TAU * p.u * density + p.band * lag * 3;
            let dx = 0;
            let dy = 0;
            switch (settings.effect) {
                case 'wave':
                    dy = strength * delta(phase, offset);
                    break;
                case 'stagger':
                    dy = strength * (.8 * delta(phase, offset + p.band * lag * 3)
                        + .2 * p.band * delta(phase * 2, p.u * Math.PI * density));
                    dx = strength * .18 * delta(phase, p.u * Math.PI - p.band * lag * 3);
                    break;
                case 'breathe': {
                    const breath = delta(phase, p.u * (density - 1) * Math.PI + p.band * lag);
                    dy = (p.y - p.midY) * strength / 180 * breath;
                    dx = (p.x - 1410) * strength / 6000 * breath;
                    break;
                }
                case 'ribbon': {
                    const angle = strength / 300 * delta(phase, (p.u - .5) * density * Math.PI + p.band * lag);
                    dx = -(p.y - p.midY) * Math.sin(angle) * .6;
                    dy = (p.y - p.midY) * (Math.cos(angle) - 1) + (p.u - .5) * 650 * Math.sin(angle);
                    dy += strength * .4 * delta(phase, p.u * Math.PI * density);
                    break;
                }
                case 'ripple': {
                    const ripple = delta(phase, -p.radius * density * TAU + p.band * lag);
                    dx = strength * .42 * ripple * p.rx;
                    dy = strength * ripple * p.ry;
                    break;
                }
                case 'organic':
                    dy = strength * (.6 * delta(phase, TAU * p.u * density + p.band * lag * 2)
                        + .3 * delta(phase * 2, -Math.PI * p.u + p.band * lag)
                        + .2 * delta(phase, p.ry * 2.5));
                    dx = strength * .3 * delta(phase, p.ry * Math.PI * density - p.u * lag);
                    break;
            }
            // Soften extreme settings near the canvas edges, preserving the crop.
            const budget = Math.max(0, (dy < 0 ? p.y - 80 : 1044 - p.y) * .8);
            const shiftY = budget > 0 ? budget * Math.tanh(dy / budget) : 0;
            return `${(p.x + dx).toFixed(3)} ${(p.y + shiftY).toFixed(3)}`;
        }
        return segments.map(({ command, points }) => command + points.map(deform).join(' ')).join('');
    };
}
