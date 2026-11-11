/*! ham-radio-trx-control 0.1.0 | MIT | https://github.com/michalsiman/ham-radio-trx-control */
/*
 * A Home Assistant card with the basics of a transceiver: frequency, band,
 * mode, transmit power, S-meter, on/off and transmit state, and controls to
 * tune, change mode and set the power.
 *
 * Made for the entities of ham-radio-ha-gateway, found by a prefix:
 *   type: custom:ham-radio-trx-control
 *   prefix: ic_7300        # sensor.ic_7300_frequency, number.ic_7300_tune, ...
 * Any entity can be set by hand under `entities:`.
 */

const VERSION = '0.1.0';

const DEFAULT_ENTITIES = {
  online: 'binary_sensor.{p}_online',
  frequency: 'sensor.{p}_frequency',
  tune: 'number.{p}_tune',
  mode: 'sensor.{p}_mode',
  mode_select: 'select.{p}_set_mode',
  transmitting: 'binary_sensor.{p}_transmitting',
  tx_power: 'sensor.{p}_tx_power',
  tx_power_set: 'number.{p}_set_tx_power',
  s_meter: 'sensor.{p}_s_meter',
};

const DEFAULT_MODES = ['LSB', 'USB', 'CW', 'AM', 'FM', 'PKTUSB'];

/** Amateur bands (IARU Region 1, generous edges), in Hz. */
const BANDS = [
  [135700, 137800, '2200 m'], [472000, 479000, '630 m'], [1810000, 2000000, '160 m'],
  [3500000, 3800000, '80 m'], [5351500, 5366500, '60 m'], [7000000, 7200000, '40 m'],
  [10100000, 10150000, '30 m'], [14000000, 14350000, '20 m'], [18068000, 18168000, '17 m'],
  [21000000, 21450000, '15 m'], [24890000, 24990000, '12 m'], [28000000, 29700000, '10 m'],
  [50000000, 52000000, '6 m'], [70000000, 70500000, '4 m'], [144000000, 146000000, '2 m'],
  [430000000, 440000000, '70 cm'],
];

const MODE_LABELS = { PKTUSB: 'USB-D', PKTLSB: 'LSB-D', PKTFM: 'FM-D', CWR: 'CW-R' };

const STRINGS = {
  en: {
    off: 'Radio off', unavailable: 'Gateway offline', tx: 'TX', power: 'Power', mode: 'Mode',
    tune_hint: 'Frequency in MHz (14.074) or kHz (14074)', tune: 'Tune', cancel: 'Cancel', out_of_band: 'Out of band',
  },
  cs: {
    off: 'Rádio vypnuté', unavailable: 'Brána offline', tx: 'TX', power: 'Výkon', mode: 'Mód',
    tune_hint: 'Frekvence v MHz (14.074) nebo kHz (14074)', tune: 'Naladit', cancel: 'Zrušit', out_of_band: 'Mimo pásmo',
  },
};

function band(hz) {
  const b = BANDS.find(([lo, hi]) => hz >= lo && hz <= hi);
  return b ? b[2] : null;
}

/** 14074000 → "14.074.000" (MHz.kHz.Hz). */
export function formatFrequency(hz) {
  const s = String(Math.round(hz)).padStart(7, '0');
  return `${s.slice(0, -6)}.${s.slice(-6, -3)}.${s.slice(-3)}`;
}

/** dB relative to S9 → "S7", "S9", "S9+20". One S-unit is 6 dB. */
export function sUnits(db) {
  if (db >= 0) return db < 5 ? 'S9' : `S9+${Math.round(db / 10) * 10}`;
  return `S${Math.max(0, Math.min(9, 9 + Math.round(db / 6)))}`;
}

/** "14.074", "14,074", "14074" (kHz) or "14074000" (Hz) → Hz; null when not a frequency. */
export function parseFrequency(text) {
  const v = Number(String(text).trim().replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v < 1000) return Math.round(v * 1e6);
  if (v < 1e6) return Math.round(v * 1e3);
  return Math.round(v);
}

// Plain base class outside a browser, so the helpers can be tested in Node.
const Base = globalThis.HTMLElement ?? class {};

class HamRadioTrxControl extends Base {
  static getStubConfig(hass) {
    const freq = Object.keys(hass?.states ?? {}).find(
      (id) => /^sensor\..+_frequency$/.test(id) && hass.states[id.replace(/^sensor\.(.+)_frequency$/, 'number.$1_tune')],
    );
    return { prefix: freq ? freq.replace(/^sensor\.(.+)_frequency$/, '$1') : 'ic_7300' };
  }

  setConfig(config) {
    if (!config || (!config.prefix && !config.entities)) {
      throw new Error('Set "prefix" (e.g. ic_7300) or "entities".');
    }
    const ids = {};
    for (const [key, pattern] of Object.entries(DEFAULT_ENTITIES)) {
      ids[key] = config.entities?.[key] ?? (config.prefix ? pattern.replace('{p}', config.prefix) : undefined);
    }
    this._config = { modes: DEFAULT_MODES, show_s_meter: true, ...config };
    this._ids = ids;
    this._editing = false;
    this._render(true);
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    // Not while the user types a frequency or drags the power slider.
    if (this._editing || this._dragging) return;
    // Render only when one of our entities changed.
    if (!old || Object.values(this._ids ?? {}).some((id) => id && old.states[id] !== hass.states[id])) {
      this._render();
    }
  }

