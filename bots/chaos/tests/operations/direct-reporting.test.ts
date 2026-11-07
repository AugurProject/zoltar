import { withdrawEscalation } from '../../src/operations/statoblast/reporter-claims.ts'
import { expect, test } from 'bun:test'
import { directEscalationDeposit } from '../../src/operations/statoblast/direct-deposits.ts'
import { escalationGameAbi, securityPoolAbi } from '@zoltar/bot-shared/contracts/abi'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { address, planningOptionsFixture, snapshotFixture } from './fixture.ts'

test('wallet reporting needs no vault registration and preserves approval cleanup on failed revalidation', () => {
	const snapshot = snapshotFixture()
	const options = planningOptionsFixture()
	const pool = snapshot.pools[0]
	if (pool === undefined) throw new Error('Missing question fixture')
	expect(directEscalationDeposit.evaluate(snapshot, options).eligible).toBe(true)
	const draft = directEscalationDeposit.buildPlan(snapshot, options)
	if (draft === undefined) throw new Error('Missing wallet reporting plan')
	const previousPlan = { ...draft, planningSeed: options.seed }
	const approval = draft.steps.find(step => step.id === 'approve-direct-rep')
	if (approval === undefined) throw new Error('Missing exact REP approval')
	const token = snapshot.wallet.tokens.find(candidate => candidate.address === pool.repToken)
	if (token === undefined) throw new Error('Missing REP inventory')
	token.allowances[pool.escalationGame] = String(draft.metadata['acceptedAmountAttoRep'])
	for (const quote of pool.directEscalationDepositQuotes) quote.mutationExpectedSuccess = true
	const context = { previousPlan, confirmedStepIds: [approval.id] }
	const continued = directEscalationDeposit.buildContinuationPlan?.(snapshot, options, context)
	expect(continued?.steps.map(step => step.id)).toEqual(['deposit-wallet-rep'])
	const deposit = continued?.steps[0]
	if (deposit === undefined) throw new Error('Missing wallet deposit')
	expect(deposit.to).toBe(pool.escalationGame)
	expect(decodeFunctionData({ abi: escalationGameAbi, data: deposit.data }).functionName).toBe('depositRepOnOutcome')
	for (const quote of pool.directEscalationDepositQuotes) quote.mutationExpectedSuccess = false
	const cleanup = directEscalationDeposit.buildContinuationPlan?.(snapshot, options, context)
	expect(cleanup?.continuationDisposition).toBe('cleanup-only')
	expect(cleanup?.steps.map(step => step.id)).toEqual(['revoke-direct-rep'])
})

test('resolved wallet reporter claims are available without a vault slot', () => {
	const snapshot = snapshotFixture()
	const options = planningOptionsFixture({ immutableTopologyCapacity: { maxPools: 16, maxUniverses: 16, maxVaultsPerPool: 1, maxStagedOperationsPerPool: 16, maxQuestions: 16, maximumAggregateItems: 100 } })
	const pool = snapshot.pools[0]
	if (pool === undefined) throw new Error('Missing question fixture')
	pool.questionOutcome = 1
	snapshot.escalationDeposits = [{ amountAttoRep: 1000n.toString(), claimed: false, depositIndex: '3', escalationGame: pool.escalationGame, outcome: 1, parentDepositIndex: '3', pool: pool.address, vault: snapshot.wallet.address }]
	expect(withdrawEscalation.evaluate(snapshot, options).eligible).toBe(true)
	const plans = withdrawEscalation.buildLifecyclePlans?.(snapshot, options)
	expect(plans).toHaveLength(1)
	const step = plans?.[0]?.steps[0]
	if (step === undefined) throw new Error('Missing reporter claim')
	expect(step.to).toBe(pool.address)
	const call = decodeFunctionData({ abi: securityPoolAbi, data: step.data })
	expect(call.functionName).toBe('withdrawFromEscalationGame')
	expect(call.args).toEqual([1n, [3n]])
})

for (const blocked of ['foreign depositor', 'already claimed', 'inactive question', 'fork before resolution'] as const) {
	test(`reporter claims reject ${blocked}`, () => {
		const snapshot = snapshotFixture()
		const options = planningOptionsFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Missing question fixture')
		pool.questionOutcome = 1
		const deposit = { amountAttoRep: 1000n.toString(), claimed: false, depositIndex: '3', escalationGame: pool.escalationGame, outcome: 1, parentDepositIndex: '3', pool: pool.address, vault: snapshot.wallet.address }
		snapshot.escalationDeposits = [deposit]
		if (blocked === 'foreign depositor') deposit.vault = address(999)
		if (blocked === 'already claimed') deposit.claimed = true
		if (blocked === 'inactive question') pool.systemState = 1
		if (blocked === 'fork before resolution') {
			const universe = snapshot.universes.find(candidate => candidate.id === pool.universeId)
			if (universe === undefined) throw new Error('Missing universe fixture')
			universe.forkTime = '1'
			pool.escalationGameEndTime = '2'
			pool.escalationHasReachedNonDecision = false
		}
		expect(withdrawEscalation.evaluate(snapshot, options).eligible).toBe(false)
		expect(withdrawEscalation.buildLifecyclePlans?.(snapshot, options)).toEqual([])
	})
}

test('initial question reporting uses wallet REP and cleans up approval if another reporter starts first', async () => {
	const { escalationDeposit } = await import('../../src/operations/statoblast/deposits.ts')
	const snapshot = snapshotFixture()
	const options = planningOptionsFixture()
	const pool = snapshot.pools[0]
	if (pool === undefined) throw new Error('Missing question')
	pool.escalationGame = address(0)
	pool.initialEscalationGameDepositAttoRep = '1000'
	const draft = escalationDeposit.buildPlan(snapshot, options)
	if (draft === undefined) throw new Error('Missing initial reporter plan')
	const step = draft.steps.at(-1)
	if (step === undefined) throw new Error('Missing report step')
	expect(decodeFunctionData({ abi: securityPoolAbi, data: step.data }).functionName).toBe('depositWalletRepToEscalationGame')
	expect(step.walletAssetDebits).toEqual([{ kind: 'erc20', asset: pool.repToken, amount: '1000', category: 'rep' }])
	pool.escalationGame = address(900)
	const cleanup = escalationDeposit.buildContinuationPlan?.(snapshot, options, { previousPlan: { ...draft, planningSeed: options.seed }, confirmedStepIds: ['approve-rep'] })
	expect(cleanup?.continuationDisposition).toBe('cleanup-only')
	expect(cleanup?.steps[0]?.id).toBe('revoke-rep')
})
