import { expect, test } from 'bun:test'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { CHAOS_OPERATION_CATALOG, evaluateOperationCatalog, reevaluateOperationContinuation } from '../../src/operations/catalog.ts'
import { operationInputCoverage } from '../../src/operations/input-coverage.ts'
import { inputFieldValue, operationInputSchema, resolveOperationInputs } from '../../src/operations/input-schema.ts'
import { restoreOperationPlanningInputs, type ManualInput, type ManualInputs } from '../../src/operations/manual-inputs.ts'
import { decodedTransaction, readableTransaction } from '../../src/operations/transaction-description.ts'
import { erc20Abi, openOracleAbi } from '../../src/contracts/abi.ts'
import { createDurableWorkflow, durableWorkflowPlan } from '../../src/runtime/workflows.ts'
import { initialDurableState, loadDurableState, saveDurableState } from '../../src/state/operator-state.ts'
import { displayOperationInput, serializeOperationInput } from '../../src/dashboard/operation-input-format.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { address, snapshotFixture } from './fixture.ts'

const options = {
	seed: 123,
	maximumBlockIntervalSeconds: 15,
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	maxEthSpendAttoEth: 1000000000000000n.toString(),
	maxRepSpendAttoRep: 1000000000000000n.toString(),
	minimumEthReserveAttoEth: 10000000000000000n.toString(),
	minimumRepReserveAttoRep: 1000000000000000000n.toString(),
	immutableTopologyCapacity: { maxPools: 100, maxQuestions: 100, maxStagedOperationsPerPool: 100, maxUniverses: 100, maxVaultsPerPool: 100, maximumAggregateItems: 10000 },
}

function editableSnapshot() {
	const snapshot = snapshotFixture()
	const question = snapshot.questions[0]
	const pool = snapshot.pools[0]
	if (question === undefined || pool === undefined) throw new Error('Missing fixture')
	question.endTime = (BigInt(snapshot.anchor.timestamp) + 10000n).toString()
	pool.shareTokenSupplyAttoShares = '1000000000000000000'
	for (const token of snapshot.wallet.tokens) token.openOracleCredit = '1000000000000000000'
	return snapshot
}

function build(id: string, values: Record<string, string>, snapshot = editableSnapshot()) {
	const inputs: ManualInputs = Object.fromEntries(Object.entries(values).map(([key, value]): [string, ManualInput] => [key, { source: 'custom', value }]))
	const operationInputs = resolveOperationInputs(id, inputs, snapshot)
	const evaluated = evaluateOperationCatalog(snapshot, { ...options, operationInputs }, id)[0]
	if (evaluated?.plan === undefined) throw new Error(`${id}: ${evaluated?.eligibility.blockers.join(', ')}`)
	return evaluated.plan
}

function transaction(plan: ReturnType<typeof build>) {
	const step = plan.steps.at(-1)
	if (step === undefined) throw new Error('Missing transaction')
	const transaction = decodedTransaction(step)
	if (transaction === undefined) throw new Error('Missing decoded transaction')
	return transaction
}

test('transaction descriptions skip unknown selectors but surface invalid transaction data', () => {
	const step = build('open-oracle.weth.wrap', {}).steps.at(-1)
	if (step === undefined) throw new Error('Missing transaction')
	expect(decodedTransaction({ ...step, data: '0xdeadbeef' })).toBeUndefined()
	expect(readableTransaction({ ...step, data: '0xdeadbeef' }).method).toBe('Deployment')
	expect(() => decodedTransaction({ ...step, data: '0xzz' })).toThrow()
	expect(() => readableTransaction({ ...step, data: '0xzz' })).toThrow()
})

