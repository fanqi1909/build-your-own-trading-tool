'use strict';

class AdapterError extends Error {
  constructor(message, code = 'API_ERROR') {
    super(message);
    this.name = 'AdapterError';
    this.code = code; // 'API_ERROR' | 'PARSE_ERROR' | 'NETWORK_ERROR' | 'TIMEOUT'
  }
}

/**
 * @typedef {Object} Ticker
 * @property {string} instId
 * @property {string} last
 * @property {string} open24h
 * @property {string} high24h
 * @property {string} low24h
 * @property {string} vol24h
 */

/**
 * @typedef {Object} Balance
 * @property {string} ccy
 * @property {number} eq
 * @property {number} eqUsd
 * @property {number} availBal
 */

/**
 * @typedef {Object} Position
 * @property {string} instId
 * @property {string} pos
 * @property {number} avgPx
 * @property {number} markPx
 * @property {number} upl
 * @property {number} uplRatio
 * @property {string} lever
 * @property {string} mgnMode
 * @property {number} mgnRatio
 * @property {number} notionalUsd
 * @property {string} liqPx
 * @property {string} posSide
 */

/**
 * @typedef {Object} Candle
 * @property {number} ts
 * @property {number} o
 * @property {number} h
 * @property {number} l
 * @property {number} c
 * @property {number} vol
 */

/**
 * @typedef {Object} Order
 * @property {string} ordId
 * @property {string} instId
 * @property {string} side
 * @property {boolean} reduceOnly
 * @property {string} ordType
 * @property {number} sz
 * @property {number} avgPx
 * @property {number} fillSz
 * @property {number} pnl
 * @property {number} fee
 * @property {string} state
 * @property {string} lever
 * @property {number} cTime
 * @property {number} fillTime
 */

module.exports = { AdapterError };
