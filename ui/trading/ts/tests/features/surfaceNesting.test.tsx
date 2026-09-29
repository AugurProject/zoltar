import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { Help } from '../../features/Help.js'
import { LiveTrading } from '../../features/LiveTrading.js'
import { shareBalanceScope, type LiveMarket } from '../../protocol/live.js'
import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { buttonByLabel, waitForDom } from '../support/dom.js'
import { etherScaleMarketFixture } from '../support/liveMarketFixture.js'
import { connectedWalletServices, discoveryPage, installSilentInjectedWallet, offlineControllerServices } from '../support/liveTradingServices.js'

const account = `0x${'11'.repeat(20)}` as Address
const pool = `0x${'22'.repeat(20)}` as Address
const configuration = deploymentConfigurationFixture()
const market = etherScaleMarketFixture({ pool, title: 'Nesting fixture market', description: 'Surface nesting fixture' })

/** Card-like surfaces: entity cards and section blocks that draw their own border or background. */
const CARD_SURFACE_SELECTOR = '.entity-card, .section-block:not(.plain):not(.embedded)'

function nestedCardSurfaces(container: ParentNode) {
	return Array.from(container.querySelectorAll(CARD_SURFACE_SELECTOR)).filter(surface => surface.parentElement?.closest(CARD_SURFACE_SELECTOR) !== null)
}

describe('trading surface nesting', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
		url: `http://localhost/?demo=0#/market/${pool}`,
	})

	const services = {
		...offlineControllerServices,
		discoverAddressedMarket: async () => discoveryPage([{ ...market }]),
		discoverTradingMarketPage: async () => discoveryPage([{ ...market }]),
		discoverAllLiveMarketsInUniverse: async () => discoveryPage([{ ...market }]),
		...connectedWalletServices(account, configuration.chainId),
		createTradingWalletClient: () => ({ waitForTransactionReceipt: async () => ({ status: 'success' as const }) }),
		loadLiveBalances: async (_client: unknown, selected: LiveMarket) => ({ scope: shareBalanceScope(selected), invalid: 10n ** 18n, yes: 10n ** 18n, no: 10n ** 18n, lp: 10n ** 18n }),
	}

	test('keeps the market workspace, list, portfolio, and help routes free of cards inside cards', async () => {
		installSilentInjectedWallet()
		const rendered = await renderIntoDocument(<LiveTrading route={`market/${pool}`} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = rendered.cleanup
		await waitForDom(() => document.querySelector('[role="tabpanel"] .tx-action-button') !== null, 'market workspace')
		expect(document.querySelectorAll('.sticky-object-context')).toHaveLength(1)
		expect(document.querySelector('[role="tablist"]')).not.toBeNull()
		expect(nestedCardSurfaces(document.body)).toEqual([])
		await act(async () => buttonByLabel('Connect wallet').click())
		await waitForDom(() => document.body.textContent?.includes('1 YES') === true, 'wallet balances')
		expect(nestedCardSurfaces(document.body)).toEqual([])
		await rendered.cleanup()
		cleanupRendered = undefined

		const list = await renderIntoDocument(<LiveTrading route='market' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = list.cleanup
		await waitForDom(() => document.querySelector('.market-record') !== null, 'market list')
		expect(document.querySelector('.open-pool-form')).not.toBeNull()
		expect(nestedCardSurfaces(document.body)).toEqual([])
		await list.cleanup()
		cleanupRendered = undefined

		const portfolio = await renderIntoDocument(<LiveTrading route='portfolio' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = portfolio.cleanup
		await act(async () => buttonByLabel('Connect wallet').click())
		await waitForDom(() => document.querySelector('.entity-card[data-portfolio-pool]') !== null && document.body.textContent?.includes('1 YES') === true, 'portfolio positions')
		expect(nestedCardSurfaces(document.body)).toEqual([])
		await portfolio.cleanup()
		cleanupRendered = undefined

		const help = await renderIntoDocument(<Help />)
		cleanupRendered = help.cleanup
		expect(document.querySelectorAll('.section-block').length).toBeGreaterThan(0)
		expect(nestedCardSurfaces(document.body)).toEqual([])
	})
})
