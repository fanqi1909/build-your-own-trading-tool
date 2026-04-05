'use strict';
/**
 * tests/phase6-layout.test.js — Build/Use flow pure logic checks
 */

async function run() {
  const manifest = require('../plugins/okx/manifest.json');
  const { normalizeCatalog } = await import('../public/core/catalog.js');
  const { getRecommendedComponents, groupBuilderSections } = await import('../public/core/suggestions.js');

  const catalog = normalizeCatalog(manifest);

  // 6.1 catalog normalization shape
  {
    let ok = true;
    if (!catalog.length) ok = false;
    for (const item of catalog) {
      if (!item.id || !item.title || !item.category || typeof item.starterPriority !== 'number') ok = false;
    }
    console.log(ok ? `[6.1] PASS — normalized ${catalog.length} catalog items` : '[6.1] FAIL — invalid catalog shape');
  }

  // 6.2 default recommendations prioritize starter cards
  {
    const recs = getRecommendedComponents(catalog, [], []);
    const top3 = recs.slice(0, 3).map(r => r.id);
    const ok = top3.includes('ticker') && top3.includes('chart') && top3.includes('balance');
    console.log(ok ? `[6.2] PASS — starter recommendations include ticker/chart/balance` : `[6.2] FAIL — top recommendations were ${top3.join(', ')}`);
  }

  // 6.3 removed cards are suppressed from recommendations
  {
    const removed = getRecommendedComponents(catalog, [], ['ticker']).map(r => r.id);
    const ok = !removed.includes('ticker');
    console.log(ok ? '[6.3] PASS — recently removed cards are suppressed from recommendations' : '[6.3] FAIL — removed card still appeared in recommendations');
  }

  // 6.4 builder grouping separates active / available
  {
    const grouped = groupBuilderSections(catalog, ['ticker', 'chart'], ['balance']);
    const ok = grouped.active.some(x => x.id === 'ticker')
      && grouped.active.some(x => x.id === 'chart')
      && grouped.available.some(x => x.id === 'balance')
      && !grouped.available.some(x => x.id === 'ticker');
    console.log(ok ? '[6.4] PASS — builder sections group active and available correctly' : '[6.4] FAIL — invalid builder grouping');
  }
}

run().catch(e => { console.error('Test error:', e); process.exit(1); });
