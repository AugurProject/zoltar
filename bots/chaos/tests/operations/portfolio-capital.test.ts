import { capitalFixture } from '../support/portfolio-fixtures.ts'
import { expect, test } from 'bun:test'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { securityPoolCapitalLedgerAbi } from '@zoltar/bot-shared/contracts/abi'
import { capitalAction, capitalPolicy, depositCapital } from '../../src/operations/statoblast/capital.ts'
import { address, planningOptionsFixture, snapshotFixture } from './fixture.ts'

function fixture() {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	if (pool === undefined) throw new Error('Missing question')
	const capital = capitalFixture(snapshot)
	snapshot.portfolioCapital = [capital]
	return { snapshot, capital, options: planningOptionsFixture() }
}

test('capital deposit targets the shared ledger and preserves the chosen health target', () => {
	const { snapshot, capital, options } = fixture()
	const draft = depositCapital.buildPlan(snapshot, options)
	if (draft === undefined) throw new Error('Missing capital deposit')
	const step = draft.steps.at(-1)
	if (step === undefined) throw new Error('Missing deposit step')
	expect(step.to).toBe(capital.capitalLedger)
	const decoded = decodeFunctionData({ abi: securityPoolCapitalLedgerAbi, data: step.data })
	expect(decoded.functionName).toBe('depositFor')
	expect(decoded.args).toEqual([snapshot.wallet.address, BigInt(String(draft.metadata['amountAttoRep']))])
	expect(step.preflightCalls).toHaveLength(1)
	expect(capital.targetHealthFactorBps).toBe('15000')
})

test('capital continuation keeps the original deposit and revokes its confirmed approval when the universe freezes', () => {
	const { snapshot, capital, options } = fixture()
	const draft = depositCapital.buildPlan(snapshot, options)
	if (draft === undefined) throw new Error('Missing capital deposit')
	const previousPlan = { ...draft, planningSeed: options.seed }
	const token = snapshot.wallet.tokens.find(token => token.address === capital.repToken)
	if (token === undefined) throw new Error('Missing wallet REP')
	token.allowances[capital.capitalLedger] = String(draft.metadata['amountAttoRep'])
	const context = { previousPlan, confirmedStepIds: ['approve-capital-rep'] }
	const continuation = depositCapital.buildContinuationPlan?.(snapshot, { ...options, seed: options.seed + 123 }, context)
	expect(continuation?.steps.map(step => step.id)).toEqual(['deposit-capital'])
	expect(continuation?.steps[0]?.data).toBe(draft.steps.at(-1)?.data)
	capital.frozen = true
	const cleanup = depositCapital.buildContinuationPlan?.(snapshot, options, context)
	expect(cleanup?.continuationDisposition).toBe('cleanup-only')
	expect(cleanup?.steps.map(step => step.id)).toEqual(['revoke-capital-rep'])
})

test('capital continuation cannot redirect an existing approval to another ledger', () => {
	const { snapshot, capital, options } = fixture()
	const draft = depositCapital.buildPlan(snapshot, options)
	if (draft === undefined) throw new Error('Missing capital deposit')
	capital.capitalLedger = address(999)
	const cleanup = depositCapital.buildContinuationPlan?.(snapshot, options, { previousPlan: { ...draft, planningSeed: options.seed }, confirmedStepIds: ['approve-capital-rep'] })
	expect(cleanup?.continuationDisposition).toBe('cleanup-only')
	expect(cleanup?.steps[0]?.to).toBe(capital.repToken)
})

for (const [kind, method, args] of [
	['withdraw', 'withdrawPrincipal', [100n]],
	['claim', 'claimEarnings', []],
	['retire', 'setCommitment', [0n]],
	['serve-retirement', 'serveRetirement', [1n]],
] as const) {
	test(`portfolio ${kind} uses one shared owner position`, () => {
		const { snapshot, capital, options } = fixture()
		const operation = capitalAction(kind)
		const plan = operation.buildPlan(snapshot, options)
		const step = plan?.steps[0]
		if (step === undefined) throw new Error('Missing capital action')
		expect(step.to).toBe(capital.capitalLedger)
		const decoded = decodeFunctionData({ abi: securityPoolCapitalLedgerAbi, data: step.data })
		expect(decoded.functionName).toBe(method)
		expect(decoded.args ?? []).toEqual(kind === 'withdraw' ? [...args, snapshot.wallet.address] : [...args])
		capital.owner = address(998)
		expect(operation.evaluate(snapshot, options).eligible).toBe(false)
	})
}

