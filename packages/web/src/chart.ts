// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Chart wrapper around TradingView Lightweight Charts™ (Apache-2.0).
// Attribution: the library's `attributionLogo` stays enabled (link to tradingview.com) and
// the NOTICE text is shown in the page footer and About dialog. Do not disable either.

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type AutoscaleInfo,
  type IChartApi,
  type IPaneApi,
  type Logical,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  atmSessions,
  fvg,
  htfCandles,
  roundToTick,
  tickDecimals,
  type AtmSession,
  type Bar,
  type FvgZone,
  type HtfSet,
} from '@candledrill/core';
import type { AggregateOptions } from '@candledrill/core';
import { weekdayName } from './labels.js';
import {
  adx,
  aroon,
  atr,
  awesomeOscillator,
  balanceOfPower,
  bollinger,
  cci,
  cmf,
  dema,
  donchian,
  elderRay,
  ema,
  envelope,
  hull,
  ichimoku,
  kdj,
  keltner,
  macd,
  momentum,
  obv,
  orbLevels,
  parabolicSar,
  priceChannel,
  roc,
  rsi,
  sma,
  standardErrorBands,
  stochastic,
  supertrend,
  tema,
  vwap,
  vwapBands,
  vwma,
  williamsR,
  wma,
  zigzag,
} from './indicators.js';
import {
  HTF_MINUTES,
  htfLabel,
  isOverlayKind,
  type IndicatorSetting,
  type PaneIndicatorConfig,
} from './indicator-prefs.js';
import { t, type MessageKey } from './i18n.js';
import { fromDisplayWall, toDisplayWall } from './display-time.js';
import { getSettings } from './settings.js';
import { el } from './format.js';
import { HorizontalLock } from './drawing-palette.js';

/** A bounded window within loaded, revealed bars; both trade endpoints must exist. */
export function tradeWindow(
  times: readonly number[],
  start: number,
  end: number,
  context = 5,
): { from: number; to: number } | null {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    !Number.isInteger(context) ||
    context < 0
  )
    return null;
  const first = times.indexOf(start);
  const last = times.indexOf(end);
  if (first < 0 || last < first) return null;
  const from = Math.max(0, first - context);
  const to = Math.min(times.length - 1, last + context);
  // A single loaded bar still needs non-zero logical width; the extra slot has no data.
  return { from, to: Math.max(from + 1, to) };
}

export interface ChartTheme {
  background: string;
  text: string;
  grid: string;
  border: string;
  up: string;
  down: string;
  accent: string;
}

export function readTheme(): ChartTheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  const user = getSettings();
  return {
    background: v('--chart-bg') || v('--bg'),
    text: v('--muted'),
    grid: user.grid ? v('--grid') || v('--panel-2') : 'rgba(0,0,0,0)',
    border: v('--border'),
    up: user.upColor || v('--up'),
    down: user.downColor || v('--down'),
    accent: v('--accent'),
  };
}

/** "#rrggbb" -> "rgba(r,g,b,a)"; other formats are returned unchanged. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`;
}

export interface PriceLineSpec {
  price: number;
  color: string;
  title: string;
  dashed?: boolean;
  /** If set, the line gets a draggable handle on the price scale. */
  orderId?: number;
  /** Protective orders get a labeled marker on the plot. Entry keeps the scale handle. */
  role?: 'entry' | 'stop-loss' | 'take-profit' | 'flatten';
  /** Price the marker's tick distance is measured from (last close). */
  reference?: number;
}

/** Live label on a stop or target marker: side of the book and distance in ticks. */
export function bracketMarkerLabel(
  role: 'stop-loss' | 'take-profit',
  price: number,
  reference: number,
  tick: number,
): string {
  const ticks = tick > 0 ? Math.round((price - reference) / tick) : 0;
  const sign = ticks > 0 ? '+' : '';
  return `${role === 'stop-loss' ? 'SL' : 'TP'} ${sign}${ticks}t`;
}

/** Hit box for a stop/target marker. Coarse pointers (and phones) use a 44px target. */
export function bracketMarkerSize(coarse: boolean): { w: number; h: number } {
  return coarse ? { w: 88, h: 44 } : { w: 72, h: 28 };
}

/** Texts for the long / short position tool, as TradingView shows them. */
export interface PositionLabels {
  target: string;
  stop: string;
  center: string[];
}

export interface MarkerSpec {
  time: number; // real (unshifted) Unix seconds, already snapped to this chart's bars
  side: 'buy' | 'sell';
  text: string;
}

export type Drawing =
  | { kind: 'hline'; id: string; price: number; color?: string }
  | {
      kind: 'tline';
      id: string;
      t1: number;
      p1: number;
      t2: number;
      p2: number;
      color?: string;
      /** Optional text shown in the middle of the line, as in TradingView. */
      text?: string;
    }
  | { kind: 'ray'; id: string; t1: number; p1: number; t2: number; p2: number; color?: string }
  | { kind: 'vline'; id: string; t1: number; p1: number; t2: number; p2: number; color?: string }
  | { kind: 'fib'; id: string; t1: number; p1: number; t2: number; p2: number; color?: string }
  | { kind: 'ce'; id: string; t1: number; p1: number; t2: number; p2: number; color?: string }
  | { kind: 'measure'; id: string; t1: number; p1: number; t2: number; p2: number; color?: string }
  | {
      kind: 'channel';
      id: string;
      t1: number;
      p1: number;
      t2: number;
      p2: number;
      /** Price offset of the parallel line from the base line. */
      w: number;
      color?: string;
    }
  | {
      kind: 'rect';
      id: string;
      t1: number;
      p1: number;
      t2: number;
      p2: number;
      color?: string;
      /** Optional text on the dashed 50% line, as on a trendline. */
      text?: string;
    }
  | { kind: 'prange'; id: string; t1: number; p1: number; t2: number; p2: number; color?: string }
  | {
      kind: 'position';
      id: string;
      side: 'long' | 'short';
      t1: number;
      t2: number;
      entry: number;
      stop: number;
      target: number;
      color?: string;
    }
  | {
      kind: 'text';
      id: string;
      t: number;
      price: number;
      text: string;
      color?: string;
      fontSize?: number;
    }
  | { kind: 'arrow'; id: string; t1: number; p1: number; t2: number; p2: number; color?: string }
  | { kind: 'freehand'; id: string; points: { t: number; p: number }[]; color?: string };

/**
 * Keep a long/short R tool consistent while dragging: the stop stays on the losing side
 * and the target on the winning side of the entry, at least one tick away.
 */
