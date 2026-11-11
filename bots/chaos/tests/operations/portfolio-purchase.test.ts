import { expect, test } from 'bun:test'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { erc20Abi, securityPoolPortfolioAbi } from '@zoltar/bot-shared/contracts/abi'
import { completeSetDefinition } from '../../src/operations/statoblast/complete-sets.ts'
import { snapshotFixture, planningOptionsFixture } from './fixture.ts'

function fixture() {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	if (pool === undefined) throw new Error('Missing question fixture')
	for (const question of snapshot.questions) question.endTime = '2100000000'
	pool.purchaseQuote = { spender: pool.coordinator, mintAttoEth: 1000n.toString(), feeAttoEth: 300n.toString(), premiumAttoEth: 200n.toString(), minimumShares: '950' }
	const token = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase())
	if (token === undefined) throw new Error('Missing WETH inventory')
	token.allowances[pool.coordinator] = '1300'
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
	expect(decodeFunctionData({ abi: securityPoolPortfolioAbi, data: step.data }).args).toEqual([BigInt(pool.universeId), BigInt(pool.questionId), 1000n, snapshot.wallet.address, 950n, 300n])
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

test('an unapproved purchase prepares one exact collateral approval before spending', () => {
	const { snapshot, pool, options } = fixture()
	const token = snapshot.wallet.tokens.find(token => token.address === snapshot.deployments.weth)
	if (token === undefined) throw new Error('Missing collateral')
	token.allowances[pool.coordinator] = '0'
	const operation = completeSetDefinition('create')
	const plan = operation.buildPlan(snapshot, options)
	if (plan === undefined || operation.buildContinuationPlan === undefined) throw new Error('Missing purchase plan')
	expect(plan.steps.map(step => step.id)).toEqual(['approve-portfolio-collateral', 'createCompleteSet'])
	const approval = plan.steps[0]
	if (approval === undefined) throw new Error('Missing approval')
	expect(decodeFunctionData({ abi: erc20Abi, data: approval.data }).args).toEqual([pool.coordinator, 1300n])
	token.allowances[pool.coordinator] = '1300'
	const context = { previousPlan: { ...plan, planningSeed: options.seed }, confirmedStepIds: ['approve-portfolio-collateral'] }
	expect(operation.buildContinuationPlan(snapshot, options, context)?.steps.map(step => step.id)).toEqual(['createCompleteSet'])
	pool.purchaseQuote = undefined
	expect(operation.buildContinuationPlan(snapshot, options, context)?.continuationDisposition).toBe('cleanup-only')
	const cleanup = operation.buildContinuationPlan(snapshot, options, context)?.steps[0]
	if (cleanup === undefined) throw new Error('Missing approval cleanup')
	expect(decodeFunctionData({ abi: erc20Abi, data: cleanup.data }).args).toEqual([pool.coordinator, 0n])
})
