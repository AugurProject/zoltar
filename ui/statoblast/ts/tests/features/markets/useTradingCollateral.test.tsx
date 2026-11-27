import { expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { zeroHash } from '@zoltar/core-shared/evm/ethereum'
import { appBlockWatcher, invalidateAppData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { createMulticallStub, createReadContractStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { useTradingCollateral } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useTradingCollateral.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { capitalClient } from '../security-pools/capitalClient.js'
import { capitalSnapshot, owner, securityPool, token } from '../security-pools/capitalFixture.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
async function setup(balance = 0n, allowance = 0n, recoveryAttoRep = 0n, recoveryToken = token) {
	const collateralToken = MAINNET_NETWORK_PROFILE.usdcAddress
	if (collateralToken === undefined) throw new Error('Missing USDC fixture')
	const source = capitalClient(capitalSnapshot({ collateralToken, walletCollateral: balance, collateralAllowance: allowance }))
	source.setRead('securityPoolFactory', token)
	source.setRead('securityPoolOf', securityPool)
	source.setRead('questionId', zeroHash)
	source.setRead('purchaseQuote', [0n])
	source.setRead('refreshSecurityPoolFees', undefined)
	source.setRead('quoteMintRecoveryRep', recoveryAttoRep)
	source.setRead('attoEthToAttoShares', 1_875_101n)
	source.setRead('availableMintCapacity', 20_000_000n)
	source.setRead('universes', [1n, recoveryToken, 0n, 0n])
	const quoteBatches = mock((_functionNames: readonly string[]) => undefined)
	source.client.multicall = createMulticallStub(async request => {
		quoteBatches(request.contracts.map(contract => contract.functionName))
		return await Promise.all(
			request.contracts.map(async contract => {
				try {
					const result = await source.client.readContract({ ...contract, blockNumber: request.blockNumber })
					return request.allowFailure === true ? { status: 'success', result } : result
				} catch (error) {
					if (request.allowFailure !== true) throw error
					return { status: 'failure', error }
				}
			}),
		)
	})
	source.install()
	const transactions: string[] = []
	const hook = await renderHookWithProps(useTradingCollateral, {
		pool: token,
		amountInput: '2',
		enabled: true,
		accountAddress: owner,
		onTransactionRequested: () => {
			transactions.push('requested')
		},
		onTransactionSubmitted: () => {
			transactions.push('submitted')
		},
		onTransactionPresented: () => {
			transactions.push('presented')
		},
		onTransactionFinished: () => undefined,
		refreshState: async () => undefined,
	})
	lifecycle.trackRendered(hook)
	await waitFor(() => expect(hook.state().loading).toBe(false))
	const balanceReads = () => source.reads.filter(read => read.name === 'balanceOf').length
	return { source, hook, transactions, balanceReads, quoteBatches }
}

test('mint preview uses quoted shares, fee and capacity with directional limits in collateral units', async () => {
	const { source, hook, quoteBatches } = await setup(3_000_000n, 3_000_000n)
	const before = quoteBatches.mock.calls.length
	source.setRead('purchaseQuote', [25_001n])
	await act(() => invalidateAppData())
	await waitFor(() =>
		expect(hook.state().mintQuote).toMatchObject({
			amount: 2_000_000n,
			fee: 25_001n,
			shares: 1_875_101n,
			capacity: 20_000_000n,
			maximumFee: 27_502n,
			minimumShares: 1_856_349n,
		}),
	)
	expect(quoteBatches).toHaveBeenCalledTimes(before + 1)
	expect(quoteBatches.mock.calls.at(-1)?.[0]).toEqual(['refreshSecurityPoolFees', 'purchaseQuote', 'quoteMintRecoveryRep', 'attoEthToAttoShares', 'availableMintCapacity'])
})

test('the current mint quote blocks an amount above free pool capacity', async () => {
	const { source, hook } = await setup(3_000_000n, 3_000_000n)
	source.setRead('availableMintCapacity', 1_999_999n)
	await act(() => invalidateAppData())
	await waitFor(() => expect(hook.state().mintQuote?.capacity).toBe(1_999_999n))
	expect(hook.state().reason).toBe('Insufficient shared REP backing after queued commitment reductions.')
})

test('Max finds the largest affordable amount with room for the fresh rounded fee cap without refreshing or changing the draft', async () => {
	const { source, hook, quoteBatches } = await setup(3_000_009n, 0n)
	const read = source.client.readContract
	const blockNumbers: (bigint | undefined)[] = []
	source.client.readContract = createReadContractStub(async request => {
		blockNumbers.push(request.blockNumber)
		const amount = request.args?.[2]
		if (request.functionName === 'purchaseQuote' && typeof amount === 'bigint') return [(amount * 7n + 99n) / 100n + 100n, 0n]
		return read(request)
	})
	const quote = hook.state().mintQuote
	const before = quoteBatches.mock.calls.length
	let maximum: bigint | undefined
	await act(async () => {
		maximum = await hook.state().findMaximumMintAmount?.()
	})
	expect(maximum).toBe(2_785_421n)
	expect(quoteBatches.mock.calls.length - before).toBeLessThanOrEqual(16)
	expect(blockNumbers.length).toBeGreaterThan(0)
	expect(blockNumbers.every(block => block !== undefined && block === blockNumbers[0])).toBe(true)
	expect(hook.state().mintQuote).toBe(quote)
})

test('Max uses the recovery REP actually required before approvals', async () => {
	const { source, hook } = await setup(3_000_000n, 0n)
	const read = source.client.readContract
	source.setRead('balanceOf', 102n, token)
	source.setRead('allowance', 0n, token)
	source.setRead('availableMintCapacity', 3_000n)
	source.client.readContract = createReadContractStub(async request => {
		const amount = request.args?.[2]
		if (request.functionName === 'quoteMintRecoveryRep' && typeof amount === 'bigint') return (amount + 9n) / 10n
		return read(request)
	})
	let maximum: bigint | undefined
	await act(async () => {
		maximum = await hook.state().findMaximumMintAmount?.()
	})
	expect(maximum).toBe(1_020n)
	expect(hook.state().maximumMintAmountError).toBeUndefined()
})

test('Max does not turn an unresolved quote into a lower verified maximum', async () => {
	const { source, hook } = await setup(3_000_000n)
	const read = source.client.readContract
	source.client.readContract = createReadContractStub(async request => {
		if (request.functionName === 'purchaseQuote') {
			if (request.args?.[2] === 2_999_998n) throw new Error('Mint fee precision rate unsupported')
			return [1n, 0n]
		}
		return read(request)
	})
	let maximum: bigint | undefined
	await act(async () => {
		maximum = await hook.state().findMaximumMintAmount?.()
	})
	expect(maximum).toBeUndefined()
	expect(hook.state().maximumMintAmountError).toBe('Couldn’t check the maximum mint amount. Try again.')
})

test('leaving the mint page cancels Max before another quote batch starts', async () => {
	const { source, hook, quoteBatches } = await setup(3_000_000n)
	const balance = createDeferred<bigint>()
	source.setRead('balanceOf', balance.promise)
	const before = quoteBatches.mock.calls.length
	let pending: Promise<bigint | undefined> | undefined
	await act(() => {
		pending = hook.state().findMaximumMintAmount?.()
	})
	await waitFor(() => expect(quoteBatches).toHaveBeenCalledTimes(before + 1))
	expect(hook.state().findingMaximumMintAmount).toBe(true)
	await hook.setProps({ enabled: false })
	await act(() => balance.resolve(3_000_000n))
	expect(await pending).toBeUndefined()
	expect(quoteBatches).toHaveBeenCalledTimes(before + 1)
	expect(hook.state().maximumMintAmountError).toBeUndefined()
})

test('external funding, approval, spending, revocation and fee changes refresh without editing the mint form', async () => {
	const { source, hook, transactions } = await setup()
	expect(hook.state().reason).toBe('Insufficient USDC balance.')
	const block = (appBlockWatcher.getLatestBlockNumber() ?? 0n) + 1n
	await act(() => appBlockWatcher.reportBlock(block))
	source.setRead('balanceOf', 3_000_000n)
	await act(() => appBlockWatcher.reportBlock(block + 1n))
	await waitFor(() => expect(hook.state().collateral?.balance).toBe(3_000_000n))
	expect(hook.state().reason).toBe('Collateral approval required.')
	source.setRead('allowance', 3_000_000n)
	await act(() => invalidateAppData())
	await waitFor(() => expect(hook.state().reason).toBeUndefined())
	source.setRead('balanceOf', 1n)
	await act(() => appBlockWatcher.reportBlock(block + 2n))
	await waitFor(() => expect(hook.state().reason).toBe('Insufficient USDC balance.'))
	source.setRead('balanceOf', 3_000_000n)
	source.setRead('allowance', 0n)
	await act(() => invalidateAppData())
	await waitFor(() => expect(hook.state().reason).toBe('Collateral approval required.'))
	source.setRead('allowance', 3_000_000n)
	source.setRead('purchaseQuote', [1_000_000n])
	await act(() => invalidateAppData())
	await waitFor(() => expect(hook.state().requiredCollateral).toBe(3_000_000n))
	expect(hook.state().reason).toBeUndefined()
	expect(hook.state().collateral?.symbol).toBe('USDC')
	expect(hook.state().collateral?.decimals).toBe(6)
	expect(transactions).toEqual([])
})

test('slow refreshes coalesce invalidations and keep useful token funding visible between results', async () => {
	const { source, hook, transactions, balanceReads } = await setup(3_000_000n, 3_000_000n)
	const first = createDeferred<bigint>()
	const second = createDeferred<bigint>()
	const before = balanceReads()
	source.setRead('balanceOf', first.promise)
	await act(() => invalidateAppData())
	await waitFor(() => expect(balanceReads()).toBe(before + 1))
	await act(() => {
		invalidateAppData()
		invalidateAppData()
		invalidateAppData()
	})
	expect(balanceReads()).toBe(before + 1)
	expect(hook.state().collateral?.decimals).toBe(6)
	expect(hook.state().collateral?.balance).toBe(3_000_000n)
	source.setRead('balanceOf', second.promise)
	source.setRead('allowance', 0n)
	await act(() => first.resolve(5_000_000n))
	await waitFor(() => expect(balanceReads()).toBe(before + 2))
	expect(hook.state().collateral?.balance).toBe(5_000_000n)
	expect(hook.state().reason).toBeUndefined()
	await act(() => second.resolve(1n))
	await waitFor(() => expect(hook.state().reason).toBe('Insufficient USDC balance.'))
	expect(hook.state().collateral?.symbol).toBe('USDC')
	expect(transactions).toEqual([])
})

test('a failed background read keeps token units, blocks spending and recovers on the next invalidation', async () => {
	const { source, hook, transactions, balanceReads } = await setup(3_000_000n, 3_000_000n)
	const failed = createDeferred<bigint>()
	const before = balanceReads()
	source.setRead('balanceOf', failed.promise)
	await act(() => invalidateAppData())
	await waitFor(() => expect(balanceReads()).toBe(before + 1))
	await act(() => failed.reject(new Error('Collateral RPC unavailable')))
	await waitFor(() => expect(hook.state().reason).toContain('Collateral RPC unavailable'))
	expect(hook.state().collateral?.symbol).toBe('USDC')
	expect(hook.state().collateral?.decimals).toBe(6)
	source.setRead('balanceOf', 1_000_000n)
	await act(() => invalidateAppData())
	await waitFor(() => expect(hook.state().reason).toBe('Insufficient USDC balance.'))
	expect(hook.state().error).toBeUndefined()
	expect(transactions).toEqual([])
})

test('changing the account discards a pending refresh and disabling stops background reads', async () => {
	const { source, hook, transactions, balanceReads } = await setup(3_000_000n, 3_000_000n)
	const old = createDeferred<bigint>()
	const before = balanceReads()
	source.setRead('balanceOf', old.promise)
	await act(() => invalidateAppData())
	await waitFor(() => expect(balanceReads()).toBe(before + 1))
	source.setRead('balanceOf', 4_000_000n)
	await hook.setProps({ accountAddress: token })
	await waitFor(() => expect(hook.state().collateral?.balance).toBe(4_000_000n))
	await act(() => old.resolve(9_000_000n))
	expect(hook.state().collateral?.balance).toBe(4_000_000n)
	await hook.setProps({ enabled: false })
	const disabledReads = balanceReads()
	await act(() => invalidateAppData())
	expect(balanceReads()).toBe(disabledReads)
	expect(hook.state().collateral).toBeUndefined()
	await hook.setProps({ enabled: true })
	await waitFor(() => expect(hook.state().collateral?.balance).toBe(4_000_000n))
	expect(transactions).toEqual([])
})

test('typing keeps token identity visible and debounces quotes without reloading immutable identity', async () => {
	const { source, hook, balanceReads } = await setup(30_000_000n, 30_000_000n)
	const quotes = () => source.reads.filter(read => read.name === 'purchaseQuote').length
	const beforeQuotes = quotes()
	const identityReads = () => source.reads.filter(read => read.name === 'collateralToken').length
	const before = identityReads()
	await hook.setProps({ amountInput: '5' })
	expect(hook.state().collateral?.decimals).toBe(6)
	await hook.setProps({ amountInput: '6' })
	await hook.setProps({ amountInput: '7' })
	await waitFor(() => expect(hook.state().requiredCollateral).toBe(7_000_000n))
	expect(identityReads()).toBe(before)
	expect(quotes()).toBe(beforeQuotes + 1)
	const beforeBalance = balanceReads()
	await act(() => invalidateAppData())
	await waitFor(() => expect(balanceReads()).toBe(beforeBalance + 1))
	await waitFor(() => expect(quotes()).toBe(beforeQuotes + 2))
	expect(identityReads()).toBe(before)
})

test('quotes every amount the mint guard accepts, including a leading decimal point and digit grouping spaces', async () => {
	const { hook } = await setup(30_000_000n, 30_000_000n)
	await hook.setProps({ amountInput: '.5' })
	await waitFor(() => expect(hook.state().requiredCollateral).toBe(500_000n))
	expect(hook.state().reason).toBeUndefined()
	await hook.setProps({ amountInput: '1 0' })
	await waitFor(() => expect(hook.state().requiredCollateral).toBe(10_000_000n))
	expect(hook.state().reason).toBeUndefined()
})

test('a recovery REP quote refreshes balance and approval independently from collateral', async () => {
	const { source, hook, transactions } = await setup(3_000_000n, 3_000_000n)
	source.setRead('quoteMintRecoveryRep', 2n * 10n ** 18n)
	source.setRead('universes', [1n, token, 0n, 0n])
	source.setRead('balanceOf', 0n, token)
	source.setRead('allowance', 0n, token)
	await act(() => invalidateAppData())
	await waitFor(() => expect(hook.state().reason).toBe('Insufficient REP for the proportional recovery contribution.'))
	expect(hook.state().recovery?.required).toBe(2n * 10n ** 18n)
	expect(hook.state().recoveryApplicable).toBe(true)
	source.setRead('balanceOf', 3n * 10n ** 18n, token)
	await act(() => invalidateAppData())
	await waitFor(() => expect(hook.state().reason).toBe('Recovery REP approval required.'))
	source.setRead('allowance', (2n * 10n ** 18n * 101n) / 100n + 1n, token)
	await act(() => invalidateAppData())
	await waitFor(() => expect(hook.state().reason).toBeUndefined())
	expect(transactions).toEqual([])
})

test('a changed recovery quote stays blocked while loading and an invalid funding read blocks approval', async () => {
	const { source, hook, transactions } = await setup(3_000_000n, 3_000_000n)
	const pending = createDeferred<bigint>()
	source.setRead('quoteMintRecoveryRep', pending.promise)
	await hook.setProps({ amountInput: '2.1' })
	await waitFor(() => expect(hook.state().reason).toBe('Updating collateral quote.'))
	source.setRead('universes', [1n, '0x0000000000000000000000000000000000000000', 0n, 0n])
	pending.resolve(2n * 10n ** 18n)
	await waitFor(() => expect(hook.state().reason).toContain('Recovery REP funding is unavailable.'))
	expect(hook.state().recoveryApplicable).toBe(true)
	await act(() => hook.state().approveRecovery(2n * 10n ** 18n))
	expect(transactions).toEqual([])
})

test('an initial positive market quote retains recovery context when its funding read fails', async () => {
	const { hook } = await setup(3_000_000n, 3_000_000n, 2n * 10n ** 18n, '0x0000000000000000000000000000000000000000')
	expect(hook.state().reason).toContain('Recovery REP funding is unavailable.')
	expect(hook.state().recoveryApplicable).toBe(true)
	expect(hook.state().recovery).toBeUndefined()
})
