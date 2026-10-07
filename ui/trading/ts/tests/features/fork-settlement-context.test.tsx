import { describe, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { createPublicClient, createWalletClient, custom, getAddress, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { LiveSettlementControls } from '../../features/LiveSettlementControls.js'
import type { ForkMigrationContext } from '../../protocol/forks.js'
import { shareBalanceScope } from '../../protocol/live.js'
// Wait past the former quote debounce to detect accidental background reads.
const QUOTE_SETTLE_MILLISECONDS = 400
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { buttonByLabel } from '../support/dom.js'
import { forkedMarketFixture } from '../support/liveMarketFixture.js'

const account = getAddress(`0x${'11'.repeat(20)}`)
const pool = getAddress(`0x${'22'.repeat(20)}`)
const shareToken = getAddress(`0x${'33'.repeat(20)}`)
const canonicalPool = getAddress(`0x${'44'.repeat(20)}`)
const router = getAddress(`0x${'55'.repeat(20)}`)
const transactionHash: Hash = `0x${'66'.repeat(32)}`
const blockHash: Hash = `0x${'77'.repeat(32)}`

const configuration = deploymentConfigurationFixture({ securityPoolFactory: getAddress(`0x${'88'.repeat(20)}`), factory: getAddress(`0x${'99'.repeat(20)}`), router })

const market = forkedMarketFixture({ pool, shareToken, description: 'Settlement context integration fixture', shareTokenSupplyAttoShares: 3n, settlementCollateralAttoEth: 3n })

const forkContext: ForkMigrationContext = {
	kind: 'categorical',
	parentUniverseId: market.universeId,
	questionId: 99n,
	title: 'Which branch wins?',
	availableTargets: [{ outcomeIndex: 1n, universeId: 101n, label: 'Red', canonicalPool, migrated: { invalid: 0n, yes: 0n, no: 0n } }],
}

async function settleEffects() {
	await act(async () => {
		await Bun.sleep(10)
	})
}

describe('live fork settlement context', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
		url: 'http://localhost/?demo=0#/market',
	})

	test('clears a confirmed complete-set redemption before refreshed balances can re-enable it', async () => {
		const liveMarket = { ...market, systemState: 0, universeForkTime: 0n, tradingStatus: 0 }
		const publicClient = createPublicClient({ transport: custom({ request: async () => undefined }) })
		const baseWallet = createWalletClient({ account, transport: custom({ request: async () => undefined }) })
		const walletClient = { ...baseWallet, waitForTransactionReceipt: async () => ({ status: 'success' as const }) }
		let submissions = 0
		const rendered = await renderIntoDocument(
			<LiveSettlementControls
				nowSeconds={100n}
				configuration={configuration}
				market={liveMarket}
				balances={{ scope: shareBalanceScope(liveMarket), invalid: 10n ** 18n, yes: 10n ** 18n, no: 10n ** 18n, lp: 0n }}
				balanceState='ready'
				balanceError={undefined}
				account={account}
				walletClient={walletClient}
				networkMismatchReason={undefined}
				wallet={{ actionLabel: 'Connect wallet', connect: async () => undefined }}
				settings={DEFAULT_TRADE_SETTINGS}
				externallyLocked={false}
				refresh={async () => undefined}
				onKnownReceipt={() => undefined}
				executeWithCurrentWalletContext={async (_account, _network, _wallet, action) => await action()}
				createGuardedWalletWrite={() => async write => await write()}
				retryBalances={async () => undefined}
				onWorkflowLockChange={() => undefined}
				services={{
					createPublicClient: () => publicClient,
					loadForkContext: async () => forkContext,
					submit: async () => {
						submissions++
						return transactionHash
					},
				}}
			/>,
		)
		cleanupRendered = rendered.cleanup
		const input = document.querySelector('input[inputmode="decimal"]')
		if (!(input instanceof HTMLInputElement)) throw new Error('Redemption amount input missing')
		await act(() => {
			input.value = '0'
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
		expect(input.getAttribute('aria-invalid')).toBe('true')
		expect(input.getAttribute('aria-describedby')).toBeTruthy()
		await act(() => {
			input.value = '0.1'
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await act(async () => await Bun.sleep(QUOTE_SETTLE_MILLISECONDS))
		await act(() => buttonByLabel('Redeem complete sets').click())
		await act(async () => await Bun.sleep(50))
		expect(submissions).toBe(1)
		expect(input.value).toBe('')
		expect(buttonByLabel('Redeem complete sets').disabled).toBe(true)
	})

	test('retries failed fork metadata and refreshes branches after confirmed migration', async () => {
		let contextLoads = 0
		let refreshes = 0
		const actualLive = await import('../../protocol/live.ts')
		const publicClient = createPublicClient({ transport: custom({ request: async () => undefined }) })
		const services = {
			createPublicClient: () => publicClient,
			loadForkContext: async () => {
				contextLoads++
				if (contextLoads === 1) throw new Error('fork metadata RPC unavailable')
				return forkContext
			},
			submit: async () => transactionHash,
		}
		const walletClient = createWalletClient({
			account,
			transport: custom({
				request: async ({ method }) => {
					if (method === 'eth_getTransactionByHash') return null
					if (method !== 'eth_getTransactionReceipt') throw new Error(`Unexpected RPC method: ${method}`)
					return {
						blockHash,
						blockNumber: '0xc',
						cumulativeGasUsed: '0x5208',
						from: account,
						gasUsed: '0x5208',
						logs: [],
						status: '0x1',
						to: shareToken,
						transactionHash,
						transactionIndex: '0x0',
						type: '0x2',
					}
				},
			}),
		})
		const balances = { scope: actualLive.shareBalanceScope(market), invalid: 1n, yes: 1n, no: 1n, lp: 0n }
		const settlementView = (currentAccount: typeof account, currentWalletClient: typeof walletClient, currentBalances: typeof balances) => (
			<LiveSettlementControls
				nowSeconds={100n}
				configuration={configuration}
				market={market}
				balances={currentBalances}
				balanceState='ready'
				balanceError={undefined}
				account={currentAccount}
				walletClient={currentWalletClient}
				wallet={{ actionLabel: 'Connect wallet', connect: async () => undefined }}
				settings={DEFAULT_TRADE_SETTINGS}
				externallyLocked={false}
				refresh={async () => {
					refreshes++
				}}
				onKnownReceipt={() => undefined}
				executeWithCurrentWalletContext={async (_account, _networkFailure, _accountFailure, action) => await action()}
				createGuardedWalletWrite={() => async write => await write()}
				retryBalances={async () => undefined}
				onWorkflowLockChange={() => undefined}
				services={services}
			/>
		)
		const rendered = await renderIntoDocument(settlementView(account, walletClient, balances))
		cleanupRendered = rendered.cleanup

		await settleEffects()
		expect(contextLoads).toBe(1)
		expect(document.body.textContent).toContain('fork metadata RPC unavailable')

		await act(() => buttonByLabel('Retry fork details').click())
		await settleEffects()
		expect(contextLoads).toBe(2)
		expect(document.body.textContent).toContain('Which branch wins?')
		const target = Array.from(document.querySelectorAll('button')).find(candidate => candidate.textContent?.includes('Red') === true && candidate.closest('[aria-label="Settlement operation"]') === null)
		if (!(target instanceof HTMLButtonElement)) throw new Error('Missing categorical fork target')
		await act(() => target.click())
		// Selecting a target uses loaded metadata and balances without wallet simulation.
		expect(document.body.textContent).not.toContain('Simulate authoritative settlement')
		await act(async () => {
			await Bun.sleep(QUOTE_SETTLE_MILLISECONDS)
		})
		await settleEffects()
		// The acknowledgment states the consequence once; no separate preflight summary repeats it.
		expect(document.body.textContent).not.toContain('simulation ready at block')
		// Migration moves the whole balance and locks it in the parent universe, so it waits for an explicit acknowledgment.
		expect(document.body.textContent).toContain('Migrates your entire balance: <0.0001 Yes')
		expect(buttonByLabel('Migrate to 1 child universe').disabled).toBe(true)
		await act(() => buttonByLabel('Migrate to 1 child universe').click())
		expect(refreshes).toBe(0)
		const acknowledgment = document.querySelector('.trade-impact-acknowledge input[type="checkbox"]')
		if (!(acknowledgment instanceof HTMLInputElement)) throw new Error('Missing migration acknowledgment')
		expect(acknowledgment.closest('label')?.textContent).toContain('moves all <0.0001 Yes (')
		expect(acknowledgment.closest('label')?.textContent).toContain('into the selected child universes and permanently locks my Yes transfers')
		await act(() => acknowledgment.click())
		expect(buttonByLabel('Migrate to 1 child universe').disabled).toBe(false)

		await act(() => buttonByLabel('Migrate to 1 child universe').click())
		await settleEffects()
		expect(refreshes).toBe(1)
		expect(contextLoads).toBe(3)
		expect(document.body.textContent).toContain('Migrate to 1 child universe confirmed.')

		const nextAccount = getAddress(`0x${'aa'.repeat(20)}`)
		const nextWalletClient = createWalletClient({ account: nextAccount, transport: custom({ request: async () => undefined }) })
		await act(() => render(settlementView(nextAccount, nextWalletClient, { ...balances, yes: 2n }), rendered.container))
		await settleEffects()
		expect(document.body.textContent).not.toContain('confirmed.')
	})
	test('shows a confirmed migration as done: the child universe is marked and linked, the balance reads as locked, and the same migration is blocked', async () => {
		const migratedContext: ForkMigrationContext = { ...forkContext, availableTargets: [{ outcomeIndex: 1n, universeId: 101n, label: 'Red', canonicalPool, migrated: { invalid: 0n, yes: 10n ** 18n, no: 0n } }] }
		let migrated = false
		const loadedAccounts: (string | undefined)[] = []
		const publicClient = createPublicClient({ transport: custom({ request: async () => undefined }) })
		const walletClient = createWalletClient({
			account,
			transport: custom({
				request: async ({ method }) => {
					if (method === 'eth_getTransactionByHash') return null
					if (method !== 'eth_getTransactionReceipt') throw new Error(`Unexpected RPC method: ${method}`)
					return { blockHash, blockNumber: '0xc', cumulativeGasUsed: '0x5208', from: account, gasUsed: '0x5208', logs: [], status: '0x1', to: shareToken, transactionHash, transactionIndex: '0x0', type: '0x2' }
				},
			}),
		})
		const rendered = await renderIntoDocument(
			<LiveSettlementControls
				nowSeconds={100n}
				configuration={configuration}
				market={market}
				balances={{ scope: shareBalanceScope(market), invalid: 0n, yes: 10n ** 18n, no: 0n, lp: 0n }}
				balanceState='ready'
				balanceError={undefined}
				account={account}
				walletClient={walletClient}
				networkMismatchReason={undefined}
				wallet={{ actionLabel: 'Connect wallet', connect: async () => undefined }}
				settings={DEFAULT_TRADE_SETTINGS}
				externallyLocked={false}
				refresh={async () => undefined}
				onKnownReceipt={() => undefined}
				executeWithCurrentWalletContext={async (_account, _network, _wallet, action) => await action()}
				createGuardedWalletWrite={() => async write => await write()}
				retryBalances={async () => undefined}
				onWorkflowLockChange={() => undefined}
				services={{
					createPublicClient: () => publicClient,
					loadForkContext: async (_client, _market, loadedAccount) => {
						loadedAccounts.push(loadedAccount)
						return migrated ? migratedContext : forkContext
					},
					submit: async () => {
						migrated = true
						return transactionHash
					},
				}}
			/>,
		)
		cleanupRendered = rendered.cleanup
		await settleEffects()
		// The migration record is read for the connected account.
		expect(loadedAccounts).toEqual([account])
		expect(document.body.textContent).toContain('Balance: 1 Yes')
		expect(document.body.textContent).not.toContain('locked after migration')
		const redTarget = () => {
			const target = Array.from(document.querySelectorAll('.migration-outcome-select')).find(candidate => candidate.textContent?.includes('Red') === true)
			if (!(target instanceof HTMLButtonElement)) throw new Error('Missing categorical fork target')
			return target
		}
		await act(() => redTarget().click())
		const acknowledgment = () => document.querySelector<HTMLInputElement>('.trade-impact-acknowledge input[type="checkbox"]')
		await act(() => acknowledgment()?.click())
		await act(() => buttonByLabel('Migrate to 1 child universe').click())
		await settleEffects()
		expect(document.body.textContent).toContain('Migrate to 1 child universe confirmed.')
		expect(loadedAccounts).toHaveLength(2)

		// The child universe that received the balance is marked migrated, and the balance left behind is locked.
		expect(redTarget().textContent).toContain('Migrated')
		expect(document.body.textContent).toMatch(/Balance: 1 Yes \([^)]*\) · locked after migration/)
		// The migrated shares are reachable in the child universe's security pool.
		const childLink = Array.from(document.querySelectorAll('.fork-migrated-list a')).find(link => link.textContent === 'Open in Red universe')
		expect(childLink?.getAttribute('href')).toContain(`#/market/${canonicalPool}`)
		expect(childLink?.getAttribute('href')).toContain('universe=101')
		// Selecting it again would migrate nothing, so the migrated target cannot be selected and says why.
		expect(redTarget().disabled).toBe(true)
		expect(redTarget().closest('.migration-outcome-row')?.textContent).toContain('This share is already migrated to this child universe.')
		await act(() => redTarget().click())
		expect(redTarget().getAttribute('aria-pressed') === 'true' || redTarget().getAttribute('aria-checked') === 'true').toBe(false)
		expect(acknowledgment()?.checked ?? false).toBe(false)
	})
})
