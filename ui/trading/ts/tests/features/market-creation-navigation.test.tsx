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

test('continues a newly created market in its liquidity view with a confirmation, and opens an existing market from the creation route', async () => {
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
	const titles: (string | undefined)[] = []
	const view = (route: `create-market/${string}` | `market/${string}` | `liquidity/${string}`) => (
		<LiveTrading route={route} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} liquidityServices={liquidityServices} onMarketTitleChange={title => titles.push(title)} />
	)
	const rendered = await renderIntoDocument(view(`create-market/${market.pool}`))
	try {
		await waitForDom(() => document.querySelector('input[name="amount"]') !== null, 'creation form')
		// The addressed market's question names the page, so browser tabs and history tell markets apart.
		expect(titles.at(-1)).toBe(market.title)
		await act(() => buttonByLabel('Connect wallet').click())
		const input = document.querySelector('input[name="amount"]')
		if (!(input instanceof HTMLInputElement)) throw new Error('Missing liquidity amount')
		await act(() => {
			input.value = '0.5'
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await waitForDom(() => !buttonByLabel('Create market and add liquidity').disabled, 'enabled initialization')
		await act(() => buttonByLabel('Create market and add liquidity').click())
		await waitForDom(() => created, 'transaction submission')
		expect(tradingRouting.resolve(window.location.hash)).toBe(`create-market/${market.pool}`)
		await act(() => receipt.resolve({ status: 'success' }))
		// The creation deposited liquidity, so the user continues in that market's liquidity view, told that it worked.
		await waitForDom(() => tradingRouting.resolve(window.location.hash) === `liquidity/${market.pool}`, 'liquidity navigation after creation')
		expect(window.location.hash).toContain('simulate=1')
		expect(window.location.hash).toContain('simScenario=deployed')
		expect(window.location.hash).toContain('universe=1')
		await act(() => render(view(`liquidity/${market.pool}`), rendered.container))
		expect(document.body.textContent).not.toContain('This pool already has a trading market.')
		expect(rendered.container.querySelector('.market-workspace')).not.toBeNull()
		expect(rendered.container.querySelector('.market-created-notice')?.textContent).toContain('Market created and liquidity added.')
		// The confirmation belongs to the creation; another view of the market does not repeat it.
		await act(() => render(view(`market/${market.pool}`), rendered.container))
		expect(rendered.container.querySelector('.market-created-notice')).toBeNull()
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

test('the list landings say when the selected universe has forked and link to its child universes', async () => {
	const configuration = deploymentConfigurationFixture()
	const dom = installDomEnvironment('http://localhost/#/market?simulate=1&simScenario=deployed&universe=1')
	const rendered = await renderIntoDocument(<LiveTrading route='market' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={offlineControllerServices} universeForked />)
	try {
		const notice = rendered.container.querySelector('.universe-forked-notice')
		expect(notice?.textContent).toContain('This universe has forked.')
		expect(notice?.querySelector('a')?.getAttribute('href')).toContain('#/universe')
		await act(() => render(<LiveTrading route='market' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={offlineControllerServices} />, rendered.container))
		expect(rendered.container.querySelector('.universe-forked-notice')).toBeNull()
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})
