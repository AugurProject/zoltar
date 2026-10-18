import { expect, test } from 'bun:test'
import { decodeFunctionData, zeroAddress, zeroHash } from '@zoltar/bot-shared/ethereum'
import { escalationGameAbi, multicall3Abi, securityPoolAbi } from '@zoltar/bot-shared/contracts/abi'
import type { ForkedClaimCheckpointSnapshot } from '../../src/operations/carry-types.ts'
import { claimCheckpointWithdrawalCalls } from '../../src/operations/statoblast/checkpoint-call.ts'
import { canonicalLifecyclePresence } from '../../src/operations/catalog.ts'
import { prepareInheritedClaim } from '../../src/operations/statoblast/carry.ts'
import { decodedTransaction, readableTransaction } from '../../src/operations/transaction-description.ts'
import { address, planningOptionsFixture, snapshotFixture } from './fixture.ts'

test('each claim preparation batch has a canonical progress identity and submits only its bounded checkpoint', () => {
	const snapshot = snapshotFixture()
	const candidate = {
		pool: address(10),
		game: address(11),
		targetGame: address(11),
		preparationReason: 'required' as const,
		settlement: 'unknown' as const,
		sourceGame: address(12),
		claimSourceGame: address(13),
		outcome: 1 as const,
		parentDepositIndex: '5',
		sourceNodeId: '6',
		amountAttoRep: 10n.toString(),
		cumulativeAmountAttoRep: 20n.toString(),
		leafIndex: '1',
		nextSourceGame: address(15),
		pendingSteps: '2',
		pendingCommitment: zeroHash,
		baseCommitment: zeroHash,
		transforms: [],
	}
	snapshot.forkedClaimCheckpoints = [candidate]
	const options = planningOptionsFixture()
	const plan = prepareInheritedClaim.buildPlan(snapshot, options)
	const step = plan?.steps[0]
	if (step === undefined) throw new Error('Missing checkpoint preparation')
	expect(plan?.steps).toHaveLength(1)
	expect(decodeFunctionData({ abi: escalationGameAbi, data: step.data })).toMatchObject({ functionName: 'processClaimCheckpoint', args: [1n, 10n, 20n, 1n, 8n, zeroHash, []] })
	expect(canonicalLifecyclePresence(snapshot, options).find(item => item.definitionId === prepareInheritedClaim.id)?.metadata).toEqual(plan?.metadata)
	candidate.nextSourceGame = zeroAddress
	candidate.pendingSteps = '4'
	expect(prepareInheritedClaim.buildPlan(snapshot, options)?.metadata).not.toEqual(plan?.metadata)
	snapshot.forkedClaimCheckpoints = []
	expect(prepareInheritedClaim.buildPlan(snapshot, options)).toBeUndefined()
})

test('uses verified witnesses for the same preparation method and includes the commitment in progress identity', () => {
	const snapshot = snapshotFixture()
	const options = planningOptionsFixture()
	const candidate = {
		pool: address(10),
		game: address(11),
		targetGame: address(11),
		preparationReason: 'required' as const,
		settlement: 'unknown' as const,
		sourceGame: address(12),
		claimSourceGame: address(13),
		outcome: 1 as const,
		parentDepositIndex: '5',
		sourceNodeId: '6',
		amountAttoRep: 10n.toString(),
		cumulativeAmountAttoRep: 20n.toString(),
		leafIndex: '1',
		nextSourceGame: zeroAddress,
		pendingSteps: '1',
		pendingCommitment: zeroHash,
		baseCommitment: zeroHash,
		transforms: [{ repBeforeAttoRep: 20n.toString(), repRemainingAttoRep: 15n.toString(), consumedBeforeAttoRep: 1n.toString() }],
	}
	snapshot.forkedClaimCheckpoints = [candidate]
	const plan = prepareInheritedClaim.buildPlan(snapshot, options)
	const step = plan?.steps[0]
	if (step === undefined) throw new Error('Missing witness transaction')
	expect(decodeFunctionData({ abi: escalationGameAbi, data: step.data })).toMatchObject({ functionName: 'processClaimCheckpoint', args: [1n, 10n, 20n, 1n, 8n, zeroHash, [{ repBeforeAttoRep: 20n, repRemainingAttoRep: 15n, consumedBeforeAttoRep: 1n }]] })
	candidate.pendingCommitment = `0x${'1'.repeat(64)}`
	expect(prepareInheritedClaim.buildPlan(snapshot, options)?.metadata).not.toEqual(plan?.metadata)
})

