import { expect, test } from 'bun:test'
import { createProductionBrowserNavigation } from './productionBrowserNavigation.ts'

test('a second navigation waits for a seeded bootstrap beyond the action timeout within the workflow budget', async () => {
	let elapsed = 0
	let navigated = false
	const readDocument = async () => ({ body: navigated && elapsed < 180_000 ? 'BOOTSTRAPPING\nStarting seeded truth auction' : 'Browse pools', timeOrigin: navigated ? 2 : 1 })
	const browser = createProductionBrowserNavigation({
		bootstrapTimeoutMilliseconds: 600_000,
		navigateDocument: async () => {
			navigated = true
			return { startsNewDocument: true }
		},
		now: () => elapsed,
		readDocument,
		wait: async milliseconds => {
			elapsed += milliseconds
		},
	})
	await browser.waitForReady()
	await browser.navigate('https://example.test/?workflow=auction')
	expect((await readDocument()).body).toBe('Browse pools')
	expect(elapsed).toBe(180_000)
})

test.each(['Browse pools', 'Simulation bootstrap failed: previous document'])('full navigation ignores the previous document body: %s', async previousBody => {
	let elapsed = 0
	const browser = createProductionBrowserNavigation({
		bootstrapTimeoutMilliseconds: 600_000,
		navigateDocument: async () => ({ startsNewDocument: true }),
		now: () => elapsed,
		readDocument: async () => (elapsed < 100 ? { body: previousBody, timeOrigin: 1 } : { body: elapsed < 200 ? 'BOOTSTRAPPING' : 'Browse pools', timeOrigin: 2 }),
		wait: async milliseconds => {
			elapsed += milliseconds
		},
	})
	await browser.navigate('https://example.test/?workflow=auction')
	expect(elapsed).toBe(200)
})

test('a full navigation that never replaces its document cannot pass readiness', async () => {
	let elapsed = 0
	const browser = createProductionBrowserNavigation({
		bootstrapTimeoutMilliseconds: 125,
		navigateDocument: async () => ({ startsNewDocument: true }),
		now: () => elapsed,
		readDocument: async () => ({ body: 'Browse pools', timeOrigin: 1 }),
		wait: async milliseconds => {
			elapsed += milliseconds
		},
	})
	await expect(browser.navigate('https://example.test/?workflow=auction')).rejects.toThrow('Production application did not finish loading')
	expect(elapsed).toBe(125)
})

test('same-document navigation retains its document identity', async () => {
	const urls: string[] = []
	const browser = createProductionBrowserNavigation({
		bootstrapTimeoutMilliseconds: 120_000,
		navigateDocument: async url => {
			urls.push(url)
			return { startsNewDocument: false }
		},
		readDocument: async () => ({ body: 'Browse pools', timeOrigin: 1 }),
	})
	await browser.navigate('https://example.test/#/pools')
	expect(urls).toEqual(['https://example.test/#/pools'])
})

test.each(['', 'Loading...', 'Loading…', 'Browse pools\nBOOTSTRAPPING', 'Starting simulation bootstrap'])('readiness waits through loading body %s', async body => {
	let elapsed = 0
	const browser = createProductionBrowserNavigation({
		bootstrapTimeoutMilliseconds: 125,
		navigateDocument: async () => ({ startsNewDocument: false }),
		now: () => elapsed,
		readDocument: async () => ({ body: elapsed < 100 ? body : 'Browse pools', timeOrigin: 1 }),
		wait: async milliseconds => {
			elapsed += milliseconds
		},
	})
	await browser.waitForReady()
	expect(elapsed).toBe(100)
})

test('bootstrap failures reject immediately instead of consuming the remaining budget', async () => {
	let elapsed = 0
	const browser = createProductionBrowserNavigation({
		bootstrapTimeoutMilliseconds: 600_000,
		navigateDocument: async () => ({ startsNewDocument: false }),
		now: () => elapsed,
		readDocument: async () => ({ body: 'Simulation bootstrap failed: seeded auction reverted', timeOrigin: 1 }),
		wait: async milliseconds => {
			elapsed += milliseconds
		},
	})
	await expect(browser.waitForReady()).rejects.toThrow('Production simulation failed to bootstrap: Simulation bootstrap failed: seeded auction reverted')
	expect(elapsed).toBe(0)
})

test.each([125, 120_000])('unfinished bootstrap expires at the selected %dms budget with its last body', async bootstrapTimeoutMilliseconds => {
	let elapsed = 0
	const browser = createProductionBrowserNavigation({
		bootstrapTimeoutMilliseconds,
		navigateDocument: async () => ({ startsNewDocument: false }),
		now: () => elapsed,
		readDocument: async () => ({ body: 'BOOTSTRAPPING\nStarting seeded truth auction', timeOrigin: 1 }),
		wait: async milliseconds => {
			elapsed += milliseconds
		},
	})
	await expect(browser.waitForReady()).rejects.toThrow('Starting seeded truth auction')
	expect(elapsed).toBe(bootstrapTimeoutMilliseconds)
})

test('readiness arriving at the exact deadline is too late', async () => {
	let elapsed = 0
	const browser = createProductionBrowserNavigation({
		bootstrapTimeoutMilliseconds: 125,
		navigateDocument: async () => ({ startsNewDocument: false }),
		now: () => elapsed,
		readDocument: async () => {
			elapsed = 125
			return { body: 'Browse pools', timeOrigin: 1 }
		},
	})
	await expect(browser.waitForReady()).rejects.toThrow('Production application did not finish loading')
})
