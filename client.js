/**
 * Turn cost row for the DeepSeek Harness chat.
 *
 * The completed-turn footer already reports token usage. This entry adds the
 * money figure beside it: the provider-reported usage of one finished Turn,
 * priced with the published DeepSeek rates for the model that served it.
 *
 * Usage comes from the shipped Chat package: its `turn-tail` Definition
 * publishes exact per-Turn `tokenUsage` (including the provider and model of
 * every billed attempt) against the Turn, so this row reuses that number
 * instead of folding Session events again, and it appears exactly when the
 * shipped token-usage row appears.
 *
 * The trigger copies the shipped usage pill's geometry, type scale, and colors
 * (see `TurnUsagePanel.module.css` / `MessageIconActions.module.css`): a
 * borderless button whose label and amount open an inline breakdown, so the
 * figures are reachable by pointer, touch, and keyboard alike.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-token-cost',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'token-cost';

    // Rates per 1,000,000 tokens as [off-peak, peak]. DeepSeek peak hours are
    // Beijing time (UTC+8) 09:00-12:00 and 14:00-18:00 on weekdays; every other
    // hour, and whole weekends, are off-peak. Chinese public holidays are not
    // modelled, so a holiday weekday is priced as peak.
    // Source: https://api-docs.deepseek.com/quick_start/pricing
    const USD = {
      'deepseek-flash': { cacheRead: [0.003, 0.006], input: [0.15, 0.3], output: [0.6, 1.2] },
      'deepseek-v4-pro': { cacheRead: [0.022, 0.044], input: [0.66, 1.32], output: [1.98, 3.96] },
    };
    const CNY = {
      'deepseek-flash': { cacheRead: [0.02, 0.04], input: [1, 2], output: [4, 8] },
      'deepseek-v4-pro': { cacheRead: [0.15, 0.3], input: [4.5, 9], output: [13.5, 27] },
    };
    // Change this one word to 'CNY' to read the same figures in yuan.
    const CURRENCY = 'USD';
    const TABLES = { USD: USD, CNY: CNY };
    const SYMBOLS = { USD: '$', CNY: '\u00a5' };
    const table = TABLES[CURRENCY] === undefined ? USD : TABLES[CURRENCY];
    const symbol = SYMBOLS[CURRENCY] === undefined ? '$' : SYMBOLS[CURRENCY];

    const DEFAULT_MODEL = 'deepseek-flash';
    // A retired or aliased model id bills at the price of the model that serves it.
    const MODEL_ALIASES = {
      'deepseek-flash': 'deepseek-flash',
      'deepseek-v4-flash': 'deepseek-flash',
      'deepseek-v4-flash-vision-exp': 'deepseek-flash',
      'deepseek-chat': 'deepseek-flash',
      'deepseek-v4-pro': 'deepseek-v4-pro',
      'deepseek-v4': 'deepseek-v4-pro',
      'deepseek-reasoner': 'deepseek-v4-pro',
    };

    /** Row classes; every rule below wears this package's prefix. */
    const CSS = [
      '.dsh-token-cost-row{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:0}',
      '.dsh-token-cost-trigger{display:inline-flex;align-items:center;gap:4px;min-width:0;'
        + 'height:calc(28px + var(--dsh-content-font-delta,0px));padding:6px 8px;border:none;'
        + 'border-radius:var(--dsw-radius-sm,8px);background:transparent;'
        + 'color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));'
        + 'font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);'
        + 'font-variant-numeric:tabular-nums;'
        + 'line-height:calc(24px + var(--dsh-content-font-delta,0px));white-space:nowrap;cursor:pointer}',
      '.dsh-token-cost-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,140,180,.12));'
        + 'color:var(--dsw-alias-label-secondary)}',
      '.dsh-token-cost-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsh-token-cost-trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,140,180,.12));'
        + 'color:var(--dsw-alias-label-secondary)}',
      '.dsh-token-cost-trigger svg{width:calc(15px + var(--dsh-content-font-delta,0px));'
        + 'height:calc(15px + var(--dsh-content-font-delta,0px));flex:none}',
      '.dsh-token-cost-label,.dsh-token-cost-amount{min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.dsh-token-cost-amount{color:var(--dsw-alias-label-primary);font-weight:500}',
      '.dsh-token-cost-trigger:hover .dsh-token-cost-amount,'
        + '.dsh-token-cost-trigger[aria-expanded="true"] .dsh-token-cost-amount{color:var(--dsw-alias-label-primary)}',
      '.dsh-token-cost-breakdown{display:flex;flex-direction:column;gap:4px;padding:2px 8px 4px}',
      '.dsh-token-cost-details{display:grid;grid-template-columns:auto auto;column-gap:12px;row-gap:3px;'
        + 'margin:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);'
        + 'line-height:1.45;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
      '.dsh-token-cost-details dt{margin:0}',
      '.dsh-token-cost-details dd{margin:0;font-variant-numeric:tabular-nums;'
        + 'color:var(--dsw-alias-label-secondary);text-align:right}',
      '.dsh-token-cost-note{margin:0;max-width:44ch;'
        + 'font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);line-height:1.45;'
        + 'color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
      '@media (max-width:480px){.dsh-token-cost-label{display:none}}',
    ].join('');

    /**
     * Model that served one Turn, from its provider-reported routes.
     * @param usage - per-Turn token usage published by the shipped footer.
     * @returns the first route's model id, or undefined when unattributed.
     */
    function usageModel(usage) {
      const routes = usage === null || usage === undefined ? undefined : usage.routes;
      if (!Array.isArray(routes)) return undefined;
      for (const route of routes) {
        if (route !== null && route !== undefined && typeof route.model === 'string' && route.model !== '') {
          return route.model;
        }
      }
      return undefined;
    }

    /**
     * Rate row for one model id.
     * @param model - provider model id, possibly absent.
     * @returns the rate row of its billed model, or of the default model.
     */
    function rateKeyFor(model) {
      const key = MODEL_ALIASES[String(model === undefined || model === null ? '' : model).toLowerCase()];
      return key !== undefined && table[key] !== undefined ? key : DEFAULT_MODEL;
    }

    /**
     * Whether one instant falls into DeepSeek peak hours.
     * @param time - epoch milliseconds.
     * @returns true for a weekday 09:00-12:00 or 14:00-18:00 in Beijing time.
     */
    function isPeak(time) {
      const shifted = new Date(Number(time) + 8 * 60 * 60 * 1000);
      const day = shifted.getUTCDay();
      if (!(day >= 1 && day <= 5)) return false;
      const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
      return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60);
    }

    /**
     * Price one bucket of tokens.
     * @param tokens - billed token count.
     * @param rate - currency units per 1,000,000 tokens.
     * @returns the bucket's money cost.
     */
    function costOf(tokens, rate) {
      const count = Number(tokens);
      return Number.isFinite(count) && count > 0 ? (count * rate) / 1e6 : 0;
    }

    /**
     * Price one Turn's provider-reported usage.
     * @param usage - per-Turn token usage.
     * @param peak - whether the Turn ended in peak hours.
     * @returns the reported model, the model whose rates applied, and the
     * priced buckets with their Turn total.
     */
    function priceTurn(usage, peak) {
      const reported = usageModel(usage);
      const pricedAs = rateKeyFor(reported);
      const rate = table[pricedAs];
      const index = peak ? 1 : 0;
      const buckets = [
        { key: 'input', tokens: Number(usage.uncachedInputTokens) || 0, rate: rate.input[index] },
        { key: 'cacheRead', tokens: Number(usage.cacheReadTokens) || 0, rate: rate.cacheRead[index] },
        // DeepSeek bills a cache write as ordinary prompt input.
        { key: 'cacheWrite', tokens: Number(usage.cacheWriteTokens) || 0, rate: rate.input[index] },
        { key: 'output', tokens: Number(usage.outputTokens) || 0, rate: rate.output[index] },
      ];
      let total = 0;
      for (const bucket of buckets) {
        bucket.cost = costOf(bucket.tokens, bucket.rate);
        total += bucket.cost;
      }
      return {
        reported: reported === undefined ? pricedAs : reported,
        pricedAs: pricedAs,
        peak: peak,
        buckets: buckets,
        total: total,
      };
    }

    /**
     * Drop trailing zero decimals so `12.30` reads `12.3` and `12.00` reads `12`.
     * @param text - decimal text produced by toFixed.
     * @returns text without trailing zero decimals.
     */
    function trimZeros(text) {
      return text.indexOf('.') < 0 ? text : text.replace(/\.?0+$/, '');
    }

    /**
     * Format a token count for the breakdown.
     * @param value - token count.
     * @returns compact text such as `940`, `12.3k`, or `1.05M`.
     */
    function formatTokens(value) {
      const count = Number(value);
      if (!Number.isFinite(count) || count <= 0) return '0';
      if (count < 1000) return String(count);
      if (count < 1e6) return trimZeros((count / 1000).toFixed(count < 1e4 ? 2 : 1)) + 'k';
      return trimZeros((count / 1e6).toFixed(2)) + 'M';
    }

    /**
     * Format a money amount, keeping sub-cent costs readable.
     * @param value - amount in the configured currency.
     * @returns text with the currency symbol.
     */
    function formatMoney(value) {
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount <= 0) return symbol + '0.00';
      if (amount < 0.00001) return '<' + symbol + '0.00001';
      const digits = amount >= 1 ? 2 : amount >= 0.1 ? 3 : amount >= 0.01 ? 4 : 5;
      return symbol + amount.toFixed(digits);
    }

    /**
     * Format one per-million rate, always with at least two decimals.
     * @param value - currency units per 1,000,000 tokens.
     * @returns rate text with the currency symbol.
     */
    function formatRate(value) {
      const rate = Number(value);
      if (!Number.isFinite(rate) || rate <= 0) return symbol + '0.00';
      const text = trimZeros(rate.toFixed(4));
      return symbol + (text.indexOf('.') < 0 ? text + '.00' : text.length - text.indexOf('.') < 3 ? text + '0' : text);
    }

    /** Coin stack glyph; inherits the trigger's color. */
    function CoinGlyph() {
      return h(
        'svg',
        {
          viewBox: '0 0 36 36',
          'aria-hidden': true,
          focusable: false,
          style: { display: 'block' },
        },
        h('ellipse', {
          cx: 18, cy: 11.5, rx: 8.5, ry: 3.5,
          fill: 'none', stroke: 'currentColor', strokeWidth: 2.6,
        }),
        h('path', {
          d: 'M9.5 11.5v5.6a8.5 3.5 0 0 0 17 0v-5.6',
          fill: 'none', stroke: 'currentColor', strokeWidth: 2.6,
        }),
        h('path', {
          d: 'M9.5 17.1v5.6a8.5 3.5 0 0 0 17 0v-5.6',
          fill: 'none', stroke: 'currentColor', strokeWidth: 2.6,
        }),
      );
    }

    /**
     * Money cost of one completed Turn, rendered in the shipped Turn tail.
     * @param props - Turn-tail owner currency (`turn`, `seq`, `openFile`) and the
     * locale seat; every other shipped property is unused here.
     * @returns the cost trigger with its expandable breakdown, or null when the
     * Turn reports no exact usage or billed no tokens.
     */
    function TurnCost(props) {
      // One hook, before every early return: a Turn that loses its usage must not
      // change the hook order of an already-mounted row.
      const [open, setOpen] = React.useState(false);
      const turn = props.turn;
      if (turn === null || turn === undefined) return null;
      const store = turn.data;
      if (store === null || store === undefined || typeof store.get !== 'function') return null;
      const tail = store.get('turn-tail');
      const usage = tail === null || tail === undefined ? undefined : tail.tokenUsage;
      if (usage === null || usage === undefined) return null;
      const endTime = turn.end === null || turn.end === undefined ? undefined : turn.end.time;
      const priced = priceTurn(usage, isPeak(typeof endTime === 'number' ? endTime : Date.now()));
      // A Turn whose attempts billed no tokens has nothing to price.
      if (!(priced.total > 0)) return null;
      const t = typeof props.t === 'function' ? props.t : function fallback(key) { return key; };
      const amount = formatMoney(priced.total);
      const period = priced.peak ? t('peak') : t('offPeak');
      const rows = [];
      rows.push(h('dt', { key: 'model' }, t('model')));
      rows.push(h('dd', { key: 'modelValue' }, priced.reported));
      rows.push(h('dt', { key: 'period' }, t('period')));
      rows.push(h('dd', { key: 'periodValue' }, period));
      for (const bucket of priced.buckets) {
        if (bucket.tokens <= 0) continue;
        rows.push(h('dt', { key: bucket.key }, t('bucket.' + bucket.key)));
        rows.push(h('dd', { key: bucket.key + 'Value' }, t('line', {
          tokens: formatTokens(bucket.tokens),
          rate: formatRate(bucket.rate),
          amount: formatMoney(bucket.cost),
        })));
      }
      const notes = [];
      if (priced.reported.toLowerCase() !== priced.pricedAs) {
        notes.push(t('unmapped', { model: priced.reported, pricedAs: priced.pricedAs }));
      }
      notes.push(t('note'));
      return h(
        'div',
        { className: 'dsh-token-cost-row' },
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-token-cost-trigger',
            'aria-expanded': open,
            onClick: function toggle() { setOpen(!open); },
          },
          h(CoinGlyph, null),
          h('span', { className: 'dsh-token-cost-label' }, t('label')),
          h('span', { className: 'dsh-token-cost-amount' }, t('approx', { cost: amount })),
        ),
        open
          ? h('div', {
            className: 'dsh-token-cost-breakdown',
            role: 'group',
            'aria-label': t('title'),
          },
          h('dl', { className: 'dsh-token-cost-details' }, rows),
          h('p', { className: 'dsh-token-cost-note' }, notes.join(' ')))
          : null,
      );
    }

    const dictionaries = {
      en: {
        label: 'Cost',
        approx: '\u2248 {cost}',
        title: 'Turn cost',
        model: 'Model',
        period: 'Rate',
        peak: 'peak (at completion)',
        offPeak: 'off-peak (at completion)',
        'bucket.input': 'Input, no cache hit',
        'bucket.cacheRead': 'Input, cache hit',
        'bucket.cacheWrite': 'Input, cache write',
        'bucket.output': 'Output',
        line: '{tokens} \u00d7 {rate} per 1M = {amount}',
        unmapped: 'No published rate for {model}; priced as {pricedAs}.',
        note: 'Estimate from provider-reported usage and published DeepSeek prices.',
      },
      ru: {
        label: 'Стоимость',
        approx: '\u2248 {cost}',
        title: 'Стоимость ответа',
        model: 'Модель',
        period: 'Тариф',
        peak: 'пиковый, на момент завершения',
        offPeak: 'непиковый, на момент завершения',
        'bucket.input': 'Ввод без кэша',
        'bucket.cacheRead': 'Ввод из кэша',
        'bucket.cacheWrite': 'Ввод, запись в кэш',
        'bucket.output': 'Вывод',
        line: '{tokens} \u00d7 {rate} за 1 млн = {amount}',
        unmapped: 'Для {model} нет опубликованного тарифа, взят тариф {pricedAs}.',
        note: 'Оценка по данным провайдера и опубликованным тарифам DeepSeek.',
      },
      zh: {
        label: '费用',
        approx: '\u2248 {cost}',
        title: '本轮费用',
        model: '模型',
        period: '费率',
        peak: '高峰时段，按结束时刻',
        offPeak: '空闲时段，按结束时刻',
        'bucket.input': '输入，缓存未命中',
        'bucket.cacheRead': '输入，缓存命中',
        'bucket.cacheWrite': '输入，缓存写入',
        'bucket.output': '输出',
        line: '{tokens} \u00d7 {rate} / 百万 = {amount}',
        unmapped: '{model} 没有公开价格，按 {pricedAs} 计价。',
        note: '按供应商返回的用量与 DeepSeek 公开价格估算。',
      },
    };

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries), 'token-cost: dictionaries');
        // One page-level stylesheet for every row, removed with this Client run.
        ctx.effect(() => {
          const element = document.createElement('style');
          element.textContent = CSS;
          document.head.appendChild(element);
          return () => { element.remove(); };
        }, 'token-cost: stylesheet');
        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: 'turn-cost',
          order: 10,
          locale: NS,
        }, TurnCost));
      },
    };
  },
});
