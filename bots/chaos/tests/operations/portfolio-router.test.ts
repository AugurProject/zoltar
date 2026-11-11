import { expect, test } from 'bun:test'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { twoWayConstantProductRouterAbi } from '@zoltar/bot-shared/contracts/abi'
import { routerEthDefinition } from '../../src/operations/trading/router-eth.ts'
import { snapshotFixture, planningOptionsFixture, address } from './fixture.ts'

for (const kind of ['create-and-initialize', 'initialize', 'add', 'enter'] as const) {
	test(`portfolio router ${kind} separates minted cash from the full fee-inclusive budget`, () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		const pair = snapshot.pairs[0]
		const question = snapshot.questions[0]
		if (pool === undefined || pair === undefined || question === undefined) throw new Error('Missing fixture')
		question.endTime = '2100000000'
		pool.escalationGame = address(0)
		pool.purchaseQuote = { spender: pool.coordinator, mintAttoEth: 1000000n.toString(), feeAttoEth: 100000n.toString(), premiumAttoEth: 200000n.toString(), minimumShares: '1000000' }
		pool.projectedSettlementCollateralAttoEth = pool.shareTokenSupplyAttoShares
		if (kind === 'create-and-initialize') snapshot.pairs = []
		if (kind === 'initialize') {
			pair.status = 6
			pair.totalSupply = '0'
			pair.effectiveYesReserve = '0'
			pair.effectiveNoReserve = '0'
		}
		const options = planningOptionsFixture({ maxEthSpendAttoEth: 1300000n.toString() })
		const operation = routerEthDefinition(kind)
		const step = operation.buildPlan(snapshot, options)?.steps[0]
		if (step === undefined) throw new Error('Missing router purchase')
		const decoded = decodeFunctionData({ abi: twoWayConstantProductRouterAbi, data: step.data })
		expect(decoded.args[1]).toBe(1000000n)
		expect(step.value).toBe('1300000')
		expect(step.walletAssetDebits).toEqual([{ amount: '1300000', asset: 'ETH', kind: 'native' }])
		expect(operation.buildPlan(snapshot, { ...options, maxEthSpendAttoEth: 1299999n.toString() })).toBeUndefined()
		pool.purchaseQuote = undefined
		expect(operation.evaluate(snapshot, options).eligible).toBe(false)
	})
}