test('commitment changes respect owner health, protocol minimum, fresh prices and pending retirement', () => {
	const { snapshot, capital, options } = fixture()
	const operation = capitalPolicy('commitment')
	expect(operation.evaluate(snapshot, options).eligible).toBe(true)
	expect(operation.evaluate(snapshot, { ...options, operationInputs: { commitmentAttoEth: 1n.toString() } }).eligible).toBe(false)
	expect(operation.evaluate(snapshot, { ...options, operationInputs: { commitmentAttoEth: 1000000000000000000n.toString() } }).eligible).toBe(false)
	capital.priceValid = false
	expect(operation.evaluate(snapshot, { ...options, operationInputs: { commitmentAttoEth: 2000000000000000n.toString() } }).eligible).toBe(false)
	capital.priceValid = true
	capital.retirementPending = true
	expect(operation.evaluate(snapshot, options).eligible).toBe(false)
	expect(capitalAction('retire').evaluate(snapshot, options).eligible).toBe(false)
})

test('owner can choose a lower voluntary health target without a fresh price', () => {
	const { snapshot, capital, options } = fixture()
	capital.priceValid = false
	const operation = capitalPolicy('health')
	expect(operation.evaluate(snapshot, { ...options, operationInputs: { healthFactorBps: '10000' } }).eligible).toBe(true)
	expect(operation.evaluate(snapshot, { ...options, operationInputs: { healthFactorBps: '20000' } }).eligible).toBe(false)
	expect(() => operation.evaluate(snapshot, { ...options, operationInputs: { healthFactorBps: '9999' } })).toThrow('outside')
})

test('forked capital still permits quoted free-principal withdrawals and earned fees', () => {
	const { snapshot, capital, options } = fixture()
	capital.frozen = true
	capital.forkTime = '100'
	expect(capitalAction('withdraw').evaluate(snapshot, options).eligible).toBe(true)
	expect(capitalAction('claim').evaluate(snapshot, options).eligible).toBe(true)
	expect(depositCapital.evaluate(snapshot, options).eligible).toBe(false)
})

test('underwater owners can reduce commitment at a stale price', () => {
	const { snapshot, capital, options } = fixture()
	capital.priceValid = false
	capital.principalAttoRep = '1'
	expect(capitalPolicy('commitment').evaluate(snapshot, { ...options, operationInputs: { commitmentAttoEth: 500000000000000n.toString() } }).eligible).toBe(true)
})

test('health increases cannot count already released principal as pledged collateral', () => {
	const { snapshot, capital, options } = fixture()
	capital.pledgedAttoRep = '1'
	expect(capitalPolicy('health').evaluate(snapshot, { ...options, operationInputs: { healthFactorBps: '20000' } }).eligible).toBe(false)
})

test('partial retirement must release at least the economic minimum even with stale pricing', () => {
	const { snapshot, capital, options } = fixture()
	capital.commitmentAttoEth = '1000'
	capital.minimumCommitmentAttoEth = '100'
	const operation = capitalPolicy('commitment')
	for (const fresh of [true, false]) {
		capital.priceValid = fresh
		expect(operation.evaluate(snapshot, { ...options, operationInputs: { commitmentAttoEth: 950n.toString() } }).eligible).toBe(false)
		expect(operation.evaluate(snapshot, { ...options, operationInputs: { commitmentAttoEth: 900n.toString() } }).eligible).toBe(true)
	}
})

test('automatic capital deposits can fund the minimum commitment instead of repeatedly depositing dust', () => {
	const { snapshot, capital, options } = fixture()
	capital.principalAttoRep = '0'
	capital.commitmentAttoEth = '0'
	capital.minimumCommitmentAttoEth = (10n ** 15n).toString()
	options.maxRepSpendAttoRep = (10n ** 16n).toString()
	const plan = depositCapital.buildPlan(snapshot, options)
	if (plan === undefined) throw new Error('Missing affordable initial deposit')
	const principal = BigInt(String(plan.metadata['amountAttoRep']))
	expect(principal).toBeGreaterThanOrEqual(10n ** 15n)
	capital.principalAttoRep = principal.toString()
	expect(capitalPolicy('commitment').evaluate(snapshot, options).eligible).toBe(true)
})
