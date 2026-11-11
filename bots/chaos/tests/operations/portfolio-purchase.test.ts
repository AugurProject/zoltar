import { expect, test } from 'bun:test'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { securityPoolPortfolioAbi } from '@zoltar/bot-shared/contracts/abi'
import { completeSetDefinition } from '../../src/operations/statoblast/complete-sets.ts'
import { snapshotFixture, planningOptionsFixture } from './fixture.ts'

function fixture() {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	if (pool === undefined) throw new Error('Missing question fixture')
	for (const question of snapshot.questions) question.endTime = '2100000000'
	pool.purchaseQuote = { mintAttoEth: 1000n.toString(), feeAttoEth: 100n.toString(), premiumAttoEth: 200n.toString(), minimumShares: '950' }
	return { snapshot, pool, options: planningOptionsFixture({ maxEthSpendAttoEth: 1300n.toString() }) }
}

test('complete set purchase pays fee and premium through the portfolio and protects the share quote', () => {
	const { snapshot, pool, options } = fixture()
	const plan = completeSetDefinition('create').buildPlan(snapshot, options)
	const step = plan?.steps[0]
	if (step === undefined) throw new Error('Missing portfolio purchase')
	expect(step.to).toBe(pool.portfolio)
	expect(step.value).toBe('0')
	expect(step.walletAssetDebits).toEqual([{ amount: '1300', asset: snapshot.deployments.weth, kind: 'erc20', category: 'weth' }])
	expect(decodeFunctionData({ abi: securityPoolPortfolioAbi, data: step.data }).args).toEqual([BigInt(pool.universeId), BigInt(pool.questionId), 1000n, snapshot.wallet.address, 950n, 100n])
})

test('purchase never spends fees outside the configured wallet budget', () => {
	const { snapshot, pool, options } = fixture()
	const operation = completeSetDefinition('create')
	expect(operation.evaluate(snapshot, { ...options, maxEthSpendAttoEth: 1299n.toString() }).eligible).toBe(false)
	expect(operation.buildPlan(snapshot, { ...options, maxEthSpendAttoEth: 1299n.toString() })).toBeUndefined()
	expect(operation.buildPlan(snapshot, { ...options, operationInputs: { amount: '999' } })).toBeUndefined()
	pool.purchaseQuote = undefined
	expect(operation.evaluate(snapshot, options).eligible).toBe(false)
	expect(operation.buildPlan(snapshot, options)).toBeUndefined()
})
