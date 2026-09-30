/*
 * Ampulheta — utils.js
 * Utilitários genéricos: matemática, hash determinístico, identificadores e DOM seguro.
 *
 * Todos os módulos do projeto são scripts clássicos que registram suas APIs no
 * namespace global `Ampulheta`. Isso permite abrir o `index.html` diretamente
 * (file://) e também publicar em qualquer servidor estático (GitHub Pages),
 * sem build e sem restrições de CORS de ES Modules.
 */
(function (root) {
  'use strict';

  const A = (root.Ampulheta = root.Ampulheta || {});

  /* ------------------------------------------------------------------ */
  /* Matemática                                                          */
  /* ------------------------------------------------------------------ */

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /** Arredonda para `digits` algarismos significativos. */
  function roundSignificant(value, digits) {
    if (!isFinite(value) || value === 0) return value;
    const magnitude = Math.floor(Math.log10(Math.abs(value)));
    const factor = Math.pow(10, digits - 1 - magnitude);
    return Math.round(value * factor) / factor;
  }

  /* ------------------------------------------------------------------ */
  /* Hash determinístico (sementes para a posição visual dos grãos)      */
  /* ------------------------------------------------------------------ */

  /** Hash inteiro de 32 bits (lowbias32 — Chris Wellons). */
  function hash32(n) {
    let x = n | 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
  }

  /** Número pseudoaleatório estável em [0, 1) para uma semente inteira. */
  function random01(seed) {
    return hash32(seed) / 4294967296;
  }

  /** FNV-1a de 32 bits para strings. */
  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /* ------------------------------------------------------------------ */
  /* Identificadores                                                      */
  /* ------------------------------------------------------------------ */

  function uuid() {
    const c = root.crypto;
    if (c && typeof c.randomUUID === 'function') {
      try {
        return c.randomUUID();
      } catch (e) {
        /* contextos não seguros (file://) podem recusar; segue o fallback */
      }
    }
    const bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') {
      c.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return (
      hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
      hex.slice(16, 20) + '-' + hex.slice(20)
    );
  }

  /* ------------------------------------------------------------------ */
  /* DOM seguro — nunca usa innerHTML com dados                           */
  /* ------------------------------------------------------------------ */

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * Cria um elemento.
   * el('button', { class: 'x', text: 'Olá', attrs: { 'aria-label': '…' }, on: { click: fn } }, [filhos])
   */
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      if (props.class) node.className = props.class;
      if (props.text != null) node.textContent = String(props.text);
      if (props.attrs) {
        for (const key of Object.keys(props.attrs)) {
          const value = props.attrs[key];
          if (value === false || value == null) continue;
          node.setAttribute(key, value === true ? '' : String(value));
        }
      }
      if (props.dataset) {
        for (const key of Object.keys(props.dataset)) node.dataset[key] = String(props.dataset[key]);
      }
      if (props.on) {
        for (const type of Object.keys(props.on)) node.addEventListener(type, props.on[type]);
      }
    }
    if (children) append(node, children);
    return node;
  }

  function append(node, children) {
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) {
      if (child == null || child === false) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  /** Ícone a partir do sprite SVG embutido no index.html. */
  function icon(name, className) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon' + (className ? ' ' + className : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k of Object.keys(attrs)) node.setAttribute(k, String(attrs[k]));
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function qs(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function qsa(selector, scope) {
    return Array.from((scope || document).querySelectorAll(selector));
  }

  /** Verdadeiro quando o foco está num campo em que o usuário digita. */
  function isTypingTarget(target) {
    if (!target || !target.tagName) return false;
    const tag = target.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const type = (target.getAttribute('type') || 'text').toLowerCase();
      return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'file'].includes(type);
    }
    return !!target.isContentEditable;
  }

  /* ------------------------------------------------------------------ */
  /* Diversos                                                             */
  /* ------------------------------------------------------------------ */

  function debounce(fn, ms) {
    let t = 0;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function mediaQuery(query) {
    try {
      return root.matchMedia ? root.matchMedia(query) : null;
    } catch (e) {
      return null;
    }
  }

  function systemPrefersReducedMotion() {
    const mq = mediaQuery('(prefers-reduced-motion: reduce)');
    return !!(mq && mq.matches);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1500);
  }

  /** Emissor de eventos mínimo. */
  function createEmitter() {
    const map = new Map();
    return {
      on(type, fn) {
        if (!map.has(type)) map.set(type, new Set());
        map.get(type).add(fn);
        return () => map.get(type).delete(fn);
      },
      emit(type, payload) {
        const set = map.get(type);
        if (!set) return;
        for (const fn of Array.from(set)) {
          try {
            fn(payload);
          } catch (err) {
            console.error('[Ampulheta]', err);
          }
        }
      }
    };
  }

  A.utils = {
    clamp,
    lerp,
    smoothstep,
    roundSignificant,
    hash32,
    random01,
    hashString,
    uuid,
    el,
    append,
    icon,
    svgEl,
    clear,
    qs,
    qsa,
    isTypingTarget,
    debounce,
    wait,
    nextFrame,
    mediaQuery,
    systemPrefersReducedMotion,
    downloadBlob,
    createEmitter
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
