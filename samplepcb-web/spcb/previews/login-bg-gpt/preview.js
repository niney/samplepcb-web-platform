import { preparePath } from './motion-path.js?v=7';

const TAU = Math.PI * 2;
const STORAGE_KEY = 'spcb.background-preview.v2';
const presets = {
    wave: { name: '흐르는 물결', description: '양 끝은 안정적으로 유지하고 봉우리와 골이 좌우로 흐릅니다.',
        period: 14, intensity: 44, density: 1, lag: 0, glow: 35 },
    stagger: { name: '시차 웨이브', description: '곡선의 높이에 따라 시차를 주어 선 사이 간격이 변화합니다.',
        period: 16, intensity: 65, density: 1.4, lag: 70, glow: 40 },
    breathe: { name: '펼침과 수렴', description: '곡선 묶음이 호흡하듯 넓게 펼쳐졌다가 가늘게 모입니다.',
        period: 18, intensity: 64, density: 1, lag: 20, glow: 50 },
    ribbon: { name: '리본 비틀림', description: '중앙 곡선들이 리본처럼 비틀리며 교차하는 흐름이 변합니다.',
        period: 20, intensity: 70, density: 1, lag: 40, glow: 35 },
    ripple: { name: '퍼지는 파동', description: '중앙에서 바깥쪽으로 퍼지는 파동이 곡선에 굴곡을 만듭니다.',
        period: 12, intensity: 68, density: 2, lag: 35, glow: 30 },
    organic: { name: '유기적인 흐름', description: '서로 다른 리듬을 겹쳐 곡선들이 느슨하고 유연하게 움직입니다.',
        period: 24, intensity: 60, density: 1.1, lag: 65, glow: 45 },
    'right-swap': { name: '360° 연속 흐름', description: '중앙에서 양쪽으로 꼬임이 흐르며 한 방향으로 계속 회전합니다. 한 바퀴가 끝나도 멈추지 않고 다음 회전으로 이어집니다.',
        period: 18, intensity: 100, density: 1.2, lag: 35, glow: 25 },
};
const limits = {
    period: { min: 4, max: 40, step: 1, unit: '초' },
    intensity: { min: 0, max: 100, step: 1, unit: '%' },
    density: { min: .5, max: 3, step: .1, unit: '배' },
    lag: { min: 0, max: 100, step: 1, unit: '%' },
    glow: { min: 0, max: 100, step: 1, unit: '%' },
};
const byId = (id) => document.getElementById(id);
const artwork = byId('preview-artwork');
const originalImage = byId('original-artwork');
const toggle = byId('motion-toggle');
const stateLabel = toggle.querySelector('.motion-toggle__state');
const description = byId('motion-description');
const settingsNote = byId('settings-note');
const pauseButton = byId('pause-motion');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let storageAvailable = true;

function defaults(effect) {
    const preset = presets[effect];
    return { effect, period: preset.period, intensity: preset.intensity, density: preset.density,
        lag: preset.lag, glow: preset.glow, glowEnabled: true };
}

function normalize(raw) {
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const effect = Object.hasOwn(presets, input.effect) ? input.effect : 'stagger';
    const value = defaults(effect);
    for (const [key, limit] of Object.entries(limits)) {
        const number = typeof input[key] === 'number' || typeof input[key] === 'string' ? Number(input[key]) : NaN;
        if (Number.isFinite(number)) {
            const bounded = Math.max(limit.min, Math.min(limit.max, number));
            value[key] = Number((Math.round(bounded / limit.step) * limit.step).toFixed(1));
        }
    }
    if (typeof input.glowEnabled === 'boolean') value.glowEnabled = input.glowEnabled;
    return value;
}

function settingsFromLink() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has('effect')) return null;
    const raw = Object.fromEntries(params);
    if (params.has('glowEnabled')) raw.glowEnabled = params.get('glowEnabled') !== 'false';
    return normalize(raw);
}

function initialSettings() {
    const linked = settingsFromLink();
    if (linked) return linked;
    try {
        return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch {
        return defaults('stagger');
    }
}

let settings = initialSettings();

function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        storageAvailable = true;
    } catch {
        storageAvailable = false;
    }
    settingsNote.textContent = storageAvailable ? '설정은 이 브라우저에 자동 저장됩니다.'
        : '자동 저장을 사용할 수 없습니다. 설정 링크를 복사해 보관하세요.';
    // Keep an opened configuration link current when its controls are adjusted.
    if (new URLSearchParams(location.hash.slice(1)).has('effect')) {
        history.replaceState(null, '', shareUrl());
    }
}

function shareUrl() {
    const url = new URL(location.href);
    url.hash = new URLSearchParams(Object.entries(settings).map(([key, value]) => [key, String(value)])).toString();
    return url.href;
}

function syncControls() {
    document.querySelectorAll('input[name="effect"]').forEach((radio) => { radio.checked = radio.value === settings.effect; });
    byId('effect-description').textContent = presets[settings.effect].description;
    byId('period-label').textContent = settings.effect === 'right-swap' ? '한 바퀴' : '한 주기';
    byId('intensity-label').textContent = settings.effect === 'right-swap' ? '회전 강도' : '변형 강도';
    byId('density-label').textContent = settings.effect === 'right-swap' ? '꼬임 밀도' : '물결 밀도';
    for (const [key, limit] of Object.entries(limits)) {
        const text = settings[key] + limit.unit;
        byId(key).value = String(settings[key]);
        byId(key).setAttribute('aria-valuetext', text);
        byId(key + '-output').textContent = text;
    }
    byId('glow-enabled').checked = settings.glowEnabled;
    byId('glow').disabled = !settings.glowEnabled;
}
syncControls();

