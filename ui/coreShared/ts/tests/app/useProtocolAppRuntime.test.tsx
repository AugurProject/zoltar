import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { useProtocolAppRuntime } from '../../app/hooks/useProtocolAppRuntime.js'
import { appBlockWatcher, appQueryCache } from '../../lib/dataRefresh.js'
import { createDeferred } from '../testUtils/deferred.js'
import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

const lifecycle = installDomTestLifecycle()

test('transaction completion retires cache reads started before its block', async () => {
	let runtime: ReturnType<typeof useProtocolAppRuntime> | undefined
	function Harness() {
		runtime = useProtocolAppRuntime({ replaceEnvironment: async () => false })
		return undefined
	}
	lifecycle.trackRendered(await renderIntoDocument(<Harness />))
	if (runtime === undefined) throw new Error('Runtime did not initialize')
	const tray = runtime.transactionTray
	const store = appQueryCache.createStore<number>()
	const older = createDeferred<number>()
	const first = store.fetch('balance', async () => await older.promise)
	let loads = 0
	try {
		await act(() => {
			tray.onTransactionRequested({ action: 'createMarket', source: 'zoltar', submittedTitle: 'Creating question' })
			appBlockWatcher.reportBlock((appBlockWatcher.getLatestBlockNumber() ?? 0n) + 1n)
			tray.onTransactionFinished()
		})
		const next = store.fetch('balance', async () => {
			loads += 1
			return 2
		})
		expect(loads).toBe(1)
		expect(await next).toBe(2)
		older.resolve(1)
		await first
		expect(store.get('balance').data).toBe(2)
	} finally {
		older.resolve(1)
	}
})
