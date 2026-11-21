// Assertions for this bundle's client module, runnable without a browser:
//
//   node .smoke/smoke.js
//
// It evaluates client.js with a fake module loader and a fake Cordis context,
// then renders the Turn cost row for representative provider-reported usage at
// peak and off-peak instants. It exits non-zero on the first failed expectation.
// No network, no React, no DOM.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');

let factory;
const styleElements = [];
vm.runInNewContext(source, {
  window: { __ModuleLoader__: { load: (definition) => { factory = definition.factory; } } },
  document: {
    createElement: () => ({ textContent: '', remove() { styleElements.pop(); } }),
    head: { appendChild: (element) => { styleElements.push(element); } },
  },
}, { filename: 'client.js' });
assert.equal(typeof factory, 'function', 'bundle registers a factory');

// The row keeps expand/collapse in one React state slot; the shim exposes it so
// the same component can be rendered closed and open.
let openFlag = false;
const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children };
  },
  useState(initial) {
    return [openFlag === undefined ? initial : openFlag, (next) => { openFlag = next; }];
  },
};

const plugin = factory((specifier) => {
  if (specifier === 'react') return React;
  throw new Error('unexpected require: ' + specifier);
});

let registered;
let dictionaries;
const disposers = [];
const styleInserts = [];
plugin.apply({
  effect(callback) {
    const dispose = callback();
    disposers.push(dispose);
    if (typeof dispose === 'function') styleInserts.push(dispose);
    return typeof dispose === 'function' ? dispose : () => {};
  },
  locale: {
    register(_ns, dicts) {
      dictionaries = dicts;
      return () => {};
    },
  },
  slots: {
    inject(_name, callback) { return callback(); },
    register(options, component) {
      registered = { options, component };
      return () => {};
    },
  },
});

// ---- helpers --------------------------------------------------------------

/** Concatenate every rendered text node below one element. */
function text(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return node.children.map(text).join('');
}

/** Collect elements whose className contains `name`. */
function byClass(node, name, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) byClass(child, name, out);
    return out;
  }
  if (typeof node.props.className === 'string' && node.props.className.split(' ').includes(name)) out.push(node);
  for (const child of node.children) byClass(child, name, out);
  return out;
}

/** Host-style translator over the dictionaries the bundle registered. */
function translate(locale) {
  const dict = dictionaries[locale] ?? dictionaries.en;
  return (key, params) => {
    let value = dict[key];
    if (value === undefined) value = dictionaries.en[key] ?? key;
    for (const [name, replacement] of Object.entries(params ?? {})) {
      value = value.split('{' + name + '}').join(String(replacement));
    }
    return value;
  };
}

const usage = {
  uncachedInputTokens: 12300,
  outputTokens: 1200,
  totalTokens: 18000,
  cacheReadTokens: 4500,
  cacheWriteTokens: 0,
  routes: [{ provider: 'deepseek-account', model: 'deepseek-flash' }],
};

function render(value, time, locale = 'en') {
  return registered.component({
    turn: {
      data: { get: (key) => (key === 'turn-tail' ? { tokenUsage: value } : undefined) },
      end: { time },
    },
    t: translate(locale),
  });
}

// Monday 2026-11-16: 02:00Z is 10:00 Beijing (peak), 11:00Z is 19:00 (off-peak),
// 04:00Z is exactly the 12:00 end of the morning peak, and 2026-11-15 is a Sunday.
const PEAK = Date.parse('2026-11-16T02:00:00Z');
const OFF_PEAK = Date.parse('2026-11-16T11:00:00Z');

// ---- registration ---------------------------------------------------------

assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale'], 'declares its two services');
assert.equal(registered.options.name, 'conversation.chat.turnTail', 'registers in the Turn tail');
assert.equal(registered.options.id, 'turn-cost', 'uses its own cell id');
assert.equal(registered.options.order, 10, 'sits between the shipped entries and the schedule card');
assert.equal(registered.options.locale, 'token-cost', 'binds its own locale namespace');
assert.ok(dictionaries.en && dictionaries.ru && dictionaries.zh, 'registers en, ru, and zh');
assert.equal(styleElements.length, 1, 'inserts exactly one page stylesheet');
assert.match(styleElements[0].textContent, /\.dsh-token-cost-trigger/, 'stylesheet carries the row classes');

// ---- closed row -----------------------------------------------------------

