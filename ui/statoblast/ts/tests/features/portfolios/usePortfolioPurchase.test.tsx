import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { decodeFunctionData, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { usePortfolioPurchase } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioPurchase.js'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { auctionCapitalSnapshot, capitalSnapshot, owner, capital, token, unit } from './capitalFixture.js'
import { modules, capitalClient } from './capitalClient.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const abi = parseAbi(['function createCompleteSet(uint248 universeId,uint256 questionId,uint256 mintAttoEth,address recipient,uint256 minimumShares,uint256 maximumFee) returns(uint256)'])
async function setup(snapshot = capitalSnapshot(), recoveryAttoRep = 0n, recoveryToken = token) {
	const source = capitalClient(snapshot)
	const values = {
		questionOriginIds: `0x${'11'.repeat(32)}`,
		getPool: capital,
		questionId: 999n,
		questionData: token,
		getQuestionEndDate: 10_000n,
		escalationGame: zeroAddress,
		systemState: 0n,
		quoteMintRecoveryRep: recoveryAttoRep,
		recoveryTokens: recoveryToken,
		purchaseQuote: [unit / 100n, unit / 200n],
		quoteQuestionMint: unit,
		availableMintCapacity: 10n * unit,
	}
	for (const [name, value] of Object.entries(values)) source.setRead(name, value)
	source.install()
	const requests: PortfolioTransaction[] = []
	const actions = {
		ownerReason: undefined,
		runPortfolioAction: async (_action: string, _label: string, build: () => PortfolioTransaction | Promise<PortfolioTransaction>) => {
			requests.push(await build())
		},
	}
	const hook = await renderHookWithProps((props: { snapshot: typeof snapshot }) => usePortfolioPurchase({ ...props, loading: false }, actions), { snapshot })
	lifecycle.trackRendered(hook)
	await act(() => {
		hook.state().setQuestionInput('999')
		hook.state().setMintAmount('1')
		hook.state().setMaximumFee('0.02')
		hook.state().setMinimumShares('0.9')
	})
	await waitFor(() => (recoveryToken === zeroAddress ? expect(hook.state().reason).toContain('Recovery REP funding is unavailable.') : expect(hook.state().quote).toBeDefined()))
	return { hook, source, requests }
}
test('purchases made while managing an auction vault receive shares in the controlling wallet', async () => {
	const { hook, requests } = await setup(auctionCapitalSnapshot())
	await act(() => hook.state().buy())
	const request = requests[0]
	if (request === undefined) throw new Error('Missing purchase')
	expect(request.account).toBe(owner)
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'createCompleteSet', args: [0n, 999n, unit, owner, (9n * unit) / 10n, unit / 50n] })
})
test('purchase uses one aggregate transaction and preserves explicit limits across new blocks', async () => {
	const { hook, requests } = await setup()
	expect(hook.state().reason).toBeUndefined()
	expect(hook.state().quote).toMatchObject({ purchaseFeeAttoEth: unit / 100n, availableCommitmentAttoEth: 10n * unit })
	await act(() => hook.state().buy())
	const request = requests[0]
	if (request === undefined) throw new Error('Missing purchase')
	expect(request.value).toBe(0n)
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'createCompleteSet', args: [0n, 999n, unit, owner, (9n * unit) / 10n, unit / 50n] })
	await hook.setProps({ snapshot: capitalSnapshot({ blockNumber: 11n }) })
	expect(hook.state().maximumFee).toBe('0.02')
	expect(hook.state().minimumShares).toBe('0.9')
})
test('a post-review capacity reduction or closed question stops submission', async () => {
	const { hook, requests, source } = await setup()
	await act(() => hook.state().buy())
	const request = requests[0]
	if (request === undefined) throw new Error('Missing purchase')
	await request.validateBeforeSubmit?.()
	source.setRead('availableMintCapacity', 0n)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('prerequisites changed')
	source.setRead('availableMintCapacity', 10n * unit)
	source.setRead('escalationGame', token)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('minting has closed')
})

