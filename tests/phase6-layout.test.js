'use strict';
/**
 * tests/phase6-layout.test.js — Build/Use flow pure logic checks
 */

async function run() {
  const manifest = require('../plugins/okx/manifest.json');
  const { normalizeCatalog } = await import('../public/core/catalog.js');
  const { getRecommendedComponents, groupBuilderSections, getSuggestedTabs } = await import('../public/core/suggestions.js');
  const { migrateState } = await import('../public/core/layout.js');

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

  // 6.4 builder grouping separates active / available / removed
  {
    const grouped = groupBuilderSections(catalog, ['ticker', 'chart'], ['balance']);
    const ok = grouped.active.some(x => x.id === 'ticker')
      && grouped.active.some(x => x.id === 'chart')
      && grouped.removed.some(x => x.id === 'balance')
      && !grouped.available.some(x => x.id === 'balance')
      && !grouped.available.some(x => x.id === 'ticker');
    console.log(ok ? '[6.4] PASS — builder sections group active, available, and removed correctly' : '[6.4] FAIL — invalid builder grouping');
  }

  // 6.5 old layout state migrates into one default tab
  {
    const migrated = migrateState({ active: [{ id: 'ticker', position: 'auto' }], removed: ['balance'] });
    const ok = migrated.version === 2
      && migrated.activeTabId === 'tab-1'
      && migrated.tabs.length === 1
      && migrated.tabs[0].layout.active[0].id === 'ticker'
      && migrated.tabs[0].layout.removed.includes('balance');
    console.log(ok ? '[6.5] PASS — old single-layout state migrates to tabbed state' : '[6.5] FAIL — old state migration incorrect');
  }

  // 6.6 suggested tabs skip ones that already exist
  {
    const suggested = getSuggestedTabs([{ title: 'Watch' }]).map(tab => tab.title);
    const ok = !suggested.includes('Watch') && suggested.includes('Trade') && suggested.includes('Review');
    console.log(ok ? '[6.6] PASS — suggested tabs skip existing titles' : '[6.6] FAIL — suggested tabs did not filter existing tabs correctly');
  }
}

run().catch(e => { console.error('Test error:', e); process.exit(1); });