async function initialize() {
    const response = await fetch(originalImage.src);
    if (!response.ok) throw new Error('Background asset: HTTP ' + response.status);
    const xml = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
    if (xml.querySelector('parsererror')) throw new Error('Invalid background SVG');
    const svg = document.importNode(xml.documentElement, true);
    const wave = svg.querySelector('[id="Vector"]');
    const glow = svg.querySelector('[id="Ellipse 4"]');
    const originalPath = wave?.getAttribute('d');
    if (!originalPath || !glow) throw new Error('Missing Figma background layers');
    const renderPath = preparePath(originalPath);
    const originalGlowTransform = glow.getAttribute('transform');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.display = 'none';
    artwork.append(svg);

    let enabled = false;
    let paused = false;
    let phase = 0;
    let frameId = 0;
    let lastTime = null;
    let lastPaint = -Infinity;

    function restoreGlow() {
        if (originalGlowTransform === null) glow.removeAttribute('transform');
        else glow.setAttribute('transform', originalGlowTransform);
    }

    function restoreOriginal() {
        wave.setAttribute('d', originalPath);
        restoreGlow();
    }

    function renderFrame() {
        if (!enabled) return;
        wave.setAttribute('d', renderPath(phase, settings));
        if (!settings.glowEnabled || settings.glow === 0) {
            restoreGlow();
            return;
        }
        const amount = settings.glow / 40;
        const shiftX = Math.sin(phase) * 32 * amount;
        const shiftY = (Math.cos(phase) - 1) * 12 * amount;
        const scale = 1 + Math.sin(phase) * .025 * amount;
        glow.setAttribute('transform', 'translate(' + shiftX + ' ' + shiftY
            + ') translate(1214.01 540.001) scale(' + scale + ') translate(-1214.01 -540.001)');
    }

    function stopLoop() {
        cancelAnimationFrame(frameId);
        frameId = 0;
        lastTime = null;
    }

    function tick(time) {
        if (!enabled || paused || document.hidden) {
            stopLoop();
            return;
        }
        if (lastTime !== null) phase = (phase + (time - lastTime) / (settings.period * 1000) * TAU) % TAU;
        lastTime = time;
        if (time - lastPaint >= 1000 / 30) {
            renderFrame();
            lastPaint = time;
        }
        frameId = requestAnimationFrame(tick);
    }

    function startLoop() {
        if (enabled && !paused && !document.hidden && !frameId) frameId = requestAnimationFrame(tick);
    }

    function syncPlayback() {
        toggle.setAttribute('aria-checked', String(enabled));
        stateLabel.textContent = enabled ? 'ON' : 'OFF';
        description.textContent = enabled
            ? presets[settings.effect].name + ' · ' + (paused ? '현재 장면 일시정지' : settings.period + '초 주기')
            : 'Figma 원본 · 정적인 배경';
        pauseButton.disabled = !enabled;
        pauseButton.setAttribute('aria-pressed', String(paused));
        pauseButton.textContent = paused ? '다시 재생' : '일시정지';
    }

    function setMotion(value) {
        enabled = value;
        paused = false;
        phase = 0;
        lastPaint = -Infinity;
        stopLoop();
        restoreOriginal();
        svg.style.display = enabled ? 'block' : 'none';
        originalImage.hidden = enabled;
        syncPlayback();
        if (enabled) renderFrame();
        startLoop();
    }

    function applySettings(next, restart = false) {
        settings = normalize(next);
        if (restart) {
            phase = 0;
            lastTime = null;
        }
        syncControls();
        saveSettings();
        byId('share-fallback').hidden = true;
        syncPlayback();
        renderFrame();
    }

    toggle.disabled = false;
    byId('motion-settings').disabled = false;
    toggle.addEventListener('click', () => setMotion(!enabled));
    pauseButton.addEventListener('click', () => {
        paused = !paused;
        stopLoop();
        syncPlayback();
        startLoop();
    });
    document.querySelectorAll('input[name="effect"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            if (radio.checked) applySettings(defaults(radio.value), true);
        });
    });
    for (const key of Object.keys(limits)) {
        byId(key).addEventListener('input', () => applySettings({ ...settings, [key]: Number(byId(key).value) }));
    }
    byId('glow-enabled').addEventListener('change', () => applySettings({ ...settings, glowEnabled: byId('glow-enabled').checked }));
    byId('reset-settings').addEventListener('click', () => applySettings(defaults(settings.effect), true));
    byId('copy-settings').addEventListener('click', async () => {
        const url = shareUrl();
        try {
            await navigator.clipboard.writeText(url);
            settingsNote.textContent = '현재 효과와 조절값이 담긴 링크를 복사했습니다.';
        } catch {
            byId('share-fallback').hidden = false;
            byId('share-url').value = url;
            byId('share-url').focus();
            byId('share-url').select();
            settingsNote.textContent = '아래 링크를 직접 복사해 주세요.';
        }
    });
    window.addEventListener('hashchange', () => {
        const linked = settingsFromLink();
        if (linked) applySettings(linked, true);
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopLoop();
        else startLoop();
    });
    window.addEventListener('pagehide', stopLoop);
    window.addEventListener('pageshow', startLoop);
    reducedMotion.addEventListener('change', () => {
        if (reducedMotion.matches) setMotion(false);
    });
    saveSettings();
    setMotion(!reducedMotion.matches);
}

initialize().catch((error) => {
    description.textContent = '원본 배경 · 애니메이션을 불러오지 못했습니다';
    console.error('Background preview:', error);
});