export function clampPosition<D extends Extract<Drawing, { kind: 'position' }>>(
  d: D,
  tick: number,
): D {
  const dir = d.side === 'long' ? 1 : -1;
  const stop = dir * (d.entry - d.stop) < tick ? d.entry - dir * tick : d.stop;
  const target = dir * (d.target - d.entry) < tick ? d.entry + dir * tick : d.target;
  return { ...d, stop, target };
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Width of a 13px trendline label, used to break the line around it. */
function measureLabel(s: string): number {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return s.length * 8;
  measureCtx.font = `13px ${getComputedStyle(document.documentElement).fontFamily}`;
  return measureCtx.measureText(s).width;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function elStyleBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'drawing-style-bar';
  bar.dataset.testid = 'drawing-style-bar';
  bar.hidden = true;
  return bar;
}

/** Filled triangular arrow head; size is tip-to-base length in CSS pixels. */
export function arrowHeadPath(x: number, y: number, angle: number, size = 12): string {
  const a1 = angle + Math.PI - 0.45;
  const a2 = angle + Math.PI + 0.45;
  return `M${x} ${y} L${x + size * Math.cos(a1)} ${y + size * Math.sin(a1)} L${x + size * Math.cos(a2)} ${y + size * Math.sin(a2)} Z`;
}

type DragPart =
  | 'p1'
  | 'p2'
  | 'body'
  | 'price'
  | 'entry'
  | 'stop'
  | 'target'
  | 't2'
  | 'w'
  // Rectangle: the other two corners and the four edge midpoints.
  | 'c12'
  | 'c21'
  | 'edgeT1'
  | 'edgeT2'
  | 'edgeP1'
  | 'edgeP2';

/** Fibonacci retracement levels drawn between the two anchors. */
export const FIB_LEVELS = [0, 0.5, 0.62, 0.702, 0.79, 1] as const;
/** ATM session box colour and pivot label per window key. */
const ATM_LOOK: Record<string, { color: string; tag: string }> = {
  asia: { color: '#787b86', tag: 'AS' },
  tokyo: { color: '#f23645', tag: 'TYO' },
  ny: { color: '#5b9cf6', tag: 'NY' },
};
/** HTF candle layout right of the last bar, in bar widths. */
const HTF_PAD = 6;
const HTF_BODY = 2;
const HTF_STEP = 3;
const HTF_SET_GAP = 4;
/** Time left in an HTF candle: "4:05", "2h 07m", "3d 5h". */
function remainingText(sec: number): string {
  if (sec <= 0) return '';
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}
/** CE price levels, extended to the price axis. */
export const CE_LEVELS = [1, 0.5, 0] as const;

/** Price, tick, bar and percent distance between two anchors (measure tool label). */
export function measureText(
  d: { t1: number; p1: number; t2: number; p2: number },
  tick: number,
  barSeconds: number,
  decimals: number,
): string {
  const dp = d.p2 - d.p1;
  const ticks = Math.round(dp / tick);
  const bars = Math.round((d.t2 - d.t1) / barSeconds);
  const pct = d.p1 > 0 ? (dp / d.p1) * 100 : 0;
  const sign = dp > 0 ? '+' : '';
  return `${sign}${dp.toFixed(decimals)} (${sign}${ticks}t, ${sign}${pct.toFixed(2)}%) · ${bars} bars`;
}

export interface ChartClick {
  time: number | null; // real Unix seconds of the bar under the cursor
  price: number | null;
  shift: boolean;
}

/** OHLC legend in the active language. Same numbers, new labels, after a locale change. */
export function ohlcLegendText(
  bar: { open: number; high: number; low: number; close: number },
  tick: number,
): string {
  const dp = tickDecimals(tick);
  return t('v1.ohlc', {
    o: bar.open.toFixed(dp),
    h: bar.high.toFixed(dp),
    l: bar.low.toFixed(dp),
    c: bar.close.toFixed(dp),
  });
}

/**
 * One price chart (candles + volume). Times are shifted by `timeShiftSeconds` for display
 * so the axis shows exchange-local time; the public API always uses real Unix seconds.
 */
export class PriceChart {
  private readonly chart: IChartApi;
  private readonly candles: ISeriesApi<'Candlestick'>;
  private readonly volume: ISeriesApi<'Histogram'>;
  private readonly markers: ISeriesMarkersPluginApi<Time>;
  private priceLines: IPriceLine[] = [];
  private drawingLines: IPriceLine[] = [];
  private drawingSeries: ISeriesApi<'Line'>[] = [];
  private theme: ChartTheme;
  private lastBarTime: number | undefined;
  private tick = 0.01;
  private barSeconds = 60;
  private drawings: Drawing[] = [];
  private snapFn: (t: number) => number = (t) => t;
  private readonly overlay: SVGSVGElement;
  private readonly latestBtn: HTMLButtonElement;
  // Local: TradingView-mobile style touch drawing. While a tool is active on a touch screen
  // a cursor sits on the chart; a one-finger drag moves it (the finger never covers the
  // point) and a tap places a point at the cursor.
  private touchPoints = 0;
  private touchCursor: { x: number; y: number } | null = null;
  private touchMoved = false;
  private touchGesture: { x: number; y: number; cx: number; cy: number; moved: boolean } | null =
    null;
  private clickHandler: ((c: ChartClick) => void) | undefined;
  private drawCancelHandler: (() => void) | undefined;
  private readonly cursorRing: HTMLElement;
  private readonly stepsBar: HTMLElement;
  private readonly stepsNo: HTMLElement;
  private readonly stepsMsg: HTMLElement;
  private readonly styleBar: HTMLElement;
  private overlaySig = '';
  private raf = 0;
  private selected: string | null = null;
  private drag: { id: string; part: DragPart; start: Drawing; t0: number; p0: number } | null =
    null;
  private editHandler: ((d: Drawing) => void) | undefined;
  private deleteHandler: ((id: string) => void) | undefined;
  private labeler: ((d: Extract<Drawing, { kind: 'position' }>) => PositionLabels) | undefined;
  private orderLineSpecs: PriceLineSpec[] = [];
  /** Position tool under the mouse (its labels show, as in TradingView). */
  private hoverId: string | null = null;
  private orderLineById = new Map<number, IPriceLine>();
  private orderDragHandler: ((orderId: number, price: number) => Promise<void>) | undefined;
  private orderDrag: {
    orderId: number;
    startPrice: number;
    priceLine: IPriceLine;
    handle: SVGRectElement;
  } | null = null;
  private barContextTimer: ReturnType<typeof setTimeout> | undefined;
  private barHoldStart: { x: number; y: number } | null = null;
  /** A long-press opened the bar menu; the click that follows must not set the ticket. */
  private swallowClick = false;
  // Indicators
  private indicatorConfig?: PaneIndicatorConfig;
  private indicatorAgg?: AggregateOptions;
  private indicatorBars: Bar[] = [];
  private fvgZones: FvgZone[] = [];
  private fvgColor = '#5b9cf6';
  private atmList: AtmSession[] = [];
  private htfList: HtfSet[] = [];
  private rightOffsetBars = 8;
  private overlaySeries = new Map<string, ISeriesApi<'Line'>>();
  private paneIndicatorSeries = new Map<string, ISeriesApi<'Line' | 'Histogram'>>();
  private indicatorPane: IPaneApi<Time> | undefined = undefined;
  // Freehand capture
  private freehandMode = false;
  private freehandPoints: { t: number; p: number }[] = [];
  private freehandHandler: ((points: { t: number; p: number }[]) => void) | undefined = undefined;
  private freehandDone: (() => void) | undefined = undefined;
  private pendingAnchor: { t: number; p: number } | null = null;
  private crosshair: { t: number; p: number } | null = null;
  private shiftDown = false;
  /** Shift held, or its on-screen stand-in (the palette Horizontal button) switched on. */
  private get shiftOn(): boolean {
    return this.shiftDown || HorizontalLock.on;
  }
  private drawingsLoaded = false;
  /** Last press on a line's text, to detect a double-click across redraws. */
  private lastTextDown: { id: string; at: number; x: number; y: number } | null = null;
  private drawingMode = false;
  private blindAxis = false;
  private dynSig = '';
  /** Point being dragged (a drawing handle or body), shown with a crosshair. */
  private dragCursor: { t: number; p: number } | null = null;
  private readonly dynLayer = svg('g', { class: 'overlay-dynamic' });
  private readonly axisLayer = svg('g', { class: 'overlay-future-axis' });

  constructor(
    private readonly container: HTMLElement,
    private timeShiftSeconds = 0,
  ) {
    this.theme = readTheme();
    this.chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: this.theme.background },
        textColor: this.theme.text,
        fontSize: 11,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: this.theme.grid },
        horzLines: { color: this.theme.grid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      leftPriceScale: {
        visible: false,
        borderVisible: false,
      },
      rightPriceScale: {
        borderColor: this.theme.border,
        scaleMargins: { top: 0.08, bottom: 0.22 },
        // Drop a label that does not fit the scale instead of painting it across the candles.
        entireTextOnly: true,
      },
      timeScale: {
        borderColor: this.theme.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        shiftVisibleRangeOnNewBar: true,
      },
      kineticScroll: { touch: true, mouse: false },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        // Local: on a touch screen a vertical drag on the price axis only rescales when this is on.
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
      },
    });
    this.candles = this.chart.addSeries(CandlestickSeries, {
      upColor: this.theme.up,
      downColor: this.theme.down,
      wickUpColor: this.theme.up,
      wickDownColor: this.theme.down,
      borderVisible: false,
      // Local: auto-fit also covers the HTF candles drawn right of the last bar.
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
        const info = base();
        if (!info?.priceRange || !this.htfList.length) return info;
        let { minValue, maxValue } = info.priceRange;
        for (const set of this.htfList)
          for (const c of set.candles) {
            minValue = Math.min(minValue, c.low);
            maxValue = Math.max(maxValue, c.high);
          }
        return { ...info, priceRange: { minValue, maxValue } };
      },
    });
    this.volume = this.chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    this.volume.applyOptions({ visible: this.volumeVisible() });
    this.markers = createSeriesMarkers(this.candles, []);
    // OHLC legend (top-left): last bar, or the bar under the crosshair.
    this.legend = el('div', { class: 'ohlc-legend num', 'data-testid': 'ohlc-legend' });
    this.chart.subscribeCrosshairMove((param) => {
      const d = param.time === undefined ? undefined : param.seriesData.get(this.candles);
      this.renderLegend(
        d && 'open' in d
          ? (d as unknown as { open: number; high: number; low: number; close: number })
          : null,
      );
    });
    this.overlay = svg('svg', { class: 'draw-overlay', 'data-testid': 'draw-overlay' });
    this.styleBar = elStyleBar();
    container.append(this.overlay, this.styleBar, this.legend);
    window.addEventListener('keydown', this.onShiftKey);
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => this.renderFutureAxis());
    // TradingView's ">>" button: shown while the latest bar is off screen.
    this.latestBtn = el(
      'button',
      {
        type: 'button',
        class: 'scroll-latest',
        title: `${t('pr.scrollLatest')} (Alt+Shift+→)`,
        'aria-label': t('pr.scrollLatest'),
        'data-i18n-aria': 'pr.scrollLatest',
        hidden: '',
      },
      '»',
    );
    this.latestBtn.addEventListener('click', () => this.scrollToEnd());
    container.append(this.latestBtn);
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => this.paintLatestBtn());
    this.cursorRing = el('div', { class: 'touch-cursor-ring', hidden: '' });
    this.stepsNo = el('span', { class: 'draw-steps-no' });
    this.stepsMsg = el('span', { class: 'draw-steps-msg' });
    const cancel = el('button', {
      type: 'button',
      class: 'draw-steps-cancel',
      'data-testid': 'draw-steps-cancel',
      title: t('pr.touchCancel'),
      'aria-label': t('pr.touchCancel'),
    });
    cancel.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';
    cancel.addEventListener('click', () => this.drawCancelHandler?.());
    this.stepsBar = el(
      'div',
      { class: 'draw-steps', 'data-testid': 'draw-steps', hidden: '' },
      this.stepsNo,
      this.stepsMsg,
      cancel,
    );
    container.append(this.cursorRing, this.stepsBar);
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'])
      container.addEventListener(type, this.onCursorTouch as EventListener, {
        capture: true,
        passive: false,
      });
    container.addEventListener('pointermove', this.onHover, true);
    container.addEventListener('pointerleave', this.onHover, true);
    window.addEventListener('keyup', this.onShiftKey);
    // Capture phase, so the library never turns this wheel into a time-axis zoom.
    container.addEventListener('wheel', this.onPriceAxisWheel, { capture: true, passive: false });
    this.overlay.addEventListener('wheel', this.onOverlayWheel, { passive: false });
  }

  /** A wheel over a drawing or its text still zooms the chart: hand it to the chart below. */
  private readonly onOverlayWheel = (e: WheelEvent): void => {
    const below = document
      .elementsFromPoint(e.clientX, e.clientY)
      .find((n) => !this.overlay.contains(n) && this.container.contains(n));
    if (!below) return;
    e.preventDefault();
    e.stopPropagation();
    below.dispatchEvent(new WheelEvent('wheel', e));
  };

  /**
   * Mouse wheel over the price scale stretches or squashes the price range around the
   * price under the cursor (down: zoom out, up: zoom in), like dragging the scale.
   * Double-clicking the scale still returns to auto-fit.
   */
  private readonly onPriceAxisWheel = (e: WheelEvent): void => {
    const rect = this.container.getBoundingClientRect();
    const plotW = rect.width - this.chart.priceScale('right').width();
    if (e.clientX - rect.left <= plotW || e.deltaY === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const scale = this.candles.priceScale();
    const range = scale.getVisibleRange();
    const anchor = this.candles.coordinateToPrice(e.clientY - rect.top);
    if (!range || anchor === null) return;
    const f = Math.exp(Math.max(-100, Math.min(100, e.deltaY)) * 0.002);
    const p = Number(anchor);
    scale.setVisibleRange({ from: p + (range.from - p) * f, to: p + (range.to - p) * f });
  };

  /** Which position tool the mouse is over; re-render only when that changes. */
  private readonly onHover = (e: PointerEvent): void => {
    let id: string | null = null;
    if (e.type === 'pointermove') {
      const rect = this.overlay.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      for (const d of this.drawings) {
        if (d.kind !== 'position') continue;
        const x1 = this.xOf(d.t1);
        const x2 = this.xOf(d.t2);
        const ys = [d.entry, d.stop, d.target].map((v) => this.yOf(v));
        if (x1 === null || x2 === null || ys.some((v) => v === null)) continue;
        const yv = ys as number[];
        if (
          x >= Math.min(x1, x2) &&
          x <= Math.max(x1, x2, Math.min(x1, x2) + 4) &&
          y >= Math.min(...yv) &&
          y <= Math.max(...yv)
        )
          id = d.id;
      }
    }
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.overlaySig = '';
    this.renderOverlay();
  };

  /**
   * While a drawing tool is active the crosshair is drawn on the overlay at the point the
   * next click will place (bar time, magnet price), also right of the last bar where the
   * library crosshair has nothing to show. The library's own lines are hidden meanwhile.
   */
  setDrawingMode(on: boolean, points = 2): void {
    this.drawingMode = on;
    // Touch screens: a cursor at the centre of the chart (tools placed by tapping only).
    this.touchPoints = on ? points : 0;
    this.touchMoved = false;
    this.touchGesture = null;
    this.touchCursor = null;
    if (this.touchPoints > 0 && window.matchMedia?.('(pointer: coarse)').matches) {
      const { plotW, plotH } = this.plotSize();
      this.touchCursor = { x: plotW / 2, y: plotH / 2 };
    }
    this.applyTouchCursor();
    this.chart.applyOptions({
      crosshair: { vertLine: { visible: !on }, horzLine: { visible: !on } },
    });
    this.overlaySig = '';
    this.renderOverlay();
  }

  /** Track Shift so the trendline rubber-band turns horizontal without a mouse move. */
  private readonly onShiftKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Shift' || this.shiftDown === (e.type === 'keydown')) return;
    this.shiftDown = e.type === 'keydown';
    if (!this.pendingAnchor) return;
    this.renderOverlay();
  };

  private readonly legend: HTMLElement;
  private renderLegend(b: { open: number; high: number; low: number; close: number } | null): void {
    const bar = b ?? this.lastOhlc;
    this.shownOhlc = bar;
    if (!bar) {
      this.legend.textContent = '';
      return;
    }
    const chg = bar.close - bar.open;
    this.legend.textContent = ohlcLegendText(bar, this.tick);
    this.legend.dataset.dir = chg > 0 ? 'up' : chg < 0 ? 'down' : '';
  }
  private lastOhlc: { open: number; high: number; low: number; close: number } | null = null;
  /** Bar currently written in the legend (last bar, or the one under the crosshair). */
  private shownOhlc: { open: number; high: number; low: number; close: number } | null = null;

  /** Re-translate the legend from the bar already on screen. Does not wait for a crosshair move. */
  refreshLegend(): void {
    this.renderLegend(this.shownOhlc);
  }

  setTickSize(tickSize: number): void {
    this.tick = tickSize;
    // Decimal places of the tick itself (0.25 → 2). ceil(-log10(tick)) is 1 for
    // 0.25 and makes lightweight-charts print 4145.75 as 4145.5.
    const precision = tickDecimals(tickSize);
    this.candles.applyOptions({ priceFormat: { type: 'price', precision, minMove: tickSize } });
  }

  setTimeShift(seconds: number): void {
    this.timeShiftSeconds = seconds;
  }

  /** Bar length of this chart, used to place drawings to the right of the last bar. */
  setBarSeconds(seconds: number): void {
    this.barSeconds = seconds;
  }

  /** Indicator configuration for this pane and the calendar options used by VWAP. */
  setIndicators(config: PaneIndicatorConfig, agg: AggregateOptions): void {
    this.indicatorConfig = config;
    this.indicatorAgg = agg;
    this.renderIndicators();
  }

  /** Show a large anchor and rubber-band line while waiting for the second click. */
  setPendingAnchor(point: { t: number; p: number } | null): void {
    this.pendingAnchor = point;
    this.touchMoved = false;
    if (this.touchCursor) this.applyTouchCursor();
    this.overlaySig = '';
    this.renderOverlay();
  }

  /** Blind mode: the time axis and crosshair show weekday and clock time, never a date. */
  setBlindAxis(on: boolean): void {
    this.blindAxis = on;
    const clock = (time: Time) => {
      const d = new Date(Number(time) * 1000);
      const hm = d.toISOString().slice(11, 16);
      return { day: weekdayName(d.getUTCDay()), hm };
    };
    if (on) {
      this.chart.applyOptions({
        localization: {
          timeFormatter: (t: Time) => {
            const c = clock(t);
            return `${c.day} ${c.hm}`;
          },
        },
        timeScale: {
          tickMarkFormatter: (t: Time) => {
            const c = clock(t);
            return c.hm === '00:00' ? c.day : c.hm;
          },
        },
      });
    }
  }

  // ------------------------------------------------------------------ crosshair / range sync
  /** Called with the real time under the mouse (null when the mouse leaves the chart). */
  onCrosshair(handler: (time: number | null) => void): void {
    this.chart.subscribeCrosshairMove((param) => {
      // Right of the last bar there is no bar time: extrapolate it from x instead of
      // treating it as "left the chart", so the rubber-band keeps following the mouse.
      const time =
        param.point === undefined
          ? null
          : param.time !== undefined
            ? this.fromTs(Number(param.time))
            : this.timeAt(param.point.x);
      if (param.point === undefined || time === null) {
        this.crosshair = null;
        this.renderOverlay();
        return handler(null);
      }
      if (!param.sourceEvent) return; // set by another chart: do not echo it back
      const price = this.candles.coordinateToPrice(param.point.y);
      // With the magnet on, the preview shows the snapped price the click will use.
      const snapped = getSettings().magnet ? this.magnetPrice(param.point.x, param.point.y) : null;
      this.crosshair = { t: time, p: snapped ?? (price === null ? NaN : Number(price)) };
      this.renderOverlay();
      handler(time);
    });
  }

  /** Show the crosshair on the bar containing `time` (already snapped), or hide it. */
  showCrosshair(time: number | null): void {
    if (time === null) return this.chart.clearCrosshairPosition();
    const shown = this.ts(time);
    const idx = this.chart.timeScale().timeToIndex(shown, true);
    const bar = idx === null ? null : this.candles.dataByIndex(idx);
    if (!bar || !('close' in bar)) return this.chart.clearCrosshairPosition();
    this.chart.setCrosshairPosition(Number(bar.close), bar.time, this.candles);
  }

  /** Called with the real time at the right edge of the view whenever it scrolls or zooms. */
  onRangeChange(handler: (rightEdge: number) => void): void {
    this.chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      const data = this.candles.data();
      if (!r || data.length < 2) return;
      const n = data.length;
      const lastShown = Number(data[n - 1]!.time);
      const t =
        r.to >= n - 1
          ? lastShown + (r.to - (n - 1)) * this.barSeconds
          : Number(data[Math.max(0, Math.round(r.to))]!.time);
      handler(this.fromTs(t));
    });
  }

  /** Scroll so the right edge is at `time`, keeping this chart's own zoom (bar count). */
  alignRightEdge(time: number): void {
    const ts = this.chart.timeScale();
    const r = ts.getVisibleLogicalRange();
    const data = this.candles.data();
    if (!r || data.length < 2) return;
    const width = r.to - r.from;
    const shown = this.ts(time);
    const lastShown = Number(data[data.length - 1]!.time);
    const idx =
      shown > lastShown
        ? data.length - 1 + (shown - lastShown) / this.barSeconds
        : ts.timeToIndex(shown, true);
    if (idx === null || Math.abs(Number(idx) - r.to) < 1) return;
    ts.setVisibleLogicalRange({ from: Number(idx) - width, to: Number(idx) });
  }

  private ts(time: number): UTCTimestamp {
    return toDisplayWall(time + this.timeShiftSeconds) as UTCTimestamp;
  }

  /** Inverse of ts(): a chart time back to real Unix seconds. */
  private fromTs(shown: number): number {
    return fromDisplayWall(shown) - this.timeShiftSeconds;
  }

  private volColor(b: Bar): string {
    return withAlpha(b.close >= b.open ? this.theme.up : this.theme.down, 0.45);
  }

  setBars(bars: readonly Bar[]): void {
    this.candles.setData(
      bars.map((b) => ({
        time: this.ts(b.time),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );
    this.volume.setData(
      bars.map((b) => ({ time: this.ts(b.time), value: b.volume, color: this.volColor(b) })),
    );
    this.lastBarTime = bars.at(-1)?.time;
    this.lastOhlc = bars.at(-1) ?? null;
    this.renderLegend(null);
    this.indicatorBars = [...bars];
    this.renderIndicators();
  }

  /**
   * Several new bars at once (a jump, +10, a play burst). Indicators are recomputed once
   * at the end instead of once per bar. A long batch replaces the series data in one go:
   * appending bar by bar costs the chart library a time-scale rebuild per bar, which made
   * long jumps freeze for tens of seconds.
   */
  updateBars(bars: readonly Bar[]): void {
    if (bars.length === 0) return;
    if (bars.length <= 50) {
      for (const b of bars) this.updateBar(b, false);
      this.renderIndicators();
      return;
    }
    const merged = [...this.indicatorBars];
    for (const b of bars) {
      const last = merged.at(-1);
      if (last && b.time < last.time) continue;
      if (last && b.time === last.time) merged[merged.length - 1] = b;
      else merged.push(b);
    }
    // Keep following the newest bar like update() does, unless the user scrolled back.
    const pos = this.chart.timeScale().scrollPosition();
    this.setBars(merged);
    if (pos >= 0) this.chart.timeScale().scrollToPosition(pos, false);
  }

  /** Append or update the last bar (bar.time must be >= the last bar time). */
  updateBar(b: Bar, render = true): void {
    this.candles.update({
      time: this.ts(b.time),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    });
    this.volume.update({ time: this.ts(b.time), value: b.volume, color: this.volColor(b) });
    this.lastBarTime = b.time;
    this.lastOhlc = b;
    this.renderLegend(null);
    if (this.indicatorBars.length && b.time < this.indicatorBars.at(-1)!.time) return;
    if (this.indicatorBars.length && b.time === this.indicatorBars.at(-1)!.time) {
      this.indicatorBars[this.indicatorBars.length - 1] = b;
    } else {
      this.indicatorBars.push(b);
    }
    if (render) this.renderIndicators();
  }

  get lastTime(): number | undefined {
    return this.lastBarTime;
  }

  setMarkers(markers: readonly MarkerSpec[]): void {
    const sorted = [...markers].sort((a, b) => a.time - b.time);
    const out: SeriesMarker<Time>[] = sorted.map((m) => ({
      time: this.ts(m.time),
      position: m.side === 'buy' ? 'belowBar' : 'aboveBar',
      shape: m.side === 'buy' ? 'arrowUp' : 'arrowDown',
      color: m.side === 'buy' ? this.theme.up : this.theme.down,
      text: m.text,
    }));
    this.markers.setMarkers(out);
  }

  setPriceLines(lines: readonly PriceLineSpec[]): void {
    for (const pl of this.priceLines) this.candles.removePriceLine(pl);
    this.orderLineSpecs = [...lines];
    this.orderLineById.clear();
    this.priceLines = lines.map((l) => {
      const pl = this.candles.createPriceLine({
        price: l.price,
        color: l.color,
        lineWidth: 1,
        lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title: l.title,
      });
      if (l.orderId !== undefined) this.orderLineById.set(l.orderId, pl);
      return pl;
    });
    this.overlaySig = '';
    this.renderOverlay();
    if (
      !this.raf &&
      (this.drawings.length || this.orderLineSpecs.some((l) => l.orderId !== undefined))
    )
      this.loop();
  }

  onOrderLineDrag(handler: (orderId: number, price: number) => Promise<void>): void {
    this.orderDragHandler = handler;
  }

  /** Render user drawings. `snap` maps a real time to a bar time of this chart's timeframe. */
  setDrawings(drawings: readonly Drawing[], snap: (t: number) => number): void {
    // A drawing just added (not the initial load) starts selected, as in TradingView.
    const known = new Set(this.drawings.map((d) => d.id));
    const added = drawings.filter((d) => !known.has(d.id) && !this.hiddenIds.has(d.id));
    if (this.drawingsLoaded && added.length === 1) this.selected = added[0]!.id;
    this.drawingsLoaded = true;
    // Hidden drawings stay saved but are not drawn; locked ones are drawn without handles.
    this.drawings = drawings.filter((d) => !this.hiddenIds.has(d.id));
    this.snapFn = snap;
    if (this.selected && !drawings.some((d) => d.id === this.selected)) this.selected = null;
    this.renderPriceLines();
    this.overlaySig = '';
    this.renderOverlay();
    this.syncStyleBar();
    if (!this.raf) this.loop();
  }

  private hiddenIds = new Set<string>();
  private lockedIds = new Set<string>();
  setDrawingFlags(hidden: ReadonlySet<string>, locked: ReadonlySet<string>): void {
    this.hiddenIds = new Set(hidden);
    this.lockedIds = new Set(locked);
  }

  onDrawingEdit(handler: (d: Drawing) => void): void {
    this.editHandler = handler;
  }
  onDrawingDelete(handler: (id: string) => void): void {
    this.deleteHandler = handler;
  }
  setPositionLabeler(fn: (d: Extract<Drawing, { kind: 'position' }>) => PositionLabels): void {
    this.labeler = fn;
  }
  get selectedDrawing(): string | null {
    return this.selected;
  }

  private renderPriceLines(): void {
    for (const pl of this.drawingLines) this.candles.removePriceLine(pl);
    for (const s of this.drawingSeries) this.chart.removeSeries(s);
    this.drawingSeries = [];
    this.drawingLines = this.drawings
      .filter((d): d is Extract<Drawing, { kind: 'hline' }> => d.kind === 'hline')
      .map((d) =>
        this.candles.createPriceLine({
          price: d.price,
          color: this.theme.accent,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: '',
        }),
      );
  }

  /** Re-render the overlay whenever the view moves (cheap: skipped when nothing changed). */
  private loop(): void {
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.overlay.isConnected) return;
      this.renderOverlay();
      if (
        this.drawings.length ||
        this.fvgZones.length ||
        this.atmList.length ||
        this.htfList.length ||
        this.orderLineSpecs.some((l) => l.orderId !== undefined)
      )
        this.loop();
    });
  }

  /** x pixel of a real time (extrapolated to the right of the last bar). */
  private xOf(time: number): number | null {
    const ts = this.timeScale();
    // indicatorBars mirrors the candle series; series.data() would copy every bar per call.
    const n = this.indicatorBars.length;
    if (n === 0) return null;
    const shown = this.ts(this.snapFn(time));
    const lastShown = Number(this.ts(this.indicatorBars[n - 1]!.time));
    let logical: number;
    if (shown > lastShown) logical = n - 1 + (shown - lastShown) / this.barSeconds;
    else {
      const idx = ts.timeToIndex(shown as UTCTimestamp, true);
      if (idx === null) return null;
      logical = idx;
    }
    return ts.logicalToCoordinate(logical as Logical);
  }

  private timeAt(x: number): number | null {
    const bars = this.indicatorBars;
    const logical = this.timeScale().coordinateToLogical(x);
    if (logical === null || bars.length === 0) return null;
    const i = Math.round(logical);
    const lastShown = Number(this.ts(bars[bars.length - 1]!.time));
    if (i >= bars.length - 1)
      return this.fromTs(lastShown + (i - (bars.length - 1)) * this.barSeconds);
    return bars[Math.max(0, i)]!.time;
  }

  private yOf(price: number): number | null {
    return this.candles.priceToCoordinate(price);
  }

  private priceAt(y: number, x?: number): number | null {
    const p = this.candles.coordinateToPrice(y);
    if (p === null) return null;
    if (x !== undefined && getSettings().magnet) {
      const snapped = this.magnetPrice(x, y);
      if (snapped !== null) return snapped;
    }
    return roundToTick(Number(p), this.tick);
  }

  /** Magnet: the open/high/low/close of the bar under x if within 8px of y. */
  /** Volume needs both the Settings switch and the indicator list (saving settings kept
   *  re-showing volume that was switched off in the indicator panel). */
  private volumeVisible(): boolean {
    const vol = this.indicatorConfig?.overlays.find((s) => s.kind === 'volume');
    return getSettings().volume && (vol ? vol.visible : true);
  }

  private magnetPrice(x: number, y: number): number | null {
    const logical = this.timeScale().coordinateToLogical(x);
    if (logical === null) return null;
    const bar = this.candles.dataByIndex(Math.round(logical));
    if (!bar || !('open' in bar)) return null;
    let best: number | null = null;
    let dist = 12;
    for (const v of [bar.open, bar.high, bar.low, bar.close]) {
      const vy = this.yOf(v);
      if (vy !== null && Math.abs(vy - y) <= dist) {
        dist = Math.abs(vy - y);
        best = v;
      }
    }
    return best;
  }

  /** Pixel boxes of the gaps that overlap the visible bars. */
  private fvgRects(): {
    x1: number;
    x2: number;
    yTop: number;
    yBottom: number;
    mitigated: boolean;
  }[] {
    if (!this.fvgZones.length) return [];
    const ts = this.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return [];
    const out = [];
    for (const z of this.fvgZones) {
      if (z.endIndex < range.from || z.startIndex > range.to) continue;
      const x1 = ts.logicalToCoordinate(z.startIndex as Logical);
      const x2 = ts.logicalToCoordinate(z.endIndex as Logical);
      const yTop = this.yOf(z.top);
      const yBottom = this.yOf(z.bottom);
      if (x1 === null || x2 === null || yTop === null || yBottom === null) continue;
      out.push({
        x1: Math.round(x1),
        x2: Math.round(x2),
        yTop: Math.round(yTop),
        yBottom: Math.round(yBottom),
        mitigated: z.mitigated,
      });
    }
    return out;
  }

  /** Pixel shapes of the ATM sessions that overlap the visible bars. */
  private atmShapes() {
    if (!this.atmList.length) return [];
    const ts = this.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return [];
    const x = (i: number) => {
      const v = ts.logicalToCoordinate(i as Logical);
      return v === null ? null : Math.round(v);
    };
    const y = (p: number) => {
      const v = this.yOf(p);
      return v === null ? null : Math.round(v);
    };
    const out = [];
    for (const s of this.atmList) {
      const last = Math.max(s.endIndex, s.highEnd, s.lowEnd);
      if (last < range.from || s.startIndex > range.to) continue;
      const [bx1, bx2, hx1, hx2, lx1, lx2] = [
        x(s.startIndex),
        x(s.endIndex),
        x(s.highIndex),
        x(s.highEnd),
        x(s.lowIndex),
        x(s.lowEnd),
      ];
      const [yh, yl] = [y(s.high), y(s.low)];
      if ([bx1, bx2, hx1, hx2, lx1, lx2, yh, yl].some((v) => v === null)) continue;
      const look = ATM_LOOK[s.key] ?? ATM_LOOK.tokyo!;
      out.push({
        color: look.color,
        hiText: `${look.tag}.H`,
        loText: `${look.tag}.L`,
        bx1: bx1!,
        bx2: bx2!,
        hx1: hx1!,
        hx2: hx2!,
        lx1: lx1!,
        lx2: lx2!,
        yh: yh!,
        yl: yl!,
      });
    }
    return out;
  }

  /** Pixel shapes of the HTF candle sets, laid out right of the last bar in bar units. */
  private htfShapes() {
    const n = this.indicatorBars.length;
    if (!this.htfList.length || n === 0) return [];
    const ts = this.timeScale();
    const x = (logical: number) => {
      const v = ts.logicalToCoordinate(logical as Logical);
      return v === null ? null : Math.round(v);
    };
    const y = (p: number) => {
      const v = this.yOf(p);
      return v === null ? null : Math.round(v);
    };
    const now = this.indicatorBars[n - 1]!.time + this.barSeconds;
    let left = n - 1 + HTF_PAD;
    const out = [];
    for (const set of this.htfList) {
      const slot = (i: number) => left + i * HTF_STEP;
      const candles = [];
      for (const [i, c] of set.candles.entries()) {
        const [x1, x2, yo, yc, yh, yl] = [
          x(slot(i)),
          x(slot(i) + HTF_BODY),
          y(c.open),
          y(c.close),
          y(c.high),
          y(c.low),
        ];
        if ([x1, x2, yo, yc, yh, yl].some((v) => v === null)) continue;
        candles.push({
          x1: x1!,
          x2: x2!,
          yo: yo!,
          yc: yc!,
          yh: yh!,
          yl: yl!,
          up: c.close >= c.open,
        });
      }
      const right = x(slot(set.candles.length - 1) + HTF_BODY);
      const gaps = [
        ...set.fvgs.map((g) => ({ ...g, vi: false })),
        ...set.volumeImbalances.map((g) => ({ ...g, vi: true })),
      ];
      const boxes = gaps.flatMap((g) => {
        const [bx, yt, yb] = [x(slot(g.index) + HTF_BODY / 2), y(g.top), y(g.bottom)];
        return bx === null || right === null || yt === null || yb === null
          ? []
          : [{ x1: bx, x2: right, yt, yb, up: g.kind === 'bull', vi: g.vi }];
      });
      const lx = x(left);
      const ly = y(Math.max(...set.candles.map((c) => c.high)));
      const label = `${htfLabel(set.tfSeconds / 60)}  ${remainingText(set.end - now)}`.trim();
      out.push({ candles, boxes, label, lx, ly });
      left += set.candles.length * HTF_STEP + HTF_SET_GAP;
    }
    return out;
  }

  private timeScale() {
    return this.chart.timeScale();
  }

  private renderOverlay(): void {
    const w = this.overlay.clientWidth;
    const plotW = Math.max(0, w - this.chart.priceScale('right').width());
    const pts = this.drawings.map((d) => {
      if (d.kind === 'hline') return [this.yOf(d.price)];
      if (d.kind === 'text') return [this.xOf(d.t), this.yOf(d.price)];
      if (d.kind === 'freehand') return d.points.map((p) => [this.xOf(p.t), this.yOf(p.p)]).flat();
      if (d.kind === 'position')
        return [
          this.xOf(d.t1),
          this.xOf(d.t2),
          this.yOf(d.entry),
          this.yOf(d.stop),
          this.yOf(d.target),
        ];
      return [this.xOf(d.t1), this.yOf(d.p1), this.xOf(d.t2), this.yOf(d.p2)];
    });
    const fvgRects = this.fvgRects();
    const atm = this.atmShapes();
    const htf = this.htfShapes();
    const orderPts = this.orderLineSpecs.map((l) =>
      l.orderId === undefined ? null : this.yOf(l.price),
    );
    const sig = `${w}|${this.selected}|${JSON.stringify(pts)}|${this.drag ? JSON.stringify(this.drawings) : ''}|${JSON.stringify(orderPts)}|${this.orderDrag?.orderId ?? ''}|${JSON.stringify(fvgRects)}|${JSON.stringify(atm)}|${JSON.stringify(htf)}`;
    // Mouse moves only change the crosshair / rubber-band layer; keep the rest as is.
    if (sig === this.overlaySig) {
      this.renderDynamic(plotW);
      return;
    }
    this.overlaySig = sig;
    const nodes: SVGElement[] = [];
    const accent = this.theme.accent;
    for (const r of fvgRects) {
      nodes.push(
        svg('rect', {
          x: r.x1,
          y: r.yTop,
          width: Math.max(1, r.x2 - r.x1),
          height: Math.max(1, r.yBottom - r.yTop),
          // Filled gaps stay visible in the script's muted grey.
          fill: r.mitigated ? withAlpha('#787b86', 0.15) : withAlpha(this.fvgColor, 0.3),
          'pointer-events': 'none',
          'data-kind': r.mitigated ? 'fvg-mitigated' : 'fvg',
        }),
      );
      if (r.mitigated) continue;
      const mid = Math.round((r.yTop + r.yBottom) / 2);
      nodes.push(
        svg('line', {
          x1: r.x1,
          x2: r.x2,
          y1: mid,
          y2: mid,
          stroke: withAlpha(this.theme.text, 0.6),
          'stroke-dasharray': '3 3',
          'pointer-events': 'none',
        }),
      );
    }
    for (const a of atm) {
      const quiet = { 'pointer-events': 'none' };
      const text = (tx: number, ty: number, content: string) => {
        const node = svg('text', {
          x: tx,
          y: ty,
          fill: this.theme.text,
          'font-size': '10px',
          'text-anchor': 'middle',
          ...quiet,
        });
        node.textContent = content;
        return node;
      };
      nodes.push(
        svg('rect', {
          x: a.bx1,
          y: a.yh,
          width: Math.max(1, a.bx2 - a.bx1),
          height: Math.max(1, a.yl - a.yh),
          fill: withAlpha(a.color, 0.2),
          'data-kind': 'atm',
          ...quiet,
        }),
        svg('line', { x1: a.hx1, x2: a.hx2, y1: a.yh, y2: a.yh, stroke: a.color, ...quiet }),
        svg('line', { x1: a.lx1, x2: a.lx2, y1: a.yl, y2: a.yl, stroke: a.color, ...quiet }),
        text(a.hx1, a.yh - 4, a.hiText),
        text(a.lx1, a.yl + 12, a.loText),
      );
    }
    for (const set of htf) {
      const quiet = { 'pointer-events': 'none' };
      for (const b of set.boxes) {
        nodes.push(
          svg('rect', {
            x: b.x1,
            y: Math.min(b.yt, b.yb),
            width: Math.max(1, b.x2 - b.x1),
            height: Math.max(1, Math.abs(b.yb - b.yt)),
            fill: b.vi
              ? withAlpha('#f2a93b', 0.35)
              : withAlpha(b.up ? this.theme.up : this.theme.down, 0.22),
            'data-kind': b.vi ? 'htf-vi' : 'htf-fvg',
            ...quiet,
          }),
        );
      }
      for (const c of set.candles) {
        const color = c.up ? this.theme.up : this.theme.down;
        const mid = Math.round((c.x1 + c.x2) / 2);
        nodes.push(
          svg('line', { x1: mid, x2: mid, y1: c.yh, y2: c.yl, stroke: color, ...quiet }),
          svg('rect', {
            x: c.x1,
            y: Math.min(c.yo, c.yc),
            width: Math.max(1, c.x2 - c.x1),
            height: Math.max(1, Math.abs(c.yc - c.yo)),
            fill: color,
            'data-kind': 'htf-candle',
            ...quiet,
          }),
        );
      }
      if (set.lx !== null && set.ly !== null) {
        const label = svg('text', {
          x: set.lx,
          y: set.ly - 8,
          fill: this.theme.text,
          'font-size': '10px',
          'data-kind': 'htf-label',
          ...quiet,
        });
        label.textContent = set.label;
        nodes.push(label);
      }
    }
    const coarseHandles = this.coarsePointer();
    const handle = (
      d: Drawing,
      part: DragPart,
      x: number | null,
      y: number | null,
      body = false,
      size = body ? 10 : 6,
    ) => {
      // Like TradingView: anchor handles only show on the selected drawing.
      if (x === null || y === null || this.lockedIds.has(d.id) || this.selected !== d.id) return;
      const h = svg('rect', {
        x: x - size / 2,
        y: y - size / 2,
        width: size,
        height: size,
        rx: body ? 5 : 1.5,
        class: `handle${body ? ' body' : ''}${this.selected === d.id ? ' active' : ''}`,
        'data-drawing': d.id,
        'data-part': part,
      });
      h.addEventListener('pointerdown', (ev) => this.startDrag(ev, d, part));
      nodes.push(h);
      // Local: touch screens get a finger-sized invisible grab area around each handle.
      if (coarseHandles) {
        const grab = 30;
        const g = svg('rect', {
          x: x - grab / 2,
          y: y - grab / 2,
          width: grab,
          height: grab,
          class: 'handle touch-grab',
          style: 'fill: transparent; stroke: none',
          'data-drawing': d.id,
          'data-part': part,
        });
        g.addEventListener('pointerdown', (ev) => this.startDrag(ev, d, part));
        nodes.push(g);
      }
    };
    // Invisible, wider targets so an unselected drawing can be clicked (selected) or dragged.
    const hit = (d: Drawing, node: SVGElement) => {
      node.classList.add('hit');
      node.addEventListener('pointerdown', (ev) => this.startDrag(ev, d, 'body'));
      nodes.push(node);
    };
    const hitLine = (d: Drawing, x1: number, y1: number, x2: number, y2: number) =>
      hit(d, svg('line', { x1, y1, x2, y2, stroke: 'transparent', 'stroke-width': 12 }));
    const hitRect = (d: Drawing, x1: number, y1: number, x2: number, y2: number) =>
      hit(
        d,
        svg('rect', {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.max(4, Math.abs(x2 - x1)),
          height: Math.max(4, Math.abs(y2 - y1)),
          fill: 'transparent',
        }),
      );
    this.drawings.forEach((d, i) => {
      const p = pts[i]!;
      if (!this.lockedIds.has(d.id)) {
        const [a, b, c, e] = p;
        if (d.kind === 'hline' && a != null) hitLine(d, 0, a, plotW, a);
        else if (d.kind === 'vline' && a != null) hitLine(d, a, 0, a, this.overlay.clientHeight);
        else if (
          (d.kind === 'tline' || d.kind === 'arrow' || d.kind === 'ray') &&
          a != null &&
          b != null &&
          c != null &&
          e != null
        )
          hitLine(d, a, b, c, e);
        else if (
          (d.kind === 'rect' ||
            d.kind === 'measure' ||
            d.kind === 'prange' ||
            d.kind === 'fib' ||
            d.kind === 'ce' ||
            d.kind === 'channel') &&
          a != null &&
          b != null &&
          c != null &&
          e != null
        )
          hitRect(d, a, b, c, e);
      }
      if (d.kind === 'hline') {
        handle(d, 'price', plotW - 24, p[0]!);
      } else if (d.kind === 'text') {
        const [x, y] = p;
        if (x == null || y == null) return;
        const fontSize = d.fontSize && d.fontSize > 0 ? d.fontSize : 13;
        const t = svg('text', {
          x,
          y: y - 6,
          fill: d.color ?? accent,
          'font-size': `${fontSize}px`,
          'font-weight': '600',
          class: 'drawing-text',
          'data-drawing': d.id,
        });
        t.textContent = d.text;
        t.addEventListener('dblclick', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.selected = d.id;
          this.editTextContent(d);
        });
        if (this.lockedIds.has(d.id)) nodes.push(t);
        else hit(d, t);
        handle(d, 'body', x, y, true);
      } else if (d.kind === 'arrow') {
        const [x1, y1, x2, y2] = p;
        if (x1 == null || y1 == null || x2 == null || y2 == null) return;
        const color = d.color ?? accent;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const head = 12;
        const inset = head * 0.85;
        const sx2 = x2 - Math.cos(angle) * inset;
        const sy2 = y2 - Math.sin(angle) * inset;
        nodes.push(
          svg('line', {
            x1,
            y1,
            x2: sx2,
            y2: sy2,
            stroke: color,
            'stroke-width': 3,
            'stroke-linecap': 'round',
          }),
          this.arrowHead(x2, y2, angle, color),
        );
        handle(d, 'p1', x1, y1);
        handle(d, 'p2', x2, y2);
      } else if (d.kind === 'freehand') {
        const coords: number[] = [];
        for (let j = 0; j < p.length; j += 2) {
          const x = p[j]!;
          const y = p[j + 1]!;
          if (x == null || y == null) continue;
          coords.push(x, y);
        }
        if (coords.length < 4) return;
        const dstr =
          `M${coords[0]} ${coords[1]} ` +
          coords
            .slice(2)
            .map((v, idx) => (idx % 2 === 0 ? `L${v}` : v))
            .join(' ');
        nodes.push(
          svg('path', {
            d: dstr,
            fill: 'none',
            stroke: d.color ?? accent,
            'stroke-width': 2,
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
            class: 'drawing-freehand-path',
            'data-drawing': d.id,
          }),
        );
        if (!this.lockedIds.has(d.id)) hit(d, nodes.pop()!);
        handle(d, 'body', coords[0]!, coords[1]!, true);
      } else if (
        d.kind === 'ray' ||
        d.kind === 'vline' ||
        d.kind === 'fib' ||
        d.kind === 'ce' ||
        d.kind === 'measure' ||
        d.kind === 'channel'
      ) {
        const [x1, y1, x2, y2] = p;
        if (x1 == null || y1 == null || x2 == null || y2 == null) return;
        const color = d.color ?? accent;
        if (d.kind === 'vline') {
          nodes.push(
            svg('line', {
              x1,
              y1: 0,
              x2: x1,
              y2: this.overlay.clientHeight,
              stroke: color,
              'stroke-width': 1.5,
            }),
          );
          // Time label in the time-axis row, as TradingView does; blind practice shows no date.
          const axisH = this.chart.timeScale().height();
          const top = this.overlay.clientHeight - axisH;
          const shown = new Date(this.ts(this.snapFn(d.t1)) * 1000);
          const iso = shown.toISOString();
          const day = weekdayName(shown.getUTCDay());
          const text = this.blindAxis
            ? `${day} ${iso.slice(11, 16)}`
            : `${day} ${iso.slice(0, 10)}  ${iso.slice(11, 16)}`;
          const w = [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 13 : 7.5), 0) + 16;
          const h = Math.max(16, axisH - 2);
          nodes.push(
            svg('rect', {
              x: x1 - w / 2,
              y: top + 1,
              width: w,
              height: h,
              rx: 2,
              fill: this.theme.text,
              'data-kind': 'vline-label',
            }),
          );
          const label = svg('text', {
            x: x1,
            y: top + 1 + h / 2 + 4,
            'font-size': '12px',
            'font-weight': '600',
            'text-anchor': 'middle',
            // Inline style: the overlay's text rule would otherwise recolour it.
            style: `fill: ${this.theme.background}; stroke: none`,
            'data-testid': `vline-label-${d.id}`,
          });
          label.textContent = text;
          nodes.push(label);
          handle(d, 'p1', x1, y1);
        } else if (d.kind === 'ray') {
          // Extend from p1 through p2 to the plot edge.
          const dx = x2 - x1;
          const dy = y2 - y1;
          const k = dx === 0 ? 0 : Math.max(1, (plotW - x1) / dx);
          const ex = dx === 0 ? x2 : dx > 0 ? x1 + dx * k : 0;
          const ey =
            dx === 0
              ? dy > 0
                ? this.overlay.clientHeight
                : 0
              : dx > 0
                ? y1 + dy * k
                : y1 - (dy / dx) * x1;
          nodes.push(svg('line', { x1, y1, x2: ex, y2: ey, stroke: color, 'stroke-width': 2 }));
          handle(d, 'p1', x1, y1);
          handle(d, 'p2', x2, y2);
        } else if (d.kind === 'fib' || d.kind === 'ce') {
          // Fib: levels span only the two anchors, the level number right of the line
          // (p1 = 1, p2 = 0). CE: 1 / 0.5 / 0 extended to the price axis with the price
          // (p1 = 0, p2 = 1). Both draw a dashed line between the anchors.
          const fib = d.kind === 'fib';
          const left = Math.min(x1, x2);
          const right = fib ? Math.max(x1, x2) : plotW;
          const dpv = tickDecimals(this.tick);
          const textStyle = `fill: ${color}; stroke: none`;
          nodes.push(svg('line', { x1, y1, x2, y2, stroke: color, 'stroke-dasharray': '5 4' }));
          for (const lv of fib ? FIB_LEVELS : CE_LEVELS) {
            const price = fib ? d.p2 + (d.p1 - d.p2) * lv : d.p1 + (d.p2 - d.p1) * lv;
            const y = this.yOf(price);
            if (y === null) continue;
            const text = fib
              ? String(lv)
              : `${lv} (${price.toLocaleString('en-US', { minimumFractionDigits: dpv, maximumFractionDigits: dpv })})`;
            const textW = text.length * 7;
            nodes.push(
              svg('line', {
                x1: left,
                y1: y,
                x2: fib ? right : Math.max(left, right - textW - 10),
                y2: y,
                stroke: color,
              }),
            );
            const label = svg('text', {
              x: fib ? right + 8 : right - 4,
              y: y + 4,
              'font-size': '12px',
              'text-anchor': fib ? 'start' : 'end',
              style: textStyle,
              'data-kind': `${d.kind}-level`,
            });
            label.textContent = text;
            nodes.push(label);
          }
          handle(d, 'p1', x1, y1);
          handle(d, 'p2', x2, y2);
        } else if (d.kind === 'measure') {
          const up = d.p2 >= d.p1;
          const fill = withAlpha(up ? this.theme.up : this.theme.down, 0.16);
          nodes.push(
            svg('rect', {
              x: Math.min(x1, x2),
              y: Math.min(y1, y2),
              width: Math.abs(x2 - x1),
              height: Math.abs(y2 - y1),
              fill,
              stroke: up ? this.theme.up : this.theme.down,
              'stroke-width': 1,
              'data-kind': 'measure',
            }),
          );
          const label = svg('text', {
            x: Math.min(x1, x2) + 4,
            y: Math.min(y1, y2) - 4,
            'data-testid': `measure-${d.id}`,
          });
          label.textContent = measureText(d, this.tick, this.barSeconds, tickDecimals(this.tick));
          nodes.push(label);
          handle(d, 'p1', x1, y1);
          handle(d, 'p2', x2, y2);
        } else {
          // channel: base line p1-p2 and a parallel line offset by w in price.
          const ya = this.yOf(d.p1 + d.w);
          const yb = this.yOf(d.p2 + d.w);
          nodes.push(svg('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': 2 }));
          if (ya !== null && yb !== null) {
            nodes.push(
              svg('line', { x1, y1: ya, x2, y2: yb, stroke: color, 'stroke-width': 2 }),
              svg('path', {
                d: `M${x1} ${y1} L${x2} ${y2} L${x2} ${yb} L${x1} ${ya} Z`,
                fill: withAlpha(color, 0.08),
                stroke: 'none',
              }),
            );
            handle(d, 'w', (x1 + x2) / 2, (ya + yb) / 2);
          }
          handle(d, 'p1', x1, y1);
          handle(d, 'p2', x2, y2);
        }
        if (d.kind !== 'vline') handle(d, 'body', (x1 + x2) / 2, (y1 + y2) / 2, true);
        else handle(d, 'body', x1, 24, true);
      } else if (d.kind === 'prange') {
        // TradingView-style price range: band, arrow from start to end, and
        // "change (percent) ticks" next to the end.
        const [x1, y1, x2, y2] = p;
        if (x1 == null || y1 == null || x2 == null || y2 == null) return;
        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const mid = (left + right) / 2;
        const color = d.color ?? accent;
        const diff = d.p2 - d.p1;
        const dp = tickDecimals(this.tick);
        const text =
          `${diff.toFixed(dp)} (${((diff / d.p1) * 100).toFixed(2)}%) ` +
          `${Math.round(diff / this.tick)}`;
        const up = y2 < y1;
        nodes.push(
          svg('rect', {
            x: left,
            y: Math.min(y1, y2),
            width: Math.max(1, right - left),
            height: Math.abs(y2 - y1),
            fill: withAlpha(color, 0.12),
            'data-kind': 'prange',
          }),
          svg('line', { x1: left, x2: right, y1, y2: y1, stroke: color, 'stroke-width': 1 }),
          svg('line', { x1: left, x2: right, y1: y2, y2, stroke: color, 'stroke-width': 1 }),
          svg('line', { x1: mid, x2: mid, y1, y2, stroke: color, 'stroke-width': 1 }),
          svg('path', {
            d: `M${mid - 6} ${y2 + (up ? 6 : -6)} L${mid} ${y2} L${mid + 6} ${y2 + (up ? 6 : -6)}`,
            fill: 'none',
            stroke: color,
            'stroke-width': 1,
          }),
        );
        const w = text.length * 6.6 + 12;
        const ly = up ? y2 - 28 : y2 + 8;
        nodes.push(
          svg('rect', {
            x: mid - w / 2,
            y: ly,
            width: w,
            height: 20,
            rx: 4,
            fill: this.theme.background,
            stroke: this.theme.border,
            'data-kind': 'prange-label',
          }),
        );
        const label = svg('text', {
          x: mid,
          y: ly + 14,
          fill: this.theme.text,
          'font-size': '12px',
          'text-anchor': 'middle',
          'data-testid': `prange-label-${d.id}`,
        });
        label.textContent = text;
        nodes.push(label);
        handle(d, 'p1', x1, y1);
        handle(d, 'p2', x2, y2);
        handle(d, 'body', mid, (y1 + y2) / 2, true);
      } else if (d.kind === 'tline' || d.kind === 'rect') {
        const [x1, y1, x2, y2] = p;
        if (x1 == null || y1 == null || x2 == null || y2 == null) return;
        if (d.kind === 'tline') this.tlineNodes(d, x1, y1, x2, y2, accent, nodes, hit);
        else
          nodes.push(
            svg('rect', {
              x: Math.min(x1, x2),
              y: Math.min(y1, y2),
              width: Math.abs(x2 - x1),
              height: Math.abs(y2 - y1),
              fill: withAlpha(accent, 0.02),
              stroke: accent,
              'stroke-width': 1,
              'data-kind': 'rect',
            }),
          );
        // 50% line, dashed, as TradingView's rectangle middle line; it can hold text too.
        if (d.kind === 'rect')
          this.tlineNodes(
            d,
            Math.min(x1, x2),
            (y1 + y2) / 2,
            Math.max(x1, x2),
            (y1 + y2) / 2,
            accent,
            nodes,
            hit,
            { 'stroke-dasharray': '6 4', 'data-kind': 'rect-mid' },
          );
        handle(d, 'p1', x1, y1);
        handle(d, 'p2', x2, y2);
        if (d.kind === 'rect') {
          // Corners resize both ways; edge midpoints move one side only (dragging inside
          // the box moves it).
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          handle(d, 'c12', x1, y2);
          handle(d, 'c21', x2, y1);
          handle(d, 'edgeT1', x1, my);
          handle(d, 'edgeT2', x2, my);
          handle(d, 'edgeP1', mx, y1);
          handle(d, 'edgeP2', mx, y2);
        }
        // A trendline has no middle handle (its middle holds the text); drag the line itself.
      } else {
        const [x1, x2, ye, ys, yt] = p;
        if (x1 == null || x2 == null || ye == null || ys == null || yt == null) return;
        const left = Math.min(x1, x2);
        const width = Math.max(4, Math.abs(x2 - x1));
        const riskRect = svg('rect', {
          x: left,
          y: Math.min(ye, ys),
          width,
          height: Math.max(2, Math.abs(ys - ye)),
          fill: withAlpha(this.theme.down, 0.2),
          'data-kind': 'risk',
          class: 'position-body',
          'data-drawing': d.id,
          'data-part': 'body',
        });
        const rewardRect = svg('rect', {
          x: left,
          y: Math.min(ye, yt),
          width,
          height: Math.max(2, Math.abs(yt - ye)),
          fill: withAlpha(this.theme.up, 0.2),
          'data-kind': 'reward',
          class: 'position-body',
          'data-drawing': d.id,
          'data-part': 'body',
        });
        riskRect.addEventListener('pointerdown', (ev) => this.startDrag(ev, d, 'body'));
        rewardRect.addEventListener('pointerdown', (ev) => this.startDrag(ev, d, 'body'));
        nodes.push(
          riskRect,
          rewardRect,
          svg('line', {
            x1: left,
            x2: left + width,
            y1: ye,
            y2: ye,
            stroke: this.theme.text,
            'stroke-width': 1,
          }),
        );
        // Labels only while the tool is hovered or selected, as in TradingView.
        if (this.labeler && (this.selected === d.id || this.hoverId === d.id)) {
          const lb = this.labeler(d);
          const cx = left + width / 2;
          // Rough width at 12px: CJK glyphs 12px, Trebuchet Latin about 5.4px.
          const textW = (s: string) =>
            [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 12 : 5.4), 0);
          // Plain white text, no background box.
          const box = (lines: string[], yTop: number, testid?: string) => {
            const w = Math.max(...lines.map(textW)) + 14;
            const x = Math.max(4, Math.min(cx - w / 2, plotW - w - 4));
            const tx = svg('text', {
              x: x + w / 2,
              y: yTop + 15,
              class: 'pos-label',
              'font-size': '12px',
              // TradingView's label font (Trebuchet MS on Windows; CJK falls back to JhengHei).
              'font-family':
                "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, 'Microsoft JhengHei', sans-serif",
              'text-anchor': 'middle',
              ...(testid ? { 'data-testid': testid } : {}),
            });
            lines.forEach((line, i) => {
              const span = svg('tspan', { x: x + w / 2, dy: i === 0 ? 0 : 16 });
              span.textContent = line;
              tx.append(span);
            });
            nodes.push(tx);
          };
          // Target and stop labels sit just outside their zones, away from the entry.
          const outside = (y: number) => (y < ye ? y - 26 : y + 4);
          box([lb.target], outside(yt));
          box([lb.stop], outside(ys));
          box(lb.center, ye + 6, `rlabel-${d.id}`);
        }
        // Wide invisible strips on the stop / target edges so they are easy to grab and resize.
        if (!this.lockedIds.has(d.id))
          for (const [part, y] of [
            ['stop', ys],
            ['target', yt],
          ] as const) {
            const strip = svg('rect', {
              x: left,
              y: y - 6,
              width,
              height: 12,
              fill: 'transparent',
              class: 'hit resize-ns',
            });
            strip.addEventListener('pointerdown', (ev) => this.startDrag(ev, d, part));
            nodes.push(strip);
          }
        handle(d, 'body', left + width / 2, ye, true);
        handle(d, 'entry', left, ye, false, 10);
        handle(d, 'stop', left + width / 2, ys);
        handle(d, 'target', left + width / 2, yt);
        handle(d, 't2', left + width, ye, false, 10);
      }
      if (this.selected === d.id && this.deleteHandler) {
        const anchor =
          d.kind === 'hline'
            ? [plotW - 44, p[0]]
            : d.kind === 'position'
              ? [p[0], p[3]]
              : d.kind === 'text'
                ? [p[0], p[1]]
                : d.kind === 'freehand'
                  ? [p[0], p[1]]
                  : [p[0], p[1]];
        const [ax, ay] = anchor as [number | null, number | null];
        if (ax != null && ay != null) {
          const g = svg('g', { class: 'del', 'data-testid': 'delete-drawing', role: 'button' });
          g.append(
            svg('circle', { cx: ax - 14, cy: ay - 14, r: 8, fill: this.theme.down }),
            svg('path', {
              d: `M${ax - 17} ${ay - 17} l6 6 m0 -6 l-6 6`,
              stroke: '#fff',
              'stroke-width': 1.5,
            }),
          );
          const title = svg('title', {});
          title.textContent = t('pr.deleteDrawing');
          g.append(title);
          g.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this.deleteHandler?.(d.id);
          });
          nodes.push(g);
        }
      }
    });
    this.renderedOverlay(nodes, plotW, w);
  }

  /**
   * Time labels right of the last bar. The library only labels times that have data, so
   * the empty future area gets clock-aligned labels drawn here in the time-axis row.
   */
  private renderFutureAxis(): void {
    const n = this.indicatorBars.length;
    const tsApi = this.timeScale();
    const range = tsApi.getVisibleLogicalRange();
    if (!this.axisLayer.isConnected) this.overlay.append(this.axisLayer);
    if (n === 0 || !range || range.to <= n - 1) {
      this.axisLayer.replaceChildren();
      return;
    }
    const lastShown = Number(this.ts(this.indicatorBars[n - 1]!.time));
    const xLast = tsApi.logicalToCoordinate((n - 1) as Logical);
    const xNext = tsApi.logicalToCoordinate(n as Logical);
    if (xLast === null || xNext === null) return;
    const pxPerBar = Math.max(0.01, xNext - xLast);
    const steps = [60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600, 43200, 86400, 604800];
    const step =
      steps.find((s) => s >= this.barSeconds && (s / this.barSeconds) * pxPerBar >= 70) ??
      steps.at(-1)!;
    const plotW = this.overlay.clientWidth - this.chart.priceScale('right').width();
    const axisH = tsApi.height();
    const y = this.overlay.clientHeight - axisH / 2 + 4;
    const end = lastShown + (range.to - (n - 1)) * this.barSeconds;
    const nodes: SVGElement[] = [];
    for (let t = Math.ceil((lastShown + this.barSeconds) / step) * step; t <= end; t += step) {
      const x = tsApi.logicalToCoordinate((n - 1 + (t - lastShown) / this.barSeconds) as Logical);
      // Keep clear of the library's own label on the last bar and of the price scale.
      if (x === null || x < xLast + 40 || x > plotW - 20) continue;
      const d = new Date(t * 1000);
      const midnight = t % 86_400 === 0;
      const text = !midnight
        ? d.toISOString().slice(11, 16)
        : this.blindAxis
          ? weekdayName(d.getUTCDay())
          : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
      const label = svg('text', {
        x,
        y,
        'font-size': '11px',
        'text-anchor': 'middle',
        style: `fill: ${this.theme.text}; stroke: none`,
        'data-kind': 'future-time',
      });
      label.textContent = text;
      nodes.push(label);
    }
    this.axisLayer.replaceChildren(...nodes);
  }

  /** Crosshair while drawing and the trendline rubber-band: redrawn on every mouse move. */
  private renderDynamic(plotW: number): void {
    const sig = `${plotW}|${this.drawingMode}|${this.shiftOn}|${JSON.stringify(this.pendingAnchor)}|${JSON.stringify(this.crosshair)}|${JSON.stringify(this.dragCursor)}`;
    if (sig === this.dynSig) return;
    this.dynSig = sig;
    const accent = this.theme.accent;
    const nodes: SVGElement[] = [];
    const axisNodes: SVGElement[] = [];
    // While dragging the chart cannot see the mouse, so draw the crosshair at the dragged
    // point; while a drawing tool is active, at the point the next click will place.
    const cursor = this.dragCursor ?? (this.drawingMode ? this.crosshair : null);
    if (cursor) {
      const x = this.xOf(cursor.t);
      const price =
        !this.dragCursor && this.shiftOn && this.pendingAnchor ? this.pendingAnchor.p : cursor.p;
      const y = this.yOf(price);
      const style = {
        stroke: withAlpha(this.theme.text, 0.6),
        'stroke-width': 1,
        'stroke-dasharray': '4 4',
        'pointer-events': 'none',
        'data-kind': 'draw-crosshair',
      };
      if (x !== null)
        nodes.push(svg('line', { x1: x, x2: x, y1: 0, y2: this.overlay.clientHeight, ...style }));
      if (y !== null) nodes.push(svg('line', { x1: 0, x2: plotW, y1: y, y2: y, ...style }));
      if (y !== null && this.dragCursor) {
        // Price tag on the price scale, so the level can be matched to earlier prices.
        const w = this.overlay.clientWidth;
        axisNodes.push(
          svg('rect', { x: plotW, y: y - 9, width: w - plotW, height: 18, fill: this.theme.text }),
        );
        const tag = svg('text', {
          x: plotW + 4,
          y: y + 4,
          'font-size': '11px',
          style: `fill: ${this.theme.background}; stroke: none`,
          'data-kind': 'drag-price',
        });
        tag.textContent = roundToTick(price, this.tick).toFixed(tickDecimals(this.tick));
        axisNodes.push(tag);
      }
    }
    // Rubber-band for trendline / arrow while waiting for the second click.
    if (this.pendingAnchor && this.crosshair) {
      const x1 = this.xOf(this.pendingAnchor.t);
      const y1 = this.yOf(this.pendingAnchor.p);
      const x2 = this.xOf(this.crosshair.t);
      // Shift keeps the line horizontal.
      const y2 = this.yOf(this.shiftOn ? this.pendingAnchor.p : this.crosshair.p);
      if (x1 != null && y1 != null && x2 != null && y2 != null) {
        nodes.push(
          svg('line', {
            x1,
            y1,
            x2,
            y2,
            stroke: accent,
            'stroke-width': 2,
            'stroke-dasharray': '4 4',
          }),
          svg('circle', { cx: x1, cy: y1, r: 6, fill: accent }),
        );
      }
    }
    const clipped = svg('g', { 'clip-path': `url(#${this.clipId})` });
    clipped.append(...nodes);
    this.dynLayer.replaceChildren(clipped, ...axisNodes);
  }

  private renderedOverlay(nodes: SVGElement[], plotW: number, w: number): void {
    // Clip shapes to the plot area so they never cover the price scale.
    const clipId = this.clipId;
    const defs = svg('defs', {});
    const clip = svg('clipPath', { id: clipId });
    clip.append(svg('rect', { x: 0, y: 0, width: plotW, height: this.overlay.clientHeight }));
    defs.append(clip);
    const g = svg('g', { 'clip-path': `url(#${clipId})` });
    g.append(...nodes);
    const orderGroup = svg('g', { class: 'order-handles' });
    const coarse = this.coarsePointer();
    for (const spec of this.orderLineSpecs) {
      const orderId = spec.orderId;
      if (orderId === undefined) continue;
      const y = this.yOf(spec.price);
      if (y === null) continue;
      if (spec.role === 'stop-loss' || spec.role === 'take-profit') {
        orderGroup.append(this.bracketMarker(spec, orderId, y, plotW, coarse));
        continue;
      }
      const h = svg('rect', {
        x: w - 12,
        y: y - 5,
        width: 12,
        height: 10,
        rx: 2,
        fill: spec.color,
        stroke: this.theme.text,
        'stroke-width': 1,
        class: 'order-handle',
        'data-order-id': String(orderId),
      });
      h.addEventListener('pointerdown', (ev) => this.startOrderDrag(ev, orderId));
      orderGroup.append(h);
    }
    this.overlay.replaceChildren(defs, g, orderGroup, this.dynLayer, this.axisLayer);
    this.renderFutureAxis();
    this.dynSig = '';
    this.renderDynamic(plotW);
  }

  private arrowHead(x: number, y: number, angle: number, color: string): SVGPathElement {
    return svg('path', {
      d: arrowHeadPath(x, y, angle),
      stroke: color,
      'stroke-width': 1,
      fill: color,
    });
  }

  private readonly clipId = `clip-${Math.random().toString(36).slice(2)}`;

  private startDrag(ev: PointerEvent, d: Drawing, part: DragPart): void {
    ev.stopPropagation();
    this.selected = d.id;
    this.syncStyleBar();
    const rect = this.overlay.getBoundingClientRect();
    const t0 = this.timeAt(ev.clientX - rect.left) ?? 0;
    const p0 = this.priceAt(ev.clientY - rect.top) ?? 0;
    this.drag = { id: d.id, part, start: d, t0, p0 };
    // Cover the chart while dragging so it never sees the moves (no panning, no stuck state).
    this.overlay.classList.add('dragging');
    let moved = false;
    const move = (e: PointerEvent) => {
      const t = this.timeAt(e.clientX - rect.left);
      const p = this.priceAt(e.clientY - rect.top, e.clientX - rect.left);
      if (t === null || p === null || !this.drag) return;
      moved = true;
      const { start, part } = this.drag;
      // Shift keeps a trendline or ray horizontal while dragging one of its ends.
      const point =
        (e.shiftKey || HorizontalLock.on) &&
        (start.kind === 'tline' || start.kind === 'ray') &&
        (part === 'p1' || part === 'p2')
          ? part === 'p1'
            ? start.p2
            : start.p1
          : p;
      const next = this.dragged(start, part, t, point, t - this.drag.t0, p - this.drag.p0);
      this.dragCursor = { t, p: point };
      this.drawings = this.drawings.map((x) => (x.id === next.id ? next : x));
      this.overlaySig = '';
      this.renderOverlay();
    };
    const up = () => {
      this.dragCursor = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.overlay.classList.remove('dragging');
      const done = this.drawings.find((x) => x.id === this.drag?.id);
      this.drag = null;
      this.overlaySig = '';
      this.renderOverlay();
      if (moved && done) {
        this.renderPriceLines();
        this.editHandler?.(done);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this.overlaySig = '';
    this.renderOverlay();
  }

  private startOrderDrag(ev: PointerEvent, orderId: number): void {
    ev.stopPropagation();
    ev.preventDefault();
    const priceLine = this.orderLineById.get(orderId);
    const handler = this.orderDragHandler;
    if (!priceLine || !handler) return;
    const spec = this.orderLineSpecs.find((l) => l.orderId === orderId);
    if (!spec) return;
    const startPrice = spec.price;
    const handle = this.overlay.querySelector(`rect[data-order-id="${orderId}"]`) as SVGRectElement;
    this.orderDrag = { orderId, startPrice, priceLine, handle };
    this.overlay.classList.add('dragging');
    let moved = false;
    const move = (e: PointerEvent) => {
      const rect = this.overlay.getBoundingClientRect();
      const p = this.priceAt(e.clientY - rect.top);
      const drag = this.orderDrag;
      if (p === null || !drag) return;
      moved = true;
      spec.price = p;
      drag.priceLine.applyOptions({ price: p });
      if (drag.handle) {
        const y = this.yOf(p);
        if (y !== null) {
          const height = Number(drag.handle.getAttribute('height') ?? 10);
          drag.handle.setAttribute('y', String(y - height / 2));
        }
      }
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.overlay.classList.remove('dragging');
      const drag = this.orderDrag;
      this.orderDrag = null;
      if (!drag || !moved) {
        this.overlaySig = '';
        this.renderOverlay();
        return;
      }
      try {
        await handler(drag.orderId, spec.price);
      } catch {
        // The caller shows the error. Snap the line back to the last accepted price.
        drag.priceLine.applyOptions({ price: drag.startPrice });
        spec.price = drag.startPrice;
      }
      this.overlaySig = '';
      this.renderOverlay();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private dragged(
    d: Drawing,
    part: DragPart,
    t: number,
    p: number,
    dt: number,
    dp: number,
  ): Drawing {
    const shiftP = (v: number) => Number((v + dp).toFixed(10));
    if (d.kind === 'hline') return { ...d, price: p };
    if (d.kind === 'text') return { ...d, t: d.t + dt, price: shiftP(d.price) };
    if (d.kind === 'freehand') {
      return {
        ...d,
        points: d.points.map((pt) => ({ t: pt.t + dt, p: shiftP(pt.p) })),
      };
    }
    if (d.kind === 'arrow') {
      if (part === 'p1') return { ...d, t1: t, p1: p };
      if (part === 'p2') return { ...d, t2: t, p2: p };
      return {
        ...d,
        t1: d.t1 + dt,
        t2: d.t2 + dt,
        p1: shiftP(d.p1),
        p2: shiftP(d.p2),
      };
    }
    if (d.kind === 'channel' && part === 'w') {
      // Offset follows the pointer: price under the cursor minus the base line at that time.
      const span = d.t2 - d.t1 || 1;
      const base = d.p1 + ((d.p2 - d.p1) * (t - d.t1)) / span;
      return { ...d, w: Number((p - base).toFixed(10)) };
    }
    if (
      d.kind === 'tline' ||
      d.kind === 'rect' ||
      d.kind === 'ray' ||
      d.kind === 'vline' ||
      d.kind === 'fib' ||
      d.kind === 'ce' ||
      d.kind === 'measure' ||
      d.kind === 'channel' ||
      d.kind === 'prange'
    ) {
      if (part === 'p1' && d.kind === 'vline') return { ...d, t1: t, t2: t };
      if (part === 'p1') return { ...d, t1: t, p1: p };
      if (part === 'p2') return { ...d, t2: t, p2: p };
      if (part === 'c12') return { ...d, t1: t, p2: p };
      if (part === 'c21') return { ...d, t2: t, p1: p };
      if (part === 'edgeT1') return { ...d, t1: t };
      if (part === 'edgeT2') return { ...d, t2: t };
      if (part === 'edgeP1') return { ...d, p1: p };
      if (part === 'edgeP2') return { ...d, p2: p };
      return { ...d, t1: d.t1 + dt, t2: d.t2 + dt, p1: shiftP(d.p1), p2: shiftP(d.p2) };
    }
    let n = d;
    if (part === 'entry') {
      // As in TradingView: the left handle moves the entry price and the left edge;
      // stop, target and the right edge stay put. Entry stays between stop and target.
      const lo = Math.min(d.stop, d.target) + this.tick;
      const hi = Math.max(d.stop, d.target) - this.tick;
      n = {
        ...d,
        t1: Math.min(t, d.t2 - this.barSeconds),
        entry: Math.min(hi, Math.max(lo, p)),
      };
    } else if (part === 'body')
      n = {
        ...d,
        t1: d.t1 + dt,
        t2: d.t2 + dt,
        entry: shiftP(d.entry),
        stop: shiftP(d.stop),
        target: shiftP(d.target),
      };
    else if (part === 'stop') n = { ...d, stop: p };
    else if (part === 'target') n = { ...d, target: p };
    else if (part === 't2') n = { ...d, t2: Math.max(t, d.t1 + this.barSeconds) };
    return clampPosition(n, this.tick);
  }

  /** Right-click or a still long-press on a candle. Drawing handles are left alone. */
  onBarContext(handler: (c: ChartClick & { clientX: number; clientY: number }) => void): void {
    const emit = (clientX: number, clientY: number) => {
      if (this.freehandMode) return;
      const rect = this.container.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const plotW = rect.width - this.chart.priceScale('right').width();
      if (x < 0 || y < 0 || x > plotW || y > rect.height) return;
      const time = this.timeAt(x);
      if (time === null) return;
      const price = this.candles.coordinateToPrice(y);
      handler({
        time,
        price: price === null ? null : Number(price),
        shift: false,
        clientX,
        clientY,
      });
    };
    this.container.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const target = e.target as Element | null;
      if (
        target?.closest?.(
          '.bracket-marker, .order-handle, .handle, .drawing-palette, .drawing-style-bar, .bar-menu',
        )
      )
        return;
      emit(e.clientX, e.clientY);
    });
    this.container.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const target = e.target as Element | null;
      if (
        target?.closest?.(
          '.bracket-marker, .order-handle, .handle, .del, .drawing-palette, .drawing-style-bar',
        )
      )
        return;
      if (this.touchCursor) return;
      this.barHoldStart = { x: e.clientX, y: e.clientY };
      if (this.barContextTimer) clearTimeout(this.barContextTimer);
      this.barContextTimer = setTimeout(() => {
        this.barContextTimer = undefined;
        const held = this.barHoldStart;
        this.barHoldStart = null;
        if (!held) return;
        this.swallowClick = true;
        emit(held.x, held.y);
      }, 550);
    });
    this.container.addEventListener('pointermove', (e) => {
      const start = this.barHoldStart;
      if (!start || !this.barContextTimer) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) this.clearBarContextHold();
    });
    this.container.addEventListener('pointerup', () => this.clearBarContextHold());
    this.container.addEventListener('pointercancel', () => this.clearBarContextHold());
  }

  private clearBarContextHold(): void {
    if (this.barContextTimer) clearTimeout(this.barContextTimer);
    this.barContextTimer = undefined;
    this.barHoldStart = null;
  }

  private coarsePointer(): boolean {
    return window.matchMedia?.('(pointer: coarse), (max-width: 899px)').matches ?? false;
  }

  private bracketMarker(
    spec: PriceLineSpec,
    orderId: number,
    y: number,
    plotW: number,
    coarse: boolean,
  ): SVGGElement {
    const role = spec.role === 'take-profit' ? 'take-profit' : 'stop-loss';
    const size = bracketMarkerSize(coarse);
    const x = Math.max(4, plotW - size.w - 6);
    const top = Math.max(2, y - size.h / 2);
    const g = svg('g', {
      class: 'bracket-marker',
      'data-testid': role === 'stop-loss' ? 'bracket-stop' : 'bracket-target',
      'data-role': role,
      'data-order-id': String(orderId),
    });
    g.setAttribute('role', 'slider');
    g.setAttribute('aria-orientation', 'vertical');
    g.setAttribute('aria-label', t(role === 'stop-loss' ? 'pr.dragStop' : 'pr.dragTarget'));
    const hit = svg('rect', {
      x,
      y: top,
      width: size.w,
      height: size.h,
      rx: 6,
      fill: spec.color,
      stroke: this.theme.text,
      'stroke-width': 1,
      class: 'bracket-marker-hit',
      'data-order-id': String(orderId),
    });
    const reference = spec.reference ?? spec.price;
    const label = svg('text', {
      x: x + size.w / 2,
      y: top + size.h / 2,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': coarse ? 13 : 11,
    });
    label.textContent = bracketMarkerLabel(role, spec.price, reference, this.tick);
    g.append(hit, label);
    g.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.startOrderDrag(ev, orderId);
    });
    return g;
  }

  /** The cancel button on the touch drawing steps bar. */
  onDrawCancel(handler: () => void): void {
    this.drawCancelHandler = handler;
  }

  private plotSize(): { plotW: number; plotH: number } {
    const rect = this.container.getBoundingClientRect();
    return {
      plotW: rect.width - this.chart.priceScale('right').width(),
      plotH: rect.height - this.chart.timeScale().height(),
    };
  }

  /** Crosshair, ring and steps bar for the touch cursor (all hidden without one). */
  private applyTouchCursor(): void {
    const c = this.touchCursor;
    this.cursorRing.hidden = !c;
    this.stepsBar.hidden = !c;
    if (!c) return;
    const time = this.timeAt(c.x);
    const price = this.priceAt(c.y, c.x);
    this.crosshair = time === null || price === null ? null : { t: time, p: price };
    const y = price === null ? c.y : (this.yOf(price) ?? c.y);
    this.cursorRing.style.left = `${c.x}px`;
    this.cursorRing.style.top = `${y}px`;
    const total = this.touchPoints * 2;
    const placed = this.pendingAnchor ? 1 : 0;
    const step = Math.min(total, placed * 2 + (this.touchMoved ? 2 : 1));
    const key: MessageKey =
      step === total
        ? 'pr.touchTapFinish'
        : step % 2 === 0
          ? 'pr.touchTapFirst'
          : placed
            ? 'pr.touchMoveNext'
            : 'pr.touchMoveStart';
    this.stepsNo.textContent = `${step}/${total}`;
    this.stepsMsg.textContent = t(key);
    this.renderOverlay();
  }

  private readonly onCursorTouch = (e: TouchEvent): void => {
    const cursor = this.touchCursor;
    if (!cursor) return;
    if (e.type === 'touchstart') {
      this.touchGesture = null;
      // Two fingers pinch-zoom the chart as usual.
      if (e.touches.length !== 1) return;
      const target = e.target as Element | null;
      if (
        target?.closest?.(
          '.drawing-palette, .drawing-style-bar, .draw-steps, .scroll-latest, .tline-input, .bar-menu, button, input, select',
        )
      )
        return;
      const touch = e.touches[0]!;
      const rect = this.container.getBoundingClientRect();
      const { plotW, plotH } = this.plotSize();
      // The price and time axes keep their own drag-to-scale.
      if (touch.clientX - rect.left > plotW || touch.clientY - rect.top > plotH) return;
      this.touchGesture = {
        x: touch.clientX,
        y: touch.clientY,
        cx: cursor.x,
        cy: cursor.y,
        moved: false,
      };
    } else {
      const g = this.touchGesture;
      if (!g) return;
      if (e.type === 'touchmove') {
        const touch = e.touches[0];
        if (e.touches.length !== 1 || !touch) {
          this.touchGesture = null;
          return;
        }
        const dx = touch.clientX - g.x;
        const dy = touch.clientY - g.y;
        if (g.moved || Math.hypot(dx, dy) >= 6) {
          g.moved = true;
          const { plotW, plotH } = this.plotSize();
          this.touchCursor = {
            x: Math.min(Math.max(g.cx + dx, 0), plotW - 1),
            y: Math.min(Math.max(g.cy + dy, 0), plotH - 1),
          };
          this.touchMoved = true;
          this.applyTouchCursor();
        }
      } else {
        this.touchGesture = null;
        if (e.type === 'touchend' && !g.moved) this.placeAtTouchCursor();
      }
    }
    // The chart library never sees a cursor gesture (no pan, no native click).
    e.preventDefault();
    e.stopPropagation();
  };

  private placeAtTouchCursor(): void {
    const c = this.touchCursor;
    if (!c || !this.clickHandler) return;
    const time = this.timeAt(c.x);
    const price = this.priceAt(c.y, c.x);
    this.touchMoved = false;
    this.clickHandler({ time, price, shift: this.shiftOn });
    if (this.touchCursor) this.applyTouchCursor();
  }

  onClick(handler: (c: ChartClick) => void): void {
    this.clickHandler = handler;
    // Native clicks (not the library's click events, which merge quick clicks into a
    // double-click): every click counts, a click that was really a pan (moved > 4 px) does not.
    let down: { x: number; y: number } | null = null;
    // Local: on touch screens the chart library cancels the native click after a tap, so a
    // touch pointerup stands in for it (and a click that still follows it is ignored).
    let touchDown: { id: number; freehand: boolean; onShape: boolean } | null = null;
    let lastTouchTap = -Infinity;
    let freehandMoved = false;
    let stroke: number | null = null;
    // Capture phase: the chart library may stop these events from bubbling.
    this.container.addEventListener(
      'pointerdown',
      (e) => {
        down = { x: e.clientX, y: e.clientY };
        // A touch that starts on a drawing (select / drag) or a control is not a chart tap:
        // the redraw on select replaces that element, so pointerup cannot tell by itself.
        touchDown =
          e.pointerType === 'mouse'
            ? null
            : {
                id: e.pointerId,
                freehand: this.freehandMode,
                onShape: !!(e.target as Element).closest?.(
                  '.handle, .hit, .del, .position-body, .drawing-style-bar, .bracket-marker, .order-handle, .drawing-palette, .scroll-latest, .tline-add, .tline-text',
                ),
              };
        if (!this.freehandMode) return;
        // The Draw palette lives inside the chart container: its buttons are not canvas.
        if ((e.target as Element).closest?.('.drawing-palette, .drawing-style-bar')) return;
        e.preventDefault();
        e.stopPropagation();
        // A stroke is one gesture: start fresh, and only this pointer may extend or end it.
        this.freehandPoints = [];
        stroke = e.pointerId;
        this.pushFreehandPoint(e.clientX, e.clientY);
        freehandMoved = false;
      },
      true,
    );
    this.container.addEventListener(
      'pointermove',
      (e) => {
        if (!this.freehandMode || stroke !== e.pointerId) return;
        e.preventDefault();
        freehandMoved = true;
        this.pushFreehandPoint(e.clientX, e.clientY);
      },
      true,
    );
    this.container.addEventListener(
      'pointerup',
      (e) => {
        // Ends only a stroke this recorder saw start (a gesture stopped earlier, e.g. the tap
        // that closed a panel, never reaches pointerdown here and so never draws).
        if (!this.freehandMode || stroke !== e.pointerId) return;
        stroke = null;
        e.preventDefault();
        e.stopPropagation();
        if (!freehandMoved) this.pushFreehandPoint(e.clientX, e.clientY);
        const pts = PriceChart.simplifyFreehand(this.freehandPoints);
        const cb = this.freehandHandler;
        this.stopFreehand();
        if (pts.length >= 2 && cb) cb(pts);
      },
      true,
    );
    const tap = (e: MouseEvent): void => {
      if (this.swallowClick) {
        this.swallowClick = false;
        return;
      }
      if (this.freehandMode) return;
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      if (
        (e.target as Element).closest?.(
          '.handle, .hit, .del, .position-body, .drawing-style-bar, .bracket-marker, .order-handle',
        )
      )
        return;
      if (this.selected) {
        this.selected = null;
        this.syncStyleBar();
        this.overlaySig = '';
        this.renderOverlay();
      }
      const rect = this.container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const plotW = rect.width - this.chart.priceScale('right').width();
      if (x > plotW) return;
      const price = getSettings().magnet ? this.priceAt(y, x) : this.candles.coordinateToPrice(y);
      const time = this.timeAt(x);
      handler({
        time,
        price: price === null ? null : Number(price),
        shift: e.shiftKey || HorizontalLock.on,
      });
    };
    this.container.addEventListener(
      'click',
      (e) => {
        if (performance.now() - lastTouchTap < 800) return;
        tap(e);
      },
      true,
    );
    this.container.addEventListener(
      'pointerup',
      (e) => {
        const td = touchDown;
        touchDown = null;
        if (!td || td.id !== e.pointerId || td.freehand || td.onShape || this.touchCursor) return;
        lastTouchTap = performance.now();
        tap(e);
      },
      true,
    );
  }

  applyTheme(): void {
    this.theme = readTheme();
    this.chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: this.theme.background },
        textColor: this.theme.text,
      },
      grid: { vertLines: { color: this.theme.grid }, horzLines: { color: this.theme.grid } },
      rightPriceScale: { borderColor: this.theme.border },
      timeScale: { borderColor: this.theme.border },
    });
    this.candles.applyOptions({
      upColor: this.theme.up,
      downColor: this.theme.down,
      wickUpColor: this.theme.up,
      wickDownColor: this.theme.down,
    });
    this.volume.applyOptions({ visible: this.volumeVisible() });
  }

  // ---------------------------------------------------------------- freehand
  startFreehand(onPoint: (point: { t: number; p: number }) => void, onDone: () => void): void {
    this.freehandMode = true;
    this.freehandPoints = [];
    this.freehandHandler = (pts) => {
      for (const p of pts) onPoint(p);
      onDone();
    };
    this.freehandDone = onDone;
    this.overlay.classList.add('drawing-freehand');
  }

  stopFreehand(): void {
    this.freehandMode = false;
    this.freehandPoints = [];
    this.freehandHandler = undefined;
    this.freehandDone = undefined;
    this.overlay.classList.remove('drawing-freehand');
  }

  private pushFreehandPoint(clientX: number, clientY: number): void {
    const rect = this.overlay.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const t = this.timeAt(x);
    const p = this.priceAt(y);
    if (t === null || p === null) return;
    this.freehandPoints.push({ t, p });
  }

  private syncStyleBar(): void {
    const d = this.drawings.find((x) => x.id === this.selected);
    if (!d || d.kind !== 'text') {
      this.styleBar.hidden = true;
      this.styleBar.replaceChildren();
      return;
    }
    this.styleBar.hidden = false;
    const color = document.createElement('input');
    color.type = 'color';
    color.value = d.color ?? '#7cc4ff';
    color.title = t('pr.textColor');
    color.dataset.testid = 'text-color';
    color.addEventListener('input', () => {
      const next = { ...d, color: color.value };
      this.drawings = this.drawings.map((x) => (x.id === next.id ? next : x));
      this.overlaySig = '';
      this.renderOverlay();
      this.editHandler?.(next);
    });
    const size = document.createElement('input');
    size.type = 'number';
    size.min = '8';
    size.max = '48';
    size.step = '1';
    size.value = String(d.fontSize && d.fontSize > 0 ? d.fontSize : 13);
    size.title = t('pr.textSize');
    size.dataset.testid = 'text-size';
    size.addEventListener('change', () => {
      const v = Number(size.value);
      if (!Number.isFinite(v) || v < 8 || v > 48) return;
      const next = { ...d, fontSize: Math.round(v) };
      this.drawings = this.drawings.map((x) => (x.id === next.id ? next : x));
      this.overlaySig = '';
      this.renderOverlay();
      this.editHandler?.(next);
    });
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'small';
    edit.textContent = t('pr.textEdit');
    edit.dataset.testid = 'text-edit';
    edit.addEventListener('click', () => this.editTextContent(d));
    const label = document.createElement('span');
    label.className = 'muted small';
    label.textContent = t('pr.textStyle');
    this.styleBar.replaceChildren(label, color, size, edit);
  }

  /**
   * Trendline with optional text in its middle, as in TradingView: the text follows the
   * line's angle and the line breaks around it. A selected line without text shows an
   * "add text" placeholder there; clicking it (or double-clicking the text) edits inline.
   * Also used for a rectangle's dashed middle line (`lineAttrs` styles the line).
   */
  private tlineNodes(
    d: Extract<Drawing, { kind: 'tline' | 'rect' }>,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    accent: string,
    nodes: SVGElement[],
    hit: (d: Drawing, node: SVGElement) => void,
    lineAttrs: Record<string, string | number> = {},
  ): void {
    const editable = !this.lockedIds.has(d.id);
    const placeholder = !d.text && editable && this.selected === d.id;
    const label = d.text ?? (placeholder ? `+ ${t('pr.addText')}` : '');
    const line = (ax: number, ay: number, bx: number, by: number) =>
      nodes.push(
        svg('line', {
          x1: ax,
          y1: ay,
          x2: bx,
          y2: by,
          stroke: accent,
          'stroke-width': 1,
          ...lineAttrs,
        }),
      );
    if (!label) {
      line(x1, y1, x2, y2);
      return;
    }
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const gap = measureLabel(label) + 12;
    if (len > gap + 4) {
      const k = gap / 2 / len;
      line(x1, y1, mx - (x2 - x1) * k, my - (y2 - y1) * k);
      line(mx + (x2 - x1) * k, my + (y2 - y1) * k, x2, y2);
    } else line(x1, y1, x2, y2);
    // Keep the text upright whichever way the line was drawn.
    let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    else if (angle < -90) angle += 180;
    const tx = svg('text', {
      x: mx,
      y: my,
      fill: accent,
      'font-size': '13px',
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      transform: `rotate(${angle.toFixed(2)} ${mx} ${my})`,
      class: placeholder ? 'tline-add' : 'tline-text',
      'data-testid': `tline-text-${d.id}`,
    });
    tx.textContent = label;
    if (placeholder) {
      tx.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      tx.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.editTlineText(d, mx, my);
      });
      nodes.push(tx);
    } else if (editable) {
      // Double-click edits. The first click selects and redraws the line, so the second
      // lands on a new element and the browser never fires dblclick: detect it here.
      tx.addEventListener('pointerdown', (ev) => {
        const now = performance.now();
        const last = this.lastTextDown;
        this.lastTextDown = { id: d.id, at: now, x: ev.clientX, y: ev.clientY };
        if (
          last &&
          last.id === d.id &&
          now - last.at < 450 &&
          Math.hypot(ev.clientX - last.x, ev.clientY - last.y) < 6
        ) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          this.lastTextDown = null;
          this.selected = d.id;
          this.editTlineText(d, mx, my);
        }
      });
      hit(d, tx);
    } else nodes.push(tx);
  }

  /** Small inline input over the line's middle; Enter or leaving it saves, Esc cancels. */
  private editTlineText(
    d: Extract<Drawing, { kind: 'tline' | 'rect' }>,
    x: number,
    y: number,
  ): void {
    this.container.querySelector('.tline-input')?.remove();
    const input = document.createElement('input');
    input.className = 'tline-input';
    input.maxLength = 200;
    input.value = d.text ?? '';
    input.placeholder = t('pr.addText');
    input.dataset.testid = 'tline-input';
    input.style.left = `${x}px`;
    input.style.top = `${y}px`;
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      input.remove();
      if (!save) return;
      const text = input.value.trim().slice(0, 200);
      if (text === (d.text ?? '')) return;
      const next: Drawing = { ...d, text };
      if (!text) delete next.text;
      this.drawings = this.drawings.map((o) => (o.id === next.id ? next : o));
      this.overlaySig = '';
      this.renderOverlay();
      this.editHandler?.(next);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.container.append(input);
    input.focus();
    input.select();
  }

  private editTextContent(d: Extract<Drawing, { kind: 'text' }>): void {
    const nextText = prompt(t('pr.textPrompt'), d.text);
    if (nextText === null) return;
    const trimmed = nextText.trim();
    if (!trimmed) return;
    const next = { ...d, text: trimmed.slice(0, 200) };
    this.drawings = this.drawings.map((x) => (x.id === next.id ? next : x));
    this.overlaySig = '';
    this.renderOverlay();
    this.syncStyleBar();
    this.editHandler?.(next);
  }

  /** Simplify a freehand stroke with a basic distance threshold. */
  static simplifyFreehand(
    points: { t: number; p: number }[],
    threshold = 8,
  ): { t: number; p: number }[] {
    if (points.length < 3) return points;
    const out: { t: number; p: number }[] = [points[0]!];
    for (let i = 1; i < points.length - 1; i++) {
      const a = out[out.length - 1]!;
      const b = points[i]!;
      const dx = b.t - a.t;
      const dy = b.p - a.p;
      if (Math.hypot(dx, dy) >= threshold) out.push(b);
    }
    out.push(points[points.length - 1]!);
    return out;
  }

  // ---------------------------------------------------------------- indicators
  private indicatorLineData(
    values: readonly (number | null)[],
    bars: readonly Bar[],
  ): { time: UTCTimestamp; value: number | null }[] {
    return bars.map((b, i) => ({ time: this.ts(b.time), value: values[i] ?? null }));
  }

  private indicatorSeriesOptions(setting: IndicatorSetting, lineStyle?: LineStyle) {
    return {
      color: setting.color ?? '#888888',
      lineWidth: 2 as const,
      ...(lineStyle !== undefined ? { lineStyle } : {}),
      lastValueVisible: false,
      priceLineVisible: false,
    };
  }

  private overlayKeys(s: IndicatorSetting): string[] {
    if (
      s.kind === 'bollinger' ||
      s.kind === 'donchian' ||
      s.kind === 'keltner' ||
      s.kind === 'envelope' ||
      s.kind === 'stderr' ||
      s.kind === 'priceChannel'
    ) {
      return [`${s.id}:u`, `${s.id}:m`, `${s.id}:l`];
    }
    if (s.kind === 'orb') return [`${s.id}:h`, `${s.id}:l`];
    if (s.kind === 'fvg' || s.kind === 'atm' || s.kind === 'htf') return [];
    if (s.kind === 'ichimoku') {
      return [
        `${s.id}:tenkan`,
        `${s.id}:kijun`,
        `${s.id}:spanA`,
        `${s.id}:spanB`,
        `${s.id}:chikou`,
      ];
    }
    if (s.kind === 'vwapBands') {
      return [`${s.id}:vwap`, `${s.id}:u1`, `${s.id}:l1`, `${s.id}:u2`, `${s.id}:l2`];
    }
    return [s.id];
  }

  private paneKeys(s: IndicatorSetting): string[] {
    if (s.kind === 'macd') return [`${s.id}:macd`, `${s.id}:signal`, `${s.id}:hist`];
    if (s.kind === 'stochastic') return [`${s.id}:k`, `${s.id}:d`];
    if (s.kind === 'adx') return [`${s.id}:adx`, `${s.id}:pdi`, `${s.id}:mdi`];
    if (s.kind === 'aroon') return [`${s.id}:up`, `${s.id}:down`];
    if (s.kind === 'kdj') return [`${s.id}:k`, `${s.id}:d`, `${s.id}:j`];
    if (s.kind === 'elder') return [`${s.id}:bull`, `${s.id}:bear`];
    return [s.id];
  }

  private renderIndicators(): void {
    if (!this.indicatorConfig || !this.indicatorAgg) return;
    const bars = this.indicatorBars;
    if (bars.length === 0) return;

    this.volume.applyOptions({ visible: this.volumeVisible() });

    const overlayWanted = new Set<string>();
    for (const s of this.indicatorConfig.overlays) {
      if (!s.visible || s.kind === 'volume') continue;
      for (const key of this.overlayKeys(s)) overlayWanted.add(key);
    }
    for (const [key, series] of [...this.overlaySeries]) {
      if (!overlayWanted.has(key)) {
        this.chart.removeSeries(series);
        this.overlaySeries.delete(key);
      }
    }

    for (const s of this.indicatorConfig.overlays) {
      if (!s.visible || s.kind === 'volume' || !isOverlayKind(s.kind)) continue;
      const source = s.source ?? 'close';
      switch (s.kind) {
        case 'sma':
          this.ensureOverlayLine(s.id, s).setData(
            this.indicatorLineData(sma(bars, s.period ?? 20, source), bars),
          );
          break;
        case 'ema':
          this.ensureOverlayLine(s.id, s).setData(
            this.indicatorLineData(ema(bars, s.period ?? 21, source), bars),
          );
          break;
        case 'bollinger': {
          const r = bollinger(bars, s.period ?? 20, s.stdDev ?? 2, source);
          this.ensureOverlayLine(`${s.id}:u`, s).setData(this.indicatorLineData(r.upper, bars));
          this.ensureOverlayLine(`${s.id}:m`, s).setData(this.indicatorLineData(r.middle, bars));
          this.ensureOverlayLine(`${s.id}:l`, s).setData(this.indicatorLineData(r.lower, bars));
          break;
        }
        case 'vwap': {
          const r = vwap(bars, this.indicatorAgg);
          this.ensureOverlayLine(s.id, s).setData(
            r.map((p) => ({ time: this.ts(p.time), value: p.value })),
          );
          break;
        }
        case 'orb': {
          const r = orbLevels(bars, s.minutes ?? 30, this.indicatorAgg);
          this.ensureOverlayLine(`${s.id}:h`, s).setData(this.indicatorLineData(r.high, bars));
          this.ensureOverlayLine(`${s.id}:l`, s).setData(this.indicatorLineData(r.low, bars));
          break;
        }
        case 'fvg':
        case 'atm':
        case 'htf':
          break;
        case 'donchian': {
          const r = donchian(bars, s.period ?? 20);
          this.ensureOverlayLine(`${s.id}:u`, s).setData(this.indicatorLineData(r.upper, bars));
          this.ensureOverlayLine(`${s.id}:m`, s).setData(this.indicatorLineData(r.middle, bars));
          this.ensureOverlayLine(`${s.id}:l`, s).setData(this.indicatorLineData(r.lower, bars));
          break;
        }
        case 'keltner': {
          const r = keltner(bars, s.period ?? 20, s.fast ?? 10, s.multiplier ?? 2, source);
          this.paintBands(s, r, bars);
          break;
        }
        case 'envelope': {
          const r = envelope(bars, s.period ?? 20, s.percent ?? 10, source);
          this.paintBands(s, r, bars);
          break;
        }
        case 'stderr': {
          const r = standardErrorBands(bars, s.period ?? 20, s.multiplier ?? 2, source);
          this.paintBands(s, r, bars);
          break;
        }
        case 'priceChannel': {
          const r = priceChannel(bars, s.period ?? 20);
          this.paintBands(s, r, bars);
          break;
        }
        case 'ichimoku': {
          const kijun = s.slow ?? 26;
          const r = ichimoku(bars, s.fast ?? 9, kijun, s.signal ?? 52, kijun);
          this.ensureOverlayLine(`${s.id}:tenkan`, s).setData(
            this.indicatorLineData(r.tenkan, bars),
          );
          this.ensureOverlayLine(`${s.id}:kijun`, s).setData(this.indicatorLineData(r.kijun, bars));
          this.ensureOverlayLine(`${s.id}:spanA`, s).setData(
            this.indicatorLineData(r.senkouA, bars),
          );
          this.ensureOverlayLine(`${s.id}:spanB`, s).setData(
            this.indicatorLineData(r.senkouB, bars),
          );
          this.ensureOverlayLine(`${s.id}:chikou`, s).setData(
            this.indicatorLineData(r.chikou, bars),
          );
          break;
        }
        case 'supertrend': {
          const r = supertrend(bars, s.period ?? 10, s.multiplier ?? 3);
          this.ensureOverlayLine(s.id, s).setData(this.indicatorLineData(r.line, bars));
          break;
        }
        case 'sar':
          this.ensureOverlayLine(s.id, s, LineStyle.Dotted).setData(
            this.indicatorLineData(parabolicSar(bars, s.step ?? 0.02, s.maxStep ?? 0.2), bars),
          );
          break;
        case 'zigzag':
          this.ensureOverlayLine(s.id, s).setData(
            this.indicatorLineData(zigzag(bars, s.percent ?? 5), bars),
          );
          break;
        case 'dema':
          this.ensureOverlayLine(s.id, s).setData(
            this.indicatorLineData(dema(bars, s.period ?? 20, source), bars),
          );
          break;
        case 'tema':
          this.ensureOverlayLine(s.id, s).setData(
            this.indicatorLineData(tema(bars, s.period ?? 20, source), bars),
          );
          break;
        case 'wma':
          this.ensureOverlayLine(s.id, s).setData(
            this.indicatorLineData(wma(bars, s.period ?? 20, source), bars),
          );
          break;
        case 'hull':
          this.ensureOverlayLine(s.id, s).setData(
            this.indicatorLineData(hull(bars, s.period ?? 16, source), bars),
          );
          break;
        case 'vwma':
          this.ensureOverlayLine(s.id, s).setData(
            this.indicatorLineData(vwma(bars, s.period ?? 20, source), bars),
          );
          break;
        case 'vwapBands': {
          const r = vwapBands(bars, this.indicatorAgg);
          this.ensureOverlayLine(`${s.id}:vwap`, s).setData(this.indicatorLineData(r.vwap, bars));
          this.ensureOverlayLine(`${s.id}:u1`, s).setData(this.indicatorLineData(r.upper1, bars));
          this.ensureOverlayLine(`${s.id}:l1`, s).setData(this.indicatorLineData(r.lower1, bars));
          this.ensureOverlayLine(`${s.id}:u2`, s).setData(this.indicatorLineData(r.upper2, bars));
          this.ensureOverlayLine(`${s.id}:l2`, s).setData(this.indicatorLineData(r.lower2, bars));
          break;
        }
        default: {
          const leftover: never = s.kind;
          void leftover;
          break;
        }
      }
    }

    const fvgSetting = this.indicatorConfig.overlays.find((o) => o.kind === 'fvg' && o.visible);
    this.fvgZones = fvgSetting ? fvg(bars) : [];
    this.fvgColor = fvgSetting?.color ?? this.fvgColor;
    this.overlaySig = '';
    this.renderOverlay();
    // The script only draws on charts of 30 minutes or less.
    const atmOn = this.indicatorConfig.overlays.some((o) => o.kind === 'atm' && o.visible);
    this.atmList =
      atmOn && this.barSeconds <= 1800
        ? atmSessions(bars, this.indicatorAgg.utcOffsetMinutes ?? 0)
        : [];
    // HTF candles: only timeframes that whole chart bars add up to.
    const htfSettings = this.indicatorConfig.overlays.filter(
      (o) =>
        o.kind === 'htf' &&
        o.visible &&
        (HTF_MINUTES as readonly number[]).includes(o.minutes ?? 60) &&
        (o.minutes ?? 60) * 60 > this.barSeconds &&
        ((o.minutes ?? 60) * 60) % this.barSeconds === 0,
    );
    this.htfList = htfSettings.map((o) =>
      htfCandles(bars, (o.minutes ?? 60) * 60, Math.min(o.period ?? 5, 30), this.indicatorAgg),
    );
    // Room right of the last bar for the candle sets.
    const room = htfSettings.length
      ? htfSettings.reduce(
          (a, o) => a + Math.min(o.period ?? 5, 30) * HTF_STEP + HTF_SET_GAP,
          HTF_PAD,
        )
      : 8;
    if (room !== this.rightOffsetBars) {
      this.rightOffsetBars = room;
      this.timeScale().applyOptions({ rightOffset: room });
    }
    if ((this.fvgZones.length || this.atmList.length || this.htfList.length) && !this.raf)
      this.loop();

    const paneWanted = new Set<string>();
    for (const s of this.indicatorConfig.panes) {
      if (!s.visible) continue;
      for (const key of this.paneKeys(s)) paneWanted.add(key);
    }
    const hasPane = paneWanted.size > 0;
    if (!hasPane && this.indicatorPane) {
      this.chart.removePane(1);
      this.indicatorPane = undefined;
      this.paneIndicatorSeries.clear();
    } else if (hasPane && !this.indicatorPane) {
      this.indicatorPane = this.chart.addPane();
      this.indicatorPane.setHeight(120);
    }
    for (const [key, series] of [...this.paneIndicatorSeries]) {
      if (!paneWanted.has(key)) {
        this.chart.removeSeries(series);
        this.paneIndicatorSeries.delete(key);
      }
    }

    for (const s of this.indicatorConfig.panes) {
      if (!s.visible || isOverlayKind(s.kind)) continue;
      const source = s.source ?? 'close';
      switch (s.kind) {
        case 'rsi':
          this.ensurePaneLine(s.id, s, 1).setData(
            this.indicatorLineData(rsi(bars, s.period ?? 14, source), bars),
          );
          break;
        case 'atr':
          this.ensurePaneLine(s.id, s, 1).setData(
            this.indicatorLineData(atr(bars, s.period ?? 14), bars),
          );
          break;
        case 'macd': {
          const r = macd(bars, s.fast ?? 12, s.slow ?? 26, s.signal ?? 9, source);
          this.ensurePaneLine(`${s.id}:macd`, s, 1).setData(this.indicatorLineData(r.macd, bars));
          this.ensurePaneLine(`${s.id}:signal`, s, 1).setData(
            this.indicatorLineData(r.signal, bars),
          );
          this.ensurePaneHistogram(`${s.id}:hist`, s, 1).setData(
            this.indicatorLineData(r.histogram, bars),
          );
          break;
        }
        case 'stochastic': {
          const r = stochastic(bars, s.period ?? 14, s.signal ?? 3, s.fast ?? 3);
          this.ensurePaneLine(`${s.id}:k`, s, 1).setData(this.indicatorLineData(r.k, bars));
          this.ensurePaneLine(`${s.id}:d`, s, 1).setData(this.indicatorLineData(r.d, bars));
          break;
        }
        case 'adx': {
          const r = adx(bars, s.period ?? 14);
          this.ensurePaneLine(`${s.id}:adx`, s, 1).setData(this.indicatorLineData(r.adx, bars));
          this.ensurePaneLine(`${s.id}:pdi`, s, 1).setData(this.indicatorLineData(r.plusDi, bars));
          this.ensurePaneLine(`${s.id}:mdi`, s, 1).setData(this.indicatorLineData(r.minusDi, bars));
          break;
        }
        case 'cci':
          this.ensurePaneLine(s.id, s, 1).setData(
            this.indicatorLineData(cci(bars, s.period ?? 20, source), bars),
          );
          break;
        case 'obv':
          this.ensurePaneLine(s.id, s, 1).setData(this.indicatorLineData(obv(bars), bars));
          break;
        case 'cmf':
          this.ensurePaneLine(s.id, s, 1).setData(
            this.indicatorLineData(cmf(bars, s.period ?? 20), bars),
          );
          break;
        case 'williams':
          this.ensurePaneLine(s.id, s, 1).setData(
            this.indicatorLineData(williamsR(bars, s.period ?? 14), bars),
          );
          break;
        case 'ao':
          this.ensurePaneHistogram(`${s.id}`, s, 1).setData(
            this.indicatorLineData(awesomeOscillator(bars, s.fast ?? 5, s.slow ?? 34), bars),
          );
          break;
        case 'momentum':
          this.ensurePaneLine(s.id, s, 1).setData(
            this.indicatorLineData(momentum(bars, s.period ?? 10, source), bars),
          );
          break;
        case 'roc':
          this.ensurePaneLine(s.id, s, 1).setData(
            this.indicatorLineData(roc(bars, s.period ?? 10, source), bars),
          );
          break;
        case 'aroon': {
          const r = aroon(bars, s.period ?? 25);
          this.ensurePaneLine(`${s.id}:up`, s, 1).setData(this.indicatorLineData(r.up, bars));
          this.ensurePaneLine(`${s.id}:down`, s, 1).setData(this.indicatorLineData(r.down, bars));
          break;
        }
        case 'bop':
          this.ensurePaneLine(s.id, s, 1).setData(
            this.indicatorLineData(balanceOfPower(bars, s.period ?? 14), bars),
          );
          break;
        case 'kdj': {
          const r = kdj(bars, s.period ?? 9);
          this.ensurePaneLine(`${s.id}:k`, s, 1).setData(this.indicatorLineData(r.k, bars));
          this.ensurePaneLine(`${s.id}:d`, s, 1).setData(this.indicatorLineData(r.d, bars));
          this.ensurePaneLine(`${s.id}:j`, s, 1).setData(this.indicatorLineData(r.j, bars));
          break;
        }
        case 'elder': {
          const r = elderRay(bars, s.period ?? 13, source);
          this.ensurePaneLine(`${s.id}:bull`, s, 1).setData(this.indicatorLineData(r.bull, bars));
          this.ensurePaneLine(`${s.id}:bear`, s, 1).setData(this.indicatorLineData(r.bear, bars));
          break;
        }
        default: {
          const leftover: never = s.kind;
          void leftover;
          break;
        }
      }
    }
  }

  private ensureOverlayLine(
    key: string,
    setting: IndicatorSetting,
    lineStyle?: LineStyle,
  ): ISeriesApi<'Line'> {
    let s = this.overlaySeries.get(key);
    const opts = this.indicatorSeriesOptions(setting, lineStyle);
    if (!s) {
      s = this.chart.addSeries(LineSeries, opts);
      this.overlaySeries.set(key, s);
    } else {
      s.applyOptions(opts);
    }
    return s;
  }

  private paintBands(
    setting: IndicatorSetting,
    r: {
      upper: readonly (number | null)[];
      middle: readonly (number | null)[];
      lower: readonly (number | null)[];
    },
    bars: readonly Bar[],
  ): void {
    this.ensureOverlayLine(`${setting.id}:u`, setting).setData(
      this.indicatorLineData(r.upper, bars),
    );
    this.ensureOverlayLine(`${setting.id}:m`, setting).setData(
      this.indicatorLineData(r.middle, bars),
    );
    this.ensureOverlayLine(`${setting.id}:l`, setting).setData(
      this.indicatorLineData(r.lower, bars),
    );
  }

  private ensurePaneLine(key: string, setting: IndicatorSetting, pane: number): ISeriesApi<'Line'> {
    let s = this.paneIndicatorSeries.get(key);
    if (!s) {
      s = this.chart.addSeries(LineSeries, this.indicatorSeriesOptions(setting), pane);
      this.paneIndicatorSeries.set(key, s);
    } else {
      s.applyOptions(this.indicatorSeriesOptions(setting));
    }
    return s as ISeriesApi<'Line'>;
  }

  private ensurePaneHistogram(
    key: string,
    setting: IndicatorSetting,
    pane: number,
  ): ISeriesApi<'Histogram'> {
    const opts = {
      color: setting.color ?? '#888888',
      priceScaleId: 'hist',
      priceFormat: { type: 'price' as const, precision: 4, minMove: 0.0001 },
      lastValueVisible: false,
      priceLineVisible: false,
    };
    let s = this.paneIndicatorSeries.get(key);
    if (!s) {
      s = this.chart.addSeries(HistogramSeries, opts, pane);
      this.chart.priceScale('hist', pane).applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
      this.paneIndicatorSeries.set(key, s);
    } else {
      s.applyOptions({ color: opts.color });
    }
    return s as ISeriesApi<'Histogram'>;
  }

  /** Focus already-loaded history. Times use the same snapped buckets as fill markers. */
  focusInterval(start: number, end: number): boolean {
    const range = tradeWindow(
      this.candles.data().map((bar) => Number(bar.time)),
      Number(this.ts(start)),
      Number(this.ts(end)),
    );
    if (!range) return false;
    this.chart.timeScale().setVisibleLogicalRange(range);
    return true;
  }

  scrollToEnd(): void {
    this.chart.timeScale().scrollToRealTime();
  }

  private paintLatestBtn(): void {
    const range = this.chart.timeScale().getVisibleLogicalRange();
    const last = this.candles.data().length - 1;
    const off = !!range && last >= 0 && range.to < last;
    this.latestBtn.hidden = !off;
    if (!off) return;
    this.latestBtn.style.right = `${this.chart.priceScale('right').width() + 12}px`;
    this.latestBtn.style.bottom = `${this.chart.timeScale().height() + 12}px`;
  }

  fit(): void {
    this.chart.timeScale().fitContent();
  }

  showRecent(bars: number): void {
    const n = this.candles.data().length;
    if (n === 0) return;
    // Local: leave room for the HTF candles right of the last bar.
    const to = this.htfList.length ? n - 1 + this.rightOffsetBars : n + 5;
    this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - bars), to });
  }

  destroy(): void {
    this.clearBarContextHold();
    window.removeEventListener('keydown', this.onShiftKey);
    window.removeEventListener('keyup', this.onShiftKey);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.overlay.remove();
    this.chart.remove();
  }
}
