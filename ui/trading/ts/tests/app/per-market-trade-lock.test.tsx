import { beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { transactionActivity } from '@zoltar/ui-core-shared/transactions/transactionActivityStore.js'
import { quoteEnterPosition } from '@zoltar/trading-shared/trading/positions'
import { App } from '../../app/App.js'
import { installTradingRouting } from '../../lib/routing.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import * as actualLive from '../../protocol/live.js'
import type { LiveMarket } from '../../protocol/live.js'
import { liveTradingControllerServices } from '../../features/liveTradingControllerHelpers.js'
import { liveMarketFixture } from '../support/liveMarketFixture.js'

const account = `0x${'11'.repeat(20)}` as Address
const firstMarket = liveMarketFixture({ pool: `0x${'22'.repeat(20)}` as Address, title: 'First market' })
const secondMarket = liveMarketFixture({ pool: `0x${'23'.repeat(20)}` as Address, shareToken: `0x${'45'.repeat(20)}` as Address, questionId: 3n, title: 'Second market' })
const configuration: DeploymentConfiguration = { chainId: 31_337, chainName: 'Local', rpcUrl: 'http://127.0.0.1:1', securityPoolFactory: `0x${'77'.repeat(20)}`, factory: `0x${'55'.repeat(20)}`, router: `0x${'66'.repeat(20)}`, feeBps: 30 }
const firstHash = `0x${'88'.repeat(32)}` as Hash
const secondHash = `0x${'8a'.repeat(32)}` as Hash

function actionButton(label: string) {
	const match = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tabpanel"] button')).find(candidate => candidate.textContent?.trim() === label)
	if (match === undefined) throw new Error(`Missing button: ${label}. Rendered text: ${document.body.textContent}`)
	return match
}

async function typeAmount(value: string) {
	const input = document.querySelector<HTMLInputElement>('[role="tabpanel"] input[name="amount"]')
	if (input === null) throw new Error('Amount input is unavailable')
	await act(() => {
		input.value = value
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
}

beforeEach(() => installTradingRouting())

describe('per-market trade lock in the application shell', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
			transactionActivity.value = { chainId: undefined, entries: [], ownerKey: undefined, storageKey: undefined }
		},
		url: `http://localhost/#/market/${firstMarket.pool}`,
	})

	test('a trade pending on one market leaves the application free to start a trade on another market', async () => {
		Reflect.set(window, 'ethereum', { request: async () => undefined, on: () => undefined, removeListener: () => undefined })
		// Receipts never arrive, so both trades stay pending for the whole test.
		const walletClient = { waitForTransactionReceipt: async () => await new Promise<never>(() => undefined) }
		const markets = [firstMarket, secondMarket]
		const submittedMarkets: Address[] = []
		const discovered = (pool: Address) => ({ start: 0n, count: 1n, total: 1n, previousStart: undefined, nextStart: undefined, markets: markets.filter(market => market.pool === pool), universeIds: [1n], selectedUniverseId: 1n })
		const services = {
			...liveTradingControllerServices,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverAddressedMarket: async (_client: unknown, _configuration: unknown, pool: Address) => discovered(pool),
			walletChainId: async () => configuration.chainId,
			connectWallet: async () => account,
			createTradingWalletClient: () => walletClient,
			loadWalletHeaderBalances: async () => ({ ethAttoEth: 5n * 10n ** 18n, repAttoRep: 0n, repToken: `0x${'47'.repeat(20)}` as Address }),
			loadLiveBalances: async (_client: unknown, market: LiveMarket) => ({ scope: actualLive.shareBalanceScope(market), invalid: 0n, yes: 0n, no: 0n, lp: 0n }),
			simulateEntry: async (_client: unknown, _configuration: unknown, market: LiveMarket, _account: unknown, side: 'YES' | 'NO', amount: bigint) => ({ blockNumber: 1n, amount, side, market, deadline: 2n ** 40n, slippageBps: 50n, minimumLongShares: 1n, result: quoteEnterPosition(side, amount, market) }),
			submitFreshEntry: async (_client: unknown, _configuration: unknown, _account: unknown, quote: { market: LiveMarket }, guardedWrite: <T>(write: () => Promise<T>) => Promise<T>) => {
				submittedMarkets.push(quote.market.pool)
				return await guardedWrite(async () => (quote.market.pool === firstMarket.pool ? firstHash : secondHash))
			},
		}
		const rendered = await renderIntoDocument(<App initializeEnvironment={async () => undefined} loadLiveDeployment={async () => configuration} liveTradingServices={services} />)
		cleanupRendered = rendered.cleanup
		await waitFor(() => expect(document.body.textContent).toContain('First market'))
		await act(async () => actionButton('Connect wallet').click())
		await waitFor(() => expect(document.body.textContent).toContain('Wallet: 5 ETH'))
		await typeAmount('0.01')
		await waitFor(() => expect(actionButton('Buy YES').disabled).toBeFalse())
		await act(async () => actionButton('Buy YES').click())
		await waitFor(() => expect(transactionActivity.value.entries.map(entry => entry.hash)).toEqual([firstHash]))

		// Only the first market waits for its trade: the second market's ticket and its action stay usable.
		await act(() => {
			window.location.hash = `#/market/${secondMarket.pool}`
		})
		await waitFor(() => expect(document.body.textContent).toContain('Second market'))
		await waitFor(() => expect(document.body.textContent).toContain('Wallet: 5 ETH'))
		expect(document.body.textContent).not.toContain('Transaction in progress.')
		await typeAmount('0.01')
		await waitFor(() => expect(actionButton('Buy YES').disabled).toBeFalse())
		await act(async () => actionButton('Buy YES').click())
		// Both trades are pending at once, each recorded against its own market.
		await waitFor(() => expect(transactionActivity.value.entries).toHaveLength(2))
		expect(submittedMarkets).toEqual([firstMarket.pool, secondMarket.pool])
		expect(transactionActivity.value.entries.map(entry => ({ hash: entry.hash, scope: entry.scope, status: entry.status }))).toEqual(
			expect.arrayContaining([
				{ hash: firstHash, scope: [`market:${firstMarket.pool.toLowerCase()}`], status: 'pending' },
				{ hash: secondHash, scope: [`market:${secondMarket.pool.toLowerCase()}`], status: 'pending' },
			]),
		)
	})
})
