import { describe, expect, test } from 'bun:test'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { tradingPairAbi, tradingRouterAbi } from '../../src/contracts/abi.ts'
import { eligibleOperationPlans } from '../../src/operations/catalog.ts'
import { snapshotFixture } from './fixture.ts'

const options = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	maxEthSpendAttoEth: (10n ** 15n).toString(),
	maxRepSpendAttoRep: (10n ** 15n).toString(),
	minimumEthReserveAttoEth: (10n ** 16n).toString(),
	minimumRepReserveAttoRep: (10n ** 18n).toString(),
	seed: 0x1234_5678,
} as const

function openTradingSnapshot() {
	const snapshot = snapshotFixture()
	const question = snapshot.questions[0]
	const shares = snapshot.wallet.shares[0]
	if (question === undefined || shares === undefined) throw new Error('Trading fixture is incomplete')
	question.endTime = (BigInt(snapshot.anchor.timestamp) + 10_000n).toString()
	const pool = snapshot.pools[0]
	if (pool === undefined) throw new Error('Trading pool fixture is missing')
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
		const add = decodeFunctionData({ abi: tradingPairAbi, data: planData('trading.liquidity.add-shares') })
		const remove = decodeFunctionData({ abi: tradingPairAbi, data: planData('trading.liquidity.remove-shares') })
		const exactInput = decodeFunctionData({ abi: tradingPairAbi, data: planData('trading.swap.exact-input') })
		const exactOutput = decodeFunctionData({ abi: tradingPairAbi, data: planData('trading.swap.exact-output') })
		positive(add.args[2], 'direct add minimum liquidity')
		positive(remove.args[1], 'direct remove minimum YES')
		positive(remove.args[2], 'direct remove minimum NO')
		positive(exactInput.args[2], 'direct exact-input minimum output')
		positive(exactOutput.args[2], 'direct exact-output maximum input')
	})

	test('uses nonzero anchored limits for router mutations', () => {
		const add = decodeFunctionData({ abi: tradingRouterAbi, data: planData('trading.liquidity.add-eth') })
		const enter = decodeFunctionData({ abi: tradingRouterAbi, data: planData('trading.position.enter') })
		const exit = decodeFunctionData({ abi: tradingRouterAbi, data: planData('trading.position.exit') })
		const redeem = decodeFunctionData({ abi: tradingRouterAbi, data: planData('trading.complete-set.redeem') })
		const remove = decodeFunctionData({ abi: tradingRouterAbi, data: planData('trading.liquidity.remove') })
		positive(add.args[1], 'router add minimum liquidity')
		positive(enter.args[2], 'router enter minimum long shares')
		positive(exit.args[4], 'router exit minimum ETH')
		positive(redeem.args[2], 'router redeem minimum ETH')
		positive(remove.args[2], 'router remove minimum YES')
		positive(remove.args[3], 'router remove minimum NO')
	})

	test('uses nonzero anchored limits for initialization', () => {
		const directSnapshot = openTradingSnapshot()
		const directPair = directSnapshot.pairs[0]
		if (directPair === undefined) throw new Error('Trading pair fixture is missing')
		directPair.status = 6
		directPair.totalSupply = '0'
		directPair.effectiveYesReserve = '0'
		directPair.effectiveNoReserve = '0'
		const direct = decodeFunctionData({ abi: tradingPairAbi, data: planData('trading.pair.initialize-shares', directSnapshot) })
		const router = decodeFunctionData({ abi: tradingRouterAbi, data: planData('trading.pair.initialize-eth', directSnapshot) })
		positive(direct.args[2], 'direct initialization minimum liquidity')
		positive(router.args[2], 'router initialization minimum liquidity')
	})
})
