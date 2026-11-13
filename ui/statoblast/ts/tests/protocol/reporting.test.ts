/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { concatHex, decodeFunctionData, encodeAbiParameters, getAddress, keccak256, parseAbiParameters, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { approveReportingRep, loadReportingDetails, reportOutcomeInSecurityPool, withdrawEscalationFromSecurityPool } from '@zoltar/ui-statoblast-shared/protocol/reporting.js'
import { buildForkCarriedEscalationProofs, withdrawForkedEscalationDeposits } from '@zoltar/ui-statoblast-shared/protocol/reportingCarryState.js'
import { statoblast_SecurityPool_SecurityPool } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import type { TransactionRequestPreview } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import type { EscalationSide } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { asWriteClient, createBlockWithTimestamp, createMockWriteClient, createMulticallStub, createReadContractStub, getContractFunctionName, mockTransactionHash } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'

const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000a1')
const vaultAddress = getAddress('0x00000000000000000000000000000000000000c1')
const alternateSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000a2')
const escalationGameAddress = getAddress('0x00000000000000000000000000000000000000e6')
const zoltarAddress = getAddress('0x00000000000000000000000000000000000000e7')
const repTokenAddress = getAddress('0x00000000000000000000000000000000000000e8')
const missingForkContinuationGetterMessage = 'The contract function "forkContinuation" returned no data ("0x"). The contract does not have the function "forkContinuation".'
const carryLeafAbi = parseAbiParameters('address depositor, uint8 outcome, uint256 amountAttoRep, uint256 parentDepositIndex, uint256 cumulativeAmountAttoRep, uint256 sourceNodeId')

function hashCarryLeafForTest(depositor: Address, outcome: bigint, amountAttoRep: bigint, parentDepositIndex: bigint, cumulativeAmountAttoRep: bigint, sourceNodeId: bigint) {
	return keccak256(encodeAbiParameters(carryLeafAbi, [depositor, outcome, amountAttoRep, parentDepositIndex, cumulativeAmountAttoRep, sourceNodeId]))
}

function hashCarryParentForTest(left: Hex, right: Hex) {
	return keccak256(concatHex([left, right]))
}

function computeEmptyNullifierRootForTest() {
	let currentHash = ('0x' + '00'.repeat(32)) as Hex
	for (let depth = 0; depth < 64; depth += 1) currentHash = hashCarryParentForTest(currentHash, currentHash)
	return currentHash
}

function computeSingleConsumedNullifierRootForTest(parentDepositIndex: bigint) {
	let path = BigInt.asUintN(64, BigInt(keccak256(encodeAbiParameters(parseAbiParameters('uint256 parentDepositIndex'), [parentDepositIndex]))))
	let currentHash = ('0x' + '00'.repeat(31) + '01') as Hex
	let zeroHash = ('0x' + '00'.repeat(32)) as Hex
	for (let depth = 0; depth < 64; depth += 1) {
		currentHash = (path & 1n) === 0n ? hashCarryParentForTest(currentHash, zeroHash) : hashCarryParentForTest(zeroHash, currentHash)
		zeroHash = hashCarryParentForTest(zeroHash, zeroHash)
		path >>= 1n
	}
	return currentHash
}

function buildCarrySnapshotPeaksForTest(leafHashes: readonly Hex[]) {
	const zeroHash = ('0x' + '00'.repeat(32)) as Hex
	const peaks = Array.from({ length: 64 }, () => zeroHash)
	let leafCount = 0n
	for (const initialLeafHash of leafHashes) {
		let carryHash = initialLeafHash
		let peakHeight = 0
		while (((leafCount >> BigInt(peakHeight)) & 1n) === 1n) {
			const peak = peaks[peakHeight]
			if (peak === undefined) throw new Error('Missing test carry peak')
			carryHash = hashCarryParentForTest(peak, carryHash)
			peaks[peakHeight] = zeroHash
			peakHeight += 1
		}
		peaks[peakHeight] = carryHash
		leafCount += 1n
	}
	return peaks
}

// Mocks the reads behind loadReportingDetails for an active escalation game; deposit pages come from the supplied reader.
function createActiveReportingClient(getDepositsByOutcome: (outcomeIndex: number, startIndex: bigint) => unknown) {
	const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
	return {
		getBlock: async () => createBlockWithTimestamp(88n),
		getCode: async () => '0x1234' as Hex,
		multicall: createMulticallStub(async request => {
			const functionName = getContractFunctionName(request.contracts[0])
			if (functionName === 'questionId') return [1n, escalationGameAddress, 20n, 3n, zoltarAddress, 5n, 0n, 3n, zeroAddress]
			if (functionName === 'questions') return [questionTuple, 10n]
			if (functionName === 'startBondAttoRep') return [7n, 50n, 12n, 22n, 11n, [1n, 14n, 3n], 150n, 3n, 0n, false]
			throw new Error(`Unexpected multicall contract: ${functionName}`)
		}),
		readContract: createReadContractStub(async request => {
			if (request.functionName === 'startBondAttoRep') return 7n
			if (request.functionName === 'nonDecisionThresholdAttoRep') return 50n
			if (request.functionName === 'activationTime') return 12n
			if (request.functionName === 'totalCostAttoRep') return 22n
			if (request.functionName === 'getBindingCapitalAttoRep') return 11n
			if (request.functionName === 'getOutcomeState') {
				const args = request.args
				if (!Array.isArray(args) || typeof args[0] !== 'number') throw new Error('Expected outcome state args')
				return { balance: [1n, 14n, 3n][args[0]] ?? 0n }
			}
			if (request.functionName === 'getEscalationGameEndDate') return 150n
			if (request.functionName === 'getQuestionOutcome') return 3
			if (request.functionName === 'getForkTime') return 0n
			if (request.functionName === 'hasReachedNonDecision') return true
			if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
			if (request.functionName === 'getForkThresholdAttoRep') return 100n
			if (request.functionName === 'escalationGame') return escalationGameAddress
			if (request.functionName === 'ordinarySettlementInitialized') return false
			if (request.functionName === 'forkContinuation') return false
			if (request.functionName === 'getDepositsByOutcome') {
				const args = request.args
				if (!Array.isArray(args) || typeof args[0] !== 'number' || typeof args[1] !== 'bigint') throw new Error('Expected deposit outcome args')
				return getDepositsByOutcome(args[0], args[1])
			}
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		}),
	} as unknown as Parameters<typeof loadReportingDetails>[0]
}

describe('reporting protocol client', () => {
	test('loads the frozen ordinary payout threshold after settlement even when the live fork threshold changed', async () => {
		const base = createActiveReportingClient(() => [])
		const client = {
			...base,
			readContract: createReadContractStub(async request => {
				if (request.functionName === 'ordinarySettlementInitialized') return true
				if (request.functionName === 'ordinarySettlementForkThresholdAttoRep') return 73n
				return base.readContract(request)
			}),
		}
		const details = await loadReportingDetails(client, securityPoolAddress, undefined)
		expect(details.forkThresholdAttoRep).toBe(73n)
	})

	test.each([zeroAddress, escalationGameAddress])('wallet reporting approves the pool before and after game startup (%s)', async gameAddress => {
		const previews: TransactionRequestPreview[] = []
		const client = asWriteClient(
			createMockWriteClient(
				() => undefined,
				async request => {
					if (request.functionName === 'universeId') return 9n
					if (request.functionName === 'escalationGame') return gameAddress
					if (request.functionName === 'getEscalationGameEndDate') return 1000n
					if (request.functionName === 'ordinarySettlementInitialized') return false
					if (request.functionName === 'forkContinuation') return false
					if (request.functionName === 'repToken') return repTokenAddress
					throw new Error(`Unexpected readContract function: ${request.functionName}`)
				},
			),
		)
		client.getBlock = async () => createBlockWithTimestamp(1n)
		client.onTransactionPrepared = preview => previews.push(preview)
		await approveReportingRep(client, securityPoolAddress, 'yes', 7n)
		expect(previews[0]?.functionName).toBe('approve')
		expect(previews[0]?.args).toEqual([securityPoolAddress, 7n])
		await reportOutcomeInSecurityPool(client, securityPoolAddress, 'yes', 7n)
		expect(previews[1]?.functionName).toBe('depositWalletRepToEscalationGame')
		expect(previews[1]?.args).toEqual([1, 7n])
	})

	test.each([zeroAddress, escalationGameAddress])('rejects removed vault funding for an ordinary game (%s)', async gameAddress => {
		const client = asWriteClient(
			createMockWriteClient(
				() => undefined,
				async request => {
					if (request.functionName === 'universeId') return 9n
					if (request.functionName === 'escalationGame') return gameAddress
					if (request.functionName === 'getEscalationGameEndDate') return 1000n
					if (request.functionName === 'ordinarySettlementInitialized') return false
					if (request.functionName === 'forkContinuation') return false
					throw new Error(`Unexpected read: ${request.functionName}`)
				},
			),
		)
		const previews: TransactionRequestPreview[] = []
		client.getBlock = async () => createBlockWithTimestamp(1n)
		client.onTransactionPrepared = preview => previews.push(preview)
		await expect(reportOutcomeInSecurityPool(client, securityPoolAddress, 'yes', 7n, 7n, 'vault')).rejects.toThrow('Reports use wallet REP')
		expect(previews).toEqual([])
	})

	test('reportOutcomeInSecurityPool routes active ordinary-game wallet contributions through the pool to game escrow', async () => {
		let capturedData: Hex | undefined
		let capturedTo: Address | null | undefined
		const client = createMockWriteClient(
			request => {
				capturedData = request.data
				capturedTo = request.to
			},
			async request => {
				if (request.functionName === 'universeId') return 9n
				if (request.functionName === 'escalationGame') return escalationGameAddress
				if (request.functionName === 'getEscalationGameEndDate') return 1000n
				if (request.functionName === 'ordinarySettlementInitialized') return false
				if (request.functionName === 'forkContinuation') return false
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		)

		const previews: TransactionRequestPreview[] = []
		const writeClient = asWriteClient(client)
		writeClient.getBlock = async () => createBlockWithTimestamp(1n)
		writeClient.onTransactionPrepared = preview => previews.push(preview)
		const result = await reportOutcomeInSecurityPool(writeClient, securityPoolAddress, 'yes', 7n, 6n)
		expect(previews[0]?.reviewAmount).toBe('0.000000000000000006\u00a0REP')
		expect(previews[0]?.reviewTitle).toBe('Report Yes · 0.000000000000000006\u00a0REP')
		expect(previews[0]?.reviewDescription).toBe('Deposits REP on Yes. If Yes loses, this REP is lost; if it wins, it returns with any earned reward.')

		expect(capturedTo).toBe(securityPoolAddress)
		expect(capturedData).toBeDefined()
		const decodedCall = decodeFunctionData({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			data: capturedData ?? ('0x' satisfies Hex),
		})
		expect(decodedCall.functionName).toBe('depositWalletRepToEscalationGame')
		expect(decodedCall.args).toEqual([1n, 7n])
		expect(result).toMatchObject({ action: 'reportOutcome', securityPoolAddress, universeId: 9n })
	})

	test('reportOutcomeInSecurityPool explains a fork-triggering report in its review step', async () => {
		const client = createMockWriteClient(
			() => undefined,
			async request => {
				if (request.functionName === 'universeId') return 9n
				if (request.functionName === 'escalationGame') return escalationGameAddress
				if (request.functionName === 'getEscalationGameEndDate') return 1000n
				if (request.functionName === 'ordinarySettlementInitialized') return false
				if (request.functionName === 'forkContinuation') return false
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		)
		const previews: TransactionRequestPreview[] = []
		const writeClient = asWriteClient(client)
		writeClient.getBlock = async () => createBlockWithTimestamp(1n)
		writeClient.onTransactionPrepared = preview => previews.push(preview)
		await reportOutcomeInSecurityPool(writeClient, securityPoolAddress, 'no', 6n, 6n, 'wallet', true)
		expect(previews[0]?.reviewTitle).toBe('Report No & trigger fork · 0.000000000000000006\u00a0REP')
		expect(previews[0]?.reviewDescription).toBe('Fills No to the non-decision threshold while another side is already there. Escalation ends without a decision, deposits lock, and the question can only resolve through a universe fork. This can’t be undone.')
	})

	test('withdrawEscalationFromSecurityPool explains that clearing losing deposits returns no REP', async () => {
		const client = createMockWriteClient(
			() => undefined,
			async request => {
				if (request.functionName === 'universeId') return 9n
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		)
		const previews: TransactionRequestPreview[] = []
		const writeClient = asWriteClient(client)
		writeClient.onTransactionPrepared = preview => previews.push(preview)
		await withdrawEscalationFromSecurityPool(writeClient, securityPoolAddress, 'no', [0n], 0n)
		expect(previews[0]?.reviewTitle).toBe('Clear No deposits (worth 0 REP)')
		expect(previews[0]?.reviewDescription).toBe('Returns no REP. Removes these losing deposits from your vault’s dispute-staked REP so you can redeem your vault REP from this pool.')
		await withdrawEscalationFromSecurityPool(writeClient, securityPoolAddress, 'yes', [0n], 4n)
		expect(previews[1]?.reviewDescription).toBeUndefined()
	})

	test('reportOutcomeInSecurityPool uses wallet-funded deposits for fork continuations', async () => {
		let capturedData: Hex | undefined
		let capturedTo: Address | null | undefined
		const client = createMockWriteClient(
			request => {
				capturedData = request.data
				capturedTo = request.to
			},
			async request => {
				if (request.functionName === 'universeId') return 9n
				if (request.functionName === 'escalationGame') return escalationGameAddress
				if (request.functionName === 'forkResumedAt') return 100n
				if (request.functionName === 'forkElapsedAtStart') return 0n
				if (request.functionName === 'getEscalationGameEndDate') return 1000n
				if (request.functionName === 'forkContinuation') return true
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		)

		await reportOutcomeInSecurityPool({ ...asWriteClient(client), getBlock: async () => createBlockWithTimestamp(1n) }, securityPoolAddress, 'no', 11n)

		expect(capturedTo).toBe(securityPoolAddress)
		expect(capturedData).toBeDefined()
		const decodedCall = decodeFunctionData({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			data: capturedData ?? ('0x' satisfies Hex),
		})
		expect(decodedCall.functionName).toBe('depositWalletRepToEscalationGame')
		expect(decodedCall.args).toEqual([2n, 11n])
	})

	test('loadReportingDetails keeps proof deposits visible after optional unresolved parent escalation-deposit accounting cleanup', async () => {
		const viewerAddress = getAddress('0x00000000000000000000000000000000000000ed')
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const poolHeldVaultRepBackingAttoRep = 70n
		const escrowedRep = 30n
		const client = {
			getBlock: async () => createBlockWithTimestamp(88n),
			getCode: async () => '0x1234' as Hex,
			multicall: createMulticallStub(async request => {
				const firstContract = request.contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'questionId') return [1n, escalationGameAddress, 20n, 3n, zoltarAddress, 5n, 0n, 3n, zeroAddress]
				if (functionName === 'questions') return [questionTuple, 10n]
				if (functionName === 'startBondAttoRep') return [7n, 50n, 12n, 22n, 11n, [1n, 14n, 3n], 150n, 3n, 0n, false]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.functionName === 'startBondAttoRep') return 7n
				if (request.functionName === 'nonDecisionThresholdAttoRep') return 50n
				if (request.functionName === 'activationTime') return 12n
				if (request.functionName === 'totalCostAttoRep') return 22n
				if (request.functionName === 'getBindingCapitalAttoRep') return 11n
				if (request.functionName === 'getOutcomeState') {
					const args = request.args
					if (!Array.isArray(args) || typeof args[0] !== 'number') throw new Error('Expected outcome state args')
					if (args[0] === 0) return { balance: 1n }
					if (args[0] === 1) return { balance: 14n }
					if (args[0] === 2) return { balance: 3n }
					throw new Error(`Unexpected outcome state index: ${args[0].toString()}`)
				}
				if (request.functionName === 'getEscalationGameEndDate') return 150n
				if (request.functionName === 'getQuestionOutcome') return 3
				if (request.functionName === 'getForkTime') return 0n
				if (request.functionName === 'hasReachedNonDecision') return true
				if (request.functionName === 'ordinarySettlementInitialized') return false
				if (request.functionName === 'forkContinuation') return false
				if (request.functionName === 'repToken') return repTokenAddress
				if (request.functionName === 'balanceOf') return 100n
				if (request.functionName === 'allowance') return 100n
				if (request.functionName === 'getForkThresholdAttoRep') return 100n
				if (request.functionName === 'escalationGame') return escalationGameAddress
				if (request.functionName === 'disputeStakedRepByVaultAttoRep') return escrowedRep
				if (request.functionName === 'securityVaults') return [100n, 0n, 0n, 0n, 0n]
				if (request.functionName === 'getEscalationMigrationEntitlementStatus') return [true, escrowedRep, [false, true, false]]
				if (request.functionName === 'backingUnitsToAttoRep') return poolHeldVaultRepBackingAttoRep
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				if (request.functionName === 'getDepositsByOutcome') {
					const args = request.args
					if (!Array.isArray(args) || typeof args[0] !== 'number') throw new Error('Expected deposit outcome args')
					return args[0] === 1 ? [{ amountAttoRep: escrowedRep, cumulativeAmountAttoRep: escrowedRep, depositor: viewerAddress }] : []
				}
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			}),
		} as unknown as Parameters<typeof loadReportingDetails>[0]

		const details = await loadReportingDetails(client, securityPoolAddress, viewerAddress)

		if (details.status !== 'active') throw new Error('Expected active reporting details')
		expect(details.contributionFunding).toBe('wallet')
		expect(details.viewerVaultDisputeStakedAttoRep).toBeUndefined()
		expect(details.viewerPoolHeldVaultRepBackingAttoRep).toBeUndefined()
		expect(details.viewerEscalationMigrationEntitlement).toBeUndefined()
		const yesSide = details.sides.find(side => side.key === 'yes')
		if (yesSide === undefined) throw new Error('Expected yes side')
		expect(yesSide.deposits).toHaveLength(1)
		expect(yesSide.userDeposits).toEqual(yesSide.deposits)
	})

	test('loadReportingDetails marks unrelated external-fork unresolved parent deposits as migration-required, not withdrawable', async () => {
		const viewerAddress = getAddress('0x00000000000000000000000000000000000000ef')
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const client = {
			getBlock: async () => createBlockWithTimestamp(88n),
			getCode: async () => '0x1234' as Hex,
			multicall: createMulticallStub(async request => {
				const firstContract = request.contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'questionId') return [1n, escalationGameAddress, 20n, 3n, zoltarAddress, 5n, 0n, 3n, zeroAddress]
				if (functionName === 'questions') return [questionTuple, 10n]
				if (functionName === 'startBondAttoRep') return [7n, 50n, 12n, 22n, 11n, [1n, 14n, 3n], 150n, 3n, 123n, false]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.functionName === 'startBondAttoRep') return 7n
				if (request.functionName === 'nonDecisionThresholdAttoRep') return 50n
				if (request.functionName === 'activationTime') return 12n
				if (request.functionName === 'totalCostAttoRep') return 22n
				if (request.functionName === 'getBindingCapitalAttoRep') return 11n
				if (request.functionName === 'getOutcomeState') {
					const args = request.args
					if (!Array.isArray(args) || typeof args[0] !== 'number') throw new Error('Expected outcome state args')
					if (args[0] === 0) return { balance: 1n }
					if (args[0] === 1) return { balance: 14n }
					if (args[0] === 2) return { balance: 3n }
					throw new Error(`Unexpected outcome state index: ${args[0].toString()}`)
				}
				if (request.functionName === 'getEscalationGameEndDate') return 150n
				if (request.functionName === 'getQuestionOutcome') return 3
				if (request.functionName === 'getForkTime') return 123n
				if (request.functionName === 'hasReachedNonDecision') return false
				if (request.functionName === 'forkData') return [0n, zeroAddress, 0n, 0n, 0n, 0n, 0n, 0n, false, false, 0n, 0n]
				if (request.functionName === 'ordinarySettlementInitialized') return false
				if (request.functionName === 'forkContinuation') return false
				if (request.functionName === 'repToken') return repTokenAddress
				if (request.functionName === 'balanceOf') return 100n
				if (request.functionName === 'allowance') return 100n
				if (request.functionName === 'getForkThresholdAttoRep') return 100n
				if (request.functionName === 'escalationGame') return escalationGameAddress
				if (request.functionName === 'disputeStakedRepByVaultAttoRep') return 9n
				if (request.functionName === 'securityVaults') return [0n, 0n, 0n, 0n, 0n]
				if (request.functionName === 'getEscalationMigrationEntitlementStatus') return [false, 0n, [false, false, false]]
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				if (request.functionName === 'getDepositsByOutcome') {
					const args = request.args
					if (!Array.isArray(args) || typeof args[0] !== 'number') throw new Error('Expected deposit outcome args')
					if (args[0] === 1) {
						return [{ amountAttoRep: 9n, cumulativeAmountAttoRep: 17n, depositor: viewerAddress }]
					}
					return []
				}
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			}),
		} as unknown as Parameters<typeof loadReportingDetails>[0]

		const details = await loadReportingDetails(client, securityPoolAddress, viewerAddress)

		if (details.status !== 'active') throw new Error('Expected active reporting details')
		expect(details.status).toBe('active')
		expect(details.settlementState).toBe('migration-required')
		expect(details.parentWithdrawalEnabled).toBe(false)
		const yesSide = details.sides.find((side: EscalationSide) => side.key === 'yes')
		if (yesSide === undefined) throw new Error('Expected yes side')
		expect(yesSide.userDeposits).toHaveLength(1)
		expect(yesSide.importedUserDeposits).toEqual([])
	})

	// The contracts no longer have a per-pool migration deadline; these cases guard that the loader never reads the removed forker fork data.
	test.each([
		{ blockTimestamp: 123n + 4_838_400n + 1n, forkActivationTime: 500n, expected: 'migration-required' },
		{ blockTimestamp: 500n + 4_838_400n, forkActivationTime: 500n, expected: 'migration-required' },
		{ blockTimestamp: 500n + 4_838_400n + 1n, forkActivationTime: 500n, expected: 'migration-required' },
		{ blockTimestamp: 123n + 4_838_400n + 1n, forkActivationTime: 0n, expected: 'migration-required' },
	] as const)('loadReportingDetails keeps inherited settlement available independently of old per-vault migration deadlines ($forkActivationTime, $blockTimestamp)', async ({ blockTimestamp, forkActivationTime, expected }) => {
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const forkDataReads: unknown[] = []
		const client = {
			getBlock: async () => createBlockWithTimestamp(blockTimestamp),
			getCode: async () => '0x1234' as Hex,
			multicall: createMulticallStub(async request => {
				const functionName = getContractFunctionName(request.contracts[0])
				if (functionName === 'questionId') return [1n, escalationGameAddress, 20n, 3n, zoltarAddress, 5n, 0n, 3n, zeroAddress]
				if (functionName === 'questions') return [questionTuple, 10n]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.functionName === 'startBondAttoRep') return 7n
				if (request.functionName === 'nonDecisionThresholdAttoRep') return 50n
				if (request.functionName === 'activationTime') return 12n
				if (request.functionName === 'totalCostAttoRep') return 22n
				if (request.functionName === 'getBindingCapitalAttoRep') return 11n
				if (request.functionName === 'getOutcomeState') return { balance: 1n }
				if (request.functionName === 'getEscalationGameEndDate') return 150n
				if (request.functionName === 'getQuestionOutcome') return 3
				if (request.functionName === 'getForkTime') return 123n
				if (request.functionName === 'hasReachedNonDecision') return false
				if (request.functionName === 'ordinarySettlementInitialized') return false
				if (request.functionName === 'forkContinuation') return false
				if (request.functionName === 'getForkThresholdAttoRep') return 100n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				if (request.functionName === 'getDepositsByOutcome') return []
				if (request.functionName === 'forkData') {
					forkDataReads.push(request.args)
					return [0n, zeroAddress, 0n, 0n, 0n, 0n, 0n, 0n, false, true, 0n, forkActivationTime]
				}
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			}),
		} as unknown as Parameters<typeof loadReportingDetails>[0]

		const details = await loadReportingDetails(client, securityPoolAddress, undefined)

		if (details.status !== 'active') throw new Error('Expected active reporting details')
		expect(details.settlementState).toBe(expected)
		expect(forkDataReads).toEqual([])
	})

	test('loadReportingDetails keeps parent settlement locked when the unrelated external fork happened after escalation ended', async () => {
		const viewerAddress = getAddress('0x00000000000000000000000000000000000000ee')
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const client = {
			getBlock: async () => createBlockWithTimestamp(88n),
			getCode: async () => '0x1234' as Hex,
			multicall: createMulticallStub(async request => {
				const firstContract = request.contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'questionId') return [1n, escalationGameAddress, 20n, 3n, zoltarAddress, 5n, 0n, 3n, zeroAddress]
				if (functionName === 'questions') return [questionTuple, 10n]
				if (functionName === 'startBondAttoRep') return [7n, 50n, 12n, 22n, 11n, [1n, 14n, 3n], 99n, 3n, 120n, false]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.functionName === 'startBondAttoRep') return 7n
				if (request.functionName === 'nonDecisionThresholdAttoRep') return 50n
				if (request.functionName === 'activationTime') return 12n
				if (request.functionName === 'totalCostAttoRep') return 22n
				if (request.functionName === 'getBindingCapitalAttoRep') return 11n
				if (request.functionName === 'getOutcomeState') {
					const args = request.args
					if (!Array.isArray(args) || typeof args[0] !== 'number') throw new Error('Expected outcome state args')
					if (args[0] === 0) return { balance: 1n }
					if (args[0] === 1) return { balance: 14n }
					if (args[0] === 2) return { balance: 3n }
					throw new Error(`Unexpected outcome state index: ${args[0].toString()}`)
				}
				if (request.functionName === 'getEscalationGameEndDate') return 99n
				if (request.functionName === 'getQuestionOutcome') return 3
				if (request.functionName === 'getForkTime') return 120n
				if (request.functionName === 'hasReachedNonDecision') return false
				if (request.functionName === 'ordinarySettlementInitialized') return false
				if (request.functionName === 'forkContinuation') return false
				if (request.functionName === 'repToken') return repTokenAddress
				if (request.functionName === 'balanceOf') return 100n
				if (request.functionName === 'allowance') return 100n
				if (request.functionName === 'getForkThresholdAttoRep') return 100n
				if (request.functionName === 'escalationGame') return escalationGameAddress
				if (request.functionName === 'disputeStakedRepByVaultAttoRep') return 9n
				if (request.functionName === 'securityVaults') return [0n, 0n, 0n, 0n, 0n]
				if (request.functionName === 'getEscalationMigrationEntitlementStatus') return [false, 0n, [false, false, false]]
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				if (request.functionName === 'getDepositsByOutcome') {
					const args = request.args
					if (!Array.isArray(args) || typeof args[0] !== 'number') throw new Error('Expected deposit outcome args')
					if (args[0] === 1) {
						return [{ amountAttoRep: 9n, cumulativeAmountAttoRep: 17n, depositor: viewerAddress }]
					}
					return []
				}
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			}),
		} as unknown as Parameters<typeof loadReportingDetails>[0]

		const details = await loadReportingDetails(client, securityPoolAddress, viewerAddress)

		if (details.status !== 'active') throw new Error('Expected active reporting details')
		expect(details.settlementState).toBe('locked')
		expect(details.parentWithdrawalEnabled).toBe(false)
	})

	test('loadReportingDetails keeps pool-level finality and previews the live reduced bond when no game exists', async () => {
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const client = {
			getBlock: async () => createBlockWithTimestamp(88n),
			getCode: async () => '0x' as Hex,
			multicall: createMulticallStub(async request => {
				const firstContract = request.contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'questionId') return [1n, zeroAddress, 20n, 3n, zoltarAddress, 5n, 0n, 1n, zeroAddress]
				if (functionName === 'questions') return [questionTuple, 10n]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.functionName === 'getForkThresholdAttoRep') return 9n
				if (request.functionName === 'escalationGame') return zeroAddress
				if (request.functionName === 'getEscalationMigrationEntitlementStatus') return [false, 0n, [false, false, false]]
				if (request.functionName === 'securityVaults') return [0n, 0n, 0n, 0n, 0n]
				if (request.functionName === 'repToken') return repTokenAddress
				if (request.functionName === 'balanceOf') return 100n
				if (request.functionName === 'allowance') {
					expect(request.args).toEqual([vaultAddress, securityPoolAddress])
					return 0n
				}
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			}),
		} as unknown as Parameters<typeof loadReportingDetails>[0]

		const details = await loadReportingDetails(client, securityPoolAddress, vaultAddress)

		expect(details.status).toBe('not-started')
		expect(details.contributionFunding).toBe('wallet')
		expect(details.viewerVaultExists).toBeUndefined()
		expect(details.viewerWalletRepBalanceAttoRep).toBe(100n)
		expect(details.viewerWalletRepAllowanceAttoRep).toBe(0n)
		expect(details.questionOutcome).toBe('yes')
		expect(details.settlementState).toBe('resolved')
		expect(details.parentWithdrawalEnabled).toBe(false)
		expect(details.nonDecisionThresholdAttoRep).toBe(5n)
		expect(details.startBondAttoRep).toBe(4n)
	})

	test('loadReportingDetails skips forkContinuation when escalation game code is missing', async () => {
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		let forkContinuationRead = false
		const client = {
			getBlock: async () => createBlockWithTimestamp(88n),
			getCode: async () => '0x' as Hex,
			multicall: createMulticallStub(async request => {
				const firstContract = request.contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'questionId') return [1n, escalationGameAddress, 20n, 3n, zoltarAddress, 5n, 0n, 3n, zeroAddress]
				if (functionName === 'questions') return [questionTuple, 10n]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.functionName === 'getForkThresholdAttoRep') return 100n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				if (request.functionName === 'forkContinuation') {
					forkContinuationRead = true
					throw new Error(missingForkContinuationGetterMessage)
				}
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			}),
		} as unknown as Parameters<typeof loadReportingDetails>[0]

		const details = await loadReportingDetails(client, securityPoolAddress, undefined)

		expect(details.status).toBe('not-started')
		expect(forkContinuationRead).toBe(false)
	})

	test('loadReportingDetails requires the forkContinuation getter for deployed escalation games', async () => {
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const client = {
			getBlock: async () => createBlockWithTimestamp(88n),
			getCode: async () => '0x1234' as Hex,
			multicall: createMulticallStub(async request => {
				const firstContract = request.contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'questionId') return [1n, escalationGameAddress, 20n, 3n, zoltarAddress, 5n, 0n, 3n, zeroAddress]
				if (functionName === 'questions') return [questionTuple, 10n]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.functionName === 'getForkThresholdAttoRep') return 100n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				if (request.functionName === 'forkContinuation') throw new Error(missingForkContinuationGetterMessage)
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			}),
		} as unknown as Parameters<typeof loadReportingDetails>[0]

		await expect(loadReportingDetails(client, securityPoolAddress, undefined)).rejects.toThrow(missingForkContinuationGetterMessage)
	})

	test('loadReportingDetails keeps a known child outcome locked until the pool becomes operational', async () => {
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const client = {
			getBlock: async () => createBlockWithTimestamp(88n),
			getCode: async () => '0x' as Hex,
			multicall: createMulticallStub(async request => {
				const firstContract = request.contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'questionId') return [1n, zeroAddress, 20n, 3n, zoltarAddress, 5n, 2n, 1n, zeroAddress]
				if (functionName === 'questions') return [questionTuple, 10n]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.functionName === 'getForkThresholdAttoRep') return 100n
				if (request.functionName === 'securityVaults') return [0n, 0n, 0n, 0n, 0n]
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			}),
		} as unknown as Parameters<typeof loadReportingDetails>[0]

		const details = await loadReportingDetails(client, securityPoolAddress, undefined)

		expect(details.status).toBe('not-started')
		expect(details.questionOutcome).toBe('yes')
		expect(details.systemState).toBe('forkMigration')
		expect(details.settlementState).toBe('locked')
		expect(details.parentWithdrawalEnabled).toBe(false)
	})

	test('loadReportingDetails continues paging deposits past settled entries on a full page', async () => {
		const depositor = getAddress('0x00000000000000000000000000000000000000e5')
		const readCalls: bigint[] = []
		const firstPage = Array.from({ length: 30 }, (_, index) => ({
			amountAttoRep: index === 29 ? 0n : BigInt(index + 1),
			cumulativeAmountAttoRep: BigInt(index + 1),
			depositor,
		}))
		const secondPage = [{ amountAttoRep: 31n, cumulativeAmountAttoRep: 31n, depositor }]
		const client = createActiveReportingClient((outcomeIndex, startIndex) => {
			if (outcomeIndex !== 1) return []
			readCalls.push(startIndex)
			if (startIndex === 0n) return firstPage
			if (startIndex === 30n) return secondPage
			throw new Error(`Unexpected start index: ${startIndex.toString()}`)
		})

		const details = await loadReportingDetails(client, securityPoolAddress, undefined)
		if (details.status !== 'active') throw new Error('Expected active reporting details')
		const deposits = details.sides.find(side => side.key === 'yes')?.deposits
		if (deposits === undefined) throw new Error('Expected yes side deposits')

		expect(readCalls).toEqual([0n, 30n])
		expect(deposits).toHaveLength(30)
		expect(deposits.some(deposit => deposit.amountAttoRep === 0n)).toBe(false)
		expect(deposits[28]?.depositIndex).toBe(28n)
		expect(deposits[29]?.depositIndex).toBe(30n)
	})

	test('loadReportingDetails rejects malformed deposit pages instead of dropping entries', async () => {
		const client = createActiveReportingClient(() => [{ amountAttoRep: 1n, cumulativeAmountAttoRep: 1n, depositor: 'not-an-address' }])

		await expect(loadReportingDetails(client, securityPoolAddress, undefined)).rejects.toThrow('Unexpected escalation deposit page response')
	})

	test('buildForkCarriedEscalationProofs rejects malformed historical carry nodes instead of dropping entries', async () => {
		const parentEscalationGameAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const zeroHash = '0x0000000000000000000000000000000000000000000000000000000000000000' satisfies Hex
		const client = {
			getBlockNumber: async () => 1n,
			getBlock: async () => ({ number: 1n, hash: keccak256('0x01') }),
			multicall: createMulticallStub(async request => {
				const firstContract = request.contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'parent') return [alternateSecurityPoolAddress, escalationGameAddress]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.functionName === 'escalationGame') return parentEscalationGameAddress
				if (request.functionName === 'getOutcomeState')
					return {
						currentCarryRoot: zeroHash,
						currentLeafCount: 0n,
						currentNullifierRoot: zeroHash,
						localHeadNodeId: request.address === parentEscalationGameAddress ? 1n : 0n,
						snapshotLeafCount: 0n,
						snapshotPeaks: Array.from({ length: 64 }, () => zeroHash),
					}
				if (request.functionName === 'ordinarySettlementInitialized') return false
				if (request.functionName === 'forkContinuation') return false
				if (request.functionName === 'nodes') return [0n, vaultAddress, 1, 1n, 'bad-index', 1n, 0n]
				if (request.functionName === 'getProofConsumedCarriedDepositIndexesByOutcome') return []
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			}),
		} as unknown as Parameters<typeof buildForkCarriedEscalationProofs>[0]

		await expect(buildForkCarriedEscalationProofs(client, securityPoolAddress, 'yes', [1n])).rejects.toThrow('Unexpected historical carry node parent deposit index response')
	})

	test('buildForkCarriedEscalationProofs requires the forkContinuation getter', async () => {
		const parentEscalationGameAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const zeroHash = '0x0000000000000000000000000000000000000000000000000000000000000000' satisfies Hex
		const client = {
			getBlockNumber: async () => 1n,
			getBlock: async () => ({ number: 1n, hash: keccak256('0x01') }),
			multicall: createMulticallStub(async request => {
				const firstContract = request.contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'parent') return [alternateSecurityPoolAddress, escalationGameAddress]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.functionName === 'escalationGame') return parentEscalationGameAddress
				if (request.functionName === 'getOutcomeState')
					return {
						currentCarryRoot: zeroHash,
						currentLeafCount: 0n,
						currentNullifierRoot: zeroHash,
					}
				if (request.functionName === 'forkContinuation') throw new Error(missingForkContinuationGetterMessage)
				if (request.functionName === 'getCarryLeafPageByOutcome') return [[], 0n]
				if (request.functionName === 'getProofConsumedCarriedDepositIndexesByOutcome') return []
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			}),
		} as unknown as Parameters<typeof buildForkCarriedEscalationProofs>[0]

		await expect(buildForkCarriedEscalationProofs(client, securityPoolAddress, 'yes', [])).rejects.toThrow(missingForkContinuationGetterMessage)
	})

	test('buildForkCarriedEscalationProofs retains historical leaves when hashing the frozen child snapshot', async () => {
		const parentEscalationGameAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const firstDepositor = getAddress('0x00000000000000000000000000000000000000f2')
		const secondDepositor = getAddress('0x00000000000000000000000000000000000000f3')
		const securityPoolForkerAddress = getAddress('0x00000000000000000000000000000000000000f4')
		const zeroHash = ('0x' + '00'.repeat(32)) as Hex
		const emptyNullifierRoot = computeEmptyNullifierRootForTest()
		const firstLeaf = {
			amountAttoRep: 3n,
			cumulativeAmountAttoRep: 3n,
			depositor: firstDepositor,
			parentDepositIndex: 0n,
			sourceNodeId: 1n,
		}
		const secondLeaf = {
			amountAttoRep: 5n,
			cumulativeAmountAttoRep: 8n,
			depositor: secondDepositor,
			parentDepositIndex: 1n,
			sourceNodeId: 2n,
		}
		const firstLeafHash = hashCarryLeafForTest(firstLeaf.depositor, 1n, firstLeaf.amountAttoRep, firstLeaf.parentDepositIndex, firstLeaf.cumulativeAmountAttoRep, firstLeaf.sourceNodeId)
		const secondLeafHash = hashCarryLeafForTest(secondLeaf.depositor, 1n, secondLeaf.amountAttoRep, secondLeaf.parentDepositIndex, secondLeaf.cumulativeAmountAttoRep, secondLeaf.sourceNodeId)
		const frozenRoot = hashCarryParentForTest(firstLeafHash, secondLeafHash)
		const snapshotPeaks = Array.from({ length: 64 }, () => zeroHash)
		snapshotPeaks[1] = frozenRoot
		const client = {
			getBlockNumber: async () => 1n,
			getBlock: async () => ({ number: 1n, hash: keccak256('0x01') }),
			multicall: createMulticallStub(async request => {
				const firstContract = request.contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'parent') return [alternateSecurityPoolAddress, escalationGameAddress]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.address === alternateSecurityPoolAddress && request.functionName === 'escalationGame') return parentEscalationGameAddress
				if (request.address === parentEscalationGameAddress && request.functionName === 'getOutcomeState') {
					return {
						currentCarryRoot: secondLeafHash,
						currentLeafCount: 2n,
						currentNullifierRoot: emptyNullifierRoot,
						localHeadNodeId: 2n,
						snapshotLeafCount: 0n,
					}
				}
				if (request.address === escalationGameAddress && request.functionName === 'getOutcomeState') {
					return {
						currentCarryRoot: frozenRoot,
						currentLeafCount: 2n,
						currentNullifierRoot: emptyNullifierRoot,
						snapshotLeafCount: 2n,
						snapshotPeaks,
					}
				}
				if (request.address === parentEscalationGameAddress && request.functionName === 'forkContinuation') return false
				if (request.address === parentEscalationGameAddress && request.functionName === 'securityPool') return alternateSecurityPoolAddress
				if (request.address === alternateSecurityPoolAddress && request.functionName === 'securityPoolForker') return securityPoolForkerAddress
				if (request.address === securityPoolForkerAddress && request.functionName === 'isEscalationDepositClaimedDirectly') return true
				if (request.address === parentEscalationGameAddress && request.functionName === 'getCarryLeafPageByOutcome') return [[firstLeaf, secondLeaf], 0n]
				if (request.address === parentEscalationGameAddress && request.functionName === 'nodes') {
					const args = request.args
					if (!Array.isArray(args)) throw new Error('Expected node args')
					if (args[0] === 2n) return [1n, secondLeaf.depositor, 1, secondLeaf.amountAttoRep, secondLeaf.parentDepositIndex, secondLeaf.cumulativeAmountAttoRep, 1n]
					if (args[0] === 1n) return [0n, firstLeaf.depositor, 1, firstLeaf.amountAttoRep, firstLeaf.parentDepositIndex, firstLeaf.cumulativeAmountAttoRep, 0n]
					throw new Error(`Unexpected node id: ${String(args[0])}`)
				}
				if (request.functionName === 'getProofConsumedCarriedDepositIndexesByOutcome') return []
				throw new Error(`Unexpected readContract function: ${request.functionName} at ${String(request.address)}`)
			}),
		} as unknown as Parameters<typeof buildForkCarriedEscalationProofs>[0]

		await expect(buildForkCarriedEscalationProofs(client, securityPoolAddress, 'yes', [secondLeaf.parentDepositIndex])).resolves.toMatchObject([
			{
				depositor: secondDepositor,
				leafIndex: 1n,
				merkleMountainRangeSiblings: [firstLeafHash],
				parentDepositIndex: secondLeaf.parentDepositIndex,
			},
		])
	})

	test('buildForkCarriedEscalationProofs preserves recursive carry append order instead of sorting by parentDepositIndex', async () => {
		const parentEscalationGameAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const grandparentSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000f2')
		const grandparentEscalationGameAddress = getAddress('0x00000000000000000000000000000000000000f3')
		const depositor = getAddress('0x00000000000000000000000000000000000000f4')
		const zeroHash = '0x0000000000000000000000000000000000000000000000000000000000000000' satisfies Hex
		const emptyNullifierRoot = computeEmptyNullifierRootForTest()
		const inheritedLeaf = {
			amountAttoRep: 3n,
			cumulativeAmountAttoRep: 3n,
			depositor,
			parentDepositIndex: 9n,
			sourceNodeId: 1n,
		}
		const childLocalLeaf = {
			amountAttoRep: 1n,
			cumulativeAmountAttoRep: 4n,
			depositor,
			parentDepositIndex: 1n,
			sourceNodeId: 2n,
		}
		const inheritedLeafHash = hashCarryLeafForTest(inheritedLeaf.depositor, 1n, inheritedLeaf.amountAttoRep, inheritedLeaf.parentDepositIndex, inheritedLeaf.cumulativeAmountAttoRep, inheritedLeaf.sourceNodeId)
		const childLocalLeafHash = hashCarryLeafForTest(childLocalLeaf.depositor, 1n, childLocalLeaf.amountAttoRep, childLocalLeaf.parentDepositIndex, childLocalLeaf.cumulativeAmountAttoRep, childLocalLeaf.sourceNodeId)
		const parentCarryRoot = hashCarryParentForTest(inheritedLeafHash, childLocalLeafHash)
		const snapshotPeaks = Array.from({ length: 64 }, () => zeroHash)
		snapshotPeaks[1] = parentCarryRoot
		const client = {
			getBlockNumber: async () => 1n,
			getBlock: async () => ({ number: 1n, hash: keccak256('0x01') }),
			multicall: createMulticallStub(async request => {
				const firstContract = request.contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'parent') return [alternateSecurityPoolAddress, escalationGameAddress]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.address === alternateSecurityPoolAddress && request.functionName === 'escalationGame') return parentEscalationGameAddress
				if (request.address === grandparentSecurityPoolAddress && request.functionName === 'escalationGame') return grandparentEscalationGameAddress
				if (request.address === parentEscalationGameAddress && request.functionName === 'getOutcomeState') {
					return {
						currentCarryRoot: parentCarryRoot,
						currentLeafCount: 2n,
						currentNullifierRoot: zeroHash,
						localHeadNodeId: 2n,
						snapshotLeafCount: 1n,
					}
				}
				if (request.address === escalationGameAddress && request.functionName === 'getOutcomeState') {
					return {
						currentCarryRoot: zeroHash,
						currentLeafCount: 0n,
						currentNullifierRoot: emptyNullifierRoot,
						snapshotLeafCount: 2n,
						snapshotPeaks,
					}
				}
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'getOutcomeState') {
					return {
						currentCarryRoot: inheritedLeafHash,
						currentLeafCount: 1n,
						currentNullifierRoot: zeroHash,
						localHeadNodeId: 1n,
						snapshotLeafCount: 0n,
					}
				}
				if (request.address === parentEscalationGameAddress && request.functionName === 'forkContinuation') return true
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'forkContinuation') return false
				if (request.address === parentEscalationGameAddress && request.functionName === 'securityPool') return alternateSecurityPoolAddress
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'securityPool') return grandparentSecurityPoolAddress
				if (request.address === alternateSecurityPoolAddress && request.functionName === 'parent') return grandparentSecurityPoolAddress
				if (request.address === grandparentSecurityPoolAddress && request.functionName === 'parent') return zeroAddress
				if (request.address === parentEscalationGameAddress && request.functionName === 'nodes') {
					return [0n, childLocalLeaf.depositor, 1, childLocalLeaf.amountAttoRep, childLocalLeaf.parentDepositIndex, childLocalLeaf.cumulativeAmountAttoRep, 1n]
				}
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'nodes') {
					return [0n, inheritedLeaf.depositor, 1, inheritedLeaf.amountAttoRep, inheritedLeaf.parentDepositIndex, inheritedLeaf.cumulativeAmountAttoRep, 0n]
				}
				if (request.address === parentEscalationGameAddress && request.functionName === 'getCarryLeafPageByOutcome') {
					return [[childLocalLeaf], 0n]
				}
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'getCarryLeafPageByOutcome') {
					return [[inheritedLeaf], 0n]
				}
				if (request.functionName === 'getProofConsumedCarriedDepositIndexesByOutcome') return []
				throw new Error(`Unexpected readContract function: ${request.functionName} at ${String(request.address)}`)
			}),
		} as unknown as Parameters<typeof buildForkCarriedEscalationProofs>[0]

		await expect(buildForkCarriedEscalationProofs(client, securityPoolAddress, 'yes', [9n, 1n])).resolves.toMatchObject([
			{ leafIndex: 0n, parentDepositIndex: 9n },
			{ leafIndex: 1n, parentDepositIndex: 1n },
		])
	})

	test('buildForkCarriedEscalationProofs preserves a zeroed local position in a recursive frozen snapshot', async () => {
		const parentEscalationGameAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const grandparentSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000f2')
		const grandparentEscalationGameAddress = getAddress('0x00000000000000000000000000000000000000f3')
		const depositor = getAddress('0x00000000000000000000000000000000000000f4')
		const securityPoolForkerAddress = getAddress('0x00000000000000000000000000000000000000f5')
		const zeroHash = ('0x' + '00'.repeat(32)) as Hex
		const emptyNullifierRoot = computeEmptyNullifierRootForTest()
		const inheritedLeaf = {
			amountAttoRep: 3n,
			cumulativeAmountAttoRep: 3n,
			depositor,
			parentDepositIndex: 9n,
			sourceNodeId: 1n,
		}
		const settledLocalLeaf = {
			amountAttoRep: 1n,
			cumulativeAmountAttoRep: 4n,
			depositor,
			parentDepositIndex: 1n,
			sourceNodeId: 2n,
		}
		const inheritedLeafHash = hashCarryLeafForTest(inheritedLeaf.depositor, 1n, inheritedLeaf.amountAttoRep, inheritedLeaf.parentDepositIndex, inheritedLeaf.cumulativeAmountAttoRep, inheritedLeaf.sourceNodeId)
		const frozenRoot = hashCarryParentForTest(inheritedLeafHash, zeroHash)
		const snapshotPeaks = Array.from({ length: 64 }, () => zeroHash)
		snapshotPeaks[1] = frozenRoot
		const client = {
			getBlockNumber: async () => 1n,
			getBlock: async () => ({ number: 1n, hash: keccak256('0x01') }),
			multicall: createMulticallStub(async request => {
				const firstContract = request.contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'parent') return [alternateSecurityPoolAddress, escalationGameAddress]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.address === alternateSecurityPoolAddress && request.functionName === 'escalationGame') return parentEscalationGameAddress
				if (request.address === grandparentSecurityPoolAddress && request.functionName === 'escalationGame') return grandparentEscalationGameAddress
				if (request.address === parentEscalationGameAddress && request.functionName === 'getOutcomeState') {
					return { currentNullifierRoot: emptyNullifierRoot, localHeadNodeId: 2n, snapshotLeafCount: 1n }
				}
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'getOutcomeState') {
					return { currentNullifierRoot: emptyNullifierRoot, localHeadNodeId: 1n, snapshotLeafCount: 0n }
				}
				if (request.address === escalationGameAddress && request.functionName === 'getOutcomeState') {
					return { currentNullifierRoot: emptyNullifierRoot, snapshotLeafCount: 2n, snapshotPeaks }
				}
				if (request.address === parentEscalationGameAddress && request.functionName === 'forkContinuation') return true
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'forkContinuation') return false
				if (request.address === parentEscalationGameAddress && request.functionName === 'securityPool') return alternateSecurityPoolAddress
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'securityPool') return grandparentSecurityPoolAddress
				if (request.address === alternateSecurityPoolAddress && request.functionName === 'parent') return grandparentSecurityPoolAddress
				if (request.address === grandparentSecurityPoolAddress && request.functionName === 'parent') return zeroAddress
				if (request.functionName === 'securityPoolForker') return securityPoolForkerAddress
				if (request.functionName === 'isEscalationDepositClaimedDirectly') return false
				if (request.address === parentEscalationGameAddress && request.functionName === 'nodes') {
					return [0n, settledLocalLeaf.depositor, 1, settledLocalLeaf.amountAttoRep, settledLocalLeaf.parentDepositIndex, settledLocalLeaf.cumulativeAmountAttoRep, 1n]
				}
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'nodes') {
					return [0n, inheritedLeaf.depositor, 1, inheritedLeaf.amountAttoRep, inheritedLeaf.parentDepositIndex, inheritedLeaf.cumulativeAmountAttoRep, 0n]
				}
				if (request.address === parentEscalationGameAddress && request.functionName === 'getCarryLeafPageByOutcome') return [[], 0n]
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'getCarryLeafPageByOutcome') return [[inheritedLeaf], 0n]
				if (request.functionName === 'getProofConsumedCarriedDepositIndexesByOutcome') return []
				throw new Error(`Unexpected readContract function: ${request.functionName} at ${String(request.address)}`)
			}),
		} as unknown as Parameters<typeof buildForkCarriedEscalationProofs>[0]

		await expect(buildForkCarriedEscalationProofs(client, securityPoolAddress, 'yes', [inheritedLeaf.parentDepositIndex])).resolves.toMatchObject([
			{
				leafIndex: 0n,
				merkleMountainRangeSiblings: [zeroHash],
				parentDepositIndex: inheritedLeaf.parentDepositIndex,
			},
		])
	})

	test('buildForkCarriedEscalationProofs inherits recursive proof consumption and rejects the consumed leaf', async () => {
		const parentEscalationGameAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const grandparentSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000f2')
		const grandparentEscalationGameAddress = getAddress('0x00000000000000000000000000000000000000f3')
		const depositor = getAddress('0x00000000000000000000000000000000000000f4')
		const zeroHash = ('0x' + '00'.repeat(32)) as Hex
		const firstLeaf = { amountAttoRep: 3n, cumulativeAmountAttoRep: 3n, depositor, parentDepositIndex: 9n, sourceNodeId: 1n }
		const secondLeaf = { amountAttoRep: 5n, cumulativeAmountAttoRep: 8n, depositor, parentDepositIndex: 10n, sourceNodeId: 2n }
		const firstLeafHash = hashCarryLeafForTest(firstLeaf.depositor, 1n, firstLeaf.amountAttoRep, firstLeaf.parentDepositIndex, firstLeaf.cumulativeAmountAttoRep, firstLeaf.sourceNodeId)
		const secondLeafHash = hashCarryLeafForTest(secondLeaf.depositor, 1n, secondLeaf.amountAttoRep, secondLeaf.parentDepositIndex, secondLeaf.cumulativeAmountAttoRep, secondLeaf.sourceNodeId)
		const frozenRoot = hashCarryParentForTest(firstLeafHash, secondLeafHash)
		const snapshotPeaks = Array.from({ length: 64 }, () => zeroHash)
		snapshotPeaks[1] = frozenRoot
		const inheritedNullifierRoot = computeSingleConsumedNullifierRootForTest(firstLeaf.parentDepositIndex)
		const client = {
			getBlockNumber: async () => 1n,
			getBlock: async () => ({ number: 1n, hash: keccak256('0x01') }),
			multicall: createMulticallStub(async request => {
				const firstContract = request.contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'parent') return [alternateSecurityPoolAddress, escalationGameAddress]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.address === alternateSecurityPoolAddress && request.functionName === 'escalationGame') return parentEscalationGameAddress
				if (request.address === grandparentSecurityPoolAddress && request.functionName === 'escalationGame') return grandparentEscalationGameAddress
				if (request.address === escalationGameAddress && request.functionName === 'getOutcomeState') {
					return { currentNullifierRoot: inheritedNullifierRoot, snapshotLeafCount: 2n, snapshotPeaks }
				}
				if (request.address === parentEscalationGameAddress && request.functionName === 'getOutcomeState') {
					return { currentNullifierRoot: inheritedNullifierRoot, localHeadNodeId: 0n, snapshotLeafCount: 2n }
				}
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'getOutcomeState') {
					return { currentNullifierRoot: computeEmptyNullifierRootForTest(), localHeadNodeId: 2n, snapshotLeafCount: 0n }
				}
				if (request.address === escalationGameAddress && request.functionName === 'forkContinuation') return true
				if (request.address === parentEscalationGameAddress && request.functionName === 'forkContinuation') return true
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'forkContinuation') return false
				if (request.address === escalationGameAddress && request.functionName === 'securityPool') return securityPoolAddress
				if (request.address === parentEscalationGameAddress && request.functionName === 'securityPool') return alternateSecurityPoolAddress
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'securityPool') return grandparentSecurityPoolAddress
				if (request.address === securityPoolAddress && request.functionName === 'parent') return alternateSecurityPoolAddress
				if (request.address === alternateSecurityPoolAddress && request.functionName === 'parent') return grandparentSecurityPoolAddress
				if (request.address === grandparentSecurityPoolAddress && request.functionName === 'parent') return zeroAddress
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'nodes') {
					const args = request.args
					if (!Array.isArray(args)) throw new Error('Expected node args')
					if (args[0] === 2n) return [1n, secondLeaf.depositor, 1, secondLeaf.amountAttoRep, secondLeaf.parentDepositIndex, secondLeaf.cumulativeAmountAttoRep, 1n]
					if (args[0] === 1n) return [0n, firstLeaf.depositor, 1, firstLeaf.amountAttoRep, firstLeaf.parentDepositIndex, firstLeaf.cumulativeAmountAttoRep, 0n]
				}
				if (request.address === parentEscalationGameAddress && request.functionName === 'getCarryLeafPageByOutcome') return [[], 0n]
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'getCarryLeafPageByOutcome') return [[secondLeaf, firstLeaf], 0n]
				if (request.functionName === 'getProofConsumedCarriedDepositIndexesByOutcome') {
					return request.address === parentEscalationGameAddress ? [firstLeaf.parentDepositIndex] : []
				}
				throw new Error(`Unexpected readContract function: ${request.functionName} at ${String(request.address)}`)
			}),
		} as unknown as Parameters<typeof buildForkCarriedEscalationProofs>[0]

		await expect(buildForkCarriedEscalationProofs(client, securityPoolAddress, 'yes', [secondLeaf.parentDepositIndex])).resolves.toMatchObject([{ leafIndex: 1n, parentDepositIndex: secondLeaf.parentDepositIndex }])
		await expect(buildForkCarriedEscalationProofs(client, securityPoolAddress, 'yes', [firstLeaf.parentDepositIndex])).rejects.toThrow('Parent deposit #9 is already settled.')
	})

	test('buildForkCarriedEscalationProofs encodes global leaf indexes with the containing peak height for three- and six-leaf tail peaks', async () => {
		const parentEscalationGameAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const depositor = getAddress('0x00000000000000000000000000000000000000f2')
		for (const { leafCount, targetGlobalIndex, targetPeakHeight } of [
			{ leafCount: 3, targetGlobalIndex: 2, targetPeakHeight: 0n },
			{ leafCount: 6, targetGlobalIndex: 5, targetPeakHeight: 1n },
		]) {
			const leaves = Array.from({ length: leafCount }, (_, index) => ({
				amountAttoRep: BigInt(index + 1),
				cumulativeAmountAttoRep: BigInt(((index + 1) * (index + 2)) / 2),
				depositor,
				parentDepositIndex: BigInt(100 + index),
				sourceNodeId: BigInt(index + 1),
			}))
			const leafHashes = leaves.map(leaf => hashCarryLeafForTest(leaf.depositor, 1n, leaf.amountAttoRep, leaf.parentDepositIndex, leaf.cumulativeAmountAttoRep, leaf.sourceNodeId))
			const snapshotPeaks = buildCarrySnapshotPeaksForTest(leafHashes)
			const targetLeaf = leaves[targetGlobalIndex]
			if (targetLeaf === undefined) throw new Error('Missing target test leaf')
			const client = {
				getBlockNumber: async () => 1n,
				getBlock: async () => ({ number: 1n, hash: keccak256('0x01') }),
				multicall: createMulticallStub(async request => {
					const firstContract = request.contracts[0]
					const functionName = getContractFunctionName(firstContract)
					if (functionName === 'parent') return [alternateSecurityPoolAddress, escalationGameAddress]
					throw new Error(`Unexpected multicall contract: ${functionName}`)
				}),
				readContract: createReadContractStub(async request => {
					if (request.address === alternateSecurityPoolAddress && request.functionName === 'escalationGame') return parentEscalationGameAddress
					if (request.address === escalationGameAddress && request.functionName === 'getOutcomeState') {
						return { currentNullifierRoot: computeEmptyNullifierRootForTest(), snapshotLeafCount: BigInt(leafCount), snapshotPeaks }
					}
					if (request.address === parentEscalationGameAddress && request.functionName === 'getOutcomeState') {
						return { currentNullifierRoot: computeEmptyNullifierRootForTest(), localHeadNodeId: BigInt(leafCount), snapshotLeafCount: 0n }
					}
					if (request.address === parentEscalationGameAddress && request.functionName === 'forkContinuation') return false
					if (request.address === parentEscalationGameAddress && request.functionName === 'nodes') {
						const args = request.args
						if (!Array.isArray(args) || typeof args[0] !== 'bigint') throw new Error('Expected node id')
						const nodeIndex = Number.parseInt((args[0] - 1n).toString(), 10)
						const leaf = leaves[nodeIndex]
						if (leaf === undefined) throw new Error(`Unexpected node id: ${args[0].toString()}`)
						return [args[0] - 1n, leaf.depositor, 1, leaf.amountAttoRep, leaf.parentDepositIndex, leaf.cumulativeAmountAttoRep, BigInt(nodeIndex)]
					}
					if (request.address === parentEscalationGameAddress && request.functionName === 'getCarryLeafPageByOutcome') return [[...leaves].reverse(), 0n]
					if (request.functionName === 'getProofConsumedCarriedDepositIndexesByOutcome') return []
					throw new Error(`Unexpected readContract function: ${request.functionName} at ${String(request.address)}`)
				}),
			} as unknown as Parameters<typeof buildForkCarriedEscalationProofs>[0]

			await expect(buildForkCarriedEscalationProofs(client, securityPoolAddress, 'yes', [targetLeaf.parentDepositIndex])).resolves.toMatchObject([{ leafIndex: BigInt(targetGlobalIndex), merkleMountainRangePeakIndex: targetPeakHeight, parentDepositIndex: targetLeaf.parentDepositIndex }])
		}
	})

	test('withdrawForkedEscalationDeposits helper encodes proof batches correctly', async () => {
		let capturedData: Hex | undefined
		let capturedTo: Address | null | undefined
		const merkleMountainRangeSibling = ('0x' + '11'.repeat(32)) as Hex
		const nullifierSibling = ('0x' + '22'.repeat(32)) as Hex
		const client = createMockWriteClient(
			request => {
				capturedData = request.data
				capturedTo = request.to
			},
			async request => {
				if (request.functionName === 'universeId') return 12n
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		)

		const result = await withdrawForkedEscalationDeposits(asWriteClient(client), securityPoolAddress, 'yes', [
			{
				depositor: vaultAddress,
				amountAttoRep: 5n,
				parentDepositIndex: 3n,
				cumulativeAmountAttoRep: 8n,
				sourceNodeId: 2n,
				leafIndex: 1n,
				merkleMountainRangeSiblings: [merkleMountainRangeSibling],
				merkleMountainRangePeakIndex: 1n,
				nullifierSiblings: [nullifierSibling],
			},
		])

		expect(capturedTo).toBe(securityPoolAddress)
		expect(capturedData).toBeDefined()
		const decodedCall = decodeFunctionData({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			data: capturedData ?? ('0x' satisfies Hex),
		})
		expect(decodedCall.functionName).toBe('withdrawForkedEscalationDeposits')
		expect(decodedCall.args[0]).toBe(1n)
		expect(decodedCall.args[1]).toMatchObject([
			{
				depositor: vaultAddress,
				amountAttoRep: 5n,
				parentDepositIndex: 3n,
				cumulativeAmountAttoRep: 8n,
				sourceNodeId: 2n,
				leafIndex: 1n,
				merkleMountainRangeSiblings: [merkleMountainRangeSibling],
				merkleMountainRangePeakIndex: 1n,
				nullifierSiblings: [nullifierSibling],
			},
		])
		expect(result).toEqual({
			action: 'settleForkedEscalation',
			hash: mockTransactionHash,
			securityPoolAddress,
			universeId: 12n,
		})
	})
})

