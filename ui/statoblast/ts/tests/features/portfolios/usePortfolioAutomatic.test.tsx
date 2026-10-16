import { expect, test } from 'bun:test'
import { useSignal } from '@preact/signals'
import { act } from 'preact/test-utils'
import { createPublicClient, http, getAddress, zeroHash, decodeFunctionData, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createMockReadClient, createBlockWithTimestamp } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import type { PortfolioSnapshot, PortfolioPosition } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { usePortfolioAutomatic } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioAutomatic.js'
import { renderHookWithProps } from '../../support/renderHook.js'

const owner = getAddress('0x0000000000000000000000000000000000000011')
const vault = getAddress('0x0000000000000000000000000000000000000022')
const portfolio = getAddress('0x0000000000000000000000000000000000000033')
const pool = getAddress('0x0000000000000000000000000000000000000044')
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const position: PortfolioPosition = {
	questionId: 51n,
	universeId: 0n,
	pool,
	registered: true,
	repToken: owner,
	coordinator: owner,
	priceFeed: owner,
	pendingReportCoordinator: owner,
	backingUnits: 100n,
	backingAttoRep: 100n,
	commitmentAttoEth: 10n,
	claimableFeesAttoEth: 0n,
	openInterestAttoEth: 10n,
	badDebtAttoEth: 0n,
	disputeStakeAttoRep: 0n,
	ordinaryResidualPending: false,
	poolHeldAttoRep: 100n,
	totalBackingUnits: 100n,
	poolCommitmentAttoEth: 10n,
	settlementCollateralAttoEth: 10n,
	securityMultiplierBps: 20000n,
	minimumDepositAttoRep: 1n,
	systemState: 0n,
	resolved: false,
	questionEndTime: 2000n,
	forkTime: 0n,
	price: 10n ** 18n,
	priceValid: true,
	pendingReportId: 0n,
	settlementTime: 0n,
	queuedOperations: [],
	queuedOperationsComplete: true,
	allocationOperationsComplete: true,
}

async function renderAutomatic(overrides: Partial<PortfolioPosition> = {}, withdrawal = false, beforeRead?: () => void) {
	let version = 3n
	let vaultEthBalance = 0n
	let residualForfeitureAllowed = false
	let captured: PortfolioTransaction | undefined
	const snapshot: PortfolioSnapshot = {
		chainId: 1,
		blockNumber: 1n,
		blockHash: zeroHash,
		timestamp: 1000n,
		portfolio,
		vault,
		owner,
		originUniverseId: 0n,
		questions: [51n],
		branches: [{ universeId: 0n, repToken: owner, idleAttoRep: 100n, forkTime: 0n, positions: [{ ...position, ...overrides }] }],
		coverage: { complete: true, registryComplete: true, issues: [], scope: 'registered-and-explicit-pools' },
	}
	const client = createPublicClient({ transport: http('https://example.test') }).extend(() => ({
		getChainId: async () => 1,
		getBlock: async () => ({ ...createBlockWithTimestamp(1000n), number: 1n, hash: zeroHash }),
		...createMockReadClient(async request => {
			beforeRead?.()
			switch (request.functionName) {
				case 'getEthBalance':
					return vaultEthBalance
				case 'allocationPolicyVersion':
					return version
				case 'allocationPolicyNonce':
					return 2n
				case 'withdrawalRequested':
					return withdrawal
				case 'withdrawalResidualForfeitureAllowed':
					return residualForfeitureAllowed
				case 'withdrawalRequestId':
					return 1n
				case 'allocatedQuestionCount':
					return 1n
				case 'getAllocatedQuestions':
					return [51n]
				case 'withdrawalRequestCount':
					return 0n
				case 'getWithdrawalRequests':
					return []
				default:
					throw new Error(`Unexpected recovery read ${request.functionName}`)
			}
		}),
	}))
	installActiveEnvironmentForTesting({ ...createFakeBackend({ accountAddress: owner }), createReadClient: () => client })
	const model = { loading: false, snapshot, selection: { portfolio, vault, owner, originUniverseId: 0n }, refresh: async () => undefined, load: async () => undefined }
	const actions: Parameters<typeof usePortfolioAutomatic>[1] = {
		vaultReason: undefined,
		runPortfolioAction: async (_action, _label, build) => {
			captured = await build()
		},
	}
	const hook = lifecycle.trackRendered(
		await renderHookWithProps(() => {
			const currentSnapshot = useSignal(snapshot)
			return usePortfolioAutomatic(
				{
					...model,
					snapshot: currentSnapshot.value,
					refresh: async () => {
						currentSnapshot.value = { ...currentSnapshot.value }
					},
				},
				actions,
				owner,
			)
		}, {}),
	)
	await waitFor(() => expect(hook.state().state !== undefined || hook.state().readError !== undefined).toBe(true))
	return {
		hook,
		captured: () => captured,
		changeAuthority: () => {
			version += 1n
		},
		changeResidualConsent: () => {
			residualForfeitureAllowed = !residualForfeitureAllowed
		},
		changeVaultEth: (balance: bigint) => {
			vaultEthBalance = balance
		},
	}
}