test('final preparation calls the game then pool atomically with a committed recipient', () => {
	const snapshot = snapshotFixture()
	const candidate: ForkedClaimCheckpointSnapshot = {
		pool: address(10),
		game: address(11),
		targetGame: address(11),
		preparationReason: 'required',
		settlement: 'unknown',
		sourceGame: address(12),
		claimSourceGame: address(13),
		outcome: 1,
		parentDepositIndex: '5',
		sourceNodeId: '6',
		amountAttoRep: 10n.toString(),
		cumulativeAmountAttoRep: 20n.toString(),
		leafIndex: '1',
		nextSourceGame: zeroAddress,
		pendingSteps: '1',
		pendingCommitment: zeroHash,
		baseCommitment: zeroHash,
		transforms: [{ repBeforeAttoRep: 20n.toString(), repRemainingAttoRep: 15n.toString(), consumedBeforeAttoRep: 1n.toString() }],
		finalWithdrawal: {
			multicall3: address(90),
			resultingCarryRoot: zeroHash,
			resultingNullifierRoot: zeroHash,
			preflightExpectedResult: '0x',
			proof: { depositor: snapshot.wallet.address, amountAttoRep: 10n.toString(), cumulativeAmountAttoRep: 20n.toString(), leafIndex: '1', parentDepositIndex: '5', sourceNodeId: '6', merkleMountainRangePeakIndex: '0', merkleMountainRangeSiblings: [], nullifierSiblings: [] },
		},
	}
	snapshot.forkedClaimCheckpoints = [candidate]
	const plan = prepareInheritedClaim.buildPlan(snapshot, planningOptionsFixture())
	const step = plan?.steps[0]
	if (step === undefined) throw new Error('Missing final checkpoint transaction')
	const calls = claimCheckpointWithdrawalCalls(candidate)
	expect(step.to).toBe(address(90))
	expect(plan?.lastValidBlockNumber).toBe('101')
	expect(decodeFunctionData({ abi: multicall3Abi, data: step.data })).toMatchObject({ functionName: 'aggregate3', args: [calls] })
	expect(decodedTransaction(step)).toMatchObject({ method: 'aggregate3', args: [calls] })
	expect(readableTransaction(step)).toMatchObject({ method: 'aggregate3', to: candidate.finalWithdrawal?.multicall3 })
	expect(calls.map(call => ({ target: call.target, allowFailure: call.allowFailure }))).toEqual([
		{ target: candidate.game, allowFailure: false },
		{ target: candidate.pool, allowFailure: false },
	])
	const checkpointCall = calls[0]
	const withdrawalCall = calls[1]
	if (checkpointCall === undefined || withdrawalCall === undefined) throw new Error('Missing atomic call')
	expect(decodeFunctionData({ abi: escalationGameAbi, data: checkpointCall.callData }).functionName).toBe('processClaimCheckpoint')
	expect(decodeFunctionData({ abi: securityPoolAbi, data: withdrawalCall.callData })).toMatchObject({ functionName: 'withdrawForkedEscalationDeposits', args: [1n, [{ depositor: snapshot.wallet.address }]] })
	expect(step.preflightCalls).toHaveLength(1)
	const finalTransforms = candidate.transforms
	candidate.pendingSteps = '9'
	candidate.transforms = Array.from({ length: 9 }, () => ({ repBeforeAttoRep: 20n.toString(), repRemainingAttoRep: 15n.toString(), consumedBeforeAttoRep: 1n.toString() }))
	expect(() => claimCheckpointWithdrawalCalls(candidate)).toThrow('withdrawal target')
	candidate.pendingSteps = '1'
	candidate.transforms = finalTransforms
	candidate.preparationReason = 'shared-ancestor'
	expect(() => prepareInheritedClaim.buildPlan(snapshot, planningOptionsFixture())).toThrow('withdrawal target')
	candidate.preparationReason = 'required'
	const final = candidate.finalWithdrawal
	if (final === undefined) throw new Error('Missing final withdrawal')
	final.proof.depositor = address(99)
	expect(() => prepareInheritedClaim.buildPlan(snapshot, planningOptionsFixture())).toThrow('recipient')
})