for (const remaining of [0n, 1n, 60n, 61n]) {
	test(`reserves reporting submission time before the escalation cutoff (${remaining})`, async () => {
		let sends = 0
		const writer = createMockWriteClient(
			() => {
				sends += 1
			},
			async request => {
				if (request.functionName === 'universeId') return 0n
				if (request.functionName === 'escalationGame') return escalationGameAddress
				if (request.functionName === 'ordinarySettlementInitialized') return false
				if (request.functionName === 'forkContinuation') return false
				if (request.functionName === 'getEscalationGameEndDate') return 1000n
				throw new Error(`Unexpected read: ${request.functionName}`)
			},
		)
		const client = { ...asWriteClient(writer), getBlock: async () => createBlockWithTimestamp(1000n - remaining) }
		const result = reportOutcomeInSecurityPool(client, securityPoolAddress, 'no', 2n)
		if (remaining > 60n) {
			await expect(result).resolves.toHaveProperty('action', 'reportOutcome')
			expect(sends).toBe(1)
		} else {
			await expect(result).rejects.toThrow('response window ends too soon')
			expect(sends).toBe(0)
		}
	})
}

for (const _advanceDuring of ['initial', 'deposit', 'preview'] as const) {
	for (const _remaining of [0n, 1n, 60n, 61n]) {
	}
}

for (const _delayedStep of [0, 1]) {
}