test('all catalog entries expose coverage and every supported field resolves from an eligible plan', () => {
	const baseline = editableSnapshot()
	const initializing = editableSnapshot()
	const pair = initializing.pairs[0]
	if (pair === undefined) throw new Error('Missing pair')
	Object.assign(pair, { status: 6, totalSupply: '0', effectiveYesReserve: '0', effectiveNoReserve: '0' })
	const deploying = editableSnapshot()
	deploying.pairs = []
	const forked = editableSnapshot()
	const universe = forked.universes[0]
	if (universe === undefined) throw new Error('Missing universe')
	universe.forkTime = '1999999999'
	const winning = editableSnapshot()
	const pool = winning.pools[0]
	if (pool === undefined) throw new Error('Missing pool')
	pool.questionOutcome = 1
	baseline.auctions.push({ address: address(90), pool: pool.address, startTime: '1999999999', endTime: '2000001000', finalized: false, minimumBidAttoEth: 100n.toString(), hasClearingPrice: false, clearingTick: '0', underfunded: false, underfundedWinningAttoEth: 0n.toString(), pendingEthRefund: '0', bids: [] })
	const covered = new Set<string>()
	for (const snapshot of [baseline, initializing, deploying, forked, winning])
		for (const definition of CHAOS_OPERATION_CATALOG) {
			expect(operationInputCoverage(definition).length, definition.id).toBeGreaterThan(0)
			const evaluated = evaluateOperationCatalog(snapshot, options, definition.id)[0]
			if (evaluated?.plan === undefined) continue
			for (const field of operationInputSchema(definition.id)) {
				covered.add(definition.id)
				const value = inputFieldValue(field, evaluated.plan)
				if (field.kind !== 'text') expect(value, `${definition.id}:${field.key}`).not.toBe('')
				const custom = build(definition.id, { [field.key]: value }, snapshot)
				expect(inputFieldValue(field, custom), `${definition.id}:${field.key}`).toBe(value)
			}
		}
	expect([...covered].sort()).toEqual(
		CHAOS_OPERATION_CATALOG.filter(definition => operationInputSchema(definition.id).length > 0)
			.map(definition => definition.id)
			.sort(),
	)
})

test('decimal amount controls preserve single base units and large integers exactly', () => {
	for (const value of ['0', '1', '999999999999999999', '1000000000000000000', ((1n << 256n) - 1n).toString()]) expect(serializeOperationInput('amount', displayOperationInput('amount', value))).toBe(value)
	for (const value of ['-1', '1e2', 'NaN', '0.0000000000000000001']) expect(() => serializeOperationInput('amount', value)).toThrow()
	expect(serializeOperationInput('list', 'One\nTwo')).toBe('["One","Two"]')
})

test('exact principal changes ETH value, approvals, debits, and decoded token arguments', () => {
	for (const id of ['open-oracle.weth.wrap', 'statoblast.complete-set.create', 'trading.liquidity.add-eth', 'trading.position.enter']) expect(transaction(build(id, { amount: '10000' })).value, id).toBe('10000')
	for (const id of ['open-oracle.weth.unwrap', 'open-oracle.withdraw', 'open-oracle.withdraw-to', 'open-oracle.push-or-credit', 'zoltar.rep.burn', 'statoblast.complete-set.redeem']) {
		const plan = build(id, { amount: '10000' })
		const field = operationInputSchema(id).find(field => field.key === 'amount')
		if (field === undefined) throw new Error('Missing amount')
		expect(inputFieldValue(field, plan), id).toBe('10000')
	}
	const deposit = build('open-oracle.deposit', { token: address(7), amount: '12345' })
	const approval = deposit.steps.find(step => step.label.includes('Approve'))
	if (approval === undefined) throw new Error('Missing approval')
	expect(decodeFunctionData({ abi: erc20Abi, data: approval.data }).args[1]).toBe(12345n)
	expect(transaction(deposit).args[1]).toBe(12345n)
	expect(deposit.steps.at(-1)?.walletAssetDebits).toContainEqual(expect.objectContaining({ amount: '12345' }))
	const report = build('open-oracle.report', { amount1: '23456', amount2: '34567' })
	expect(report.metadata).toMatchObject({ amount1: '23456', amount2: '34567' })
	expect(transaction(report).args[0]).toMatchObject({ currentAmount1: 23456n, currentAmount2: 34567n })
})

test('recipient affects calldata, simulation, and transfer evidence', () => {
	const plan = build('open-oracle.withdraw-to', { amount: '23456', recipient: address(99) })
	const step = plan.steps.at(-1)
	expect(transaction(plan).args[2]).toBe(address(99))
	expect(step?.evidence).toContainEqual(expect.objectContaining({ indexed: { from: editableSnapshot().deployments.openOracle, to: address(99) } }))
	const preflight = step?.preflightCalls?.[0]
	if (preflight === undefined) throw new Error('Missing recipient preflight')
	expect(decodeFunctionData({ abi: openOracleAbi, data: preflight.data }).args[2]).toBe(address(99))
	expect(() => build('open-oracle.withdraw-to', { recipient: address(0) })).toThrow('recipient')
})

