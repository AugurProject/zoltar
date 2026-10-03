import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { tradingRouting } from '../../lib/routing.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { LiveTrading } from '../../features/LiveTrading.js'
import { shareBalanceScope } from '../../protocol/live.js'
import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { etherScaleMarketFixture, fixtureAddress } from '../support/liveMarketFixture.js'
import { connectedWalletServices, discoveryPage, installSilentInjectedWallet, offlineControllerServices } from '../support/liveTradingServices.js'
import { buttonByLabel, waitForDom } from '../support/dom.js'

test('opens a newly created market and opens it again when entered through the creation route', async () => {
	const market = etherScaleMarketFixture({ endTime: BigInt(Math.floor(Date.now() / 1000)) + 86400n, pair: undefined, lpTotalSupply: 0n, yesReserve: 0n, noReserve: 0n })
	const initialized = etherScaleMarketFixture({ endTime: market.endTime })
	const configuration = deploymentConfigurationFixture()
	const account = fixtureAddress('11')
	const dom = installDomEnvironment(`http://localhost/#/create-market/${market.pool}?simulate=1&simScenario=deployed&universe=1`)
	installSilentInjectedWallet()
	let created = false
	const receipt = createDeferred<{ status: 'success' }>()
	const services = {
		...offlineControllerServices,
		...connectedWalletServices(account, configuration.chainId),
		createTradingWalletClient: () => ({ waitForTransactionReceipt: async () => await receipt.promise }),
		discoverAddressedMarket: async () => discoveryPage([created ? initialized : market]),
		loadLiveBalances: async (_client: unknown, selected: typeof market) => ({ scope: shareBalanceScope(selected), invalid: 0n, yes: 0n, no: 0n, lp: 0n }),
	}
	const liquidityServices = {
		submitFreshLiquidity: async () => {
			created = true
			return `0x${'88'.repeat(32)}` as const
		},
	}
	const view = (route: `create-market/${string}` | `market/${string}`) => <LiveTrading route={route} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} liquidityServices={liquidityServices} />
	const rendered = await renderIntoDocument(view(`create-market/${market.pool}`))
	try {
		await waitForDom(() => document.querySelector('input[name="amount"]') !== null, 'creation form')
		await act(() => buttonByLabel('Connect wallet').click())
		const input = document.querySelector('input[name="amount"]')
		if (!(input instanceof HTMLInputElement)) throw new Error('Missing liquidity amount')
		await act(() => {
			input.value = '0.5'
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await waitForDom(() => !buttonByLabel('Initialize pool').disabled, 'enabled initialization')
		await act(() => buttonByLabel('Initialize pool').click())
		await waitForDom(() => created, 'transaction submission')
		expect(tradingRouting.resolve(window.location.hash)).toBe(`create-market/${market.pool}`)
		await act(() => receipt.resolve({ status: 'success' }))
		await waitForDom(() => tradingRouting.resolve(window.location.hash) === `market/${market.pool}`, 'market navigation after creation')
		expect(window.location.hash).toContain('simulate=1')
		expect(window.location.hash).toContain('simScenario=deployed')
		expect(window.location.hash).toContain('universe=1')
		await act(() => render(view(`market/${market.pool}`), rendered.container))
		expect(document.body.textContent).not.toContain('This pool already has a trading market.')
		expect(rendered.container.querySelector('.market-workspace')).not.toBeNull()
		window.location.hash = `#/create-market/${market.pool}`
		await act(() => render(view(`create-market/${market.pool}`), rendered.container))
		await waitForDom(() => tradingRouting.resolve(window.location.hash) === `market/${market.pool}`, 'market navigation on reopening')
		expect(document.body.textContent).not.toContain('This pool already has a trading market.')
		expect(document.body.textContent).not.toContain('Market created:')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})
