import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import type { Address } from '@zoltar/shared/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LiveTrading } from '../../features/LiveTrading.js'
import { liveTradingControllerServices } from '../../features/liveTradingControllerHelpers.js'
import { shareBalanceScope, type LiveMarket, type LiveBalances } from '../../protocol/live.js'

const pool: Address = `0x${'12'.repeat(20)}`
const shareToken: Address = `0x${'34'.repeat(20)}`
const secondPool: Address = `0x${'56'.repeat(20)}`
const secondShareToken: Address = `0x${'78'.repeat(20)}`

const market: LiveMarket = {
	pool,
	pair: pool,
	shareToken,
	universeId: 7n,
	questionId: 9n,
	title: 'Scoped portfolio',
	description: 'Scope fixture',
	endTime: 2n ** 255n,
	statoblastSecurityMultiplierBps: 20_000n,
	initialReportPriorityFeeAttoEthPerGas: 1n,
	systemState: 0,
	awaitingForkContinuation: false,
	universeForkTime: 0n,
	vaultCount: 1n,
	shareTokenSupplyAttoShares: 0n,
	settlementCollateralAttoEth: 0n,
	currentRetentionRate: 10n ** 18n,
	totalCapacityOwnershipAttoRep: 1n,
	feeEligibleCapacityOwnershipAttoRep: 1n,
	mintingCapacityCeilingAttoEth: 1n,
	availableMintingCapacityAttoEth: 1n,
	feeBps: 30n,
	tradingStatus: 0,
	questionOutcome: 3,
	yesReserve: 1n,
	noReserve: 1n,
	lpTotalSupply: 1n,
}

let cleanup: (() => Promise<void>) | undefined
installDomTestLifecycle({
	url: 'http://localhost/?demo=0#/market',
	afterTest: async () => {
		await cleanup?.()
		cleanup = undefined
	},
})

for (const initiallyPending of [false, true]) {
	test(`reselects the current market with ${initiallyPending ? 'pending' : 'ready'} balances and ignores stale responses`, async () => {
		const requests: Array<{ market: LiveMarket; resolve(value: LiveBalances): void }> = []
		const secondMarket = { ...market, pool: secondPool, shareToken: secondShareToken, title: 'Second market' }
		const configuration = { chainId: 31_337, chainName: 'Local', rpcUrl: 'http://127.0.0.1:8545', securityPoolFactory: pool, factory: pool, router: pool, feeBps: 30 }
		const services = {
			...liveTradingControllerServices,
			validateLiveDeployment: async () => undefined,
			discoverLiveUniverseMarketPage: async () => ({ start: 0n, count: 2n, total: 2n, previousStart: undefined, nextStart: undefined, markets: [market, secondMarket], universeIds: [7n], selectedUniverseId: 7n }),
			connectWallet: async () => pool,
			walletChainId: async () => configuration.chainId,
			loadWalletHeaderBalances: async () => ({ ethAttoEth: 1n, repAttoRep: 1n, repToken: shareToken }),
			loadLiveBalances: async (_client: unknown, selected: LiveMarket) => await new Promise<LiveBalances>(resolve => requests.push({ market: selected, resolve })),
		}
		Reflect.set(window, 'ethereum', { request: async () => undefined })
		const rendered = await renderIntoDocument(<LiveTrading route='market' configuration={configuration} configurationError={undefined} selectedUniverseId='7' controllerServices={services} onWorkflowLockChange={() => undefined} />)
		cleanup = rendered.cleanup
		async function flush() {
			await act(async () => {
				await Bun.sleep(20)
			})
		}
		function select(index: number) {
			const target = document.querySelectorAll<HTMLButtonElement>('.live-market-button')[index]
			if (target === undefined) throw new Error('Missing market button')
			target.click()
		}
		async function resolveRequest(index: number, amount: bigint) {
			const request = requests[index]
			if (request === undefined) throw new Error('Missing balance request')
			await act(async () => request.resolve({ scope: shareBalanceScope(request.market), invalid: amount, yes: amount, no: amount, approved: false, lp: 0n, lpAllowance: 0n }))
			await flush()
		}
		await flush()
		const connect = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Connect wallet')
		if (connect === undefined) throw new Error('Missing wallet connection')
		await act(async () => connect.click())
		await flush()
		expect(requests).toHaveLength(1)
		if (!initiallyPending) await resolveRequest(0, 10n ** 18n)
		await act(async () => {
			select(0)
			select(0)
		})
		await flush()
		expect(document.activeElement?.classList.contains('live-focus-target')).toBe(true)
		expect(requests).toHaveLength(1)
		if (initiallyPending) await resolveRequest(0, 10n ** 18n)
		expect(document.body.textContent).not.toContain('Refreshing wallet balances and approvals')
		expect(document.body.textContent).toContain('1 YES')
		await act(async () => select(1))
		await flush()
		await act(async () => select(0))
		await flush()
		expect(requests).toHaveLength(3)
		await resolveRequest(2, 2n * 10n ** 18n)
		await resolveRequest(1, 9n * 10n ** 18n)
		expect(document.body.textContent).toContain('2 YES')
		expect(document.body.textContent).not.toContain('9 YES')
		expect(document.body.textContent).not.toContain('Refreshing wallet balances and approvals')
	})
}
