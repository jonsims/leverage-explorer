const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3007';
const PIN = '1234';

// Helper: admin API call
async function adminFetch(path, opts = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { 'x-admin-pin': PIN, 'Content-Type': 'application/json', ...opts.headers },
  });
  return res.json();
}

// Helper: reset session before each test
test.beforeEach(async () => {
  await adminFetch('/api/admin/reset', { method: 'POST', body: JSON.stringify({ confirm: true }) });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. PAGE LOADING
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Page loading', () => {
  test('student page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Leverage Point Explorer');
    await expect(page.locator('#waitingScreen')).toBeVisible();
  });

  test('admin page loads with PIN gate', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('#pinGate')).toBeVisible();
    await expect(page.locator('#adminPanel')).toBeHidden();
  });

  test('display page loads', async ({ page }) => {
    await page.goto('/display');
    await expect(page.locator('h1')).toHaveText('Leverage Point Explorer');
    await expect(page.locator('#waitingDisplay')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. ADMIN AUTH
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Admin authentication', () => {
  test('correct PIN grants access', async ({ page }) => {
    await page.goto('/admin');
    await page.fill('#pinInput', PIN);
    await page.click('#pinGate button');
    await expect(page.locator('#adminPanel')).toBeVisible();
    await expect(page.locator('#pinGate')).toBeHidden();
  });

  test('wrong PIN shows error', async ({ page }) => {
    await page.goto('/admin');
    await page.fill('#pinInput', '0000');
    await page.click('#pinGate button');
    await expect(page.locator('#pinError')).toBeVisible();
    await expect(page.locator('#adminPanel')).toBeHidden();
  });

  test('admin login does NOT reset phase', async () => {
    // Set phase to classify-food first
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'classify-food' }) });
    // Verify PIN (simulates admin page refresh)
    const result = await adminFetch('/api/admin/verify');
    expect(result.phase).toBe('classify-food');
    // Phase should still be classify-food
    const state = await (await fetch(`${BASE}/api/state`)).json();
    expect(state.phase).toBe('classify-food');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. PHASE CONTROL
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Phase control', () => {
  test('admin can cycle through all phases', async () => {
    const phases = ['waiting', 'classify-food', 'classify-data', 'chains', 'discuss'];
    for (const phase of phases) {
      const result = await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase }) });
      expect(result.ok).toBe(true);
      const state = await (await fetch(`${BASE}/api/state`)).json();
      expect(state.phase).toBe(phase);
    }
  });

  test('invalid phase is rejected', async () => {
    const result = await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'invalid' }) });
    expect(result.error).toBeTruthy();
  });

  test('student sees correct screen for each phase', async ({ page }) => {
    await page.goto('/');
    // Wait for initial polling
    await page.waitForTimeout(500);

    // Waiting phase
    await expect(page.locator('#waitingScreen')).toBeVisible();

    // Switch to classify-food
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'classify-food' }) });
    await page.waitForTimeout(2500); // Wait for poll cycle
    await expect(page.locator('#classifyFoodScreen')).toBeVisible();
    await expect(page.locator('#waitingScreen')).toBeHidden();

    // Switch to classify-data
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'classify-data' }) });
    await page.waitForTimeout(2500);
    await expect(page.locator('#classifyDataScreen')).toBeVisible();
    await expect(page.locator('#classifyFoodScreen')).toBeHidden();

    // Switch to chains
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'chains' }) });
    await page.waitForTimeout(2500);
    await expect(page.locator('#chainsScreen')).toBeVisible();

    // Switch to discuss
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'discuss' }) });
    await page.waitForTimeout(2500);
    await expect(page.locator('#discussScreen')).toBeVisible();
  });

  test('display shows correct screen for each phase', async ({ page }) => {
    await page.goto('/display');
    await page.waitForTimeout(500);
    await expect(page.locator('#waitingDisplay')).toBeVisible();

    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'classify-food' }) });
    await page.waitForTimeout(2500);
    await expect(page.locator('#classifyFoodDisplay')).toBeVisible();

    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'classify-data' }) });
    await page.waitForTimeout(2500);
    await expect(page.locator('#classifyDataDisplay')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. CLASSIFICATION (Food & Data)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Classification', () => {
  test('student can classify food interventions', async ({ page }) => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'classify-food' }) });
    await page.goto('/');
    await page.waitForTimeout(2500);

    // Should see 6 food cards
    const cards = page.locator('#foodCards .card');
    await expect(cards).toHaveCount(6);

    // Classify first intervention as Parameters
    const firstCard = cards.first();
    await firstCard.locator('.realm-btn[data-realm="Parameters"]').click();
    await expect(firstCard.locator('.realm-btn[data-realm="Parameters"]')).toHaveClass(/selected/);
    await expect(firstCard).toHaveClass(/classified/);

    // Progress should update
    await expect(page.locator('#foodProgressText')).toHaveText('1 of 6 classified');
  });

  test('student can classify data interventions', async ({ page }) => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'classify-data' }) });
    await page.goto('/');
    await page.waitForTimeout(2500);

    const cards = page.locator('#dataCards .card');
    await expect(cards).toHaveCount(6);

    await cards.first().locator('.realm-btn[data-realm="Design"]').click();
    await expect(page.locator('#dataProgressText')).toHaveText('1 of 6 classified');
  });

  test('classification persists after page reload', async ({ page }) => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'classify-food' }) });
    await page.goto('/');
    await page.waitForTimeout(2500);

    // Classify first card
    const firstCard = page.locator('#foodCards .card').first();
    await firstCard.locator('.realm-btn[data-realm="Intent"]').click();
    await expect(firstCard).toHaveClass(/classified/);

    // Reload
    await page.reload();
    await page.waitForTimeout(2500);

    // Should still be classified
    const restoredCard = page.locator('#foodCards .card').first();
    await expect(restoredCard).toHaveClass(/classified/);
    await expect(restoredCard.locator('.realm-btn[data-realm="Intent"]')).toHaveClass(/selected/);
  });

  test('classification shows on display as bars', async ({ page, context }) => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'classify-food' }) });

    // Submit some classifications via API
    for (let i = 0; i < 5; i++) {
      await fetch(`${BASE}/api/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: `test_${i}`, interventionId: 1, realm: 'Parameters' }),
      });
    }
    for (let i = 5; i < 8; i++) {
      await fetch(`${BASE}/api/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: `test_${i}`, interventionId: 1, realm: 'Design' }),
      });
    }

    // Check display
    await page.goto('/display');
    await page.waitForTimeout(2500);
    const bars = page.locator('#bars-1 .bar-segment');
    const barCount = await bars.count();
    expect(barCount).toBeGreaterThan(0);
  });

  test('changing classification updates the selection', async ({ page }) => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'classify-food' }) });
    await page.goto('/');
    await page.waitForTimeout(2500);

    const firstCard = page.locator('#foodCards .card').first();
    // Select Parameters first
    await firstCard.locator('.realm-btn[data-realm="Parameters"]').click();
    await expect(firstCard.locator('.realm-btn[data-realm="Parameters"]')).toHaveClass(/selected/);

    // Change to Design
    await firstCard.locator('.realm-btn[data-realm="Design"]').click();
    await expect(firstCard.locator('.realm-btn[data-realm="Design"]')).toHaveClass(/selected/);
    await expect(firstCard.locator('.realm-btn[data-realm="Parameters"]')).not.toHaveClass(/selected/);
  });

  test('completing all 6 shows done message', async ({ page }) => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'classify-food' }) });
    await page.goto('/');
    await page.waitForTimeout(2500);

    const cards = page.locator('#foodCards .card');
    for (let i = 0; i < 6; i++) {
      await cards.nth(i).locator('.realm-btn[data-realm="Parameters"]').click();
    }
    await expect(page.locator('#foodDoneMsg')).toBeVisible();
    await expect(page.locator('#foodProgressText')).toHaveText('6 of 6 classified');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. CHAIN RANKING
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Chain ranking', () => {
  test('student sees chain when admin selects one', async ({ page }) => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'chains' }) });
    await adminFetch('/api/admin/active-chain', { method: 'POST', body: JSON.stringify({ chainId: 'kennedy' }) });
    await page.goto('/');
    await page.waitForTimeout(2500);

    await expect(page.locator('#chainsScreen')).toBeVisible();
    await expect(page.locator('#chainViewer h2')).toHaveText('Kennedy Moon Landing');
    // Should see 4 steps
    await expect(page.locator('#chainViewer .step')).toHaveCount(4);
  });

  test('student can rank steps by tapping in order', async ({ page }) => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'chains' }) });
    await adminFetch('/api/admin/active-chain', { method: 'POST', body: JSON.stringify({ chainId: 'kennedy' }) });
    await page.goto('/');
    await page.waitForTimeout(2500);

    const steps = page.locator('#chainViewer .step');

    // Tap step 3 first (highest leverage)
    await steps.nth(2).click();
    await expect(steps.nth(2)).toHaveClass(/ranked/);
    await expect(steps.nth(2).locator('.rank-number')).toHaveText('1');

    // Tap step 1 second
    await steps.nth(0).click();
    await expect(steps.nth(0).locator('.rank-number')).toHaveText('2');

    // Tap step 2 third
    await steps.nth(1).click();
    await expect(steps.nth(1).locator('.rank-number')).toHaveText('3');

    // Tap step 4 last — should complete
    await steps.nth(3).click();
    await expect(steps.nth(3).locator('.rank-number')).toHaveText('4');

    // Prompt should show done
    await expect(page.locator('.rank-prompt')).toHaveClass(/done/);
  });

  test('already-ranked step cannot be tapped again', async ({ page }) => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'chains' }) });
    await adminFetch('/api/admin/active-chain', { method: 'POST', body: JSON.stringify({ chainId: 'kennedy' }) });
    await page.goto('/');
    await page.waitForTimeout(2500);

    const steps = page.locator('#chainViewer .step');

    // Tap step 1
    await steps.nth(0).click();
    await expect(steps.nth(0).locator('.rank-number')).toHaveText('1');

    // Tap step 1 again — should still be rank 1, not create rank 2
    await steps.nth(0).click();
    await expect(steps.nth(0).locator('.rank-number')).toHaveText('1');

    // Only 1 step should be ranked
    const rankedSteps = page.locator('#chainViewer .step.ranked');
    await expect(rankedSteps).toHaveCount(1);
  });

  test('Start Over clears ranking', async ({ page }) => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'chains' }) });
    await adminFetch('/api/admin/active-chain', { method: 'POST', body: JSON.stringify({ chainId: 'kennedy' }) });
    await page.goto('/');
    await page.waitForTimeout(2500);

    const steps = page.locator('#chainViewer .step');
    await steps.nth(0).click();
    await steps.nth(1).click();
    await expect(page.locator('#chainViewer .step.ranked')).toHaveCount(2);

    // Click Start Over
    await page.click('.reset-btn');
    await expect(page.locator('#chainViewer .step.ranked')).toHaveCount(0);
  });

  test('ranking persists after page reload', async ({ page }) => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'chains' }) });
    await adminFetch('/api/admin/active-chain', { method: 'POST', body: JSON.stringify({ chainId: 'strawberry' }) });
    await page.goto('/');
    await page.waitForTimeout(2500);

    const steps = page.locator('#chainViewer .step');
    // Rank all 4 steps
    await steps.nth(3).click();
    await steps.nth(2).click();
    await steps.nth(1).click();
    await steps.nth(0).click();

    // Reload
    await page.reload();
    await page.waitForTimeout(2500);

    // Rankings should be restored
    await expect(page.locator('#chainViewer .step.ranked')).toHaveCount(4);
    await expect(page.locator('#chainViewer .step').nth(3).locator('.rank-number')).toHaveText('1');
  });

  test('rank API validates correctly', async () => {
    // Valid ranking
    let res = await fetch(`${BASE}/api/chain-rank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: 'v1', chainId: 'kennedy', ranking: [3, 1, 0, 2] }),
    });
    expect((await res.json()).ok).toBe(true);

    // Missing step
    res = await fetch(`${BASE}/api/chain-rank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: 'v2', chainId: 'kennedy', ranking: [0, 1, 2] }),
    });
    expect(res.status).toBe(400);

    // Duplicate step
    res = await fetch(`${BASE}/api/chain-rank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: 'v3', chainId: 'kennedy', ranking: [0, 0, 1, 2] }),
    });
    expect(res.status).toBe(400);

    // Invalid chain
    res = await fetch(`${BASE}/api/chain-rank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: 'v4', chainId: 'nonexistent', ranking: [0, 1] }),
    });
    expect(res.status).toBe(400);
  });

  test('rankings hidden until reveal, then show on display', async ({ page }) => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'chains' }) });
    await adminFetch('/api/admin/active-chain', { method: 'POST', body: JSON.stringify({ chainId: 'kennedy' }) });

    // Submit rankings from 10 students
    for (let i = 0; i < 10; i++) {
      await fetch(`${BASE}/api/chain-rank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: `rank_test_${i}`, chainId: 'kennedy', ranking: [0, 1, 2, 3] }),
      });
    }

    await page.goto('/display');
    await page.waitForTimeout(2500);

    // Before reveal: no rank bars, no realm badges, but shows count
    await expect(page.locator('.rank-bar')).toHaveCount(0);
    await expect(page.locator('.realm-badge')).toHaveCount(0);
    await expect(page.locator('.vote-header')).toContainText('10 rankings submitted');

    // Reveal
    await adminFetch('/api/admin/reveal-chain', { method: 'POST' });
    await page.waitForTimeout(2500);

    // After reveal: rank bars and realm badges visible
    await expect(page.locator('.rank-bar')).toHaveCount(4);
    await expect(page.locator('.realm-badge')).toHaveCount(4);
    await expect(page.locator('.vote-header')).toContainText('10 responses');
  });

  test('3-step chain (ozone) works correctly', async ({ page }) => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'chains' }) });
    await adminFetch('/api/admin/active-chain', { method: 'POST', body: JSON.stringify({ chainId: 'ozone' }) });
    await page.goto('/');
    await page.waitForTimeout(2500);

    // Should see 3 steps, not 4
    await expect(page.locator('#chainViewer .step')).toHaveCount(3);

    // Rank all 3
    const steps = page.locator('#chainViewer .step');
    await steps.nth(1).click();
    await steps.nth(0).click();
    await steps.nth(2).click();

    await expect(page.locator('.rank-prompt')).toHaveClass(/done/);
    await expect(page.locator('#chainViewer .step.ranked')).toHaveCount(3);
  });

  test('switching chains shows new chain on student', async ({ page }) => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'chains' }) });
    await adminFetch('/api/admin/active-chain', { method: 'POST', body: JSON.stringify({ chainId: 'kennedy' }) });
    await page.goto('/');
    await page.waitForTimeout(2500);
    await expect(page.locator('#chainViewer h2')).toHaveText('Kennedy Moon Landing');

    // Switch to strawberry
    await adminFetch('/api/admin/active-chain', { method: 'POST', body: JSON.stringify({ chainId: 'strawberry' }) });
    await page.waitForTimeout(2500);
    await expect(page.locator('#chainViewer h2')).toHaveText('Strawberry Cold Chain');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. DUMMY DATA & RESET
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Dummy data and reset', () => {
  test('load dummy data creates 44 voters and rankings', async () => {
    const result = await adminFetch('/api/admin/load-dummy', { method: 'POST' });
    expect(result.voters).toBe(44);
    expect(result.submissions).toBe(12);

    const state = await (await fetch(`${BASE}/api/state`)).json();
    expect(state.voterCount).toBe(44);
  });

  test('reset clears all data', async () => {
    // Load dummy data first
    await adminFetch('/api/admin/load-dummy', { method: 'POST' });
    let state = await (await fetch(`${BASE}/api/state`)).json();
    expect(state.voterCount).toBe(44);

    // Reset
    await adminFetch('/api/admin/reset', { method: 'POST', body: JSON.stringify({ confirm: true }) });
    state = await (await fetch(`${BASE}/api/state`)).json();
    expect(state.voterCount).toBe(0);
    expect(state.phase).toBe('waiting');
    expect(state.activeChain).toBeNull();
    expect(state.chainSubmissions).toHaveLength(0);
    expect(state.chainRankCount).toBe(0);
  });

  test('reset without confirm is rejected', async () => {
    const result = await adminFetch('/api/admin/reset', { method: 'POST', body: JSON.stringify({}) });
    expect(result.error).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. QR CODE
// ═══════════════════════════════════════════════════════════════════════════

test.describe('QR code', () => {
  test('QR endpoint generates SVG', async () => {
    const res = await fetch(`${BASE}/api/admin/qr?url=https://example.com`, {
      headers: { 'x-admin-pin': PIN },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<svg');
  });

  test('QR shows on display during waiting phase', async ({ page }) => {
    // Generate QR
    await fetch(`${BASE}/api/admin/qr?url=https://example.com`, {
      headers: { 'x-admin-pin': PIN },
    });

    await page.goto('/display');
    await page.waitForTimeout(2500);
    const qrBox = page.locator('#displayQR');
    const svgContent = await qrBox.innerHTML();
    expect(svgContent).toContain('svg');
  });

  test('QR not sent in non-waiting phases', async () => {
    await fetch(`${BASE}/api/admin/qr?url=https://example.com`, {
      headers: { 'x-admin-pin': PIN },
    });
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'classify-food' }) });
    const state = await (await fetch(`${BASE}/api/state`)).json();
    expect(state.qrSvg).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. CONCURRENT STUDENTS SIMULATION
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Concurrent load', () => {
  test('45 simultaneous classifications do not drop data', async () => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'classify-food' }) });

    // 45 students each classify intervention 1
    const promises = [];
    for (let i = 0; i < 45; i++) {
      promises.push(
        fetch(`${BASE}/api/classify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitorId: `student_${i}`, interventionId: 1, realm: 'Parameters' }),
        })
      );
    }
    const results = await Promise.all(promises);
    expect(results.every(r => r.ok)).toBe(true);

    const state = await (await fetch(`${BASE}/api/state`)).json();
    expect(state.voterCount).toBe(45);
    expect(state.classificationTotals[1].Parameters).toBe(45);
  });

  test('45 simultaneous rankings do not drop data', async () => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'chains' }) });
    await adminFetch('/api/admin/active-chain', { method: 'POST', body: JSON.stringify({ chainId: 'kennedy' }) });

    const promises = [];
    for (let i = 0; i < 45; i++) {
      promises.push(
        fetch(`${BASE}/api/chain-rank`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitorId: `ranker_${i}`, chainId: 'kennedy', ranking: [0, 1, 2, 3] }),
        })
      );
    }
    const results = await Promise.all(promises);
    expect(results.every(r => r.ok)).toBe(true);

    const state = await (await fetch(`${BASE}/api/state`)).json();
    expect(state.chainRankCount).toBe(45);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Edge cases', () => {
  test('classify with invalid realm is rejected', async () => {
    const res = await fetch(`${BASE}/api/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: 'v1', interventionId: 1, realm: 'NotAReal' }),
    });
    expect(res.status).toBe(400);
  });

  test('classify without visitorId is rejected', async () => {
    const res = await fetch(`${BASE}/api/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interventionId: 1, realm: 'Parameters' }),
    });
    expect(res.status).toBe(400);
  });

  test('admin endpoints require PIN', async () => {
    const endpoints = [
      ['/api/admin/verify', 'GET'],
      ['/api/admin/phase', 'POST'],
      ['/api/admin/reset', 'POST'],
    ];
    for (const [path, method] of endpoints) {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? '{}' : undefined,
      });
      expect(res.status).toBe(401);
    }
  });

  test('student visitorId persists across reloads', async ({ page }) => {
    await page.goto('/');
    const id1 = await page.evaluate(() => localStorage.getItem('lpe_visitor_id'));
    expect(id1).toBeTruthy();

    await page.reload();
    const id2 = await page.evaluate(() => localStorage.getItem('lpe_visitor_id'));
    expect(id2).toBe(id1);
  });

  test('no chain selected shows waiting message', async ({ page }) => {
    await adminFetch('/api/admin/phase', { method: 'POST', body: JSON.stringify({ phase: 'chains' }) });
    // Don't select a chain
    await page.goto('/');
    await page.waitForTimeout(2500);
    await expect(page.locator('.no-chain-msg')).toBeVisible();
  });
});
