import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { decodeFunctionData, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { usePortfolioPurchase } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioPurchase.js'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { auctionCapitalSnapshot, capitalSnapshot, owner, capital, token, unit } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const abi = parseAbi(['function createCompleteSet(uint248 universeId,uint256 questionId,uint256 mintAttoEth,address recipient,uint256 minimumShares,uint256 maximumFee) returns(uint256)'])
async function setup(snapshot = capitalSnapshot()) {
	const source = capitalClient(snapshot)
	const values = {
		questionOriginIds: `0x${'11'.repeat(32)}`,
		getPool: capital,
		questionId: 999n,
		questionData: token,
		getQuestionEndDate: 10_000n,
		escalationGame: zeroAddress,
		systemState: 0n,
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
	await waitFor(() => expect(hook.state().quote).toBeDefined())
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

test('USDC purchases parse six decimals and require a separate token approval', async () => {
	const collateralToken = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
	const snapshot = capitalSnapshot({ collateralToken, collateral: { address: collateralToken, symbol: 'USDC', decimals: 6 }, walletCollateral: 10_000_000n, collateralAllowance: 0n })
	const { hook, source, requests } = await setup(snapshot)
	source.setRead('purchaseQuote', [1_000n, 0n])
	source.setRead('quoteQuestionMint', 2_000_000n)
	await act(() => hook.state().setMintAmount('2'))
	await waitFor(() => expect(hook.state().quote?.purchaseFeeAttoEth).toBe(1_000n))
	expect(hook.state().requiredCollateral).toBe(2_020_000n)
	expect(hook.state().reason).toBe('Collateral approval required.')
	await act(() => hook.state().approve(2_020_000n))
	expect(requests).toHaveLength(1)
	const approval = requests[0]
	if (approval === undefined) throw new Error('Missing collateral approval')
	expect(approval.to).toBe(collateralToken)
	expect(approval.value).toBe(0n)
	expect(decodeFunctionData({ abi: parseAbi(['function approve(address spender,uint256 amount) returns (bool)']), data: approval.data })).toEqual({ functionName: 'approve', args: [snapshot.services, 2_020_000n] })
	expect(hook.state().reason).toBe('Collateral approval required.')
	await hook.setProps({ snapshot: { ...snapshot, collateralAllowance: 2_020_000n, blockNumber: 11n } })
	await waitFor(() => expect(hook.state().reason).toBeUndefined())
	await act(() => hook.state().buy())
	const purchase = requests[1]
	if (purchase === undefined) throw new Error('Missing collateral purchase')
	expect(purchase.value).toBe(0n)
	expect(decodeFunctionData({ abi, data: purchase.data })).toEqual({ functionName: 'createCompleteSet', args: [0n, 999n, 2_000_000n, owner, 900_000n, 20_000n] })
})

/** A `USDT`-symbol collateral at `collateralToken` with a 5 USDT allowance, and the requested increase to 10 USDT. */
async function requestUsdtSymbolApprovalIncrease(collateralToken: typeof token) {
	const snapshot = capitalSnapshot({ collateralToken, collateral: { address: collateralToken, symbol: 'USDT', decimals: 6 }, walletCollateral: 10_000_000n, collateralAllowance: 5_000_000n })
	const state = await setup(snapshot)
	state.source.setRead('allowance', 5_000_000n)
	await act(() => state.hook.state().approve(10_000_000n))
	const increase = state.requests[0]
	if (increase === undefined) throw new Error('Missing approval')
	return { ...state, snapshot, increase }
}

test('USDT approvals require a separate reset even when the existing allowance covers the purchase', async () => {
	const { hook, source, requests, snapshot, increase } = await requestUsdtSymbolApprovalIncrease('0xdAC17F958D2ee523a2206206994597C13D831ec7')
	await expect(increase.validateBeforeSubmit?.()).rejects.toThrow('Reset USDT approval first.')
	await act(() => hook.state().approve(0n))
	const reset = requests[1]
	if (reset === undefined) throw new Error('Missing reset')
	await reset.validateBeforeSubmit?.()
	expect(decodeFunctionData({ abi: parseAbi(['function approve(address spender,uint256 amount) returns (bool)']), data: reset.data }).args).toEqual([snapshot.services, 0n])
	source.setRead('allowance', 0n)
	await increase.validateBeforeSubmit?.()
	expect(requests).toHaveLength(2)
})
test('a token that only reports the USDT symbol does not require an allowance reset', async () => {
	const { increase } = await requestUsdtSymbolApprovalIncrease(token)
	await increase.validateBeforeSubmit?.()
})
