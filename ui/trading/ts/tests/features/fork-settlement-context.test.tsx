import { describe, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { createPublicClient, createWalletClient, custom, getAddress, type Hash } from '@zoltar/shared/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { LiveSettlementControls } from '../../features/LiveSettlementControls.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import type { ForkMigrationContext } from '../../protocol/forks.js'
import type { LiveMarket } from '../../protocol/live.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

const account = getAddress(`0x${'11'.repeat(20)}`)
const pool = getAddress(`0x${'22'.repeat(20)}`)
const shareToken = getAddress(`0x${'33'.repeat(20)}`)
const canonicalPool = getAddress(`0x${'44'.repeat(20)}`)
const router = getAddress(`0x${'55'.repeat(20)}`)
const transactionHash: Hash = `0x${'66'.repeat(32)}`
const blockHash: Hash = `0x${'77'.repeat(32)}`

const configuration: DeploymentConfiguration = {
	chainId: 31_337,
	chainName: 'Local',
	rpcUrl: 'http://127.0.0.1:8545',
	securityPoolFactory: getAddress(`0x${'88'.repeat(20)}`),
	factory: getAddress(`0x${'99'.repeat(20)}`),
	router,
	feeBps: 30,
}

const market: LiveMarket = {
	pool,
	pair: undefined,
	shareToken,
	universeId: 7n,
	questionId: 8n,
	title: 'Forked market',
	description: 'Settlement context integration fixture',
	endTime: 1n,
	statoblastSecurityMultiplierBps: 20_000n,
	initialReportPriorityFeeAttoEthPerGas: 1n,
	systemState: 1,
	awaitingForkContinuation: false,
	universeForkTime: 1n,
	vaultCount: 0n,
	shareTokenSupplyAttoShares: 3n,
	settlementCollateralAttoEth: 3n,
	currentRetentionRate: 0n,
	totalCapacityOwnershipAttoRep: 0n,
	feeEligibleCapacityOwnershipAttoRep: 0n,
	mintingCapacityCeilingAttoEth: 0n,
	availableMintingCapacityAttoEth: 0n,
	feeBps: 30n,
	tradingStatus: 4,
	questionOutcome: 3,
	yesReserve: 0n,
	noReserve: 0n,
	lpTotalSupply: 0n,
}

const forkContext: ForkMigrationContext = {
	kind: 'categorical',
	parentUniverseId: market.universeId,
	questionId: 99n,
	title: 'Which branch wins?',
	availableTargets: [{ outcomeIndex: 1n, universeId: 101n, label: 'Red', canonicalPool }],
}

function button(label: string) {
	const found = Array.from(document.querySelectorAll('button')).find(candidate => candidate.textContent?.trim() === label)
	if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}. Rendered text: ${document.body.textContent}`)
	return found
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
			simulate: async () => ({
				blockNumber: 12n,
				blockHash,
				operation: 'migrate-shares' as const,
				market,
				sourceOutcome: 'YES' as const,
				targetOutcomeIndexes: [1n],
			}),
			submit: async () => transactionHash,
		}
		const walletClient = createWalletClient({
			account,
			transport: custom({
				request: async ({ method }) => {
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
		const balances = { scope: actualLive.shareBalanceScope(market), invalid: 1n, yes: 1n, no: 1n, approved: true, lp: 0n, lpAllowance: 0n }
		const settlementView = (currentAccount: typeof account, currentWalletClient: typeof walletClient, currentBalances: typeof balances) => (
			<LiveSettlementControls
				configuration={configuration}
				market={market}
				balances={currentBalances}
				balanceState='ready'
				balanceError={undefined}
				account={currentAccount}
				walletClient={currentWalletClient}
				externallyLocked={false}
				refresh={async () => {
					refreshes++
				}}
				refreshBalancesAfterApproval={async () => 'ready'}
				onKnownReceipt={() => undefined}
				walletContextIsCurrent={() => true}
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

		await act(() => button('Retry fork details').click())
		await settleEffects()
		expect(contextLoads).toBe(2)
		expect(document.body.textContent).toContain('Which branch wins?')
		const target = Array.from(document.querySelectorAll('button')).find(candidate => candidate.textContent?.includes('Red') === true)
		if (!(target instanceof HTMLButtonElement)) throw new Error('Missing categorical fork target')
		await act(() => target.click())
		await act(() => button('Simulate authoritative settlement').click())
		await settleEffects()
		expect(document.body.textContent).toContain('Fork migration simulation ready at block 12')

		await act(() => button('Submit migration to 1 child branch').click())
		await settleEffects()
		expect(refreshes).toBe(1)
		expect(contextLoads).toBe(3)
		expect(document.body.textContent).toContain('Settlement transaction confirmed on-chain')

		const nextAccount = getAddress(`0x${'aa'.repeat(20)}`)
		const nextWalletClient = createWalletClient({ account: nextAccount, transport: custom({ request: async () => undefined }) })
		await act(() => render(settlementView(nextAccount, nextWalletClient, { ...balances, yes: 2n }), rendered.container))
		await settleEffects()
		expect(document.body.textContent).not.toContain('Settlement transaction confirmed on-chain')
	})
})