  getCardSize() {
    return 4;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: 'auto' };
  }

  _t(key) {
    const lang = (this._hass?.locale?.language || this._hass?.language || 'en').split('-')[0];
    return (STRINGS[lang] ?? STRINGS.en)[key] ?? STRINGS.en[key];
  }

  _state(key) {
    const id = this._ids?.[key];
    return id ? this._hass?.states[id] : undefined;
  }

  _num(key) {
    const s = this._state(key);
    const v = s ? Number(s.state) : NaN;
    return Number.isFinite(v) ? v : null;
  }

  _call(domain, service, key, data) {
    const entity_id = this._ids[key];
    if (!entity_id || !this._hass?.states[entity_id]) return;
    this._hass.callService(domain, service, { entity_id, ...data });
  }

  _render(force = false) {
    if (!this._config) return;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
    }
    if (!this._hass) {
      if (force) this.shadowRoot.innerHTML = `<ha-card><div class="pad">…</div></ha-card>`;
      return;
    }
    const freqState = this._state('frequency');
    const gatewayDown = !freqState || freqState.state === 'unavailable';
    const online = this._state('online')?.state === 'on' && !gatewayDown;
    const tx = online && this._state('transmitting')?.state === 'on';
    const mhz = this._num('frequency');
    const hz = mhz !== null ? Math.round(mhz * 1e6) : null;
    const mode = this._state('mode')?.state;
    const powerSet = this._state('tx_power_set');
    const watts = this._num('tx_power');
    const smeter = this._num('s_meter');
    const modeOptions = this._state('mode_select')?.attributes?.options ?? [];
    const modes = this._config.modes.filter((m) => !modeOptions.length || modeOptions.includes(m));
    if (mode && !modes.includes(mode) && modeOptions.includes(mode)) modes.push(mode);
    const bandName = hz ? band(hz) : null;
    const name = this._config.name ?? this._state('frequency')?.attributes?.friendly_name?.replace(/\s*Frequency$/i, '') ?? 'Radio';
    const status = gatewayDown ? this._t('unavailable') : online ? '' : this._t('off');
    const smeterPct = smeter === null || !online ? 0 : Math.max(0, Math.min(100, ((smeter + 54) / (54 + 60)) * 100));
    const pmax = Number(powerSet?.attributes?.max ?? 100);
    const pstep = Number(powerSet?.attributes?.step ?? 1);

    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 16px; ${online ? '' : 'opacity: 0.75;'} }
        .head { display: flex; align-items: center; gap: 8px; }
        .name { flex: 1; font-weight: 500; color: var(--primary-text-color); }
        .dot { width: 10px; height: 10px; border-radius: 50%; background: ${online ? 'var(--success-color, #43a047)' : 'var(--disabled-text-color, #888)'}; }
        .tx { padding: 2px 10px; border-radius: 6px; font-weight: 700; font-size: 13px; letter-spacing: 1px;
              background: ${tx ? 'var(--error-color, #db4437)' : 'transparent'}; color: ${tx ? '#fff' : 'var(--disabled-text-color, #888)'};
              border: 1px solid ${tx ? 'var(--error-color, #db4437)' : 'var(--divider-color, #555)'}; }
        .freq { margin: 12px 0 4px; font: 600 40px/1.1 var(--ha-font-family-code, monospace); color: var(--primary-text-color);
                cursor: ${online ? 'pointer' : 'default'}; letter-spacing: 1px; font-variant-numeric: tabular-nums; }
        .freq small { font-size: 16px; color: var(--secondary-text-color); margin-left: 6px; }
        .sub { display: flex; gap: 12px; color: var(--secondary-text-color); font-size: 14px; min-height: 20px; }
        .status { color: var(--warning-color, #ff9800); }
        .tune { display: flex; gap: 8px; margin: 10px 0 4px; flex-wrap: wrap; align-items: center; }
        .tune input { flex: 1; min-width: 120px; font: 600 20px var(--ha-font-family-code, monospace); padding: 6px 8px;
                      border-radius: 8px; border: 1px solid var(--divider-color, #555); background: var(--card-background-color); color: var(--primary-text-color); }
        .hint { width: 100%; font-size: 12px; color: var(--secondary-text-color); }
        button { font: inherit; cursor: pointer; border-radius: 8px; padding: 6px 12px; border: 1px solid var(--divider-color, #555);
                 background: transparent; color: var(--primary-text-color); }
        button.primary { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
        button:disabled { opacity: 0.5; cursor: default; }
        .label { margin-top: 14px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--secondary-text-color); }
        .modes { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
        .modes button.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
        .power { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
        .power input { flex: 1; accent-color: var(--primary-color); }
        .power b { min-width: 56px; text-align: right; color: var(--primary-text-color); }
        .meter { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
        /* Colours on a fixed scale (green to S9, orange to S9+30, red above); the
           unlit part is covered from the reading to the end. */
        .bar { flex: 1; height: 8px; border-radius: 4px; overflow: hidden;
               background: linear-gradient(90deg, var(--success-color, #43a047) 0 47%, var(--warning-color, #ff9800) 47% 75%, var(--error-color, #db4437) 75%); }
        .bar i { display: block; height: 100%; margin-left: ${smeterPct}%; background: var(--divider-color, #444); }
        .meter b { min-width: 56px; text-align: right; color: var(--primary-text-color); }
        .pad { padding: 16px; }
      </style>
      <ha-card>
        <div class="head">
          <span class="dot"></span>
          <span class="name">${escapeHtml(name)}</span>
          <span class="tx">${this._t('tx')}</span>
        </div>
        ${this._editing ? `
          <div class="tune">
            <input id="freq-input" inputmode="decimal" value="${hz ? String(hz / 1e6) : ''}">
            <button class="primary" id="tune-ok">${this._t('tune')}</button>
            <button id="tune-cancel">${this._t('cancel')}</button>
            <div class="hint">${this._t('tune_hint')}</div>
          </div>` : `
          <div class="freq" id="freq" title="${this._t('tune')}">${hz && online ? formatFrequency(hz) : '–.–––.–––'}<small>MHz</small></div>`}
        <div class="sub">
          ${status ? `<span class="status">${status}</span>` : ''}
          ${online && bandName ? `<span>${bandName}</span>` : ''}
          ${online && hz && !bandName ? `<span>${this._t('out_of_band')}</span>` : ''}
          ${online && mode ? `<span>${escapeHtml(MODE_LABELS[mode] ?? mode)}</span>` : ''}
        </div>
        ${this._ids.mode_select && this._state('mode_select') ? `
          <div class="label">${this._t('mode')}</div>
          <div class="modes">
            ${modes.map((m) => `<button data-mode="${escapeHtml(m)}" class="${online && m === mode ? 'on' : ''}" ${online ? '' : 'disabled'}>${escapeHtml(MODE_LABELS[m] ?? m)}</button>`).join('')}
          </div>` : ''}
        ${powerSet || watts !== null ? `
          <div class="label">${this._t('power')}</div>
          <div class="power">
            ${powerSet ? `<input id="power" type="range" min="${Number(powerSet.attributes.min ?? 0)}" max="${pmax}" step="${pstep}" value="${watts ?? 0}" ${online ? '' : 'disabled'}>` : '<span style="flex:1"></span>'}
            <b>${watts !== null && online ? `${watts} W` : '– W'}</b>
          </div>` : ''}
        ${this._config.show_s_meter && this._state('s_meter') ? `
          <div class="meter">
            <div class="bar"><i></i></div>
            <b>${smeter !== null && online ? sUnits(smeter) : '–'}</b>
          </div>` : ''}
      </ha-card>`;

    const root = this.shadowRoot;
    root.getElementById('freq')?.addEventListener('click', () => {
      if (!online || !this._state('tune')) return;
      this._editing = true;
      this._render();
      const input = root.getElementById('freq-input');
      input?.focus();
      input?.select();
    });
    const submit = () => {
      const value = parseFrequency(root.getElementById('freq-input')?.value ?? '');
      if (value === null) return;
      this._editing = false;
      this._call('number', 'set_value', 'tune', { value: Math.round(value / 10) / 100 }); // kHz, 10 Hz steps
      this._render();
    };
    root.getElementById('tune-ok')?.addEventListener('click', submit);
    root.getElementById('freq-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') { this._editing = false; this._render(); }
    });
    root.getElementById('tune-cancel')?.addEventListener('click', () => { this._editing = false; this._render(); });
    root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      this._call('select', 'select_option', 'mode_select', { option: b.dataset.mode });
    }));
    const power = root.getElementById('power');
    power?.addEventListener('pointerdown', () => { this._dragging = true; });
    power?.addEventListener('input', () => {
      const out = power.parentElement.querySelector('b');
      if (out) out.textContent = `${power.value} W`;
    });
    power?.addEventListener('change', () => {
      this._dragging = false;
      this._call('number', 'set_value', 'tx_power_set', { value: Number(power.value) });
    });
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

if (globalThis.customElements && !customElements.get('ham-radio-trx-control')) {
  customElements.define('ham-radio-trx-control', HamRadioTrxControl);
}
if (globalThis.window) {
  window.customCards = window.customCards || [];
}
if (globalThis.window && !window.customCards.some((c) => c.type === 'ham-radio-trx-control')) {
  window.customCards.push({
    type: 'ham-radio-trx-control',
    name: 'Ham radio TRX control',
    description: 'Frequency, band, mode, TX power and S-meter of a transceiver, with tuning, mode and power controls.',
    documentationURL: 'https://github.com/michalsiman/ham-radio-trx-control',
  });
}
console.info(`%c HAM-RADIO-TRX-CONTROL %c ${VERSION} `, 'color:#fff;background:#03a9f4;font-weight:700', 'color:#03a9f4');
