/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { concatHex, decodeFunctionData, encodeAbiParameters, getAddress, keccak256, parseAbiParameters, zeroAddress, type Address, type Hex } from '@zoltar/shared/ethereum'
import { buildForkCarriedEscalationProofs, loadEscalationDeposits, loadReportingDetails, claimParentEscalationDeposits, migrateVaultWithUnresolvedEscalation, withdrawForkedEscalationDeposits } from '../../protocol/index.js'
import { peripherals_SecurityPool_SecurityPool, peripherals_SecurityPoolForker_SecurityPoolForker } from '../../contractArtifact.js'
import type { EscalationSide } from '../../types/contracts.js'
import { asWriteClient, createBlockWithTimestamp, createMockReadClient, createMockWriteClient, createMulticallStub, createReadContractStub, getContractFunctionName, mockTransactionHash, type MockReadContractHandler } from './testSupport.js'

const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000a1')
const vaultAddress = getAddress('0x00000000000000000000000000000000000000c1')
const alternateSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000a2')
const escalationGameAddress = getAddress('0x00000000000000000000000000000000000000e6')
const zoltarAddress = getAddress('0x00000000000000000000000000000000000000e7')
const missingForkContinuationGetterMessage = 'The contract function "forkContinuation" returned no data ("0x"). The contract does not have the function "forkContinuation".'
const carryLeafAbi = parseAbiParameters('address depositor, uint8 outcome, uint256 amount, uint256 parentDepositIndex, uint256 cumulativeAmount, uint256 sourceNodeId')

