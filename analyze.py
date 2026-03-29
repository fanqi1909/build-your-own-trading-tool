#!/usr/bin/env python3
"""
OKX Technical Analysis Script - Receives candles JSON via pipe, outputs trade signal summary

Usage:
  okx market candles BTC-USDT --bar 1H --limit 200 --json | python3 analyze.py
  okx market candles BTC-USDT --bar 1H --limit 200 --json | python3 analyze.py --inst BTC-USDT
"""

import json
import sys
import math
import argparse
from datetime import datetime


# -- Indicator Calculations ---------------------------------------------------

def ema(values: list[float], period: int) -> list[float]:
    k = 2 / (period + 1)
    result = [None] * len(values)
    result[period - 1] = sum(values[:period]) / period
    for i in range(period, len(values)):
        result[i] = values[i] * k + result[i - 1] * (1 - k)
    return result


def sma(values: list[float], period: int) -> list[float | None]:
    result = [None] * len(values)
    for i in range(period - 1, len(values)):
        result[i] = sum(values[i - period + 1:i + 1]) / period
    return result


def calculate_rsi(closes: list[float], period: int = 14) -> float | None:
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def calculate_macd(closes: list[float], fast=12, slow=26, signal=9):
    if len(closes) < slow + signal:
        return None, None, None
    ema_fast = ema(closes, fast)
    ema_slow = ema(closes, slow)
    macd_line = [
        (ema_fast[i] - ema_slow[i]) if ema_fast[i] is not None and ema_slow[i] is not None else None
        for i in range(len(closes))
    ]
    valid_macd = [v for v in macd_line if v is not None]
    if len(valid_macd) < signal:
        return None, None, None
    signal_start = next(i for i, v in enumerate(macd_line) if v is not None)
    signal_line_vals = ema(valid_macd, signal)
    signal_line = [None] * signal_start + [None] * (signal - 1) + signal_line_vals[signal - 1:]
    signal_line = signal_line[:len(closes)]
    last_macd = next((v for v in reversed(macd_line) if v is not None), None)
    last_signal = next((v for v in reversed(signal_line) if v is not None), None)
    last_hist = (last_macd - last_signal) if last_macd is not None and last_signal is not None else None
    return last_macd, last_signal, last_hist


def calculate_ma(closes: list[float], period: int) -> float | None:
    vals = sma(closes, period)
    return next((v for v in reversed(vals) if v is not None), None)


def calculate_bb(closes: list[float], period: int = 20, mult: float = 2.0):
    if len(closes) < period:
        return None, None, None
    window = closes[-period:]
    mid = sum(window) / period
    variance = sum((x - mid) ** 2 for x in window) / period
    std = math.sqrt(variance)
    return mid + mult * std, mid, mid - mult * std


