'use strict';

const { AdapterError } = require('./base');

function notImpl() {
  throw new AdapterError('REST adapter not implemented');
}

module.exports = {
  fetchTicker:      () => notImpl(),
  fetchBalance:     () => notImpl(),
  fetchPositions:   () => notImpl(),
  fetchCandles:     () => notImpl(),
  fetchHistory:     () => notImpl(),
  setLeverage:      () => notImpl(),
  placeMarketOrder: () => notImpl(),
  placeLimitOrder:  () => notImpl(),
  placeAlgoOrder:   () => notImpl(),
  closePosition:    () => notImpl(),
  fetchOpenOrders:  () => notImpl(),
  cancelOrder:      () => notImpl(),
  fetchAlgoOrders:  () => notImpl(),
  amendAlgoOrder:   () => notImpl(),
};
