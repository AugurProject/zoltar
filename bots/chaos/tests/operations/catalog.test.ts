import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, encodeAbiParameters } from '@zoltar/bot-shared/ethereum'
import { coordinatorAbi } from '../../src/contracts/abi.ts'
import { validateStepReceiptEvidence } from '../../src/execution/receipt-validation.ts'
import { canonicalLifecyclePresence, CHAOS_OPERATION_CATALOG, eligibleOperationPlans, evaluateOperationCatalog, reevaluateOperationContinuation, urgentOperationPlans } from '../../src/operations/catalog.ts'
import { validForkOutcomeRoutes } from '../../src/operations/fork-outcomes.ts'
import type { OperationEvidence, OperationPlan } from '../../src/operations/types.ts'
import { address, hash, snapshotFixture } from './fixture.ts'

const permissiveOptions = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	maxEthSpendAttoEth: (10n ** 15n).toString(),
	maxRepSpendAttoRep: (10n ** 15n).toString(),
	minimumEthReserveAttoEth: (10n ** 16n).toString(),
	minimumRepReserveAttoRep: (10n ** 18n).toString(),
	seed: 0x1234_5678,
} as const

describe('chaos operation catalog', () => {
	test('has stable unique identifiers and covers every ecosystem', () => {
		const ids = CHAOS_OPERATION_CATALOG.map(operation => operation.id)
		expect(new Set(ids).size).toBe(ids.length)
		expect(ids.length).toBeGreaterThanOrEqual(60)
		expect(new Set(CHAOS_OPERATION_CATALOG.map(operation => operation.ecosystem))).toEqual(new Set(['zoltar', 'statoblast', 'open-oracle', 'trading']))
		for (const definition of CHAOS_OPERATION_CATALOG) {
			expect(definition.discoveryInputs.length).toBeGreaterThan(0)
			expect(definition.description.length).toBeGreaterThan(20)
			if (definition.classification === 'lifecycle-obligation') {
				expect(definition.buildLifecyclePlans, definition.id).toBeFunction()
				expect(definition.enumerateLifecyclePresence, definition.id).toBeFunction()
			}
		}
	})

	test('evaluates anchored candidates into JSON-safe calldata plans', () => {
		const evaluated = evaluateOperationCatalog(snapshotFixture(), permissiveOptions)
		const plans = evaluated.flatMap(operation => (operation.plan === undefined ? [] : [operation.plan]))
		expect(plans.length).toBeGreaterThan(15)
		for (const plan of plans) {
			expect(plan.createdAtBlock).toBe('100')
			expect(plan.steps.length).toBeGreaterThan(0)
			for (const step of plan.steps) {
				expect(step.data.startsWith('0x')).toBe(true)
				expect(step.evidence.length).toBeGreaterThan(0)
				expect(
					step.evidence.some(evidence => evidence.kind !== 'receipt-success'),
					`${plan.definitionId}:${step.id}`,
				).toBe(true)
				for (const debit of step.walletAssetDebits) {
					expect(BigInt(debit.amount)).toBeGreaterThan(0n)
					if (debit.kind === 'native') {
						if (step.value === undefined) throw new Error(`${plan.definitionId}:${step.id} declares native debit without value`)
						expect(debit.amount).toBe(step.value)
					}
				}
			}
		}
		expect(() => JSON.stringify(evaluated)).not.toThrow()
	})

	test('is deterministic for a seed and changes bounded random plans for another seed', () => {
		const snapshot = snapshotFixture()
		const first = eligibleOperationPlans(snapshot, permissiveOptions)
		const repeated = eligibleOperationPlans(snapshot, permissiveOptions)
		const changed = eligibleOperationPlans(snapshot, { ...permissiveOptions, seed: permissiveOptions.seed + 1 })
		expect(repeated).toEqual(first)
		expect(changed).not.toEqual(first)
	})

	test('enumerates every durable report and auction identity independently of selection seed', () => {
		const snapshot = snapshotFixture()
		const report = {
			currentAmount1: '1000',
			currentAmount2: '1000',
			currentReporter: address(31),
			disputeAfterTimestamp: '2',
			disputeBeforeTimestamp: '3',
			disputeDelay: '1',
			escalationHalt: '100000',
			flags: 7,
			game: { callbackContract: address(0), callbackGasLimit: 0, feePercentage: 0, lastReportOppoTime: '1', numReports: 1, protocolFee: 0, protocolFeeRecipient: address(30), settlerReward: '0' },
			helper: { blockNumber: '1', blockTimestamp: '1', creator: snapshot.wallet.address },
			multiplier: 140,
			openOracle: snapshot.deployments.openOracle,
			reportId: '1',
			reportTimestamp: '1',
			settlementTime: '2',
			settlementTimestamp: '0',
			stateHash: hash(41),
			token1: snapshot.deployments.weth,
			token2: snapshot.pools[0]?.repToken ?? address(12),
		}
		snapshot.reports = [report, { ...report, reportId: '2', stateHash: hash(42) }]
		snapshot.auctions = [41, 42].map(index => ({ address: address(index), bids: [], clearingTick: '0', endTime: '1', finalized: false, hasClearingPrice: false, minimumBidAttoEth: 1n.toString(), pendingEthRefund: '1000', pool: snapshot.pools[0]?.address ?? address(11), startTime: '1' }))
		const identities = (seed: number) =>
			urgentOperationPlans(snapshot, { ...permissiveOptions, seed })
				.filter(plan => plan.definitionId === 'open-oracle.settle' || plan.definitionId === 'statoblast.auction.withdraw-refund')
				.map(plan => `${plan.definitionId}:${plan.metadata['reportId'] ?? plan.metadata['auction']}`)
				.sort()
		const expected = ['open-oracle.settle:1', 'open-oracle.settle:2', `statoblast.auction.withdraw-refund:${address(41)}`, `statoblast.auction.withdraw-refund:${address(42)}`].sort()
		expect(identities(1)).toEqual(expected)
		expect(identities(0xffff_fffe)).toEqual(expected)

		const secondReport = urgentOperationPlans(snapshot, { ...permissiveOptions, seed: 1 }).find(plan => plan.definitionId === 'open-oracle.settle' && plan.metadata['reportId'] === '2')
		if (secondReport === undefined) throw new Error('Expected the second report lifecycle instance')
		snapshot.reports = snapshot.reports.filter(candidate => candidate.reportId !== '1')
		expect(reevaluateOperationContinuation(snapshot, secondReport, permissiveOptions).plan?.metadata['reportId']).toBe('2')
	})

	test('enumerates lifecycle candidates with linear indexed work', () => {
		const snapshot = snapshotFixture()
		const base = {
			currentAmount1: '1000',
			currentAmount2: '1000',
			currentReporter: address(31),
			disputeDelay: '1',
			escalationHalt: '100000',
			flags: 7,
			game: { callbackContract: address(0), callbackGasLimit: 0, feePercentage: 0, lastReportOppoTime: '1', numReports: 1, protocolFee: 0, protocolFeeRecipient: address(30), settlerReward: '0' },
			helper: { blockNumber: '1', blockTimestamp: '1', creator: snapshot.wallet.address },
			multiplier: 140,
			openOracle: snapshot.deployments.openOracle,
			reportTimestamp: '1',
			settlementTime: '2',
			settlementTimestamp: '0',
			token1: snapshot.deployments.weth,
			token2: snapshot.pools[0]?.repToken ?? address(12),
		}
		let indexedReads = 0
		const reports = Array.from({ length: 1000 }, (_, index) => ({ ...base, reportId: (index + 1).toString(), stateHash: hash(index + 1) }))
		snapshot.reports = new Proxy(reports, {
			get(target, property, receiver) {
				if (typeof property === 'string' && /^\d+$/.test(property)) indexedReads += 1
				return Reflect.get(target, property, receiver)
			},
		})
		const definition = CHAOS_OPERATION_CATALOG.find(candidate => candidate.id === 'open-oracle.settle')
		if (definition?.buildLifecyclePlans === undefined) throw new Error('Settle enumerator missing')
		const plans = definition.buildLifecyclePlans(snapshot, permissiveOptions)
		expect(plans).toHaveLength(1000)
		expect(indexedReads).toBeLessThanOrEqual(1000)
	})

	test('keeps disputes out of lifecycle presence when policy or funding blocks random work', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		pool.pendingReportId = '42'
		snapshot.reports = [
			{
				currentAmount1: '1000',
				currentAmount2: '1000',
				currentReporter: pool.coordinator,
				disputeDelay: '60',
				escalationHalt: '100000',
				flags: 7,
				game: { callbackContract: pool.coordinator, callbackGasLimit: 500000, feePercentage: 0, lastReportOppoTime: '1', numReports: 1, protocolFee: 0, protocolFeeRecipient: address(30), settlerReward: '0' },
				helper: { blockNumber: '99', blockTimestamp: '1999999500', creator: pool.coordinator },
				multiplier: 140,
				openOracle: snapshot.deployments.openOracle,
				reportId: '42',
				reportTimestamp: '1999999500',
				settlementTime: '2500',
				settlementTimestamp: '0',
				stateHash: hash(42),
				token1: snapshot.deployments.weth,
				token2: pool.repToken,
			},
		]
		for (const token of snapshot.wallet.tokens) token.balance = '0'
		const restrictive = { ...permissiveOptions, allowHighRisk: false, allowIrreversibleOperations: false, maxEthSpendAttoEth: 0n.toString(), maxRepSpendAttoRep: 0n.toString() }
		expect(urgentOperationPlans(snapshot, restrictive).find(plan => plan.definitionId === 'open-oracle.dispute')).toBeUndefined()
		expect(canonicalLifecyclePresence(snapshot, restrictive).some(presence => presence.definitionId === 'open-oracle.dispute')).toBe(false)
	})

	test('excludes untrusted and excessive-callback reports from lifecycle presence', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		pool.pendingReportId = '42'
		const candidate = {
			currentAmount1: '1000',
			currentAmount2: '1000',
			currentReporter: pool.coordinator,
			disputeDelay: '1',
			escalationHalt: '100000',
			flags: 7,
			game: { callbackContract: pool.coordinator, callbackGasLimit: 8_000_001, feePercentage: 0, lastReportOppoTime: '1', numReports: 1, protocolFee: 0, protocolFeeRecipient: address(30), settlerReward: '0' },
			helper: { blockNumber: '1', blockTimestamp: '1', creator: pool.coordinator },
			multiplier: 140,
			openOracle: snapshot.deployments.openOracle,
			reportId: '42',
			reportTimestamp: '1',
			settlementTime: '2',
			settlementTimestamp: '0',
			stateHash: hash(42),
			token1: snapshot.deployments.weth,
			token2: pool.repToken,
		}
		snapshot.reports = [candidate]
		expect(canonicalLifecyclePresence(snapshot, permissiveOptions).some(presence => presence.definitionId.startsWith('open-oracle.'))).toBe(false)
		candidate.game.callbackGasLimit = 8_000_000
		expect(canonicalLifecyclePresence(snapshot, permissiveOptions)).toContainEqual({ definitionId: 'open-oracle.settle', ecosystem: 'open-oracle', metadata: { deadlineBlock: '0', reportId: '42', selfDispute: false, stateHash: hash(42) } })
		candidate.token2 = address(99)
		expect(canonicalLifecyclePresence(snapshot, permissiveOptions).some(presence => presence.definitionId.startsWith('open-oracle.'))).toBe(false)
	})

	test('does not create another signer report while one remains unresolved', () => {
		const snapshot = snapshotFixture()
		const rep = snapshot.universes[0]?.repToken
		if (rep === undefined) throw new Error('REP fixture missing')
		snapshot.reports = [
			{
				currentAmount1: '1000',
				currentAmount2: '1000',
				currentReporter: snapshot.wallet.address,
				disputeDelay: '1',
				escalationHalt: '100000',
				flags: 7,
				game: { callbackContract: address(0), callbackGasLimit: 0, feePercentage: 0, lastReportOppoTime: '1', numReports: 1, protocolFee: 0, protocolFeeRecipient: address(30), settlerReward: '0' },
				helper: { blockNumber: '100', blockTimestamp: '2000000000', creator: snapshot.wallet.address },
				multiplier: 140,
				openOracle: snapshot.deployments.openOracle,
				reportId: '9',
				reportTimestamp: '2000000000',
				settlementTime: '900',
				settlementTimestamp: '0',
				stateHash: hash(9),
				token1: snapshot.deployments.weth,
				token2: rep,
			},
		]
		expect(eligibleOperationPlans(snapshot, permissiveOptions).find(plan => plan.definitionId === 'open-oracle.report')).toBeUndefined()
	})

	test('persists the planning seed and rebuilds a durable workflow with that seed', () => {
		const snapshot = snapshotFixture()
		const plan = eligibleOperationPlans(snapshot, permissiveOptions)[0]
		if (plan === undefined) throw new Error('Expected at least one eligible plan')
		expect(plan.planningSeed).toBe(permissiveOptions.seed)
		const rebuilt = reevaluateOperationContinuation(snapshot, plan, {
			allowHighRisk: permissiveOptions.allowHighRisk,
			allowIrreversibleOperations: permissiveOptions.allowIrreversibleOperations,
			maxEthSpendAttoEth: permissiveOptions.maxEthSpendAttoEth,
			maxRepSpendAttoRep: permissiveOptions.maxRepSpendAttoRep,
			minimumEthReserveAttoEth: permissiveOptions.minimumEthReserveAttoEth,
			minimumRepReserveAttoRep: permissiveOptions.minimumRepReserveAttoRep,
		})
		expect(rebuilt.plan).toEqual(plan)
	})

	test('continues the exact selectable instance after candidate removal and prerequisite confirmation', () => {
		const snapshot = snapshotFixture()
		const universe = snapshot.universes[0]
		const firstQuestion = snapshot.questions[0]
		const rep = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === universe?.repToken.toLowerCase())
		if (universe === undefined || firstQuestion === undefined || rep === undefined) throw new Error('Zoltar fork fixture missing')
		universe.forkThresholdAttoRep = '1000'
		snapshot.questions.push({ ...firstQuestion, id: '78' })
		const options = { ...permissiveOptions, maxRepSpendAttoRep: 1_000_000n.toString() }
		let plan: OperationPlan | undefined
		for (let block = 100; block < 132; block += 1) {
			snapshot.anchor = { ...snapshot.anchor, blockHash: hash(block), blockNumber: block.toString() }
			const candidate = eligibleOperationPlans(snapshot, options).find(value => value.definitionId === 'zoltar.universe.fork' && value.metadata['questionId'] === '78')
			if (candidate !== undefined) {
				plan = candidate
				break
			}
		}
		if (plan === undefined) throw new Error('Could not select the second fork candidate')
		expect(plan.steps).toHaveLength(2)
		snapshot.questions = snapshot.questions.filter(question => question.id !== firstQuestion.id)
		rep.allowances[snapshot.deployments.zoltar] = universe.forkThresholdAttoRep
		const continuationBlock = Number(BigInt(snapshot.anchor.blockNumber) + 100n)
		snapshot.anchor = { blockHash: hash(continuationBlock), blockNumber: continuationBlock.toString(), timestamp: (BigInt(snapshot.anchor.timestamp) + 1n).toString() }
		const rebuilt = reevaluateOperationContinuation(snapshot, plan, {
			allowHighRisk: options.allowHighRisk,
			allowIrreversibleOperations: options.allowIrreversibleOperations,
			maxEthSpendAttoEth: options.maxEthSpendAttoEth,
			maxRepSpendAttoRep: options.maxRepSpendAttoRep,
			minimumEthReserveAttoEth: options.minimumEthReserveAttoEth,
			minimumRepReserveAttoRep: options.minimumRepReserveAttoRep,
		})
		expect(rebuilt.plan?.metadata).toEqual(plan.metadata)
		expect(rebuilt.plan?.steps).toHaveLength(1)
		expect(rebuilt.plan?.createdAtBlock).toBe(continuationBlock.toString())
	})

	test('gates high-risk and irreversible definitions independently', () => {
		const evaluated = evaluateOperationCatalog(snapshotFixture(), { seed: 1 })
		expect(evaluated.find(operation => operation.definition.id === 'open-oracle.report')?.eligibility.blockers).toContain('High-risk operations are disabled')
		expect(evaluated.find(operation => operation.definition.id === 'zoltar.universe.fork')?.eligibility.blockers).toContain('Irreversible operations are disabled')
	})

	test('requires decoded success=true for staged execution', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Fixture pool missing')
		snapshot.stagedOperations.push({
			amount: '1000',
			coordinator: pool.coordinator,
			executionExpectedResult: '0x',
			executionExpectedSuccess: true,
			id: '42',
			isPendingSettlement: false,
			liquidationApprovalId: hash(0),
			liquidationMinimumReceiverHealthFactorBps: '0',
			liquidationMinPriceDistanceBps: '0',
			operation: 1,
			operator: snapshot.wallet.address,
			queuedAt: '1999999000',
			receiverVault: snapshot.wallet.address,
			reservedLiquidationDebtAttoEth: 0n.toString(),
			snapshotTargetBackingUnits: '1000000000000000000',
			snapshotTargetCapacityOwnershipAttoRep: (10n ** 18n).toString(),
			snapshotTargetDisputeStakedAttoRep: 0n.toString(),
			snapshotTargetOpenInterestAttoEth: 0n.toString(),
			snapshotTotalPoolHeldAttoRep: (10n ** 18n).toString(),
			snapshotTotalRepBackingUnits: '1000000000000000000',
			targetVault: snapshot.wallet.address,
			validForSeconds: '3600',
		})
		const plan = urgentOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'statoblast.staged.execute')
		expect(plan).toBeDefined()
		const evidence = plan?.steps[0]?.evidence.find((candidate): candidate is Extract<OperationEvidence, { kind: 'decoded-event-field' }> => candidate.kind === 'decoded-event-field')
		if (evidence === undefined) throw new Error('Expected decoded staged-operation evidence')
		expect(evidence).toEqual({
			abi: 'event ExecutedStagedOperation(uint256 indexed operationId, uint8 operation, bool success, string errorMessage)',
			emitter: pool.coordinator,
			equals: true,
			field: 'success',
			indexed: { operationId: '42' },
			kind: 'decoded-event-field',
			signature: 'ExecutedStagedOperation(uint256,uint8,bool,string)',
			topic0: evidence.topic0,
		})
		const staged = snapshot.stagedOperations[0]
		if (staged === undefined) throw new Error('Staged operation fixture missing')
		staged.executionExpectedSuccess = false
		expect(urgentOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'statoblast.staged.execute')).toBeUndefined()
		staged.queuedAt = '1'
		staged.validForSeconds = '1'
		const expiry = urgentOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'statoblast.staged.expire')
		expect(expiry).toBeDefined()
		expect(expiry?.deadlineTimestamp).toBeUndefined()
	})

	test('rejects a queued withdrawal whose configured REP cap rounds to zero backing units', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		const vault = pool?.vaults.find(candidate => candidate.address === snapshot.wallet.address)
		if (pool === undefined || vault === undefined) throw new Error('Pool vault fixture missing')
		pool.totalRepBackingUnits = '1'
		pool.poolRepBalanceAttoRep = '1000'
		pool.settlementCollateralAttoEth = '0'
		pool.totalBadDebtAttoEth = '0'
		vault.repBackingUnits = '1'
		vault.repBackingAttoRep = '1000'
		vault.disputeStakedAttoRep = '0'
		const plan = eligibleOperationPlans(snapshot, { ...permissiveOptions, maxRepSpendAttoRep: 1n.toString() }).find(candidate => candidate.definitionId === 'statoblast.staged.queue')
		expect(plan).toBeUndefined()
	})

	test('binds OpenOracle credit withdrawal to a decrement-capable private next block', () => {
		const snapshot = snapshotFixture()
		const token = snapshot.wallet.tokens[0]
		if (token === undefined) throw new Error('Fixture token missing')
		token.openOracleCredit = '1001'
		const plan = eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.withdraw')
		const evidence = plan?.steps[0]?.evidence[0]
		expect(evidence?.kind).toBe('storage-postcondition')
		if (evidence?.kind !== 'storage-postcondition') throw new Error('Expected storage postcondition')
		expect(evidence.abi).toContain('tokenHolder')
		expect(evidence.args).toEqual([snapshot.wallet.address, token.address])
		expect(evidence.expected).toBe('1')
		expect(evidence.relation).toBe('at-least')
		expect(plan?.lastValidBlockNumber).toBe('101')
		expect(plan?.steps[0]?.evidence).toContainEqual(expect.objectContaining({ emitter: token.address, equals: '1000', field: 'value', indexed: { from: snapshot.deployments.openOracle, to: snapshot.wallet.address }, kind: 'decoded-event-field', signature: 'Transfer(address,address,uint256)' }))
		expect(plan?.steps[0]?.preflightCalls).toEqual([
			expect.objectContaining({
				caller: snapshot.wallet.address,
				expectedResult: encodeAbiParameters([{ type: 'uint256' }], [1000n]),
				label: 'Prove the fixed OpenOracle withdrawal still debits its full amount',
			}),
		])
		const step = plan?.steps[0]
		if (step === undefined) throw new Error('Withdrawal step missing')
		expect(() => validateStepReceiptEvidence(step, { blockHash: hash(101), blockNumber: 101n, logs: [], status: 'success', transactionHash: hash(102) }, { storage: [{ after: '1', before: '1', evidence }] })).toThrow('Transfer(address,address,uint256)')
	})

	test('excludes native deposits, withdrawals, and pushes while retaining WETH and REP deposits', () => {
		const snapshot = snapshotFixture()
		for (const token of snapshot.wallet.tokens) {
			token.balance = '0'
			token.openOracleCredit = '1'
		}
		expect(BigInt(snapshot.wallet.ethBalanceAttoEth)).toBeGreaterThan(BigInt(permissiveOptions.minimumEthReserveAttoEth))
		expect(eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.deposit')).toBeUndefined()

		const weth = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase())
		const repAddress = snapshot.universes[0]?.repToken
		const rep = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === repAddress?.toLowerCase())
		if (weth === undefined || rep === undefined) throw new Error('WETH/REP inventory missing')
		weth.balance = '1000000000000000000'
		const wethDeposit = eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.deposit')
		expect(wethDeposit?.metadata['token']).toBe(snapshot.deployments.weth)
		expect(wethDeposit?.steps.at(-1)?.value).toBeUndefined()

		weth.balance = '0'
		rep.balance = '10000000000000000000'
		const repDeposit = eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.deposit')
		expect(repDeposit?.metadata['token']).toBe(rep.address)
		expect(repDeposit?.steps.at(-1)?.value).toBeUndefined()

		snapshot.wallet.openOracleEthCredit = '1001'
		const withdrawal = eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.withdraw')
		expect(withdrawal).toBeUndefined()
		const nativePush = eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.push-or-credit')
		expect(nativePush).toBeUndefined()

		snapshot.wallet.openOracleEthCredit = '1'
		weth.openOracleCredit = '1001'
		const push = eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.push-or-credit')
		expect(push?.metadata).toMatchObject({ amount: '1000', token: snapshot.deployments.weth })
		expect(push?.steps[0]?.evidence[0]).toMatchObject({ functionName: 'tokenHolder', relation: 'at-least' })
		expect(push?.steps[0]?.evidence).toContainEqual(expect.objectContaining({ emitter: snapshot.deployments.weth, equals: '1000', field: 'value', indexed: { from: snapshot.deployments.openOracle, to: snapshot.wallet.address }, kind: 'decoded-event-field' }))
	})

	test('uses terminal evidence for both winning and losing escalation withdrawals', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Fixture pool missing')
		pool.questionOutcome = 1
		const deposit = {
			amountAttoRep: 1_000n.toString(),
			claimed: false,
			depositIndex: '2',
			escalationGame: pool.escalationGame,
			outcome: 2,
			parentDepositIndex: '2',
			pool: pool.address,
			vault: snapshot.wallet.address,
		}
		snapshot.escalationDeposits = [deposit]
		const losing = urgentOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'statoblast.escalation.withdraw')
		expect(losing?.steps[0]?.evidence[0]).toMatchObject({ signature: 'CarryDepositConsumed(uint256,uint256,address,uint8,uint256,uint8,uint256,bytes32,bytes32)' })

		deposit.outcome = 1
		const winning = urgentOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'statoblast.escalation.withdraw')
		expect(winning?.steps[0]?.evidence[0]).toMatchObject({ signature: 'ClaimDeposit(address,uint8,uint256,uint256,uint256,uint256,bool)' })
	})

	test('builds one private next-block carry proof per lifecycle plan with exact Invalid-outcome evidence', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		const candidate = {
			amountAttoRep: 10n.toString(),
			amountToWithdrawAttoRep: 12n.toString(),
			burnAmountAttoRep: 3n.toString(),
			depositor: snapshot.wallet.address,
			game: pool.escalationGame,
			outcome: 0 as const,
			parentDepositIndex: '7',
			pool: pool.address,
			preflightExpectedResult: '0x' as const,
			proof: {
				amountAttoRep: 10n.toString(),
				cumulativeAmountAttoRep: 10n.toString(),
				depositor: snapshot.wallet.address,
				leafIndex: '0',
				merkleMountainRangePeakIndex: '0',
				merkleMountainRangeSiblings: [],
				nullifierSiblings: Array.from({ length: 64 }, () => hash(0)),
				parentDepositIndex: '7',
				sourceNodeId: '9',
			},
			resultingCarryRoot: hash(80),
			resultingNullifierRoot: hash(81),
			resultingUnresolvedTotalAttoRep: 90n.toString(),
			snapshotId: hash(82),
			sourceGame: address(83),
			sourceNodeId: '9',
			sourcePool: address(84),
		}
		snapshot.forkedCarryWithdrawals = [candidate, { ...candidate, outcome: 2, parentDepositIndex: '8', proof: { ...candidate.proof, parentDepositIndex: '8' } }]
		const plans = urgentOperationPlans(snapshot, permissiveOptions).filter(plan => plan.definitionId === 'statoblast.escalation.withdraw-forked')
		expect(plans).toHaveLength(2)
		const invalid = plans.find(plan => plan.metadata['outcome'] === 0)
		expect(invalid?.lastValidBlockNumber).toBe('101')
		expect(invalid?.metadata).toEqual({ game: pool.escalationGame, outcome: 0, parentDepositIndex: '7', pool: pool.address, sourceGame: address(83), sourceNodeId: '9' })
		expect(invalid?.steps).toHaveLength(1)
		expect(invalid?.steps[0]?.data.startsWith('0xcd8e4401')).toBeTrue()
		expect(invalid?.steps[0]?.preflightCalls).toHaveLength(1)
		expect(invalid?.steps[0]?.evidence).toContainEqual(expect.objectContaining({ equals: 0, field: 'reason', indexed: { depositor: snapshot.wallet.address, parentDepositIndex: '7', sourceNodeId: '9' } }))
		expect(invalid?.steps[0]?.evidence).toContainEqual(expect.objectContaining({ equals: '90', field: 'resultingUnresolvedTotalAttoRep' }))
		expect(invalid?.steps[0]?.evidence).toContainEqual(expect.objectContaining({ equals: true, field: 'transferredRep', indexed: { depositor: snapshot.wallet.address, outcome: '0', parentDepositIndex: '7' } }))
		expect(invalid?.steps[0]?.evidence).toContainEqual(expect.objectContaining({ equals: '12', field: 'amountToWithdrawAttoRep' }))
		expect(invalid?.steps[0]?.evidence).toContainEqual(expect.objectContaining({ equals: '3', field: 'burnAmountAttoRep' }))
		const presence = canonicalLifecyclePresence(snapshot, { ...permissiveOptions, maxEthSpendAttoEth: 0n.toString(), maxRepSpendAttoRep: 0n.toString() }).filter(entry => entry.definitionId === 'statoblast.escalation.withdraw-forked')
		expect(presence.map(entry => entry.metadata['parentDepositIndex'])).toEqual(['7', '8'])
	})

	test('bounds escalation lifecycle batches and advances their durable identity', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Fixture pool missing')
		pool.questionOutcome = 1
		snapshot.escalationDeposits = Array.from({ length: 20 }, (_, index) => ({
			amountAttoRep: 1_000n.toString(),
			claimed: false,
			depositIndex: index.toString(),
			escalationGame: pool.escalationGame,
			outcome: 1,
			parentDepositIndex: index.toString(),
			pool: pool.address,
			vault: snapshot.wallet.address,
		}))
		const first = urgentOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'statoblast.escalation.withdraw')
		expect(first?.metadata['depositCount']).toBe(16)
		expect(first?.metadata['depositIndexes']).toBe(Array.from({ length: 16 }, (_, index) => index.toString()).join(','))
		for (const deposit of snapshot.escalationDeposits.slice(0, 16)) deposit.claimed = true
		const second = urgentOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'statoblast.escalation.withdraw')
		expect(second?.metadata).toMatchObject({ depositCount: 4, depositIndexes: '16,17,18,19' })
	})

	test('bounds settlement batches and gives every losing auction refund an immutable singleton identity', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Fixture pool missing')
		const auctionAddress = address(40)
		pool.truthAuction = auctionAddress
		snapshot.auctions = [
			{
				address: auctionAddress,
				bids: Array.from({ length: 20 }, (_, index) => ({ amountAttoEth: 1_000n.toString(), index: index.toString(), refunded: false, tick: index.toString() })),
				clearingTick: '100',
				endTime: '1999999000',
				finalized: true,
				hasClearingPrice: true,
				minimumBidAttoEth: 1n.toString(),
				pendingEthRefund: '0',
				pool: pool.address,
				startTime: '1999990000',
			},
		]
		let plans = urgentOperationPlans(snapshot, permissiveOptions)
		expect(plans.find(candidate => candidate.definitionId === 'statoblast.auction.settle-bids')?.metadata['bidCount']).toBe(16)
		expect(plans.find(candidate => candidate.definitionId === 'statoblast.auction.claim')).toBeUndefined()
		const auction = snapshot.auctions[0]
		if (auction === undefined) throw new Error('Auction fixture missing')
		auction.finalized = false
		plans = urgentOperationPlans(snapshot, permissiveOptions)
		const refunds = plans.filter(candidate => candidate.definitionId === 'statoblast.auction.refund')
		expect(refunds).toHaveLength(20)
		expect(refunds.map(plan => `${plan.metadata['tick']}:${plan.metadata['bidIndex']}`)).toEqual(Array.from({ length: 20 }, (_, index) => `${index.toString()}:${index.toString()}`))
		expect(refunds.every(plan => plan.steps[0]?.id === `refund-losing-bid-${plan.metadata['tick']}-${plan.metadata['bidIndex']}`)).toBe(true)
	})

	test('keeps repeatable OpenOracle withdrawal selectable as internal credit advances', () => {
		const snapshot = snapshotFixture()
		const token = snapshot.wallet.tokens[0]
		if (token === undefined) throw new Error('Fixture token missing')
		token.openOracleCredit = '2000000000000000001'
		const first = eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.withdraw')
		token.openOracleCredit = '1000000000000000001'
		const second = eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.withdraw')
		expect(first?.metadata['amount']).toBe(second?.metadata['amount'])
		expect(first?.metadata['creditBefore']).not.toBe(second?.metadata['creditBefore'])
		expect(first?.obligation).toBe(false)
		expect(canonicalLifecyclePresence(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.withdraw')).toBeUndefined()
	})

	test('tracks share migration progress and does not replay a completed child route', () => {
		const snapshot = snapshotFixture()
		const universe = snapshot.universes[0]
		const pool = snapshot.pools[0]
		const shares = snapshot.wallet.shares[0]
		if (universe === undefined || pool === undefined || shares === undefined) throw new Error('Fork migration fixture is incomplete')
		universe.forkTime = '1999999000'
		universe.forkQuestionId = '77'
		pool.systemState = 1
		shares.migrationProgressByRoute['0:0'] = '0'
		const first = eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'trading.shares.migrate')
		expect(first?.metadata).toMatchObject({ fromId: '0', targetOutcome: '0' })
		expect(first?.steps[0]?.walletAssetDebits).toEqual([{ amount: shares.invalid, asset: shares.shareToken, category: 'outcome-share', kind: 'erc1155', tokenId: '0' }])

		shares.migrationProgressByRoute['0:0'] = shares.invalid
		const repeated = eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'trading.shares.migrate')
		expect(repeated).toBeUndefined()
	})

	test('constructs well-formed categorical/scalar children and keeps empty indexed REP split progress ineligible', () => {
		const snapshot = snapshotFixture()
		const universe = snapshot.universes[0]
		const question = snapshot.questions[0]
		if (universe === undefined || question === undefined) throw new Error('Fork fixture is incomplete')
		universe.forkTime = '1999999000'
		universe.forkQuestionId = question.id
		question.kind = 'categorical'
		question.outcomeLabels = ['Alpha', 'Beta', 'Gamma']
		let evaluated = evaluateOperationCatalog(snapshot, permissiveOptions)
		expect(evaluated.find(operation => operation.definition.id === 'zoltar.child.deploy')?.eligibility.eligible).toBe(true)
		question.kind = 'scalar'
		question.numTicks = '100'
		question.outcomeLabels = []
		evaluated = evaluateOperationCatalog(snapshot, permissiveOptions)
		const scalarPlan = evaluated.find(operation => operation.definition.id === 'zoltar.child.deploy')?.plan
		expect(scalarPlan).toBeDefined()
		expect(BigInt(String(scalarPlan?.metadata['outcomeIndex'])) === 0n || BigInt(String(scalarPlan?.metadata['outcomeIndex'])) >> 255n === 1n).toBe(true)
		expect(evaluated.find(operation => operation.definition.id === 'zoltar.migration.split')).toMatchObject({ definition: { classification: 'selectable', risk: 'irreversible' }, eligibility: { eligible: false } })

		const knownScalarOutcome = (1n << 255n) | (37n << 120n) | 63n
		universe.knownChildOutcomes = [knownScalarOutcome.toString()]
		expect(validForkOutcomeRoutes(question, universe.knownChildOutcomes)).toContain(knownScalarOutcome.toString())
	})

	test('rejects complete-set redemptions whose anchored conversion rounds to zero ETH', () => {
		const snapshot = snapshotFixture()
		const shares = snapshot.wallet.shares[0]
		if (shares === undefined) throw new Error('Share fixture missing')
		shares.invalid = '1'
		shares.yes = '1'
		shares.no = '1'
		const plans = eligibleOperationPlans(snapshot, permissiveOptions)
		expect(plans.find(candidate => candidate.definitionId === 'statoblast.complete-set.redeem')).toBeUndefined()
		expect(plans.find(candidate => candidate.definitionId === 'trading.complete-set.redeem')).toBeUndefined()
		expect(plans.find(candidate => candidate.definitionId === 'trading.position.exit')).toBeUndefined()
	})

	test('constructs a policy-bounded random non-self OpenOracle dispute without lifecycle presence', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		pool.pendingReportId = '42'
		snapshot.reports.push({
			currentAmount1: '1000',
			currentAmount2: '1000',
			currentReporter: pool.coordinator,
			disputeAfterTimestamp: '1999999560',
			disputeBeforeTimestamp: '2000000400',
			disputeDelay: '60',
			escalationHalt: '100000',
			flags: 7,
			game: { callbackContract: pool.coordinator, callbackGasLimit: 500000, feePercentage: 0, lastReportOppoTime: '1', numReports: 1, protocolFee: 0, protocolFeeRecipient: address(30), settlerReward: '0' },
			helper: { blockNumber: '99', blockTimestamp: '1999999500', creator: pool.coordinator },
			multiplier: 140,
			openOracle: snapshot.deployments.openOracle,
			reportId: '42',
			reportTimestamp: '1999999500',
			settlementTime: '2500',
			settlementTimestamp: '0',
			stateHash: hash(42),
			token1: snapshot.deployments.weth,
			token2: pool.repToken,
		})
		const definition = CHAOS_OPERATION_CATALOG.find(candidate => candidate.id === 'open-oracle.dispute')
		expect(definition?.classification).toBe('selectable')
		expect(definition?.buildLifecyclePlans).toBeUndefined()
		expect(definition?.enumerateLifecyclePresence).toBeUndefined()
		const plan = eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.dispute')
		expect(plan?.metadata).toMatchObject({ reportId: '42', selfDispute: false, stateHash: hash(42) })
		expect(plan).toMatchObject({ classification: 'selectable', obligation: false, priority: 'random' })
		expect(urgentOperationPlans(snapshot, permissiveOptions).some(candidate => candidate.definitionId === 'open-oracle.dispute')).toBe(false)
		expect(canonicalLifecyclePresence(snapshot, permissiveOptions).some(presence => presence.definitionId === 'open-oracle.dispute')).toBe(false)
		expect(
			plan?.steps
				.at(-1)
				?.walletAssetDebits.map(debit => (debit.kind === 'erc20' ? debit.category : debit.kind))
				.sort(),
		).toEqual(['rep', 'weth'])

		const indexed = snapshot.reports[0]
		if (indexed === undefined) throw new Error('Indexed report fixture missing')
		const repInventory = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === pool.repToken.toLowerCase())
		const wethInventory = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase())
		if (repInventory === undefined || wethInventory === undefined) throw new Error('Funding inventory missing')
		repInventory.openOracleCredit = '1000000'
		wethInventory.openOracleCredit = '1000000'
		repInventory.balance = '0'
		wethInventory.balance = '0'
		expect(eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.dispute')).toBeUndefined()
		const repReserve = 10n ** 18n
		repInventory.openOracleCredit = (repReserve + 1n).toString()
		expect(eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.dispute')).toBeUndefined()
		repInventory.openOracleCredit = (repReserve - 1_000n).toString()
		repInventory.balance = '1001000'
		expect(eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.dispute')).toBeDefined()
		repInventory.openOracleCredit = (repReserve + 1_000_000n).toString()
		repInventory.balance = '0'
		const internalPlan = eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.dispute')
		const internalDebits = internalPlan?.steps.at(-1)?.walletAssetDebits
		expect(internalDebits?.map(debit => (debit.kind === 'open-oracle-credit' ? debit.category : debit.kind)).sort()).toEqual(['rep', 'weth'])
		expect(internalDebits?.every(debit => debit.kind === 'open-oracle-credit' && BigInt(debit.amount) > 0n)).toBe(true)
		indexed.escalationHalt = '1000'
		repInventory.openOracleCredit = '1'
		const zeroRepDebitPlan = eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.dispute')
		expect(zeroRepDebitPlan).toBeDefined()
		expect(zeroRepDebitPlan?.steps.at(-1)?.walletAssetDebits.some(debit => debit.kind !== 'native' && debit.category === 'rep')).toBe(false)
		indexed.escalationHalt = '100000'

		indexed.token1 = address(0)
		snapshot.wallet.openOracleEthCredit = '1'
		repInventory.openOracleCredit = '1'
		repInventory.balance = '10000000000000000000'
		const nativePlan = eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.dispute')
		expect(nativePlan).toBeUndefined()

		indexed.token1 = snapshot.deployments.weth
		repInventory.openOracleCredit = '1'
		wethInventory.openOracleCredit = '1'
		repInventory.balance = '10000000000000000000'
		wethInventory.balance = '1000000000000000000'
		indexed.flags = 6
		indexed.reportTimestamp = '95'
		indexed.disputeDelay = '2'
		indexed.settlementTime = '120'
		const blockClockPlan = eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.dispute')
		expect(blockClockPlan?.deadlineTimestamp).toBeUndefined()
		expect(blockClockPlan?.lastValidBlockNumber).toBe('214')
		expect(blockClockPlan?.metadata).toMatchObject({ deadlineBlock: '214', reportId: '42' })

		indexed.settlementTime = '90'
		expect(eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.dispute')).toBeUndefined()
		for (const token of snapshot.wallet.tokens) token.allowances[snapshot.deployments.openOracle] = '1000000000000000000000000'
		expect(eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.dispute')).toBeDefined()
	})

	test('buffers oracle requests and constrains them to private next-block inclusion', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		pool.oraclePriceValid = false
		const plan = eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'statoblast.oracle.request-price')
		if (plan === undefined) throw new Error('Buffered request-price plan missing')
		const request = plan.steps.at(-1)
		if (request === undefined) throw new Error('Request-price step missing')
		const decoded = decodeFunctionData({ abi: coordinatorAbi, data: request.data })
		expect(plan.lastValidBlockNumber).toBe('101')
		expect(request.value).toBe('2000')
		expect(decoded.functionName).toBe('requestPrice')
		expect(decoded.args[1]).toBe(2000n)
		expect(request.walletAssetDebits.find(debit => debit.kind === 'erc20' && debit.category === 'weth')?.amount).toBe('2000')
		expect(request.walletAssetDebits.find(debit => debit.kind === 'erc20' && debit.category === 'rep')?.amount).toBe('2000')
		expect(eligibleOperationPlans(snapshot, { ...permissiveOptions, maxEthSpendAttoEth: 3_000n.toString() }).find(candidate => candidate.definitionId === 'statoblast.oracle.request-price')).toBeUndefined()
	})

	test('excludes already-initialized dust and reserve-synchronized pairs', () => {
		const snapshot = snapshotFixture()
		expect(eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'open-oracle.dust')).toBeUndefined()
		expect(eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'trading.pair.sync')).toBeUndefined()
		const pair = snapshot.pairs[0]
		if (pair === undefined) throw new Error('Pair fixture missing')
		pair.effectiveYesReserve = (BigInt(pair.yesReserve) + 1n).toString()
		expect(eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'trading.pair.sync')).toBeDefined()
	})

	test('admits safe share migration directly from an operational forked pool and rejects an unsafe origin deployment threshold', () => {
		const snapshot = snapshotFixture()
		const universe = snapshot.universes[0]
		const pool = snapshot.pools[0]
		const shares = snapshot.wallet.shares[0]
		if (universe === undefined || pool === undefined || shares === undefined) throw new Error('Fork fixture missing')
		universe.forkTime = '1999999000'
		universe.forkQuestionId = '77'
		pool.systemState = 0
		shares.migrationProgressByRoute['0:0'] = '0'
		expect(eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'trading.shares.migrate')).toBeDefined()

		universe.forkTime = '0'
		universe.nonDecisionThresholdAttoRep = universe.initialEscalationDepositAttoRep
		expect(eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'statoblast.pool.deploy')).toBeUndefined()
	})

	test('requires live pair economics and lifecycle predicates before direct/router transactions', () => {
		const snapshot = snapshotFixture()
		const pair = snapshot.pairs[0]
		const question = snapshot.questions[0]
		if (pair === undefined || question === undefined) throw new Error('Trading fixture missing')
		pair.effectiveYesReserve = '1000000000000000000000000000000'
		pair.effectiveNoReserve = '1'
		const skewed = eligibleOperationPlans(snapshot, permissiveOptions)
		expect(skewed.find(candidate => candidate.definitionId === 'trading.liquidity.add-shares')).toBeUndefined()
		expect(skewed.find(candidate => candidate.definitionId === 'trading.liquidity.add-eth')).toBeUndefined()

		pair.status = 6
		pair.totalSupply = '0'
		pair.effectiveYesReserve = '0'
		pair.effectiveNoReserve = '0'
		question.endTime = snapshot.anchor.timestamp
		expect(eligibleOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'trading.pair.initialize-shares')).toBeUndefined()
	})

	test('binds open trading calls to the question horizon including approval finality', () => {
		const snapshot = snapshotFixture()
		const question = snapshot.questions[0]
		const shares = snapshot.wallet.shares[0]
		const pool = snapshot.pools[0]
		if (question === undefined || shares === undefined || pool === undefined) throw new Error('Trading fixture missing')
		shares.yes = '1000000000000000000000'
		shares.no = '1000000000000000000000'
		pool.projectedSettlementCollateralAttoEth = '1000000000000000000000'
		question.endTime = (BigInt(snapshot.anchor.timestamp) + 2_000n).toString()
		let plans = eligibleOperationPlans(snapshot, permissiveOptions)
		for (const definitionId of ['trading.liquidity.add-shares', 'trading.swap.exact-input', 'trading.position.exit']) {
			const plan = plans.find(candidate => candidate.definitionId === definitionId)
			expect(plan, definitionId).toBeDefined()
			expect(BigInt(plan?.deadlineTimestamp ?? '0')).toBeLessThan(BigInt(question.endTime))
		}

		question.endTime = (BigInt(snapshot.anchor.timestamp) + 900n).toString()
		plans = eligibleOperationPlans(snapshot, permissiveOptions)
		expect(plans.find(candidate => candidate.definitionId === 'trading.swap.exact-input')).toBeUndefined()
		expect(plans.find(candidate => candidate.definitionId === 'trading.position.exit')).toBeUndefined()

		shares.isApprovedForAll[snapshot.pairs[0]?.address ?? address(14)] = true
		shares.isApprovedForAll[snapshot.deployments.tradingRouter] = true
		plans = eligibleOperationPlans(snapshot, permissiveOptions)
		expect(plans.find(candidate => candidate.definitionId === 'trading.swap.exact-input')).toBeDefined()
		expect(plans.find(candidate => candidate.definitionId === 'trading.position.exit')).toBeDefined()
	})

	test('marks deadline-bound pool fork continuation as urgent lifecycle work', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		const universe = snapshot.universes[0]
		if (pool === undefined || universe === undefined) throw new Error('Fork fixture missing')
		pool.systemState = 1
		pool.forkActivationTime = '1999999000'
		universe.forkTime = '1999999000'
		universe.forkQuestionId = pool.questionId
		const plan = urgentOperationPlans(snapshot, permissiveOptions).find(candidate => candidate.definitionId === 'statoblast.fork.create-child')
		expect(plan?.priority).toBe('urgent')
		expect(plan?.deadlineTimestamp).toBe('2004837400')
	})
})
