import { describe, expect, test } from 'bun:test'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { erc1155Abi, twoWayConstantProductPairAbi, twoWayConstantProductRouterAbi } from '@zoltar/bot-shared/contracts/abi'
import { eligibleOperationPlans } from '../support/operation-plans.ts'
import { planningOptionsFixture, snapshotFixture } from './fixture.ts'

const options = planningOptionsFixture()

function openTradingSnapshot() {
	const snapshot = snapshotFixture()
	const question = snapshot.questions[0]
	const shares = snapshot.wallet.shares[0]
	if (question === undefined || shares === undefined) throw new Error('Trading fixture is incomplete')
	question.endTime = (BigInt(snapshot.anchor.timestamp) + 10_000n).toString()
	const pool = snapshot.pools[0]
	if (pool === undefined) throw new Error('Trading pool fixture is missing')
	pool.escalationGame = '0x0000000000000000000000000000000000000000'
	pool.currentMintingCapacityAttoEth = (2n * 10n ** 18n).toString()
	pool.purchaseQuote = { spender: pool.coordinator, mintAttoEth: 1000000000000n.toString(), feeAttoEth: 30000000000n.toString(), premiumAttoEth: 20000000000n.toString(), minimumShares: '1000000000000' }
	pool.shareTokenSupplyAttoShares = '1000000000000000000'
	shares.isApprovedForAll = Object.fromEntries(Object.keys(shares.isApprovedForAll).map(operator => [operator, true]))
	const lp = snapshot.wallet.lpTokens[0]
	if (lp !== undefined) lp.allowanceToRouter = lp.balance
	return snapshot
}

function planData(definitionId: string, snapshot = openTradingSnapshot()) {
	const plan = eligibleOperationPlans(snapshot, options).find(candidate => candidate.definitionId === definitionId)
	if (plan === undefined) throw new Error(`Missing eligible plan ${definitionId}`)
	const step = plan.steps.at(-1)
	if (step === undefined) throw new Error(`Missing transaction step ${definitionId}`)
	return step.data
}

function positive(value: unknown, label: string) {
	if (typeof value !== 'bigint') throw new Error(`${label} is not a bigint`)
	expect(value, label).toBeGreaterThan(0n)
}

describe('trading economic bounds', () => {
	test('uses nonzero anchored limits for direct pair mutations', () => {
		const add = decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: planData('trading.liquidity.add-shares') })
		const remove = decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: planData('trading.liquidity.remove') })
		const exactInput = decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: planData('trading.swap.exact-input') })
		const exactOutput = decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: planData('trading.swap.exact-output') })
		positive(add.args[2], 'direct add minimum liquidity')
		positive(remove.args[1], 'direct remove minimum YES')
		positive(remove.args[2], 'direct remove minimum NO')
		positive(exactInput.args[2], 'direct exact-input minimum output')
		positive(exactOutput.args[2], 'direct exact-output maximum input')
	})

	test('uses nonzero anchored limits for router mutations', () => {
		const add = decodeFunctionData({ abi: twoWayConstantProductRouterAbi, data: planData('trading.liquidity.add-eth') })
		const enter = decodeFunctionData({ abi: twoWayConstantProductRouterAbi, data: planData('trading.position.enter') })
		const exit = decodeFunctionData({ abi: erc1155Abi, data: planData('trading.position.exit') })
		const redeem = decodeFunctionData({ abi: erc1155Abi, data: planData('trading.complete-set.redeem') })
		positive(add.args[2], 'router add maximum YES')
		positive(add.args[3], 'router add maximum NO')
		positive(add.args[4], 'router add minimum liquidity')
		positive(enter.args[3], 'router enter minimum long shares')
		expect(exit.args[4]).not.toBe('0x')
		expect(redeem.args[4]).not.toBe('0x')
	})

	test('uses nonzero anchored limits for initialization', () => {
		const directSnapshot = openTradingSnapshot()
		const directPair = directSnapshot.pairs[0]
		if (directPair === undefined) throw new Error('Trading pair fixture is missing')
		directPair.status = 6
		directPair.totalSupply = '0'
		directPair.effectiveYesReserve = '0'
		directPair.effectiveNoReserve = '0'
		const direct = decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: planData('trading.pair.initialize-shares', directSnapshot) })
		const router = decodeFunctionData({ abi: twoWayConstantProductRouterAbi, data: planData('trading.pair.initialize-eth', directSnapshot) })
		positive(direct.args[2], 'direct initialization minimum liquidity')
		positive(router.args[3], 'router initialization maximum YES deposit')
		positive(router.args[4], 'router initialization maximum NO deposit')
		positive(router.args[5], 'router initialization minimum YES deposit')
		positive(router.args[6], 'router initialization minimum NO deposit')
		positive(router.args[7], 'router initialization minimum liquidity')
	})
})

// One side may round to zero: the pair permits any nonzero aggregate payout.
test.each([
	['1', '1000', 0n, 9n],
	['1000', '1', 9n, 0n],
] as const)('dust LP can exit reserves %s/%s', (yesReserve, noReserve, minYes, minNo) => {
	const snapshot = openTradingSnapshot()
	const pair = snapshot.pairs[0]
	if (pair === undefined) throw new Error('Missing pair fixture')
	Object.assign(pair, { totalSupply: '1000', walletLiquidity: '10', effectiveYesReserve: yesReserve, effectiveNoReserve: noReserve })
	const remove = decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: planData('trading.liquidity.remove', snapshot) })
	expect(remove.args.slice(0, 3)).toEqual([10n, minYes, minNo])
})

test('dust LP stays unavailable when both outputs round to zero', () => {
	const snapshot = openTradingSnapshot()
	const pair = snapshot.pairs[0]
	if (pair === undefined) throw new Error('Missing pair fixture')
	Object.assign(pair, { totalSupply: '1000', walletLiquidity: '10', effectiveYesReserve: '1', effectiveNoReserve: '1' })
	expect(eligibleOperationPlans(snapshot, options).some(plan => plan.definitionId === 'trading.liquidity.remove')).toBe(false)
})