test('final withdrawal remains processable with outstanding collateral and stale price, and uses the selected native branch', async () => {
	const { hook, captured } = await renderAutomatic({ resolved: true, priceValid: false, ordinaryResidualPending: true, backingAttoRep: 0n }, true)
	const position = hook.state().positions[0]
	if (position === undefined) throw new Error('Expected position')
	expect(position.processReason).toBeUndefined()
	await act(async () => {
		await position.process()
	})
	const request = captured()
	if (request === undefined) throw new Error('Expected process request')
	expect(request.account).toBe(owner)
	expect(request.to).toBe(vault)
	expect(decodeFunctionData({ abi: parseAbi(['function processWithdrawal(uint256,uint248)']), data: request.data }).args).toEqual([51n, 0n])
})

test('cancelling native runoff preserves shared-fund separation and invalidates stale state', async () => {
	const { hook, captured, changeAuthority } = await renderAutomatic({}, true)
	await act(async () => await hook.state().cancelWithdrawal())
	const request = captured()
	if (request === undefined) throw new Error('Expected cancellation request')
	expect(decodeFunctionData({ abi: parseAbi(['function cancelWithdrawal()']), data: request.data }).functionName).toBe('cancelWithdrawal')
	expect(request.reviewDescription).toContain('does not deposit REP into the shared fund')
	await request.validateBeforeSubmit?.()
	changeAuthority()
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('authority changed')
})

test('pre-final residual consent is reviewed, can be revoked, and invalidates pending withdrawal reviews', async () => {
	const { hook, captured, changeResidualConsent } = await renderAutomatic({ ordinaryResidualPending: true, settlementCollateralAttoEth: 0n }, true)
	expect(hook.state().positions[0]?.processReason).toContain('residual')
	await act(async () => await hook.state().allowResidualForfeiture())
	const consent = captured()
	if (consent === undefined) throw new Error('Expected residual consent request')
	expect(decodeFunctionData({ abi: parseAbi(['function setWithdrawalResidualForfeiture(bool)']), data: consent.data }).args).toEqual([true])
	expect(consent.reviewDescription).toContain('permanently')
	changeResidualConsent()
	await expect(consent.validateBeforeSubmit?.()).rejects.toThrow('authority changed')
	await act(async () => await hook.state().retry())
	await waitFor(() => expect(hook.state().state?.withdrawalResidualForfeitureAllowed).toBe(true))
	expect(hook.state().positions[0]?.processReason).toBeUndefined()
	await act(async () => await hook.state().revokeResidualForfeiture())
	const revoke = captured()
	if (revoke === undefined) throw new Error('Expected residual protection request')
	expect(decodeFunctionData({ abi: parseAbi(['function setWithdrawalResidualForfeiture(bool)']), data: revoke.data }).args).toEqual([false])
})

test('owner ETH withdrawal exposes available earnings and rejects a changed reviewed balance', async () => {
	const { hook, captured, changeVaultEth } = await renderAutomatic()
	expect(hook.state().withdrawEthReason).toContain('No ETH')
	await expect(hook.state().withdrawEth()).rejects.toThrow('No ETH')
	changeVaultEth(2n * 10n ** 18n)
	await act(async () => await hook.state().retry())
	await waitFor(() => expect(hook.state().state?.ethBalanceAttoEth).toBe(2n * 10n ** 18n))
	expect(hook.state().withdrawEthReason).toBeUndefined()
	await act(async () => await hook.state().withdrawEth())
	const request = captured()
	if (request === undefined) throw new Error('Expected ETH withdrawal request')
	expect(decodeFunctionData({ abi: parseAbi(['function withdrawEth()']), data: request.data }).functionName).toBe('withdrawEth')
	expect(request.reviewDescription).toContain('2 ETH')
	expect(request.reviewDescription).toContain('remain unchanged')
	await request.validateBeforeSubmit?.()
	changeVaultEth(3n * 10n ** 18n)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('ETH balance changed')
})

test('a same-block refresh retries failed native recovery reads', async () => {
	let failing = true
	const { hook } = await renderAutomatic({}, false, () => {
		if (failing) throw new Error('Recovery read unavailable')
	})
	expect(hook.state().readError).toContain('unavailable')
	failing = false
	await act(async () => await hook.state().retry())
	await waitFor(() => expect(hook.state().state).toBeDefined())
	expect(hook.state().readError).toBeUndefined()
})
