import { expect, spyOn, test } from 'bun:test'
import { startChromiumSession } from './chromium-session.ts'

test('restarts only a timed-out Chromium initialization before any UI assertions run', async () => {
	const logged = spyOn(console, 'warn').mockImplementation(() => {})
	let attempts = 0
	const session = { close: async () => {}, getLastNetworkActivity: () => 0, hasWorkerStarted: () => false, issues: [], send: async () => undefined, pageUrl: 'about:blank' }
	try {
		expect(
			await startChromiumSession('chromium', async () => {
				attempts += 1
				if (attempts === 1) throw new Error('Chromium initialization timed out while requesting the DevTools target list')
				return session
			}),
		).toBe(session)
		expect(attempts).toBe(2)
		expect(logged).toHaveBeenCalledTimes(1)
	} finally {
		logged.mockRestore()
	}
})

test('fails after the second startup timeout and never retries other errors', async () => {
	const logged = spyOn(console, 'warn').mockImplementation(() => {})
	try {
		for (const message of ['Chromium initialization timed out while requesting the DevTools target list', 'Could not launch Chromium', 'UI assertion failed']) {
			let attempts = 0
			const failure = new Error(message)
			await expect(
				startChromiumSession('chromium', async () => {
					attempts += 1
					throw failure
				}),
			).rejects.toBe(failure)
			expect(attempts).toBe(message.startsWith('Chromium initialization') ? 2 : 1)
		}
	} finally {
		logged.mockRestore()
	}
})

test('allows a cold Chromium startup that needs more than ten seconds', async () => {
	const session = { close: async () => {}, getLastNetworkActivity: () => 0, hasWorkerStarted: () => false, issues: [], send: async () => undefined, pageUrl: 'about:blank' }
	const launched = await startChromiumSession('chromium', async (_path, _url, _viewport, options = {}) => {
		const initializationBudget = options.initializationTimeoutMilliseconds ?? 60_000
		if (initializationBudget < 15_000) throw new Error('Chromium initialization timed out while waiting for the DevTools port')
		return session
	})
	expect(launched).toBe(session)
})