test('a wallet that covers the collateral and quoted fee can purchase without funding the unused fee cap', async () => {
	// Quoted fee 0.01 against a 0.02 cap: 1.01 is what the contract pulls, so 1.01 of balance and allowance suffice.
	const snapshot = capitalSnapshot({ walletCollateral: unit + unit / 100n, collateralAllowance: unit + unit / 100n })
	const { hook, requests } = await setup(snapshot)
	expect(hook.state().requiredCollateral).toBe(unit + unit / 100n)
	expect(hook.state().reason).toBeUndefined()
	await act(() => hook.state().buy())
	const request = requests[0]
	if (request === undefined) throw new Error('Missing purchase')
	expect(decodeFunctionData({ abi, data: request.data }).args[5]).toBe(unit / 50n)
	await request.validateBeforeSubmit?.()
	await hook.setProps({ snapshot: { ...snapshot, collateralAllowance: unit, blockNumber: 11n } })
	await waitFor(() => expect(hook.state().reason).toBe('Collateral approval required.'))
})

test('USDC purchases parse six decimals and require a separate token approval', async () => {
	const collateralToken = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
	const snapshot = capitalSnapshot({ collateralToken, collateral: { address: collateralToken, symbol: 'USDC', decimals: 6 }, walletCollateral: 10_000_000n, collateralAllowance: 0n })
	const { hook, source, requests } = await setup(snapshot)
	source.setRead('purchaseQuote', [1_000n, 0n])
	source.setRead('quoteQuestionMint', 2_000_000n)
	await act(() => hook.state().setMintAmount('2'))
	await waitFor(() => expect(hook.state().quote?.purchaseFeeAttoEth).toBe(1_000n))
	expect(hook.state().requiredCollateral).toBe(2_001_000n)
	expect(hook.state().reason).toBe('Collateral approval required.')
	await act(() => hook.state().approve(2_001_000n))
	expect(requests).toHaveLength(1)
	const approval = requests[0]
	if (approval === undefined) throw new Error('Missing collateral approval')
	expect(approval.to).toBe(collateralToken)
	expect(approval.value).toBe(0n)
	expect(decodeFunctionData({ abi: parseAbi(['function approve(address spender,uint256 amount) returns (bool)']), data: approval.data })).toEqual({ functionName: 'approve', args: [snapshot.services, 2_001_000n] })
	expect(hook.state().reason).toBe('Collateral approval required.')
	await hook.setProps({ snapshot: { ...snapshot, collateralAllowance: 2_001_000n, blockNumber: 11n } })
	await waitFor(() => expect(hook.state().reason).toBeUndefined())
	await act(() => hook.state().buy())
	const purchase = requests[1]
	if (purchase === undefined) throw new Error('Missing collateral purchase')
	expect(purchase.value).toBe(0n)
	expect(decodeFunctionData({ abi, data: purchase.data })).toEqual({ functionName: 'createCompleteSet', args: [0n, 999n, 2_000_000n, owner, 900_000n, 20_000n] })
})

test('raising an existing collateral allowance is one approval that needs no reset', async () => {
	const snapshot = capitalSnapshot({ collateral: { address: token, symbol: 'USDC', decimals: 6 }, walletCollateral: 10_000_000n, collateralAllowance: 5_000_000n })
	const { hook, requests } = await setup(snapshot)
	await act(() => hook.state().approve(10_000_000n))
	expect(requests).toHaveLength(1)
	const increase = requests[0]
	if (increase === undefined) throw new Error('Missing approval')
	expect(increase.validateBeforeSubmit).toBeUndefined()
	expect(decodeFunctionData({ abi: parseAbi(['function approve(address spender,uint256 amount) returns (bool)']), data: increase.data }).args).toEqual([snapshot.services, 10_000_000n])
})

