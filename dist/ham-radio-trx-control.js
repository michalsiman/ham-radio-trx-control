/*! ham-radio-trx-control 0.2.0 | MIT | https://github.com/michalsiman/ham-radio-trx-control */
/*
 * A Home Assistant card with the basics of a transceiver: a frequency
 * display, a tuning knob, band, mode, transmit power, S-meter, on/off and
 * transmit state.
 *
 * Tap the mark under a digit to choose what the knob changes (10 MHz down to
 * 100 Hz), then turn the knob: drag around it, use the mouse wheel over it,
 * or the arrow keys. The new frequency is sent when the knob stops.
 *
 * Made for the entities of ham-radio-ha-gateway, found by a prefix:
 *   type: custom:ham-radio-trx-control
 *   prefix: ic_7300        # sensor.ic_7300_frequency, number.ic_7300_tune, ...
 * Any entity can be set by hand under `entities:`.
 */

const VERSION = '0.2.0';

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

const DEFAULT_BANDS = ['80m', '40m', '20m', '15m', '12m', '10m'];

/** Where a band button tunes when the band has no remembered frequency: by kind of mode. */
const BAND_DEFAULTS = {
  '160m': { data: 1842000, cw: 1830000, voice: 1850000 },
  '80m': { data: 3578000, cw: 3550000, voice: 3700000 },
  '60m': { data: 5357000, cw: 5354000, voice: 5363000 },
  '40m': { data: 7078000, cw: 7030000, voice: 7100000 },
  '30m': { data: 10130000, cw: 10116000, voice: 10130000 },
  '20m': { data: 14078000, cw: 14050000, voice: 14200000 },
  '17m': { data: 18104000, cw: 18086000, voice: 18130000 },
  '15m': { data: 21078000, cw: 21050000, voice: 21250000 },
  '12m': { data: 24922000, cw: 24906000, voice: 24940000 },
  '10m': { data: 28078000, cw: 28050000, voice: 28500000 },
  '6m': { data: 50318000, cw: 50090000, voice: 50150000 },
  '2m': { data: 144174000, cw: 144050000, voice: 144300000 },
};

const MODE_LABELS = { PKTUSB: 'USB-D', PKTLSB: 'LSB-D', PKTFM: 'FM-D', CWR: 'CW-R' };

/** One click of the knob every this many degrees: 24 per turn, like a detented VFO. */
const DEGREES_PER_STEP = 15;
/** Send the frequency this long after the knob stopped. */
const SEND_DELAY_MS = 350;
const MIN_HZ = 30_000;
const MAX_HZ = 470_000_000;

const STRINGS = {
  en: {
    off: 'Radio off', unavailable: 'Gateway offline', tx: 'TX', power: 'Power', mode: 'Mode',
    tune_hint: 'Frequency in MHz (14.074) or kHz (14074)', tune: 'Tune', cancel: 'Cancel', out_of_band: 'Out of band',
    enter: 'Enter frequency', knob: 'Tuning knob', step: 'Step', band: 'Band (m)',
  },
  cs: {
    off: 'Rádio vypnuté', unavailable: 'Brána offline', tx: 'TX', power: 'Výkon', mode: 'Mód',
    tune_hint: 'Frekvence v MHz (14.074) nebo kHz (14074)', tune: 'Naladit', cancel: 'Zrušit', out_of_band: 'Mimo pásmo',
    enter: 'Zadat frekvenci', knob: 'Ladicí kolečko', step: 'Krok', band: 'Pásmo (m)',
  },
};

function band(hz) {
  const b = BANDS.find(([lo, hi]) => hz >= lo && hz <= hi);
  return b ? b[2] : null;
}

/** "80 m", "80M", "80m" → "80m". */
export function bandKey(name) {
  return String(name).toLowerCase().replace(/\s+/g, '');
}

/** Data, CW or voice: picks a band's default frequency. */
export function modeKind(mode) {
  const m = String(mode ?? '').toUpperCase();
  if (m.startsWith('PKT') || m === 'RTTY' || m === 'RTTYR' || m.startsWith('DATA')) return 'data';
  if (m.startsWith('CW')) return 'cw';
  return 'voice';
}