openFlag = false;
const closed = render(usage, PEAK);
assert.equal(closed.props.className, 'dsh-token-cost-row', 'row wrapper');
const trigger = byClass(closed, 'dsh-token-cost-trigger')[0];
assert.ok(trigger, 'renders one trigger button');
assert.equal(trigger.type, 'button', 'the trigger is a real button, so keyboard and touch reach it');
assert.equal(trigger.props['aria-expanded'], false, 'expanded state is announced');
assert.equal(text(trigger), 'Cost\u2248 $0.00516', 'closed row shows the label and the estimated amount');
assert.equal(byClass(closed, 'dsh-token-cost-details').length, 0, 'closed row hides the breakdown');

// Amounts: peak vs off-peak, and the boundary instant.
assert.equal(text(byClass(render(usage, OFF_PEAK), 'dsh-token-cost-trigger')[0]), 'Cost\u2248 $0.00258');
assert.equal(text(byClass(render(usage, Date.parse('2026-11-16T04:00:00Z')), 'dsh-token-cost-trigger')[0]), 'Cost\u2248 $0.00258');
assert.equal(text(byClass(render(usage, Date.parse('2026-11-15T02:00:00Z')), 'dsh-token-cost-trigger')[0]), 'Cost\u2248 $0.00258');

// Russian locale.
assert.equal(text(byClass(render(usage, PEAK, 'ru'), 'dsh-token-cost-trigger')[0]), 'Стоимость\u2248 $0.00516');
// Unknown locale falls back to English copy.
assert.equal(text(byClass(render(usage, PEAK, 'de'), 'dsh-token-cost-trigger')[0]), 'Cost\u2248 $0.00516');

// ---- expanded breakdown ---------------------------------------------------

openFlag = true;
const expanded = render(usage, PEAK);
const details = byClass(expanded, 'dsh-token-cost-details')[0];
assert.ok(details, 'the trigger opens the breakdown');
assert.ok(byClass(expanded, 'dsh-token-cost-note')[0], 'the breakdown explains where the figure comes from');
const breakdown = text(byClass(expanded, 'dsh-token-cost-breakdown')[0]);
for (const expected of [
  'Model', 'deepseek-flash',
  'Rate', 'peak (at completion)',
  'Input, no cache hit', '12.3k \u00d7 $0.30 per 1M = $0.00369',
  'Input, cache hit', '4.5k \u00d7 $0.006 per 1M = $0.00003',
  'Output', '1.2k \u00d7 $1.20 per 1M = $0.00144',
  'Estimate from provider-reported usage and published DeepSeek prices.',
]) {
  assert.ok(breakdown.includes(expected), 'breakdown states: ' + expected);
}
assert.equal(
  byClass(expanded, 'dsh-token-cost-trigger')[0].props['aria-expanded'],
  true,
  'expanded state is announced',
);
// A cache-write bucket joins only when the provider reported one.
assert.ok(!breakdown.includes('cache write'), 'a zero cache-write bucket is omitted');

openFlag = true;
const unmapped = render({ ...usage, routes: [{ provider: 'x', model: 'some-new-model' }] }, PEAK);
assert.ok(
  text(byClass(unmapped, 'dsh-token-cost-breakdown')[0])
    .includes('No published rate for some-new-model; priced as deepseek-flash.'),
  'an unmapped model says which rates were used',
);

// ---- guards ---------------------------------------------------------------

openFlag = false;
assert.equal(render(undefined, PEAK), null, 'no usage, no row');
assert.equal(registered.component({ turn: undefined, t: translate('en') }), null, 'no turn, no row');
assert.equal(registered.component({ turn: { data: { get: () => undefined } }, t: translate('en') }), null, 'no Turn data, no row');
assert.equal(render({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  routes: usage.routes,
}, PEAK), null, 'a turn that billed nothing shows no row');

// A missing locale seat must not crash the slot.
assert.equal(
  text(byClass(registered.component({
    turn: { data: { get: () => ({ tokenUsage: usage }) }, end: { time: PEAK } },
  }), 'dsh-token-cost-trigger')[0]),
  'labelapprox', // unresolved keys, never a throw
);

// Disposal removes the stylesheet the run inserted.
for (const dispose of styleInserts) dispose();
assert.equal(styleElements.length, 0, 'unloading removes the stylesheet');

console.log('ok — ' + (byClass(closed, 'dsh-token-cost-trigger').length + 1) + ' row variants checked');