test('recovery-bearing purchases separately approve REP and bind the reviewed contribution budget', async () => {
	const { hook, source, requests } = await setup(capitalSnapshot(), 2n * unit)
	expect(hook.state().maximumRecoveryRep).toBe('2.020000000000000001')
	await act(() => hook.state().setMaximumRecoveryRep('2'))
	source.setRead('allowance', 0n, token)
	await act(() => hook.state().setMintAmount('1.1'))
	await waitFor(() => expect(hook.state().reason).toBe('Recovery REP approval required.'))
	await act(() => hook.state().approveRecoveryRep(2n * unit))
	expect(requests).toHaveLength(1)
	const approval = requests[0]
	if (approval === undefined) throw new Error('Missing recovery approval')
	expect(approval.to).toBe(token)
	expect(decodeFunctionData({ abi: parseAbi(['function approve(address,uint256) returns(bool)']), data: approval.data }).args).toEqual([modules.engine, 2n * unit])
	source.setRead('allowance', 2n * unit, token)
	await act(() => hook.state().setMintAmount('1.2'))
	await waitFor(() => expect(hook.state().reason).toBeUndefined())
	await act(() => hook.state().buy())
	const purchase = requests[1]
	if (purchase === undefined) throw new Error('Missing funded purchase')
	expect(decodeFunctionData({ abi: parseAbi(['function createCompleteSetWithRecoveryRep(uint248,uint256,uint256,address,uint256,uint256,uint256)']), data: purchase.data }).args?.[6]).toBe(2n * unit)
	source.setRead('quoteMintRecoveryRep', 3n * unit)
	await expect(purchase.validateBeforeSubmit?.()).rejects.toThrow('Purchase prerequisites changed')
})

test('a buyer without enough recovery REP sees the contribution and cannot submit', async () => {
	const { hook, source, requests } = await setup(capitalSnapshot(), 2n * unit)
	source.setRead('balanceOf', 0n, token)
	await act(() => {
		hook.state().setMaximumRecoveryRep('2')
		hook.state().setMintAmount('1.1')
	})
	await waitFor(() => expect(hook.state().reason).toBe('Insufficient REP for the proportional recovery contribution.'))
	expect(hook.state().quote?.recoveryAttoRep).toBe(2n * unit)
	await expect(hook.state().buy()).rejects.toThrow('Insufficient REP')
	expect(requests).toHaveLength(0)
})

test('known recovery controls remain applicable through a block refresh and quote error without allowing a stale purchase', async () => {
	const snapshot = capitalSnapshot()
	const { hook, source, requests } = await setup(snapshot, 2n * unit)
	expect(hook.state().recoveryApplicable).toBe(true)
	const pending = createDeferred<bigint>()
	source.setRead('quoteMintRecoveryRep', pending.promise)
	const next = { ...snapshot, blockNumber: 11n, blockHash: `0x${'01'.repeat(32)}` as const }
	source.setSnapshot(next)
	await hook.setProps({ snapshot: next })
	await waitFor(() => expect(hook.state().quoteLoading).toBe(true))
	expect(hook.state().recoveryApplicable).toBe(true)
	expect(hook.state().quote).toBeUndefined()
	await act(() => pending.reject(new Error('Recovery quote temporarily unavailable.')))
	await waitFor(() => expect(hook.state().recoveryError).toContain('Recovery quote temporarily unavailable.'))
	expect(hook.state().recoveryApplicable).toBe(true)
	await expect(hook.state().buy()).rejects.toThrow('Recovery quote temporarily unavailable.')
	expect(requests).toHaveLength(0)
	source.setRead('quoteMintRecoveryRep', 0n)
	source.setRead('questionId', 2n)
	await act(() => hook.state().setQuestionInput('2'))
	expect(hook.state().recoveryApplicable).toBe(false)
	await waitFor(() => expect(hook.state().quote?.recoveryAttoRep).toBe(0n))
	expect(hook.state().recoveryApplicable).toBe(false)
})

test('a positive quote makes recovery controls applicable even when its first funding read fails', async () => {
	const { hook } = await setup(capitalSnapshot(), 2n * unit, zeroAddress)
	expect(hook.state().recoveryApplicable).toBe(true)
	expect(hook.state().quote).toBeUndefined()
	expect(hook.state().recovery).toBeUndefined()
	expect(hook.state().recoveryError).toContain('Recovery REP funding is unavailable.')
})