/** Where a band button tunes: the band's remembered frequency, else its default for the mode. */
export function bandTarget(key, mode, memory) {
  const remembered = memory?.[key];
  const range = BANDS.find(([, , n]) => bandKey(n) === key);
  if (remembered && range && remembered >= range[0] && remembered <= range[1]) return remembered;
  const defaults = BAND_DEFAULTS[key];
  if (defaults) return defaults[modeKind(mode)];
  return range ? range[0] : null;
}

/** 14074500 → "14.0745": MHz with 100 Hz resolution. */
export function formatFrequency(hz) {
  return (Math.round(hz / 100) / 1e4).toFixed(4);
}

/** The digits of formatFrequency with the step each one stands for (null for the point). */
export function frequencyDigits(hz) {
  const text = formatFrequency(hz);
  const point = text.indexOf('.');
  return [...text].map((ch, i) => {
    if (ch === '.') return { ch, step: null };
    const power = i < point ? point - 1 - i : -(i - point);
    return { ch, step: Math.round(10 ** (6 + power)) };
  });
}

/** Label for a step in Hz: "100 Hz", "1 kHz", "10 MHz". */
export function stepLabel(step) {
  if (step >= 1e6) return `${step / 1e6} MHz`;
  if (step >= 1e3) return `${step / 1e3} kHz`;
  return `${step} Hz`;
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

/**
 * Turn the frequency by whole steps of the chosen digit. From a frequency
 * between steps, the first click only reaches the next step in that direction.
 */
export function stepFrequency(hz, step, clicks) {
  let target;
  if (hz % step === 0) target = hz + clicks * step;
  else if (clicks > 0) target = Math.ceil(hz / step) * step + (clicks - 1) * step;
  else target = Math.floor(hz / step) * step + (clicks + 1) * step;
  return Math.max(MIN_HZ, Math.min(MAX_HZ, target));
}

/** The knob as SVG: a grip ring, a body and a finger dimple, turned by `angle` degrees. */
function knobSvg(angle) {
  const ridges = Array.from({ length: 60 }, (_, i) => {
    const a = (i * 6 * Math.PI) / 180;
    const x1 = 50 + 44 * Math.sin(a);
    const y1 = 50 - 44 * Math.cos(a);
    const x2 = 50 + 48 * Math.sin(a);
    const y2 = 50 - 48 * Math.cos(a);
    return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
  }).join('');
  return `
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="body" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stop-color="#5a5f66"/><stop offset="60%" stop-color="#2d3036"/><stop offset="100%" stop-color="#1b1d21"/>
        </radialGradient>
        <radialGradient id="dimple" cx="60%" cy="65%" r="70%">
          <stop offset="0%" stop-color="#3a3e44"/><stop offset="100%" stop-color="#121316"/>
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="49" fill="#15171a"/>
      <g class="rotor" style="transform: rotate(${angle}deg)">
        <circle cx="50" cy="50" r="48" fill="#24272c"/>
        <g class="ridges" stroke="#3c4047" stroke-width="1.6">${ridges}</g>
        <circle cx="50" cy="50" r="42" fill="url(#body)" stroke="#0f1013" stroke-width="1"/>
        <circle cx="50" cy="50" r="30" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="0.8"/>
        <circle cx="50" cy="22" r="8.5" fill="url(#dimple)" stroke="#0d0e10" stroke-width="0.8"/>
      </g>
    </svg>`;
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
    this._config = { modes: DEFAULT_MODES, bands: DEFAULT_BANDS, show_s_meter: true, show_knob: true, ...config };
    this._memKey = `ham-radio-trx-control:bands:${config.prefix ?? ids.frequency}`;
    this._ids = ids;
    this._editing = false;
    this._step = this._step ?? 1000;
    this._angle = this._angle ?? 0;
    this._render(true);
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    // A frequency being tuned is shown until the radio reports it, or 3 s pass.
    if (this._pendingHz !== undefined) {
      const reported = this._radioHz();
      if (reported === this._pendingHz || Date.now() - this._pendingAt > 3000) this._pendingHz = undefined;
    }
    // Not while the user types a frequency, drags the slider or turns the knob.
    if (this._editing || this._dragging || this._turning || this._pendingHz !== undefined) return;
    if (!old || Object.values(this._ids ?? {}).some((id) => id && old.states[id] !== hass.states[id])) {
      this._render();
    }
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: 'auto' };
  }

  disconnectedCallback() {
    clearTimeout(this._sendTimer);
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

  _radioHz() {
    const mhz = this._num('frequency');
    return mhz !== null ? Math.round(mhz * 1e6) : null;
  }

  _online() {
    const f = this._state('frequency');
    return !!f && f.state !== 'unavailable' && this._state('online')?.state === 'on';
  }

  _call(domain, service, key, data) {
    const entity_id = this._ids[key];
    if (!entity_id || !this._hass?.states[entity_id]) return;
    this._hass.callService(domain, service, { entity_id, ...data });
  }

  // ── band memory ──────────────────────────────────────────────────

  _bandMemory() {
    try {
      return JSON.parse(localStorage.getItem(this._memKey) || '{}');
    } catch {
      return {};
    }
  }

  /** Remember the frequency on its band, so the band button comes back to it. */
  _rememberBand(hz) {
    const name = hz ? band(hz) : null;
    if (!name) return;
    const memory = this._bandMemory();
    const key = bandKey(name);
    if (memory[key] === hz) return;
    memory[key] = hz;
    try {
      localStorage.setItem(this._memKey, JSON.stringify(memory));
    } catch {
      // Private mode or full storage: no memory, defaults still work.
    }
  }

  _goToBand(key) {
    const target = bandTarget(key, this._state('mode')?.state, this._bandMemory());
    if (!target || !this._online()) return;
    this._pendingHz = target;
    this._pendingAt = Date.now();
    this._call('number', 'set_value', 'tune', { value: Math.round(target / 10) / 100 });
    this._render();
  }

  // ── tuning ───────────────────────────────────────────────────────

  /** Shown frequency: the one being tuned, else the radio's. */
  _shownHz() {
    return this._pendingHz ?? this._radioHz();
  }

  _turn(clicks) {
    if (!this._online() || !this._state('tune')) return;
    const from = this._shownHz();
    if (from === null) return;
    this._pendingHz = stepFrequency(from, this._step, clicks);
    this._pendingAt = Date.now();
    this._paintDisplay();
    clearTimeout(this._sendTimer);
    this._sendTimer = setTimeout(() => {
      if (this._pendingHz === undefined) return;
      this._pendingAt = Date.now();
      this._call('number', 'set_value', 'tune', { value: Math.round(this._pendingHz / 10) / 100 }); // kHz
    }, SEND_DELAY_MS);
  }

  /** Update only the display and the knob, so a drag on the knob isn't interrupted. */
  _paintDisplay() {
    const root = this.shadowRoot;
    const digits = root?.getElementById('digits');
    if (digits) digits.innerHTML = this._digitsHtml(this._shownHz(), this._online());
    const band_ = root?.getElementById('band');
    const hz = this._shownHz();
    if (band_) band_.textContent = hz && this._online() ? (band(hz) ?? this._t('out_of_band')) : '';
    const rotor = root?.querySelector('.rotor');
    if (rotor) rotor.style.transform = `rotate(${this._angle}deg)`;
    const step = root?.getElementById('step');
    if (step) step.textContent = stepLabel(this._step);
  }

  _digitsHtml(hz, online) {
    if (!hz || !online) {
      return '<span class="dg dim">--.----</span>';
    }
    return frequencyDigits(hz).map(({ ch, step }) => (step === null
      ? '<span class="pt">.</span>'
      : `<span class="dg${step === this._step ? ' sel' : ''}" data-step="${step}" title="${this._t('step')} ${stepLabel(step)}">${ch}<i></i></span>`)).join('');
  }

  _bindKnob(knob) {
    let last = null;
    let rest = 0;
    const angleOf = (e) => {
      const r = knob.getBoundingClientRect();
      return (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
    };
    knob.addEventListener('pointerdown', (e) => {
      if (!this._online()) return;
      knob.setPointerCapture(e.pointerId);
      this._turning = true;
      last = angleOf(e);
      e.preventDefault();
    });
    knob.addEventListener('pointermove', (e) => {
      if (last === null) return;
      const a = angleOf(e);
      let delta = a - last;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      last = a;
      this._angle += delta;
      rest += delta;
      const clicks = Math.trunc(rest / DEGREES_PER_STEP);
      if (clicks) {
        rest -= clicks * DEGREES_PER_STEP;
        this._turn(clicks);
      } else {
        this._paintDisplay();
      }
    });
    const end = () => {
      last = null;
      rest = 0;
      this._turning = false;
    };
    knob.addEventListener('pointerup', end);
    knob.addEventListener('pointercancel', end);
    knob.addEventListener('wheel', (e) => {
      if (!this._online()) return;
      e.preventDefault();
      const clicks = e.deltaY < 0 ? 1 : -1;
      this._angle += clicks * DEGREES_PER_STEP;
      this._turn(clicks);
    }, { passive: false });
    knob.addEventListener('keydown', (e) => {
      const clicks = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
      if (!clicks) return;
      e.preventDefault();
      this._angle += Math.sign(clicks) * DEGREES_PER_STEP;
      this._turn(clicks);
    });
  }

  // ── drawing ──────────────────────────────────────────────────────

  _render(force = false) {
    if (!this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    if (!this._hass) {
      if (force) this.shadowRoot.innerHTML = `<ha-card><div class="pad">…</div></ha-card>`;
      return;
    }
    const freqState = this._state('frequency');
    const gatewayDown = !freqState || freqState.state === 'unavailable';
    const online = this._online();
    const tx = online && this._state('transmitting')?.state === 'on';
    const hz = this._shownHz();
    const mode = this._state('mode')?.state;
    const powerSet = this._state('tx_power_set');
    const watts = this._num('tx_power');
    const smeter = this._num('s_meter');
    const modeOptions = this._state('mode_select')?.attributes?.options ?? [];
    const modes = this._config.modes.filter((m) => !modeOptions.length || modeOptions.includes(m));
    if (mode && !modes.includes(mode) && modeOptions.includes(mode)) modes.push(mode);
    const name = this._config.name ?? freqState?.attributes?.friendly_name?.replace(/\s*Frequency$/i, '') ?? 'Radio';
    const status = gatewayDown ? this._t('unavailable') : online ? '' : this._t('off');
    const pct = smeter === null || !online ? 0 : Math.max(0, Math.min(100, ((smeter + 54) / (54 + 60)) * 100));
    const pmax = Number(powerSet?.attributes?.max ?? 100);
    const pstep = Number(powerSet?.attributes?.step ?? 1);
    const canTune = online && !!this._state('tune');
    if (online && this._pendingHz === undefined) this._rememberBand(this._radioHz());
    const currentBand = hz ? bandKey(band(hz) ?? '') : '';
    const bands = this._config.bands.map(bandKey).filter((k) => BANDS.some(([, , n]) => bandKey(n) === k));

    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 16px; ${online ? '' : 'opacity: 0.8;'} }
        .head { display: flex; align-items: center; gap: 8px; }
        .name { flex: 1; font-weight: 500; color: var(--primary-text-color); }
        .dot { width: 10px; height: 10px; border-radius: 50%; background: ${online ? 'var(--success-color, #43a047)' : 'var(--disabled-text-color, #888)'}; }
        .tx { padding: 2px 10px; border-radius: 6px; font-weight: 700; font-size: 13px; letter-spacing: 1px;
              background: ${tx ? 'var(--error-color, #db4437)' : 'transparent'}; color: ${tx ? '#fff' : 'var(--disabled-text-color, #888)'};
              border: 1px solid ${tx ? 'var(--error-color, #db4437)' : 'var(--divider-color, #555)'}; }

        /* The display: dark glass with a lit readout, like a radio's LCD. */
        .lcd { position: relative; margin-top: 12px; padding: 10px 14px 8px; border-radius: 10px;
               background: linear-gradient(180deg, #0c1a14, #08120e); border: 2px solid #2b3a33;
               box-shadow: inset 0 2px 8px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.05); }
        .lcd .row { display: flex; align-items: baseline; gap: 8px; }
        #digits { display: flex; align-items: baseline; font: 600 44px/1.15 var(--ha-font-family-code, monospace);
                  color: ${online ? '#8dffc4' : '#3d5a4b'}; text-shadow: ${online ? '0 0 8px rgba(80,255,170,0.45)' : 'none'};
                  font-variant-numeric: tabular-nums; }
        .dg { position: relative; display: inline-block; padding-bottom: 10px; cursor: ${canTune ? 'pointer' : 'default'}; }
        .dg i { position: absolute; left: 15%; right: 15%; bottom: 0; height: 4px; border-radius: 2px;
                background: rgba(141,255,196,0.18); }
        .dg.sel i { background: #8dffc4; box-shadow: 0 0 6px rgba(80,255,170,0.7); }
        .dg.dim { color: #3d5a4b; }
        .pt { padding-bottom: 10px; }
        .unit { font: 600 16px var(--ha-font-family-code, monospace); color: #5fbf92; }
        .lcd .info { display: flex; gap: 12px; font: 13px var(--ha-font-family-code, monospace); color: #5fbf92; min-height: 18px; }
        .lcd .info .grow { flex: 1; }
        .lcd .status { color: #ffb74d; }
        .edit { position: absolute; top: 6px; right: 8px; padding: 2px 6px; border: none; background: transparent;
                color: #5fbf92; cursor: pointer; font-size: 16px; }

        .tune { display: flex; gap: 8px; margin: 10px 0 4px; flex-wrap: wrap; align-items: center; }
        .tune input { flex: 1; min-width: 120px; font: 600 20px var(--ha-font-family-code, monospace); padding: 6px 8px;
                      border-radius: 8px; border: 1px solid var(--divider-color, #555); background: var(--card-background-color); color: var(--primary-text-color); }
        .hint { width: 100%; font-size: 12px; color: var(--secondary-text-color); }

        .knob-wrap { display: flex; justify-content: center; margin: 14px 0 4px; }
        .knob { width: 150px; height: 150px; border-radius: 50%; touch-action: none; user-select: none;
                cursor: ${canTune ? 'grab' : 'default'}; outline: none;
                filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5)); opacity: ${canTune ? 1 : 0.5}; }
        .knob:active { cursor: ${canTune ? 'grabbing' : 'default'}; }
        .knob:focus-visible { box-shadow: 0 0 0 3px var(--primary-color); }
        .knob svg { width: 100%; height: 100%; display: block; }
        .rotor { transform-origin: 50px 50px; }

        button { font: inherit; cursor: pointer; border-radius: 8px; padding: 6px 12px; border: 1px solid var(--divider-color, #555);
                 background: transparent; color: var(--primary-text-color); }
        button.primary { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
        button:disabled { opacity: 0.5; cursor: default; }
        .label { margin-top: 14px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--secondary-text-color); }
        /* One row each: buttons share the width. */
        .row-buttons { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 4px; margin-top: 6px; }
        .row-buttons button { padding: 6px 2px; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .row-buttons button.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
        .power { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
        .power input { flex: 1; accent-color: var(--primary-color); }
        .power b, .meter b { min-width: 56px; text-align: right; color: var(--primary-text-color); }
        .meter { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
        /* Lit part only, coloured on a fixed scale: green to S9, orange to S9+30, red above. */
        .bar { flex: 1; height: 8px; border-radius: 4px; overflow: hidden; background: rgba(127,127,127,0.25); }
        .bar i { display: block; height: 100%; width: ${pct}%;
                 background: linear-gradient(90deg, var(--success-color, #43a047) 0 47%, var(--warning-color, #ff9800) 47% 75%, var(--error-color, #db4437) 75%);
                 background-size: ${pct > 0 ? (10000 / pct).toFixed(1) : 100}% 100%; }
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
          <div class="lcd">
            ${canTune ? `<button class="edit" id="edit" title="${this._t('enter')}" aria-label="${this._t('enter')}">⌨</button>` : ''}
            <div class="row"><span id="digits">${this._digitsHtml(hz, online)}</span><span class="unit">MHz</span></div>
            <div class="info">
              ${status ? `<span class="status">${status}</span>` : `<span id="band">${hz ? (band(hz) ?? this._t('out_of_band')) : ''}</span>`}
              ${online && mode ? `<span>${escapeHtml(MODE_LABELS[mode] ?? mode)}</span>` : ''}
              <span class="grow"></span>
              ${online ? `<span>${this._t('step')} <span id="step">${stepLabel(this._step)}</span></span>` : ''}
            </div>
          </div>`}
        ${this._config.show_knob && this._state('tune') ? `
          <div class="knob-wrap">
            <div class="knob" id="knob" tabindex="${canTune ? 0 : -1}" role="slider" aria-label="${this._t('knob')}">${knobSvg(this._angle)}</div>
          </div>` : ''}
        ${this._state('mode_select') ? `
          <div class="label">${this._t('mode')}</div>
          <div class="row-buttons" style="--n: ${modes.length}">
            ${modes.map((m) => `<button data-mode="${escapeHtml(m)}" class="${online && m === mode ? 'on' : ''}" ${online ? '' : 'disabled'}>${escapeHtml(MODE_LABELS[m] ?? m)}</button>`).join('')}
          </div>` : ''}
        ${this._state('tune') && bands.length ? `
          <div class="label">${this._t('band')}</div>
          <div class="row-buttons" style="--n: ${bands.length}">
            ${bands.map((b) => `<button data-band="${b}" class="${online && b === currentBand ? 'on' : ''}" ${canTune ? '' : 'disabled'}>${b.replace('m', '')}</button>`).join('')}
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
    // A tap on a digit's mark chooses what the knob changes.
    root.getElementById('digits')?.addEventListener('click', (e) => {
      const digit = e.target.closest?.('[data-step]');
      if (!digit || !canTune) return;
      this._step = Number(digit.dataset.step);
      this._paintDisplay();
    });
    root.getElementById('edit')?.addEventListener('click', () => {
      this._editing = true;
      this._render();
      const input = root.getElementById('freq-input');
      input?.focus();
      input?.select();
    });
    const knob = root.getElementById('knob');
    if (knob && canTune) this._bindKnob(knob);
    const submit = () => {
      const value = parseFrequency(root.getElementById('freq-input')?.value ?? '');
      if (value === null) return;
      this._editing = false;
      this._pendingHz = Math.max(MIN_HZ, Math.min(MAX_HZ, value));
      this._pendingAt = Date.now();
      this._call('number', 'set_value', 'tune', { value: Math.round(this._pendingHz / 10) / 100 });
      this._render();
    };
    root.getElementById('tune-ok')?.addEventListener('click', submit);
    root.getElementById('freq-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') { this._editing = false; this._render(); }
    });
    root.getElementById('tune-cancel')?.addEventListener('click', () => { this._editing = false; this._render(); });
    root.querySelectorAll('[data-band]').forEach((b) => b.addEventListener('click', () => this._goToBand(b.dataset.band)));
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
    description: 'Frequency display and tuning knob, band, mode, TX power and S-meter of a transceiver.',
    documentationURL: 'https://github.com/michalsiman/ham-radio-trx-control',
  });
}
console.info(`%c HAM-RADIO-TRX-CONTROL %c ${VERSION} `, 'color:#fff;background:#03a9f4;font-weight:700', 'color:#03a9f4');
