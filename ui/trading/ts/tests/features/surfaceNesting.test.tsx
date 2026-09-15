import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { Help } from '../../features/Help.js'
import { LiveTrading } from '../../features/LiveTrading.js'
import { liveTradingControllerServices } from '../../features/liveTradingControllerHelpers.js'
import { shareBalanceScope, type LiveMarket } from '../../protocol/live.js'

const account = `0x${'11'.repeat(20)}` as Address
const pool = `0x${'22'.repeat(20)}` as Address
const configuration: DeploymentConfiguration = { chainId: 31_337, chainName: 'Local', rpcUrl: 'http://127.0.0.1:8545', securityPoolFactory: `0x${'77'.repeat(20)}`, factory: `0x${'55'.repeat(20)}`, router: `0x${'66'.repeat(20)}`, feeBps: 30 }
const market: LiveMarket = {
	pool,
	pair: `0x${'33'.repeat(20)}`,
	shareToken: `0x${'44'.repeat(20)}`,
	universeId: 1n,
	questionId: 2n,
	title: 'Nesting fixture market',
	description: 'Surface nesting fixture',
	endTime: 2n ** 255n,
	statoblastSecurityMultiplierBps: 20_000n,
	initialReportPriorityFeeAttoEthPerGas: 1n,
	systemState: 0,
	awaitingForkContinuation: false,
	universeForkTime: 0n,
	vaultCount: 1n,
	shareTokenSupplyAttoShares: 10n * 10n ** 36n,
	settlementCollateralAttoEth: 10n * 10n ** 18n,
	currentRetentionRate: 10n ** 18n,
	totalCapacityOwnershipAttoRep: 1n,
	feeEligibleCapacityOwnershipAttoRep: 1n,
	mintingCapacityCeilingAttoEth: 2n,
	availableMintingCapacityAttoEth: 1n,
	feeBps: 30n,
	tradingStatus: 0,
	questionOutcome: 3,
	yesReserve: 50n * 10n ** 36n,
	noReserve: 50n * 10n ** 36n,
	lpTotalSupply: 50n * 10n ** 36n,
}

/** Card-like surfaces: entity cards and section blocks that draw their own border or background. */
const CARD_SURFACE_SELECTOR = '.entity-card, .section-block:not(.plain):not(.embedded)'

function nestedCardSurfaces(container: ParentNode) {
	return Array.from(container.querySelectorAll(CARD_SURFACE_SELECTOR)).filter(surface => surface.parentElement?.closest(CARD_SURFACE_SELECTOR) !== null)
}

async function waitForDom(predicate: () => boolean, description: string) {
	for (let attempt = 0; attempt < 200; attempt++) {
		await act(async () => {
			await Bun.sleep(10)
		})
		if (predicate()) return
	}
	throw new Error(`Timed out waiting for ${description}. Rendered text: ${document.body.textContent}`)
}

function button(label: string) {
	const match = Array.from(document.querySelectorAll('button')).find(candidate => candidate.textContent?.trim() === label)
	if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`)
	return match
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

	const page = (markets: LiveMarket[]) => ({ start: 0n, count: BigInt(markets.length), total: BigInt(markets.length), previousStart: undefined, nextStart: undefined, markets, universeIds: [1n], selectedUniverseId: 1n })
	const services = {
		...liveTradingControllerServices,
		createTradingPublicClient: () => ({}),
		validateLiveDeployment: async () => undefined,
		discoverAddressedMarket: async () => page([{ ...market }]),
		discoverTradingMarketPage: async () => page([{ ...market }]),
		discoverAllLiveMarketsInUniverse: async () => page([{ ...market }]),
		walletChainId: async () => configuration.chainId,
		connectWallet: async () => account,
		createTradingWalletClient: () => ({ waitForTransactionReceipt: async () => ({ status: 'success' as const }) }),
		loadWalletHeaderBalances: async () => ({ ethAttoEth: 5n * 10n ** 18n, repAttoRep: 6n * 10n ** 18n, repToken: `0x${'47'.repeat(20)}` as Address }),
		loadLiveBalances: async (_client: unknown, selected: LiveMarket) => ({ scope: shareBalanceScope(selected), invalid: 10n ** 36n, yes: 10n ** 36n, no: 10n ** 36n, lp: 10n ** 36n }),
	}

	test('keeps the market workspace, list, portfolio, and help routes free of cards inside cards', async () => {
		Reflect.set(window, 'ethereum', { request: async () => undefined, on: () => undefined, removeListener: () => undefined })
		const rendered = await renderIntoDocument(<LiveTrading route={`market/${pool}`} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = rendered.cleanup
		await waitForDom(() => document.querySelector('[role="tabpanel"] .tx-action-button') !== null, 'market workspace')
		expect(document.querySelectorAll('.sticky-object-context')).toHaveLength(1)
		expect(document.querySelector('[role="tablist"]')).not.toBeNull()
		expect(nestedCardSurfaces(document.body)).toEqual([])
		await act(async () => button('Connect wallet').click())
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
		await act(async () => button('Connect wallet').click())
		await waitForDom(() => document.querySelector('[data-portfolio-pool] .entity-card') !== null && document.body.textContent?.includes('1 YES') === true, 'portfolio positions')
		expect(nestedCardSurfaces(document.body)).toEqual([])
		await portfolio.cleanup()
		cleanupRendered = undefined

		const help = await renderIntoDocument(<Help />)
		cleanupRendered = help.cleanup
		expect(document.querySelectorAll('.section-block').length).toBeGreaterThan(0)
		expect(nestedCardSurfaces(document.body)).toEqual([])
	})
})