function hashCarryLeafForTest(depositor: Address, outcome: bigint, amount: bigint, parentDepositIndex: bigint, cumulativeAmount: bigint, sourceNodeId: bigint) {
	return keccak256(encodeAbiParameters(carryLeafAbi, [depositor, outcome, amount, parentDepositIndex, cumulativeAmount, sourceNodeId]))
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

describe('reporting protocol client', () => {
	test('loadReportingDetails keeps proof deposits visible after optional parent-lock cleanup', async () => {
		const viewerAddress = getAddress('0x00000000000000000000000000000000000000ed')
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const unlockedPoolClaim = 70n
		const escrowedRep = 30n
		const client = {
			getBlock: async () => createBlockWithTimestamp(88n),
			getCode: async () => '0x1234' as Hex,
			multicall: createMulticallStub(async request => {
				const firstContract = request.contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'questionId') return [1n, escalationGameAddress, 20n, 3n, zoltarAddress, 5n, 0n, 3n, zeroAddress]
				if (functionName === 'questions') return [questionTuple, 10n]
				if (functionName === 'startBond') return [7n, 50n, 12n, 22n, 11n, [1n, 14n, 3n], 150n, 3n, 0n, false]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.functionName === 'startBond') return 7n
				if (request.functionName === 'nonDecisionThreshold') return 50n
				if (request.functionName === 'activationTime') return 12n
				if (request.functionName === 'totalCost') return 22n
				if (request.functionName === 'getBindingCapital') return 11n
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
				if (request.functionName === 'forkContinuation') return false
				if (request.functionName === 'getForkThreshold') return 100n
				if (request.functionName === 'escalationGame') return escalationGameAddress
				if (request.functionName === 'escrowedRepByVault') return escrowedRep
				if (request.functionName === 'securityVaults') return [100n, 0n, 0n, 0n, 0n]
				if (request.functionName === 'getEscalationMigrationEntitlementStatus') return [true, escrowedRep, [false, true, false]]
				if (request.functionName === 'poolOwnershipToRep') return unlockedPoolClaim
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				if (request.functionName === 'getDepositsByOutcome') {
					const args = request.args
					if (!Array.isArray(args) || typeof args[0] !== 'number') throw new Error('Expected deposit outcome args')
					return args[0] === 1 ? [{ amount: escrowedRep, cumulativeAmount: escrowedRep, depositor: viewerAddress }] : []
				}
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			}),
		} as unknown as Parameters<typeof loadReportingDetails>[0]

		const details = await loadReportingDetails(client, securityPoolAddress, viewerAddress)

		if (details.status !== 'active') throw new Error('Expected active reporting details')
		expect(details.viewerVaultRepDepositShare).toBe(unlockedPoolClaim)
		expect(details.viewerVaultEscrowedRep).toBe(escrowedRep)
		expect(details.viewerVaultAvailableEscalationRep).toBe(unlockedPoolClaim)
		expect(details.viewerEscalationMigrationEntitlement).toEqual({
			initialized: true,
			materializedByOutcome: { invalid: false, yes: true, no: false },
			totalCurrentRep: escrowedRep,
		})
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
				if (functionName === 'startBond') return [7n, 50n, 12n, 22n, 11n, [1n, 14n, 3n], 150n, 3n, 123n, false]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.functionName === 'startBond') return 7n
				if (request.functionName === 'nonDecisionThreshold') return 50n
				if (request.functionName === 'activationTime') return 12n
				if (request.functionName === 'totalCost') return 22n
				if (request.functionName === 'getBindingCapital') return 11n
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
				if (request.functionName === 'forkContinuation') return false
				if (request.functionName === 'getForkThreshold') return 100n
				if (request.functionName === 'escalationGame') return escalationGameAddress
				if (request.functionName === 'escrowedRepByVault') return 9n
				if (request.functionName === 'securityVaults') return [0n, 0n, 0n, 0n, 0n]
				if (request.functionName === 'getEscalationMigrationEntitlementStatus') return [false, 0n, [false, false, false]]
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				if (request.functionName === 'getDepositsByOutcome') {
					const args = request.args
					if (!Array.isArray(args) || typeof args[0] !== 'number') throw new Error('Expected deposit outcome args')
					if (args[0] === 1) {
						return [{ amount: 9n, cumulativeAmount: 17n, depositor: viewerAddress }]
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
				if (functionName === 'startBond') return [7n, 50n, 12n, 22n, 11n, [1n, 14n, 3n], 99n, 3n, 120n, false]
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			}),
			readContract: createReadContractStub(async request => {
				if (request.functionName === 'startBond') return 7n
				if (request.functionName === 'nonDecisionThreshold') return 50n
				if (request.functionName === 'activationTime') return 12n
				if (request.functionName === 'totalCost') return 22n
				if (request.functionName === 'getBindingCapital') return 11n
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
				if (request.functionName === 'forkContinuation') return false
				if (request.functionName === 'getForkThreshold') return 100n
				if (request.functionName === 'escalationGame') return escalationGameAddress
				if (request.functionName === 'escrowedRepByVault') return 9n
				if (request.functionName === 'securityVaults') return [0n, 0n, 0n, 0n, 0n]
				if (request.functionName === 'getEscalationMigrationEntitlementStatus') return [false, 0n, [false, false, false]]
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				if (request.functionName === 'getDepositsByOutcome') {
					const args = request.args
					if (!Array.isArray(args) || typeof args[0] !== 'number') throw new Error('Expected deposit outcome args')
					if (args[0] === 1) {
						return [{ amount: 9n, cumulativeAmount: 17n, depositor: viewerAddress }]
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

	test('loadReportingDetails keeps pool-level finality when no escalation game exists', async () => {
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
				if (request.functionName === 'getForkThreshold') return 100n
				if (request.functionName === 'securityVaults') return [0n, 0n, 0n, 0n, 0n]
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			}),
		} as unknown as Parameters<typeof loadReportingDetails>[0]

		const details = await loadReportingDetails(client, securityPoolAddress, undefined)

		expect(details.status).toBe('not-started')
		expect(details.questionOutcome).toBe('yes')
		expect(details.settlementState).toBe('resolved')
		expect(details.parentWithdrawalEnabled).toBe(false)
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
				if (request.functionName === 'getForkThreshold') return 100n
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
				if (request.functionName === 'getForkThreshold') return 100n
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
				if (request.functionName === 'getForkThreshold') return 100n
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

	test('loadEscalationDeposits continues paging past settled entries on a full page', async () => {
		const escalationGameAddress = getAddress('0x00000000000000000000000000000000000000d4')
		const depositor = getAddress('0x00000000000000000000000000000000000000e5')
		const readCalls: bigint[] = []
		const firstPage = Array.from({ length: 30 }, (_, index) => ({
			amount: index === 29 ? 0n : BigInt(index + 1),
			cumulativeAmount: BigInt(index + 1),
			depositor,
		}))
		const secondPage = [
			{
				amount: 31n,
				cumulativeAmount: 31n,
				depositor,
			},
		]
		const readContract: MockReadContractHandler = async request => {
			const args = Reflect.get(request, 'args')
			const startIndex = Array.isArray(args) ? args[1] : undefined
			if (typeof startIndex !== 'bigint') throw new Error('Expected pagination start index')
			readCalls.push(startIndex)
			if (startIndex === 0n) return firstPage
			if (startIndex === 30n) return secondPage
			throw new Error(`Unexpected start index: ${startIndex.toString()}`)
		}
		const client = createMockReadClient(async request => {
			return await readContract(request)
		})

		const deposits = await loadEscalationDeposits(client, escalationGameAddress, 'yes')

		expect(readCalls).toEqual([0n, 30n])
		expect(deposits).toHaveLength(30)
		expect(deposits.some(deposit => deposit.amount === 0n)).toBe(false)
		expect(deposits[28]?.depositIndex).toBe(28n)
		expect(deposits[29]?.depositIndex).toBe(30n)
	})

	test('loadEscalationDeposits rejects malformed deposit pages instead of dropping entries', async () => {
		const client = createMockReadClient(async request => {
			if (request.functionName === 'getDepositsByOutcome') {
				return [{ amount: 1n, cumulativeAmount: 1n, depositor: 'not-an-address' }]
			}
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		})

		await expect(loadEscalationDeposits(client, escalationGameAddress, 'yes')).rejects.toThrow('Unexpected escalation deposit page response')
	})

	test('buildForkCarriedEscalationProofs rejects malformed historical carry nodes instead of dropping entries', async () => {
		const parentEscalationGameAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const zeroHash = '0x0000000000000000000000000000000000000000000000000000000000000000' satisfies Hex
		const client = {
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

	test('buildForkCarriedEscalationProofs retains a directly claimed leaf when hashing the frozen child snapshot', async () => {
		const parentEscalationGameAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const firstDepositor = getAddress('0x00000000000000000000000000000000000000f2')
		const secondDepositor = getAddress('0x00000000000000000000000000000000000000f3')
		const securityPoolForkerAddress = getAddress('0x00000000000000000000000000000000000000f4')
		const zeroHash = ('0x' + '00'.repeat(32)) as Hex
		const emptyNullifierRoot = computeEmptyNullifierRootForTest()
		const firstLeaf = {
			amount: 3n,
			cumulativeAmount: 3n,
			depositor: firstDepositor,
			parentDepositIndex: 0n,
			sourceNodeId: 1n,
		}
		const secondLeaf = {
			amount: 5n,
			cumulativeAmount: 8n,
			depositor: secondDepositor,
			parentDepositIndex: 1n,
			sourceNodeId: 2n,
		}
		const firstLeafHash = hashCarryLeafForTest(firstLeaf.depositor, 1n, firstLeaf.amount, firstLeaf.parentDepositIndex, firstLeaf.cumulativeAmount, firstLeaf.sourceNodeId)
		const secondLeafHash = hashCarryLeafForTest(secondLeaf.depositor, 1n, secondLeaf.amount, secondLeaf.parentDepositIndex, secondLeaf.cumulativeAmount, secondLeaf.sourceNodeId)
		const frozenRoot = hashCarryParentForTest(firstLeafHash, secondLeafHash)
		const snapshotPeaks = Array.from({ length: 64 }, () => zeroHash)
		snapshotPeaks[1] = frozenRoot
		const client = {
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
				if (request.address === parentEscalationGameAddress && request.functionName === 'getCarryLeafPageByOutcome') return [[secondLeaf], 0n]
				if (request.address === parentEscalationGameAddress && request.functionName === 'nodes') {
					const args = request.args
					if (!Array.isArray(args)) throw new Error('Expected node args')
					if (args[0] === 2n) return [1n, secondLeaf.depositor, 1, secondLeaf.amount, secondLeaf.parentDepositIndex, secondLeaf.cumulativeAmount, 1n]
					if (args[0] === 1n) return [0n, firstLeaf.depositor, 1, firstLeaf.amount, firstLeaf.parentDepositIndex, firstLeaf.cumulativeAmount, 0n]
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
			amount: 3n,
			cumulativeAmount: 3n,
			depositor,
			parentDepositIndex: 9n,
			sourceNodeId: 1n,
		}
		const childLocalLeaf = {
			amount: 1n,
			cumulativeAmount: 4n,
			depositor,
			parentDepositIndex: 1n,
			sourceNodeId: 2n,
		}
		const inheritedLeafHash = hashCarryLeafForTest(inheritedLeaf.depositor, 1n, inheritedLeaf.amount, inheritedLeaf.parentDepositIndex, inheritedLeaf.cumulativeAmount, inheritedLeaf.sourceNodeId)
		const childLocalLeafHash = hashCarryLeafForTest(childLocalLeaf.depositor, 1n, childLocalLeaf.amount, childLocalLeaf.parentDepositIndex, childLocalLeaf.cumulativeAmount, childLocalLeaf.sourceNodeId)
		const parentCarryRoot = hashCarryParentForTest(inheritedLeafHash, childLocalLeafHash)
		const snapshotPeaks = Array.from({ length: 64 }, () => zeroHash)
		snapshotPeaks[1] = parentCarryRoot
		const client = {
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
					return [0n, childLocalLeaf.depositor, 1, childLocalLeaf.amount, childLocalLeaf.parentDepositIndex, childLocalLeaf.cumulativeAmount, 1n]
				}
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'nodes') {
					return [0n, inheritedLeaf.depositor, 1, inheritedLeaf.amount, inheritedLeaf.parentDepositIndex, inheritedLeaf.cumulativeAmount, 0n]
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
			amount: 3n,
			cumulativeAmount: 3n,
			depositor,
			parentDepositIndex: 9n,
			sourceNodeId: 1n,
		}
		const settledLocalLeaf = {
			amount: 1n,
			cumulativeAmount: 4n,
			depositor,
			parentDepositIndex: 1n,
			sourceNodeId: 2n,
		}
		const inheritedLeafHash = hashCarryLeafForTest(inheritedLeaf.depositor, 1n, inheritedLeaf.amount, inheritedLeaf.parentDepositIndex, inheritedLeaf.cumulativeAmount, inheritedLeaf.sourceNodeId)
		const frozenRoot = hashCarryParentForTest(inheritedLeafHash, zeroHash)
		const snapshotPeaks = Array.from({ length: 64 }, () => zeroHash)
		snapshotPeaks[1] = frozenRoot
		const client = {
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
					return [0n, settledLocalLeaf.depositor, 1, settledLocalLeaf.amount, settledLocalLeaf.parentDepositIndex, settledLocalLeaf.cumulativeAmount, 1n]
				}
				if (request.address === grandparentEscalationGameAddress && request.functionName === 'nodes') {
					return [0n, inheritedLeaf.depositor, 1, inheritedLeaf.amount, inheritedLeaf.parentDepositIndex, inheritedLeaf.cumulativeAmount, 0n]
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
		const firstLeaf = { amount: 3n, cumulativeAmount: 3n, depositor, parentDepositIndex: 9n, sourceNodeId: 1n }
		const secondLeaf = { amount: 5n, cumulativeAmount: 8n, depositor, parentDepositIndex: 10n, sourceNodeId: 2n }
		const firstLeafHash = hashCarryLeafForTest(firstLeaf.depositor, 1n, firstLeaf.amount, firstLeaf.parentDepositIndex, firstLeaf.cumulativeAmount, firstLeaf.sourceNodeId)
		const secondLeafHash = hashCarryLeafForTest(secondLeaf.depositor, 1n, secondLeaf.amount, secondLeaf.parentDepositIndex, secondLeaf.cumulativeAmount, secondLeaf.sourceNodeId)
		const frozenRoot = hashCarryParentForTest(firstLeafHash, secondLeafHash)
		const snapshotPeaks = Array.from({ length: 64 }, () => zeroHash)
		snapshotPeaks[1] = frozenRoot
		const inheritedNullifierRoot = computeSingleConsumedNullifierRootForTest(firstLeaf.parentDepositIndex)
		const client = {
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
					if (args[0] === 2n) return [1n, secondLeaf.depositor, 1, secondLeaf.amount, secondLeaf.parentDepositIndex, secondLeaf.cumulativeAmount, 1n]
					if (args[0] === 1n) return [0n, firstLeaf.depositor, 1, firstLeaf.amount, firstLeaf.parentDepositIndex, firstLeaf.cumulativeAmount, 0n]
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
		await expect(buildForkCarriedEscalationProofs(client, securityPoolAddress, 'yes', [firstLeaf.parentDepositIndex])).rejects.toThrow('Parent carry leaf 9 is already settled.')
	})

	test('buildForkCarriedEscalationProofs encodes peak-relative indexes for three- and six-leaf tail peaks', async () => {
		const parentEscalationGameAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const depositor = getAddress('0x00000000000000000000000000000000000000f2')
		for (const { leafCount, targetGlobalIndex, targetPeakIndex } of [
			{ leafCount: 3, targetGlobalIndex: 2, targetPeakIndex: 0n },
			{ leafCount: 6, targetGlobalIndex: 5, targetPeakIndex: 1n },
		]) {
			const leaves = Array.from({ length: leafCount }, (_, index) => ({
				amount: BigInt(index + 1),
				cumulativeAmount: BigInt(((index + 1) * (index + 2)) / 2),
				depositor,
				parentDepositIndex: BigInt(100 + index),
				sourceNodeId: BigInt(index + 1),
			}))
			const leafHashes = leaves.map(leaf => hashCarryLeafForTest(leaf.depositor, 1n, leaf.amount, leaf.parentDepositIndex, leaf.cumulativeAmount, leaf.sourceNodeId))
			const snapshotPeaks = buildCarrySnapshotPeaksForTest(leafHashes)
			const targetLeaf = leaves[targetGlobalIndex]
			if (targetLeaf === undefined) throw new Error('Missing target test leaf')
			const client = {
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
						const nodeIndex = Number(args[0] - 1n)
						const leaf = leaves[nodeIndex]
						if (leaf === undefined) throw new Error(`Unexpected node id: ${args[0].toString()}`)
						return [args[0] - 1n, leaf.depositor, 1, leaf.amount, leaf.parentDepositIndex, leaf.cumulativeAmount, BigInt(nodeIndex)]
					}
					if (request.address === parentEscalationGameAddress && request.functionName === 'getCarryLeafPageByOutcome') return [[...leaves].reverse(), 0n]
					if (request.functionName === 'getProofConsumedCarriedDepositIndexesByOutcome') return []
					throw new Error(`Unexpected readContract function: ${request.functionName} at ${String(request.address)}`)
				}),
			} as unknown as Parameters<typeof buildForkCarriedEscalationProofs>[0]

			await expect(buildForkCarriedEscalationProofs(client, securityPoolAddress, 'yes', [targetLeaf.parentDepositIndex])).resolves.toMatchObject([{ leafIndex: targetPeakIndex, parentDepositIndex: targetLeaf.parentDepositIndex }])
		}
	})

	test('migrateVaultWithUnresolvedEscalation helper encodes the selected child outcome correctly', async () => {
		let capturedData: Hex | undefined
		let capturedTo: Address | null | undefined
		const client = createMockWriteClient(request => {
			capturedData = request.data
			capturedTo = request.to
		})

		const result = await migrateVaultWithUnresolvedEscalation(asWriteClient(client), securityPoolAddress, vaultAddress, 9n, 'no')

		expect(capturedTo).toBeDefined()
		expect(capturedData).toBeDefined()
		const decodedCall = decodeFunctionData({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			data: capturedData ?? ('0x' satisfies Hex),
		})
		if (!Array.isArray(decodedCall.args) || decodedCall.args.length !== 3) throw new Error('Unexpected migrateVaultWithUnresolvedEscalation calldata')
		const decodedArgs = decodedCall.args
		expect(decodedCall.functionName).toBe('migrateVaultWithUnresolvedEscalation')
		expect(decodedArgs[0]).toBe(securityPoolAddress)
		expect(decodedArgs[1]).toBe(vaultAddress)
		expect(decodedArgs[2]).toBe(2n)
		expect(result).toEqual({
			action: 'migrateUnresolvedEscalation',
			hash: mockTransactionHash,
			securityPoolAddress,
			universeId: 9n,
		})
	})

	test('claimParentEscalationDeposits helper keeps deposit indexes as uint256 values', async () => {
		let capturedData: Hex | undefined
		let capturedTo: Address | null | undefined
		const client = createMockWriteClient(request => {
			capturedData = request.data
			capturedTo = request.to
		})

		const result = await claimParentEscalationDeposits(asWriteClient(client), securityPoolAddress, 9n, vaultAddress, 'yes', [0n, 255n, 256n])

		expect(capturedTo).toBeDefined()
		expect(capturedData).toBeDefined()
		const decodedCall = decodeFunctionData({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			data: capturedData ?? ('0x' satisfies Hex),
		})
		if (!Array.isArray(decodedCall.args) || decodedCall.args.length !== 4) throw new Error('Unexpected claimForkedEscalationDeposits calldata')
		const decodedArgs = decodedCall.args
		expect(decodedCall.functionName).toBe('claimForkedEscalationDeposits')
		expect(decodedArgs[0]).toBe(securityPoolAddress)
		expect(decodedArgs[1]).toBe(vaultAddress)
		expect(decodedArgs[2]).toBe(1n)
		expect(decodedArgs[3]).toEqual([0n, 255n, 256n])
		expect(result).toEqual({
			action: 'claimParentEscalationDeposits',
			hash: mockTransactionHash,
			securityPoolAddress,
			universeId: 9n,
		})
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
				amount: 5n,
				parentDepositIndex: 3n,
				cumulativeAmount: 8n,
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
			abi: peripherals_SecurityPool_SecurityPool.abi,
			data: capturedData ?? ('0x' satisfies Hex),
		})
		expect(decodedCall.functionName).toBe('withdrawForkedEscalationDeposits')
		expect(decodedCall.args[0]).toBe(1n)
		expect(decodedCall.args[1]).toMatchObject([
			{
				depositor: vaultAddress,
				amount: 5n,
				parentDepositIndex: 3n,
				cumulativeAmount: 8n,
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