def calculate_atr(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> float | None:
    """Average True Range (ATR)"""
    if len(closes) < period + 1:
        return None
    trs = []
    for i in range(1, len(closes)):
        hl = highs[i] - lows[i]
        hc = abs(highs[i] - closes[i - 1])
        lc = abs(lows[i] - closes[i - 1])
        trs.append(max(hl, hc, lc))
    # Wilder smoothing (same as RSI)
    atr = sum(trs[:period]) / period
    for i in range(period, len(trs)):
        atr = (atr * (period - 1) + trs[i]) / period
    return atr


def calculate_stoch_rsi(closes: list[float], rsi_period: int = 14, stoch_period: int = 14, smooth_k: int = 3, smooth_d: int = 3) -> tuple[float, float] | None:
    """
    Stochastic RSI, returns (K, D), range 0~100
    K crosses above D (Golden Cross): bullish
    K crosses below D (Death Cross): bearish
    """
    if len(closes) < rsi_period + stoch_period + smooth_k + smooth_d:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
    avg_gain = sum(gains[:rsi_period]) / rsi_period
    avg_loss = sum(losses[:rsi_period]) / rsi_period
    rsi_vals = []
    for i in range(rsi_period, len(gains)):
        avg_gain = (avg_gain * (rsi_period - 1) + gains[i]) / rsi_period
        avg_loss = (avg_loss * (rsi_period - 1) + losses[i]) / rsi_period
        if avg_loss == 0:
            rsi_vals.append(100.0)
        else:
            rs = avg_gain / avg_loss
            rsi_vals.append(100 - (100 / (1 + rs)))
    if len(rsi_vals) < stoch_period:
        return None
    raw_k = []
    for i in range(stoch_period - 1, len(rsi_vals)):
        window = rsi_vals[i - stoch_period + 1:i + 1]
        lo, hi = min(window), max(window)
        raw_k.append((rsi_vals[i] - lo) / (hi - lo) * 100 if hi != lo else 50.0)
    if len(raw_k) < smooth_k:
        return None
    k_vals = [sum(raw_k[i - smooth_k + 1:i + 1]) / smooth_k for i in range(smooth_k - 1, len(raw_k))]
    if len(k_vals) < smooth_d:
        return None
    d_vals = [sum(k_vals[i - smooth_d + 1:i + 1]) / smooth_d for i in range(smooth_d - 1, len(k_vals))]
    # Detect Golden Cross / Death Cross
    prev_k = k_vals[-2] if len(k_vals) >= 2 else None
    prev_d = d_vals[-2] if len(d_vals) >= 2 else None
    return k_vals[-1], d_vals[-1], prev_k, prev_d


def calculate_adx(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> float | None:
    """
    ADX Trend Strength (0~100)
    < 20: Ranging  20~25: Emerging Trend  >25: Trend Confirmed  >50: Strong Trend
    """
    if len(closes) < period * 2 + 1:
        return None
    plus_dm, minus_dm, trs = [], [], []
    for i in range(1, len(closes)):
        up   = highs[i] - highs[i - 1]
        down = lows[i - 1] - lows[i]
        plus_dm.append(up if up > down and up > 0 else 0)
        minus_dm.append(down if down > up and down > 0 else 0)
        hl = highs[i] - lows[i]
        hc = abs(highs[i] - closes[i - 1])
        lc = abs(lows[i] - closes[i - 1])
        trs.append(max(hl, hc, lc))
    def wilder(vals, p):
        s = sum(vals[:p])
        result = [s]
        for v in vals[p:]:
            s = s - s / p + v
            result.append(s)
        return result
    tr_s  = wilder(trs, period)
    pdm_s = wilder(plus_dm, period)
    mdm_s = wilder(minus_dm, period)
    di_p = [100 * p / t if t else 0 for p, t in zip(pdm_s, tr_s)]
    di_m = [100 * m / t if t else 0 for m, t in zip(mdm_s, tr_s)]
    dx   = [abs(p - m) / (p + m) * 100 if (p + m) else 0 for p, m in zip(di_p, di_m)]
    if len(dx) < period:
        return None
    adx = sum(dx[:period]) / period
    for v in dx[period:]:
        adx = (adx * (period - 1) + v) / period
    return adx


def calculate_support_resistance(highs: list[float], lows: list[float], closes: list[float], pivot_strength: int = 3, max_levels: int = 3):
    """
    Swing pivot method to detect nearby support/resistance levels
    Only scans the most recent 100 candles; clusters merged within 0.3%
    Returns: (supports, resistances) sorted by distance from current price
    """
    price = closes[-1]
    n = len(highs)
    raw_res, raw_sup = [], []
    start = max(pivot_strength, n - 100)
    for i in range(start, n - pivot_strength):
        if all(highs[i] >= highs[i-j] for j in range(1, pivot_strength+1)) and \
           all(highs[i] >= highs[i+j] for j in range(1, pivot_strength+1)):
            raw_res.append(highs[i])
        if all(lows[i] <= lows[i-j] for j in range(1, pivot_strength+1)) and \
           all(lows[i] <= lows[i+j] for j in range(1, pivot_strength+1)):
            raw_sup.append(lows[i])

    def cluster(levels):
        if not levels:
            return []
        levels = sorted(set(levels))
        merged = [levels[0]]
        for v in levels[1:]:
            if abs(v - merged[-1]) / merged[-1] < 0.003:
                merged[-1] = (merged[-1] + v) / 2
            else:
                merged.append(v)
        return merged

    resistances = sorted([r for r in cluster(raw_res) if r > price])[:max_levels]
    supports    = sorted([s for s in cluster(raw_sup) if s < price], reverse=True)[:max_levels]
    return supports, resistances


def calculate_volume_signal(volumes: list[float], period: int = 20) -> tuple[float, float, float] | None:
    """
    Returns (current volume, avg volume, volume ratio)
    Volume ratio = current volume / 20-period avg volume
    """
    if len(volumes) < period + 1:
        return None
    avg_vol = sum(volumes[-period-1:-1]) / period   # Use prior period avg, excluding current
    cur_vol = volumes[-1]
    ratio = cur_vol / avg_vol if avg_vol > 0 else 1.0
    return cur_vol, avg_vol, ratio


# -- Signal Interpretation ----------------------------------------------------

def rsi_label(rsi: float) -> tuple[str, str]:
    if rsi >= 70:
        return "bear", f"RSI {rsi:.1f}, overbought zone, watch for pullback"
    elif rsi >= 60:
        return "bull", f"RSI {rsi:.1f}, leaning strong, still has upside"
    elif rsi >= 40:
        return "neutral", f"RSI {rsi:.1f}, neutral zone"
    elif rsi >= 30:
        return "bear", f"RSI {rsi:.1f}, leaning weak"
    else:
        return "bull", f"RSI {rsi:.1f}, oversold zone, watch for bounce"


def macd_label(hist: float, prev_hist: float | None) -> tuple[str, str]:
    cross = ""
    if prev_hist is not None:
        if prev_hist < 0 and hist > 0:
            cross = "Golden Cross"
        elif prev_hist > 0 and hist < 0:
            cross = "Death Cross"
    direction = "momentum increasing" if hist > 0 else "momentum decreasing"
    tag = "bull" if hist > 0 else "bear"
    label = f"Histogram {hist:+.2f}, {direction}"
    if cross:
        label += f", {cross}"
    return tag, label


def bb_label(price: float, upper: float, mid: float, lower: float) -> tuple[str, str]:
    band_width = upper - lower
    position = (price - lower) / band_width if band_width > 0 else 0.5
    pct = position * 100
    if price > upper:
        return "bear", f"Price above upper band (position {pct:.0f}%), overbought warning"
    elif price > mid:
        return "bull", f"Price above middle band (position {pct:.0f}%)"
    elif price > lower:
        return "bear", f"Price below middle band (position {pct:.0f}%)"
    else:
        return "bull", f"Price below lower band (position {pct:.0f}%), watch for bounce"


def ma_label(price: float, ma20, ma50, ma200) -> tuple[str, str]:
    above = sum(1 for ma in [ma20, ma50, ma200] if ma is not None and price > ma)
    total = sum(1 for ma in [ma20, ma50, ma200] if ma is not None)
    if above == total:
        return "bull", f"Price above all MA20/50/200, bullish alignment"
    elif above == 0:
        return "bear", f"Price below all MA20/50/200, bearish alignment"
    else:
        return "neutral", f"Price above {above}/{total} MAs, mixed trend"


def stoch_rsi_label(k: float, d: float, prev_k: float | None, prev_d: float | None) -> tuple[str, str]:
    """Stochastic RSI signal interpretation"""
    cross = ""
    if prev_k is not None and prev_d is not None:
        if prev_k <= prev_d and k > d:
            cross = " Golden Cross"
        elif prev_k >= prev_d and k < d:
            cross = " Death Cross"
    if k >= 80:
        zone = "Overbought"
        tag = "bear"
    elif k <= 20:
        zone = "Oversold"
        tag = "bull"
    elif k > d:
        zone = "K>D Bullish"
        tag = "bull"
    else:
        zone = "K<D Bearish"
        tag = "bear"
    return tag, f"K {k:.1f} / D {d:.1f}, {zone}{cross}"


def adx_label(adx: float) -> tuple[str, str]:
    """ADX trend strength interpretation"""
    if adx >= 50:
        return "neutral", f"ADX {adx:.1f}, Strong Trend, trade with the trend"
    elif adx >= 25:
        return "neutral", f"ADX {adx:.1f}, Trend Confirmed, high signal reliability"
    elif adx >= 20:
        return "neutral", f"ADX {adx:.1f}, Emerging Trend, await confirmation"
    else:
        return "neutral", f"ADX {adx:.1f}, Ranging, trend signals less reliable"


def volume_label(cur_vol: float, avg_vol: float, ratio: float, price_up: bool) -> tuple[str, str]:
    """Volume-price signal"""
    if ratio >= 2.0:
        vol_desc = f"High Volume {ratio:.1f}x"
    elif ratio >= 1.3:
        vol_desc = f"Moderate Volume {ratio:.1f}x"
    elif ratio <= 0.5:
        vol_desc = f"Very Low Volume {ratio:.1f}x"
    else:
        vol_desc = f"Low Volume {ratio:.1f}x"

    if ratio >= 1.3 and price_up:
        return "bull", f"{vol_desc}, price up + volume up, bulls in control"
    elif ratio >= 1.3 and not price_up:
        return "bear", f"{vol_desc}, price down + volume up, bears in control"
    elif ratio <= 0.7 and price_up:
        return "neutral", f"{vol_desc}, price up on low volume, weak momentum, caution"
    elif ratio <= 0.7 and not price_up:
        return "neutral", f"{vol_desc}, price down on low volume, selling pressure fading, may stabilize"
    else:
        return "neutral", f"{vol_desc}, volume steady, direction unclear"


# -- Main Flow ----------------------------------------------------------------

def print_for_claude(inst: str, bar: str, time_str: str, price: float, signals: list, atr: float | None,
                     supports: list | None = None, resistances: list | None = None):
    """Pure signal output for Claude to make logical judgments"""
    tag_map = {"bull": "Bullish", "bear": "Bearish", "neutral": "Neutral"}
    print(f"Instrument: {inst or 'N/A'} | Timeframe: {bar} | Time: {time_str}")
    print(f"Price: {price:,.2f} USDT")
    if atr:
        print(f"ATR(14): {atr:,.2f}  SL Reference: Long SL {price - 1.5*atr:,.2f}  Short SL {price + 1.5*atr:,.2f}")
    if resistances:
        print(f"Resistance: {' / '.join(f'${r:,.2f}' for r in resistances)}")
    if supports:
        print(f"Support: {' / '.join(f'${s:,.2f}' for s in supports)}")
    if supports and resistances:
        sl_long  = supports[0]  - (supports[0]  * 0.001)
        sl_short = resistances[0] + (resistances[0] * 0.001)
        print(f"Suggested SL Zone: Long SL ${sl_long:,.2f} (below support)  Short SL ${sl_short:,.2f} (above resistance)")
    elif supports:
        sl_long  = supports[0]  - (supports[0]  * 0.001)
        print(f"Suggested SL Zone: Long SL ${sl_long:,.2f} (below support)")
    elif resistances:
        sl_short = resistances[0] + (resistances[0] * 0.001)
        print(f"Suggested SL Zone: Short SL ${sl_short:,.2f} (above resistance)")
    print()
    labels = ["Trend ", "MACD  ", "RSI   ", "BB    ", "Volume", "StochRSI", "ADX   "]
    for (tag, msg), label in zip(signals, labels):
        print(f"[{label}]  {tag_map.get(tag, tag):<8}  {msg}")
    print()
    bull = sum(1 for t, _ in signals if t == "bull")
    bear = sum(1 for t, _ in signals if t == "bear")
    print(f"Bull Signals {bull} / Bear Signals {bear} / Total {len(signals)}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--inst", default="", help="Instrument ID, used for output title only")
    parser.add_argument("--bar", default="1H", help="Candle period, used for output title only")
    parser.add_argument("--for-claude", action="store_true", help="Output pure signal format for Claude")
    args = parser.parse_args()

    raw = sys.stdin.read().strip()
    candles = json.loads(raw)

    # newest-first -> oldest-first
    candles = list(reversed(candles))
    # Filter incomplete candles (confirm=0 means the current candle has not closed)
    candles = [c for c in candles if c[8] == "1"]

    closes  = [float(c[4]) for c in candles]
    highs   = [float(c[2]) for c in candles]
    lows    = [float(c[3]) for c in candles]
    volumes = [float(c[5]) for c in candles]

    last_ts = int(candles[-1][0])
    price = closes[-1]
    time_str = datetime.fromtimestamp(last_ts / 1000).strftime("%Y-%m-%d %H:%M")
    price_up = closes[-1] >= closes[-2] if len(closes) >= 2 else True

    # Calculate indicators
    rsi = calculate_rsi(closes)
    macd, sig, hist = calculate_macd(closes)
    prev_hist = None
    if len(closes) >= 27:
        _, _, prev_hist = calculate_macd(closes[:-1])
    ma20  = calculate_ma(closes, 20)
    ma50  = calculate_ma(closes, 50)
    ma200 = calculate_ma(closes, 200)
    bb_upper, bb_mid, bb_lower = calculate_bb(closes)
    atr = calculate_atr(highs, lows, closes)
    supports, resistances = calculate_support_resistance(highs, lows, closes)
    vol_result = calculate_volume_signal(volumes)
    stoch_result = calculate_stoch_rsi(closes)
    adx = calculate_adx(highs, lows, closes)

    title = f"{args.inst} " if args.inst else ""

    # -- Signal Summary -------------------------------------------------------
    signals = []
    if ma20 and ma50 and ma200:
        signals.append(ma_label(price, ma20, ma50, ma200))
    if hist is not None:
        signals.append(macd_label(hist, prev_hist))
    if rsi is not None:
        signals.append(rsi_label(rsi))
    if bb_upper is not None:
        signals.append(bb_label(price, bb_upper, bb_mid, bb_lower))
    if vol_result is not None:
        cur_vol, avg_vol, ratio = vol_result
        signals.append(volume_label(cur_vol, avg_vol, ratio, price_up))
    if stoch_result is not None:
        signals.append(stoch_rsi_label(*stoch_result))
    if adx is not None:
        signals.append(adx_label(adx))

    if args.for_claude:
        print_for_claude(args.inst, args.bar, time_str, price, signals, atr, supports, resistances)
        return

    # -- Human-readable output ------------------------------------------------
    print(f"\n{'='*54}")
    print(f"  {title}Technical Analysis  ({time_str})")
    print(f"{'='*54}")
    print(f"  Current Price: {price:,.2f}")
    print()

    print("-- MA -------------------------------------------------------")
    for label, val in [("MA20 ", ma20), ("MA50 ", ma50), ("MA200", ma200)]:
        if val:
            diff = price - val
            arrow = "▲" if diff > 0 else "▼"
            print(f"  {label}  {val:>12,.2f}   {arrow} {abs(diff):,.2f} ({diff/val*100:+.1f}%)")
    print()

    print("-- RSI (14) -------------------------------------------------")
    if rsi is not None:
        bar_len = int(rsi / 5)
        bar = "█" * bar_len + "░" * (20 - bar_len)
        print(f"  {bar}  {rsi:.1f}")
    print()

    print("-- MACD (12/26/9) -------------------------------------------")
    if macd is not None:
        print(f"  MACD    {macd:>10.3f}")
        print(f"  Signal  {sig:>10.3f}")
        print(f"  Hist    {hist:>+10.3f}  {'▲' if hist > 0 else '▼'}")
    print()

    print("-- Bollinger Bands (20, 2σ) ---------------------------------")
    if bb_upper is not None:
        band_pct = (price - bb_lower) / (bb_upper - bb_lower) * 100
        print(f"  Upper  {bb_upper:>12,.2f}")
        print(f"  Mid    {bb_mid:>12,.2f}   <- Current Position {band_pct:.0f}%")
        print(f"  Lower  {bb_lower:>12,.2f}")
    print()

    print("-- Volume ---------------------------------------------------")
    if vol_result is not None:
        cur_vol, avg_vol, ratio = vol_result
        bar_len = min(int(ratio * 10), 20)
        bar = "█" * bar_len + "░" * (20 - bar_len)
        print(f"  {bar}  {ratio:.2f}x")
        print(f"  Current   {cur_vol:>12,.2f}")
        print(f"  Average   {avg_vol:>12,.2f}  (MA20)")
    print()

    print("-- ATR Stop Loss Reference (14) -----------------------------")
    if atr is not None:
        sl_long  = price - 1.5 * atr
        sl_short = price + 1.5 * atr
        print(f"  ATR      {atr:>12,.2f}")
        print(f"  Long SL  ▼  {sl_long:>10,.2f}   (1.5x ATR)")
        print(f"  Short SL ▲  {sl_short:>10,.2f}   (1.5x ATR)")
    print()

    print("-- Support / Resistance -------------------------------------")
    res_str = "  /  ".join(f"${r:,.2f}" for r in resistances) if resistances else "Not detected"
    sup_str = "  /  ".join(f"${s:,.2f}" for s in supports)    if supports    else "Not detected"
    print(f"  Resistance ▲  {res_str}")
    print(f"  Current Price  ${price:,.2f}")
    print(f"  Support    ▼  {sup_str}")
    print()

    print("-- Stochastic RSI (14,14,3,3) -------------------------------")
    if stoch_result is not None:
        k, d, _, _ = stoch_result
        bar_len = min(int(k / 5), 20)
        bar = "█" * bar_len + "░" * (20 - bar_len)
        print(f"  K {bar}  {k:.1f}")
        print(f"  D {'░' * min(int(d/5),20)}{'░' * max(0, 20-min(int(d/5),20))}  {d:.1f}")
        if k >= 80:
            print(f"  Warning: Overbought zone (>80), watch for pullback")
        elif k <= 20:
            print(f"  Warning: Oversold zone (<20), watch for bounce")
    print()

    print("-- ADX Trend Strength (14) ----------------------------------")
    if adx is not None:
        bar_len = min(int(adx / 5), 20)
        bar = "█" * bar_len + "░" * (20 - bar_len)
        trend = "Strong Trend" if adx >= 50 else "Trend Confirmed" if adx >= 25 else "Emerging Trend" if adx >= 20 else "Ranging"
        print(f"  {bar}  {adx:.1f}  [{trend}]")
    print()

    tag_map = {"bull": "✅", "bear": "🔴", "neutral": "⚠️ "}
    print("-- Signal Summary -------------------------------------------")
    signal_labels = ["Trend  ", "MACD   ", "RSI    ", "BB     ", "Volume ", "StochRSI", "ADX    "]
    for (tag, msg), label in zip(signals, signal_labels):
        print(f"  {tag_map.get(tag, '  ')} {label} {msg}")

    bull = sum(1 for t, _ in signals if t == "bull")
    bear = sum(1 for t, _ in signals if t == "bear")
    print()
    print(f"  Bull Signals {bull} / Bear Signals {bear} / Total {len(signals)}")
    print(f"{'='*54}\n")


if __name__ == "__main__":
    main()
