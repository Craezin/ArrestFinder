// ==UserScript==
// @name         ArrestFinder
// @author       Sin_Vida (Craezin)
// @namespace    https://www.torn.com/
// @version      1.1.12
// @description  Analyzes a player's jailed & crime stats across three time windows to classify them as a Good, Potential, or Bad arrest target.
// @match        https://www.torn.com/profiles.php*
// @downloadURL  https://github.com/Craezin/ArrestFinder/raw/refs/heads/main/ArrestFinder.user.js
// @updateURL    https://github.com/Craezin/ArrestFinder/raw/refs/heads/main/ArrestFinder.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_deleteValue
// @connect      api.torn.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ─── Constants ────────────────────────────────────────────────────────────
    const SCRIPT_KEY   = 'arrestfinder_apikey';
    const STATS_PARAM  = 'jailed,nerverefills,vandalism,theft,counterfeiting,fraud,illicitservices,cybercrime,extortion,illegalproduction';
    const COMMENT      = 'ArrestFinder';

    const COLORS = {
        good:      '#2ecc71',   // green
        potential: '#f39c12',   // amber
        bad:       '#e74c3c',   // red
        border:    '#3d3d3d',
        bg:        '#1a1a1a',
        bgAlt:     '#252525',
        text:      '#e0e0e0',
        muted:     '#888',
        accent:    '#3498db',
        header:    '#2c2c2c',
    };

    // ─── Helpers ──────────────────────────────────────────────────────────────
    function getTargetUserId() {
        const params = new URLSearchParams(window.location.search);
        return params.get('XID') || params.get('xid');
    }

    function nowTs()           { return Math.floor(Date.now() / 1000); }
    function sevenDaysAgoTs()  { return nowTs() - 7 * 24 * 60 * 60; }
    function fourteenDaysAgoTs() { return nowTs() - 14 * 24 * 60 * 60; }

    // ─── GM_* Compatibility Shims ─────────────────────────────────────────────
    const HAS_GM_GET    = typeof GM_getValue          === 'function';
    const HAS_GM_SET    = typeof GM_setValue          === 'function';
    const HAS_GM_DEL    = typeof GM_deleteValue       === 'function';
    const HAS_GM_MENU   = typeof GM_registerMenuCommand === 'function';
    const HAS_GM_XHR    = typeof GM_xmlhttpRequest    === 'function';

    function getSavedKey() {
        if (HAS_GM_GET) return GM_getValue(SCRIPT_KEY, '');
        try { return sessionStorage.getItem(SCRIPT_KEY) || ''; } catch { return ''; }
    }
    function saveKey(k) {
        const v = k.trim();
        if (HAS_GM_SET) { GM_setValue(SCRIPT_KEY, v); return; }
        try { sessionStorage.setItem(SCRIPT_KEY, v); } catch { /* silent */ }
    }
    function deleteKey() {
        if (HAS_GM_DEL) { GM_deleteValue(SCRIPT_KEY); return; }
        try { sessionStorage.removeItem(SCRIPT_KEY); } catch { /* silent */ }
    }

    // ─── Tampermonkey Menu Commands ───────────────────────────────────────────
    function registerMenuCommands() {
        if (!HAS_GM_MENU) return;

        GM_registerMenuCommand('🔑 Set API Key', () => {
            const current = getSavedKey();
            const input = prompt(
                'ArrestFinder — Enter your Torn API v2 key:\n(Leave blank and click OK to clear the saved key)',
                current
            );
            if (input === null) return;
            const trimmed = input.trim();
            if (trimmed === '') {
                deleteKey();
                alert('ArrestFinder: API key cleared.');
            } else {
                saveKey(trimmed);
                alert('ArrestFinder: API key saved successfully.');
            }
            const statusEl = document.getElementById('af-status');
            if (statusEl) updateKeyStatus(statusEl);
        });

        GM_registerMenuCommand('🗑️ Clear API Key', () => {
            if (!confirm('ArrestFinder: Clear the saved API key?')) return;
            deleteKey();
            alert('ArrestFinder: API key cleared.');
            const statusEl = document.getElementById('af-status');
            if (statusEl) updateKeyStatus(statusEl);
        });
    }

    function updateKeyStatus(statusEl) {
        const key = getSavedKey();
        if (key) {
            statusEl.style.display = 'none';
            statusEl.innerHTML = '';
        } else {
            statusEl.style.display = 'block';
            const hint = HAS_GM_MENU
                ? ' — open the <strong>Tampermonkey menu</strong> to add one.'
                : '';
            statusEl.innerHTML = `<span style="color:#e74c3c;">⚠ API Key Missing</span>${hint}`;
        }
    }

    function buildUrl(userId, apiKey, timestamp) {
        return `https://api.torn.com/v2/user/${userId}/personalstats?stat=${STATS_PARAM}&timestamp=${timestamp}&comment=${COMMENT}&key=${apiKey}`;
    }

    function parseStats(json) {
        const out = {};
        const list = json?.personalstats ?? [];
        for (const item of list) {
            out[item.name] = item.value;
        }
        
        // Calculate criminaloffenses manually by summing up all specific crime types
        out['criminaloffenses'] = (out['vandalism'] ?? 0) +
                                  (out['theft'] ?? 0) +
                                  (out['counterfeiting'] ?? 0) +
                                  (out['fraud'] ?? 0) +
                                  (out['illicitservices'] ?? 0) +
                                  (out['cybercrime'] ?? 0) +
                                  (out['extortion'] ?? 0) +
                                  (out['illegalproduction'] ?? 0);
        
        return out;
    }

    if (typeof document.currentScript === 'undefined') {
        Object.defineProperty(document, 'currentScript', { value: null, configurable: true });
    }

    function fetchGM(url) {
        if (HAS_GM_XHR) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    onload(r) {
                        try { resolve(JSON.parse(r.responseText)); }
                        catch (e) { reject(new Error('JSON parse error')); }
                    },
                    onerror() { reject(new Error('Network error')); },
                });
            });
        }
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(JSON.parse(xhr.responseText)); }
                    catch (e) { reject(new Error('JSON parse error')); }
                } else {
                    reject(new Error(`HTTP ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.ontimeout = () => reject(new Error('Request timed out'));
            xhr.timeout = 15000;
            xhr.send();
        });
    }

    function fmtNum(n) {
        if (n == null) return '—';
        return Number(n).toLocaleString();
    }

    // ─── Classification Logic ─────────────────────────────────────────────────
    /**
     * Final verdict is the WORSE of the two individual signal verdicts.
     * Precedence (worst → best): bad > potential > good
     *
     * ── JAILED SIGNAL ────────────────────────────────────────────────────────
     *   GOOD      → jailed value is identical across all three snapshots
     *               (player has not been jailed at all during the full 14-day window)
     *   POTENTIAL → jailed(now) === jailed(7d) BUT differs from jailed(14d)
     *               (no new jails in the last 7 days, but was jailed before that)
     *   BAD       → jailed(now) !== jailed(7d)
     *               (player was jailed within the last 7 days — actively getting caught)
     *
     * ── CRIMINAL OFFENSES SIGNAL ─────────────────────────────────────────────
     *   Measures how many NEW offenses occurred in each window:
     *     delta1wk = offenses(now) − offenses(1 week ago)   ← crimes in last 7 days
     *     delta2wk = offenses(now) − offenses(2 weeks ago)  ← crimes in last 14 days
     *
     *   GOOD      → delta1wk >= 300  AND delta2wk >= 600
     *               (high, consistent criminal activity — very active target)
     *   BAD       → delta1wk <  200  OR  delta2wk <  400
     *               (low activity in either window — target is dormant/inactive)
     *   POTENTIAL → everything in between
     *               (moderate activity; some risk the player may not be reliably active)
     *               **BOOST**: Upgraded to GOOD if theft in last 7 days > 50 or illicit services > 25.
     *
     * ── COMBINED VERDICT ─────────────────────────────────────────────────────
     *   The two signals are scored (good=2, potential=1, bad=0) and the lower
     *   score wins, so a single BAD signal is enough to mark the target BAD.
     *   A single POTENTIAL signal alongside a GOOD pulls the result to POTENTIAL.
     *   Only when BOTH signals are GOOD is the final verdict GOOD.
     */
    const SCORE = { good: 2, potential: 1, bad: 0 };
    const SCORE_TO_VERDICT = ['bad', 'potential', 'good'];

    function classifyJailed(jailNow, jailDays7, jailDays14) {
        if (jailNow === jailDays7 && jailNow === jailDays14) return 'good';
        if (jailNow === jailDays7)                           return 'potential';
        return 'bad';
    }

    function classifyOffenses(offNow, offDays7, offDays14) {
        const delta1wk = offNow - offDays7;
        const delta2wk = offNow - offDays14;

        if (delta1wk >= 300 && delta2wk >= 600) return 'good';
        if (delta1wk < 200 || delta2wk < 400) return 'bad';
        return 'potential';
    }

    function classify(statsNow, statsDays7, statsDays14) {
        const jailNow    = statsNow['jailed']              ?? 0;
        const jailDays7  = statsDays7['jailed']            ?? 0;
        const jailDays14 = statsDays14['jailed']           ?? 0;

        const offNow     = statsNow['criminaloffenses']    ?? 0;
        const offDays7   = statsDays7['criminaloffenses']  ?? 0;
        const offDays14  = statsDays14['criminaloffenses'] ?? 0;

        const theftDelta7d   = (statsNow['theft'] ?? 0) - (statsDays7['theft'] ?? 0);
        const illicitDelta7d = (statsNow['illicitservices'] ?? 0) - (statsDays7['illicitservices'] ?? 0);

        const jailVerdict    = classifyJailed(jailNow, jailDays7, jailDays14);
        let offenseVerdict = classifyOffenses(offNow, offDays7, offDays14);

        // Boost logic based on historical database: high-yield crimes convert potential targets to good
        if (offenseVerdict === 'potential' && (theftDelta7d > 50 || illicitDelta7d > 25)) {
            offenseVerdict = 'good';
        }

        const minScore = Math.min(SCORE[jailVerdict], SCORE[offenseVerdict]);
        return SCORE_TO_VERDICT[minScore];
    }

    const VERDICT = {
        good:      { label: '✅ Good Arrest Target',      color: COLORS.good },
        potential: { label: '⚠️ Potential Arrest Target', color: COLORS.potential },
        bad:       { label: '❌ Bad Arrest Target',        color: COLORS.bad },
    };

    // ─── Badge Builder ────────────────────────────────────────────────────────
    function buildBadge() {
        const badge = document.createElement('div');
        badge.id = 'af-badge';
        badge.style.display = 'none';
        badge.innerHTML = `
            <span class="af-badge-label">Arrest:</span><span class="af-badge-pill">…</span>
        `;
        return badge;
    }

    function injectBadge() {
        if (document.getElementById('af-badge')) return null;
        const badge = buildBadge();
        const container = document.querySelector('div.content-title.m-bottom10');
        container.appendChild(badge);
        return badge;
    }

    function updateBadge(badge, verdict) {
        if (!badge) return;
        const BADGE_LABELS = {
            good:      { text: 'Good Arrest',      bg: COLORS.good },
            potential: { text: 'Potential Arrest',  bg: COLORS.potential },
            bad:       { text: 'Bad Arrest',        bg: COLORS.bad },
        };
        const { text, bg } = BADGE_LABELS[verdict];
        const pill = badge.querySelector('.af-badge-pill');
        pill.textContent = text;
        pill.style.background = bg;
        badge.style.display = 'block';
    }

    // ─── UI Builders ──────────────────────────────────────────────────────────
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #af-panel {
                font-family: inherit;
                font-size: 13px;
                background: ${COLORS.bg};
                border: 1px solid ${COLORS.border};
                border-radius: 6px;
                margin: 10px 0 0 0;
                color: ${COLORS.text};
                overflow: hidden;
                width: 100%;
                clear: both;
                box-sizing: border-box;
                display: block;
            }
            #af-panel .af-header {
                background: ${COLORS.header};
                padding: 8px 12px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                border-bottom: 1px solid ${COLORS.border};
                cursor: pointer;
                user-select: none;
            }
            #af-panel .af-header-title {
                font-weight: bold;
                font-size: 13px;
                letter-spacing: 0.4px;
                color: ${COLORS.accent};
                display: flex;
                align-items: center;
                gap: 6px;
            }
            #af-panel .af-toggle-icon {
                font-size: 11px;
                color: ${COLORS.muted};
                transition: transform 0.2s;
            }
            #af-panel.af-collapsed .af-toggle-icon {
                transform: rotate(-90deg);
            }
            #af-panel.af-collapsed #af-body {
                display: none;
            }
            #af-body {
                padding: 10px 12px;
            }
            #af-badge {
                display: inline-block;
                clear: both;
                margin: 5px 0;
                font-size: 12px;
                font-weight: bold;
                font-family: inherit;
            }
            #af-badge .af-badge-label {
                font-weight: bold;
                margin-right: 6px;
            }
            #af-badge .af-badge-pill {
                display: inline-block;
                color: white;
                font-weight: bold;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 12px;
            }
            .af-set-key-btn {
                margin-left: 8px;
                background: ${COLORS.accent};
                color: #fff;
                border: none;
                padding: 3px 10px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: bold;
                cursor: pointer;
                vertical-align: middle;
                transition: background 0.15s;
            }
            .af-set-key-btn:hover { background: #217dbb; }
            #af-status {
                color: ${COLORS.muted};
                font-size: 12px;
                margin-bottom: 8px;
                min-height: 16px;
                display: none;
            }
            #af-verdict-box {
                display: none;
                border-radius: 5px;
                padding: 10px 14px;
                margin-bottom: 10px;
                font-weight: bold;
                font-size: 15px;
                text-align: center;
                border: 2px solid transparent;
            }
            #af-table-wrap {
                display: none;
            }
            .af-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 12px;
            }
            .af-table th {
                background: ${COLORS.bgAlt};
                color: ${COLORS.muted};
                font-weight: bold;
                text-align: left;
                padding: 5px 8px;
                border-bottom: 1px solid ${COLORS.border};
                text-transform: uppercase;
                font-size: 10px;
                letter-spacing: 0.5px;
            }
            .af-table td {
                padding: 5px 8px;
                border-bottom: 1px solid #2a2a2a;
                color: ${COLORS.text};
                vertical-align: middle;
            }
            .af-table tr:last-child td { border-bottom: none; }
            .af-table tr:nth-child(even) td { background: ${COLORS.bgAlt}; }
            .af-stat-name { font-weight: bold; color: #bbb; text-transform: capitalize; }
            .af-highlight { color: #fff; font-weight: bold; }
            .af-delta-up-good      { color: ${COLORS.good};      font-size: 11px; }
            .af-delta-up-potential { color: ${COLORS.potential};  font-size: 11px; }
            .af-delta-up-bad       { color: ${COLORS.bad};        font-size: 11px; }
            .af-delta-up-good-7d      { color: ${COLORS.good};      font-size: 11px; }
            .af-delta-up-potential-7d { color: ${COLORS.potential};  font-size: 11px; }
            .af-delta-up-bad-7d       { color: ${COLORS.bad};        font-size: 11px; }
            .af-delta-jail-up   { color: ${COLORS.bad};    font-size: 11px; }
            .af-delta-jail-down { color: ${COLORS.good};   font-size: 11px; }
            .af-delta-zero { color: ${COLORS.muted};  font-size: 11px; }
            .af-section-label {
                font-size: 11px;
                color: ${COLORS.muted};
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin: 8px 0 4px;
                font-weight: bold;
            }
            .af-spinner {
                display: inline-block;
                width: 12px; height: 12px;
                border: 2px solid #555;
                border-top-color: ${COLORS.accent};
                border-radius: 50%;
                animation: af-spin 0.7s linear infinite;
                vertical-align: middle;
                margin-right: 6px;
            }
            @keyframes af-spin { to { transform: rotate(360deg); } }
        `;
        document.head.appendChild(style);
    }

    function buildPanel() {
        const panel = document.createElement('div');
        panel.id = 'af-panel';
        panel.classList.add('af-collapsed');
        panel.innerHTML = `
            <div class="af-header" id="af-header">
                <div class="af-header-title">
                    🚔 ArrestFinder
                </div>
                <span class="af-toggle-icon">▼</span>
            </div>
            <div id="af-body">
                <div id="af-status"></div>
                <div id="af-verdict-box"></div>
                <div id="af-table-wrap"></div>
            </div>
        `;
        return panel;
    }

    function deltaJail(now, then) {
        if (now == null || then == null) return '';
        const d = now - then;
        if (d === 0) return `<span class="af-delta-zero">±0</span>`;
        if (d > 0)   return `<span class="af-delta-jail-up">+${fmtNum(d)}</span>`;
        return `<span class="af-delta-jail-down">${fmtNum(d)}</span>`;
    }

    function deltaCrime(now, then, window) {
        if (now == null || then == null) return '';
        const d = now - then;
        if (d === 0) return `<span class="af-delta-zero">±0</span>`;

        let cls;
        if (window === '14d') {
            if (d >= 500)      cls = 'af-delta-up-good';
            else if (d >= 250) cls = 'af-delta-up-potential';
            else               cls = 'af-delta-up-bad';
        } else {
            if (d >= 250)      cls = 'af-delta-up-good-7d';
            else if (d >= 125) cls = 'af-delta-up-potential-7d';
            else               cls = 'af-delta-up-bad-7d';
        }
        return `<span class="${cls}">+${fmtNum(d)}</span>`;
    }

    function buildResultTable(statsNow, statsDays7, statsDays14) {
        const STAT_ORDER = [
            'jailed',
            'criminaloffenses',
            'vandalism',
            'theft',
            'counterfeiting',
            'fraud',
            'illicitservices',
            'cybercrime',
            'extortion',
            'illegalproduction',
            'nerverefills',
        ];

        const LABELS = {
            jailed:              'Times Jailed',
            criminaloffenses:    'Criminal Offenses',
            vandalism:           'Vandalism',
            theft:               'Theft',
            counterfeiting:      'Counterfeiting',
            fraud:               'Fraud',
            illicitservices:     'Illicit Services',
            cybercrime:          'Cybercrime',
            extortion:           'Extortion',
            illegalproduction:   'Illegal Production',
            nerverefills:        'Nerve Refills',
        };

        let rows = '';
        for (const stat of STAT_ORDER) {
            const now    = statsNow[stat];
            const days7  = statsDays7[stat];
            const d14    = statsDays14[stat];
            const isJail = stat === 'jailed';
            const deltaDays7 = isJail ? deltaJail(now, days7) : deltaCrime(now, days7, '7d');
            const delta14d   = isJail ? deltaJail(now, d14)   : deltaCrime(now, d14,   '14d');
            rows += `
                <tr>
                    <td class="af-stat-name${isJail ? ' af-highlight' : ''}">${LABELS[stat] ?? stat}</td>
                    <td class="${isJail ? 'af-highlight' : ''}">${fmtNum(now)}</td>
                    <td>${fmtNum(days7)} ${deltaDays7}</td>
                    <td>${fmtNum(d14)} ${delta14d}</td>
                </tr>
            `;
        }

        return `
            <div class="af-section-label">Stat Breakdown</div>
            <table class="af-table">
                <thead>
                    <tr>
                        <th>Stat</th>
                        <th>Now</th>
                        <th>7 Days Ago</th>
                        <th>14 Days Ago</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    // ─── Main Logic ───────────────────────────────────────────────────────────
    async function runAnalysis(userId, apiKey, statusEl, verdictBox, tableWrap, badge) {
        tableWrap.style.display = 'none';
        verdictBox.style.display = 'none';

        const steps = [
            { label: 'Fetching current stats…',            ts: nowTs() },
            { label: 'Fetching stats from 7 days ago…',    ts: sevenDaysAgoTs() },
            { label: 'Fetching stats from 14 days ago…',   ts: fourteenDaysAgoTs() },
        ];

        const results = [];
        for (const step of steps) {
            statusEl.style.display = 'block';
            statusEl.innerHTML = `<span class="af-spinner"></span>${step.label}`;
            try {
                const url  = buildUrl(userId, apiKey, step.ts);
                const json = await fetchGM(url);
                if (json.error) {
                    throw new Error(`API error ${json.error.code}: ${json.error.error}`);
                }
                results.push(parseStats(json));
            } catch (err) {
                statusEl.textContent = `❌ ${err.message}`;
                return;
            }
        }

        statusEl.style.display = 'none';
        statusEl.innerHTML = '';

        const [statsNow, statsDays7, statsDays14] = results;

        const verdict = classify(statsNow, statsDays7, statsDays14);
        const { label, color } = VERDICT[verdict];

        updateBadge(badge, verdict);

        verdictBox.style.display = 'block';
        verdictBox.style.background = color + '22';
        verdictBox.style.borderColor = color;
        verdictBox.style.color = color;

        verdictBox.innerHTML = label;

        tableWrap.style.display = 'block';
        tableWrap.innerHTML = buildResultTable(statsNow, statsDays7, statsDays14);
    }

    // ─── Injection ────────────────────────────────────────────────────────────
    function injectPanel(userId) {
        const container = document.querySelector('div.content-title.m-bottom10');
        if (!container) {
            console.warn('[ArrestFinder] Could not find div.content-title.m-bottom10 — aborting injection.');
            return;
        }

        if (document.getElementById('af-panel')) return;

        injectStyles();
        const panel = buildPanel();
        container.appendChild(panel);

        const badge = injectBadge();

        const header     = panel.querySelector('#af-header');
        const statusEl   = panel.querySelector('#af-status');
        const verdictBox = panel.querySelector('#af-verdict-box');
        const tableWrap  = panel.querySelector('#af-table-wrap');

        header.addEventListener('click', () => {
            panel.classList.toggle('af-collapsed');
        });

        const key = getSavedKey();
        if (!key) {
            statusEl.style.display = 'block';
            statusEl.innerHTML = `
                <span style="color:#e74c3c;">⚠ API Key Missing</span>
                <button id="af-set-key-btn" class="af-set-key-btn">Set API Key</button>
            `;
            document.getElementById('af-set-key-btn').addEventListener('click', () => {
                const input = prompt('ArrestFinder — Enter your Torn API v2 key:');
                if (input === null) return;
                const trimmed = input.trim();
                if (!trimmed) return;
                saveKey(trimmed);
                panel.remove();
                injectPanel(userId);
            });
            return;
        }

        runAnalysis(userId, key, statusEl, verdictBox, tableWrap, badge);
    }

    // ─── Entry Point ──────────────────────────────────────────────────────────
    function init() {
        registerMenuCommands();

        const userId = getTargetUserId();
        if (!userId) return;

        const tryInject = () => {
            const target = document.querySelector('div.content-title.m-bottom10');
            if (target) {
                injectPanel(userId);
            } else {
                setTimeout(tryInject, 300);
            }
        };

        tryInject();
    }

    // ─── Wait for DOM ─────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
