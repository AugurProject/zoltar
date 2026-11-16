import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { zeroHash } from '@zoltar/core-shared/evm/ethereum'
import { appBlockWatcher, invalidateAppData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { useTradingCollateral } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useTradingCollateral.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { capitalClient } from '../portfolios/capitalClient.js'
import { capitalSnapshot, owner, portfolio, token } from '../portfolios/capitalFixture.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
async function setup(balance = 0n, allowance = 0n) {
	const collateralToken = MAINNET_NETWORK_PROFILE.usdcAddress
	if (collateralToken === undefined) throw new Error('Missing USDC fixture')
	const source = capitalClient(capitalSnapshot({ collateralToken, walletCollateral: balance, collateralAllowance: allowance }))
	source.setRead('securityPoolFactory', token)
	source.setRead('getSecurityPoolPortfolio', portfolio)
	source.setRead('questionId', zeroHash)
	source.setRead('purchaseQuote', [0n])
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
	return { source, hook, transactions, balanceReads }
}

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
	await waitFor(() => expect(hook.state().requiredCollateral).toBe(3_010_000n))
	expect(hook.state().reason).toBe('Insufficient USDC balance.')
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