test('question text, timing, labels, and scalar bounds are encoded before computing identity', () => {
	for (const kind of ['binary', 'categorical', 'scalar']) {
		const custom: Record<string, string> = { title: 'Custom question', description: '', startTime: '2000001000', endTime: '2000002000' }
		if (kind === 'scalar') Object.assign(custom, { answerUnit: 'degrees', numTicks: '40', displayValueMin: '-10', displayValueMax: '30' })
		else custom['labels'] = kind === 'binary' ? '["Cold","Hot"]' : '["Cold","Warm","Hot"]'
		const plan = build(`zoltar.question.create-${kind}`, custom)
		expect(transaction(plan).args[0]).toMatchObject({ title: 'Custom question', description: '', startTime: 2000001000n, endTime: 2000002000n })
		if (kind === 'scalar') expect(transaction(plan).args[0]).toMatchObject({ answerUnit: 'degrees', numTicks: 40n, displayValueMin: -10n, displayValueMax: 30n })
		else {
			const labels = transaction(plan).args[1]
			if (!Array.isArray(labels)) throw new Error('Missing labels')
			expect(new Set(labels)).toEqual(new Set(kind === 'binary' ? ['Cold', 'Hot'] : ['Cold', 'Warm', 'Hot']))
		}
	}
	expect(() => build('zoltar.question.create-scalar', { displayValueMin: '200', displayValueMax: '100' })).toThrow('maximum')
	expect(() => build('zoltar.question.create-binary', { startTime: '200', endTime: '100' })).toThrow('end time')
	expect(() => build('zoltar.question.create-binary', { labels: '["Same","Same"]' })).toThrow('distinct')
})

test('trading controls affect amounts, direction, quote bounds, and deadlines', () => {
	const input = build('trading.swap.exact-input', { direction: 'YES-to-NO', amount: '10000', minimumOutput: '9000' })
	expect(transaction(input).args.slice(0, 3)).toEqual([true, 10000n, 9000n])
	const output = build('trading.swap.exact-output', { direction: 'NO-to-YES', outputAmount: '10000', maximumInput: '11000' })
	expect(transaction(output).args.slice(0, 3)).toEqual([false, 10000n, 11000n])
	const liquidity = build('trading.liquidity.add-shares', { amount: '10000', minimumLiquidity: '9000' })
	expect(transaction(liquidity).args.slice(0, 3)).toEqual([10000n, 10000n, 9000n])
	const removal = build('trading.liquidity.remove', { amount: '10000', minimumYes: '8000', minimumNo: '9000' })
	expect(transaction(removal).args.slice(0, 3)).toEqual([10000n, 8000n, 9000n])
	const enter = build('trading.position.enter', { amount: '10000', longOutcome: '2', minimumOutput: '15000', deadline: '2000000190' })
	expect(transaction(enter).args.slice(1, 3)).toEqual([2n, 15000n])
	expect(transaction(enter).args[4]).toBe(2000000190n)
	for (const deadline of ['1999999999', '2000010001']) expect(() => build('trading.position.enter', { deadline })).toThrow()
	expect(() => build('trading.swap.exact-input', { amount: '10000', minimumOutput: '100000' })).toThrow()
	expect(() => build('open-oracle.weth.wrap', { amount: '1000000000000001' })).toThrow()
	expect(() => build('trading.swap.exact-input', { pair: address(999) })).toThrow('available')
})

test('stored inputs and sources survive disk reload and approval continuation under tighter policy', async () => {
	const original = build('open-oracle.deposit', { token: address(7), amount: '12345' })
	original.operationInputs = { token: address(7), amount: '12345', maxEthSpendAttoEth: 20000n.toString() }
	original.inputSources = { token: 'custom', amount: 'custom', maxEthSpendAttoEth: 'chaosbot' }
	const workflow = createDurableWorkflow(original)
	const state = initialDurableState(1)
	state.workflows.push(workflow)
	const directory = await mkdtemp(join(tmpdir(), 'chaos-inputs-'))
	try {
		const path = join(directory, 'state.json')
		await saveDurableState(path, state)
		const loaded = await loadDurableState(path, 1)
		const stored = loaded.workflows[0]
		if (stored === undefined) throw new Error('Missing stored workflow')
		const restored = durableWorkflowPlan(stored)
		expect(restored.operationInputs).toEqual(original.operationInputs)
		expect(restored.inputSources).toEqual(original.inputSources)
		const continued = reevaluateOperationContinuation(editableSnapshot(), restored, options)
		expect(continued.plan?.steps.at(-1)?.data).toBe(original.steps.at(-1)?.data)
		expect(continued.plan?.operationInputs).toEqual(original.operationInputs)
		expect(restoreOperationPlanningInputs({ ...options, maxEthSpendAttoEth: 10000n.toString() }, restored.operationInputs).maxEthSpendAttoEth).toBe('10000')
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
