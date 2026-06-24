import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { concatHex, decodeEventLog, encodeAbiParameters, encodeDeployData, keccak256, type Address, type Hex, zeroAddress } from 'viem'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient, writeContractAndWait } from '../testsuite/simulator/utils/viem'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { addressString } from '../testsuite/simulator/utils/bigint'
import { contractExists, setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { QuestionOutcome } from '../testsuite/simulator/types/types'
import assert from '../testsuite/simulator/utils/assert'
import { deployEscalationGame, depositOnOutcome, getActivationTime, getBalances, getEscalationGameDeposits, getQuestionResolution } from '../testsuite/simulator/utils/contracts/escalationGame'
import { ensureZoltarDeployed, getRepTokenAddress, getZoltarAddress } from '../testsuite/simulator/utils/contracts/zoltar'
import { ensureInfraDeployed } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import {
	peripherals_EscalationGame_EscalationGame,
	peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier,
	ReputationToken_ReputationToken,
	test_peripherals_EscalationGameProofTestSecurityPool_EscalationGameProofTestSecurityPool as escalationGameProofTestPoolArtifact,
	test_peripherals_IncompatibleEscalationGameProofVerifier_IncompatibleEscalationGameProofVerifier as incompatibleProofVerifierArtifact,
} from '../types/contractArtifact'
import { getERC20Balance } from '../testsuite/simulator/utils/utilities'
import { isIgnorableLogDecodeError } from './logDecodeErrors'

const ESCALATION_TIME_LENGTH = 4233600n
const NULLIFIER_DEPTH = 64
const MAX_UINT256 = 2n ** 256n - 1n

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('Escalation Game Test Suite', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const reportBond = 1n * 10n ** 18n
	const nonDecisionThreshold = 1000n * 10n ** 18n
	const recursiveResolutionTargetCost = (25n * reportBond) / 10n

	const readIterativeAttritionCost = async (escalationGame: Address, timeSinceStart: bigint) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'computeIterativeAttritionCost',
			address: escalationGame,
			args: [timeSinceStart],
		})

	const readTimeSinceStartFromAttritionCost = async (escalationGame: Address, attritionCost: bigint) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'computeTimeSinceStartFromAttritionCost',
			address: escalationGame,
			args: [attritionCost],
		})

	const readBindingCapital = async (escalationGame: Address) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getBindingCapital',
			address: escalationGame,
			args: [],
		})

	const readHasReachedNonDecision = async (escalationGame: Address) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'hasReachedNonDecision',
			address: escalationGame,
			args: [],
		})

	const requireContractAddress = (value: `0x${string}` | null | undefined, context: string): `0x${string}` => {
		if (value === undefined || value === null) throw new Error(`${context} missing`)
		return value
	}

	const deployEscalationGameTestSecurityPool = async () => {
		const deployment = await deployEscalationGameWithProofPool()
		await startEscalation(deployment.escalationGameAddress, reportBond, nonDecisionThreshold)
		return deployment
	}

	async function deployEscalationGameWithProofPool() {
		const testSecurityPoolAddress = await deployProofTestSecurityPool()
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: ReputationToken_ReputationToken.abi,
					address: getRepTokenAddress(0n),
					functionName: 'approve',
					args: [testSecurityPoolAddress, MAX_UINT256],
				}),
		)
		const verifierDeploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier.abi,
				bytecode: `0x${peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier.evm.bytecode.object}`,
			}),
		})
		const verifierDeploymentReceipt = await client.waitForTransactionReceipt({ hash: verifierDeploymentHash })
		const proofVerifierAddress = requireContractAddress(verifierDeploymentReceipt.contractAddress, 'proof verifier deployment address')
		const escalationGameDeploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				bytecode: `0x${peripherals_EscalationGame_EscalationGame.evm.bytecode.object}`,
				args: [testSecurityPoolAddress, getRepTokenAddress(0n), proofVerifierAddress],
			}),
		})
		const escalationGameDeploymentReceipt = await client.waitForTransactionReceipt({ hash: escalationGameDeploymentHash })
		const escalationGameAddress = requireContractAddress(escalationGameDeploymentReceipt.contractAddress, 'escalation game deployment address')
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: testSecurityPoolAddress,
					functionName: 'setEscalationGame',
					args: [escalationGameAddress],
				}),
		)
		return { escalationGameAddress, testSecurityPoolAddress }
	}

	async function deployProofTestSecurityPool() {
		const zoltarAddress = getZoltarAddress()
		const testSecurityPoolDeploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: escalationGameProofTestPoolArtifact.abi,
				bytecode: `0x${escalationGameProofTestPoolArtifact.evm.bytecode.object}`,
				args: [zoltarAddress, 0n, client.account.address],
			}),
		})
		const testSecurityPoolDeploymentReceipt = await client.waitForTransactionReceipt({ hash: testSecurityPoolDeploymentHash })
		return requireContractAddress(testSecurityPoolDeploymentReceipt.contractAddress, 'proof test security pool deployment address')
	}

	async function deployIncompatibleProofVerifier() {
		const verifierDeploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: incompatibleProofVerifierArtifact.abi,
				bytecode: `0x${incompatibleProofVerifierArtifact.evm.bytecode.object}`,
			}),
		})
		const verifierDeploymentReceipt = await client.waitForTransactionReceipt({ hash: verifierDeploymentHash })
		return requireContractAddress(verifierDeploymentReceipt.contractAddress, 'incompatible proof verifier deployment address')
	}

	const startEscalation = async (escalationGameAddress: Address, startBond: bigint, nonDecisionThreshold: bigint) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_EscalationGame_EscalationGame.abi,
					address: escalationGameAddress,
					functionName: 'start',
					args: [startBond, nonDecisionThreshold],
				}),
		)

	const startEscalationFromFork = async (escalationGameAddress: Address, startBond: bigint, nonDecisionThreshold: bigint, elapsedAtFork: bigint) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_EscalationGame_EscalationGame.abi,
					address: escalationGameAddress,
					functionName: 'startFromFork',
					args: [startBond, nonDecisionThreshold, elapsedAtFork],
				}),
		)

	const resumeEscalationFromFork = async (escalationGameAddress: Address) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_EscalationGame_EscalationGame.abi,
					address: escalationGameAddress,
					functionName: 'resumeFromFork',
					args: [],
				}),
		)

	const advanceForkContinuationPastStart = async (escalationGameAddress: Address, targetAttritionCost = reportBond + 1n) => {
		await resumeEscalationFromFork(escalationGameAddress)
		const forkResumedAt = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'forkResumedAt',
			args: [],
		})
		const elapsedAtTargetCost = await readTimeSinceStartFromAttritionCost(escalationGameAddress, targetAttritionCost)
		await mockWindow.setTime(forkResumedAt + (elapsedAtTargetCost > 0n ? elapsedAtTargetCost : 1n))
	}

	const depositOnOutcomeViaProofTestSecurityPool = async (testSecurityPoolAddress: Address, depositor: Address, outcome: QuestionOutcome, amount: bigint) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: testSecurityPoolAddress,
					functionName: 'depositOnOutcome',
					args: [depositor, outcome, amount],
				}),
		)

	const readOutcomeState = async (escalationGameAddress: Address, outcome: QuestionOutcome) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getOutcomeState',
			args: [outcome],
		})

	const readCarryPeaks = async (escalationGameAddress: Address, outcome: QuestionOutcome) => (await readOutcomeState(escalationGameAddress, outcome)).currentPeaks
	const readCarryRoot = async (escalationGameAddress: Address, outcome: QuestionOutcome) => (await readOutcomeState(escalationGameAddress, outcome)).currentCarryRoot
	const readCarryLeafCount = async (escalationGameAddress: Address, outcome: QuestionOutcome) => (await readOutcomeState(escalationGameAddress, outcome)).currentLeafCount
	const readCarryTotal = async (escalationGameAddress: Address, outcome: QuestionOutcome) => (await readOutcomeState(escalationGameAddress, outcome)).currentCarryTotal
	const readNullifierRoot = async (escalationGameAddress: Address, outcome: QuestionOutcome) => (await readOutcomeState(escalationGameAddress, outcome)).currentNullifierRoot
	const readTotalEscrowedRep = async (escalationGameAddress: Address) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'totalEscrowedRep',
			args: [],
		})

	const readForkCarrySnapshotInitialized = async (escalationGameAddress: Address) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'forkCarrySnapshotInitialized',
			args: [],
		})

	const readEscrowedRepByVault = async (escalationGameAddress: Address, vault: Address) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'escrowedRepByVault',
			args: [vault],
		})

	const readForkedEscrowByVaultAndOutcome = async (escalationGameAddress: Address, vault: Address, outcome: QuestionOutcome) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getForkedEscrowByVaultAndOutcome',
			args: [vault, outcome],
		})

	const readCarryLeafPage = async (escalationGameAddress: Address, outcome: QuestionOutcome, startNodeId: bigint, maxEntries: bigint) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getCarryLeafPageByOutcome',
			args: [outcome, startNodeId, maxEntries],
		})

	const readProofConsumedCarriedDepositIndexes = async (escalationGameAddress: Address, outcome: QuestionOutcome, startIndex: bigint, numberOfEntries: bigint) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getProofConsumedCarriedDepositIndexesByOutcome',
			args: [outcome, startIndex, numberOfEntries],
		})

	const assertEscrowAccounting = async (escalationGameAddress: Address, expectedTotalEscrowedRep: bigint) => {
		assert.strictEqual(await readTotalEscrowedRep(escalationGameAddress), expectedTotalEscrowedRep, 'total escrowed REP should match scenario accounting')
	}

	type LocalAccountingDeposit = {
		vault: Address
		amount: bigint
		depositIndex: bigint
		active: boolean
	}

	const assertLocalYesAccountingModel = async (escalationGameAddress: Address, vaults: readonly Address[], deposits: readonly LocalAccountingDeposit[]) => {
		const activeDeposits = deposits.filter(deposit => deposit.active)
		const activeTotal = activeDeposits.reduce((total, deposit) => total + deposit.amount, 0n)
		await assertEscrowAccounting(escalationGameAddress, activeTotal)
		await assertOutcomeCarryTotalsMatchComponents(escalationGameAddress)
		assert.strictEqual(await readCarryTotal(escalationGameAddress, QuestionOutcome.Yes), activeTotal, 'active local Yes model should match carry total')

		for (const vault of vaults) {
			const expectedVaultTotal = activeDeposits.filter(deposit => deposit.vault === vault).reduce((total, deposit) => total + deposit.amount, 0n)
			assert.strictEqual(await readEscrowedRepByVault(escalationGameAddress, vault), expectedVaultTotal, 'vault escrow should match active local deposits')
		}

		const [carryPage] = await readCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, 0n, BigInt(activeDeposits.length + 1))
		const expectedNewestFirst = activeDeposits.slice().reverse()
		assert.deepStrictEqual(
			carryPage.map(leaf => ({
				depositor: leaf.depositor,
				amount: leaf.amount,
				parentDepositIndex: leaf.parentDepositIndex,
			})),
			expectedNewestFirst.map(deposit => ({
				depositor: deposit.vault,
				amount: deposit.amount,
				parentDepositIndex: deposit.depositIndex,
			})),
			'carry leaf page should expose exactly the active local deposits newest first',
		)
	}

	const createDeterministicRng = (initialSeed: bigint) => {
		let seed = initialSeed
		return () => {
			seed = (seed * 1103515245n + 12345n) % (1n << 31n)
			return Number(seed)
		}
	}

	const assertOutcomeCarryTotalsMatchComponents = async (escalationGameAddress: Address) => {
		for (const outcome of [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]) {
			const state = await readOutcomeState(escalationGameAddress, outcome)
			assert.strictEqual(state.currentCarryTotal, state.inheritedUnresolvedTotal + state.localUnresolvedTotal, 'outcome carry total should equal inherited plus local unresolved REP')
		}
	}

	type PeakArray = Awaited<ReturnType<typeof readCarryPeaks>>

	const toPeakArray = (peaks: readonly Hex[]): PeakArray => {
		if (peaks.length !== 64) {
			throw new Error(`expected 64 carry peaks, got ${peaks.length}`)
		}
		return peaks as PeakArray
	}

	const zeroPeakArray = () => toPeakArray(Array.from({ length: 64 }, () => zeroHash()))

	const initializeSnapshotViaTestSecurityPool = async (
		testSecurityPoolAddress: Address,
		inheritedCarryPeaks: readonly [PeakArray, PeakArray, PeakArray],
		inheritedCarryLeafCounts: readonly [bigint, bigint, bigint],
		inheritedCarryTotals: readonly [bigint, bigint, bigint],
		inheritedNullifierRoots: readonly [Hex, Hex, Hex],
	) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: testSecurityPoolAddress,
					functionName: 'initializeForkCarrySnapshot',
					args: [inheritedCarryPeaks, inheritedCarryLeafCounts, inheritedCarryTotals, inheritedNullifierRoots],
				}),
		)

	const initializeSnapshotWithResolutionBalancesViaTestSecurityPool = async (
		testSecurityPoolAddress: Address,
		inheritedCarryPeaks: readonly [PeakArray, PeakArray, PeakArray],
		inheritedCarryLeafCounts: readonly [bigint, bigint, bigint],
		inheritedCarryTotals: readonly [bigint, bigint, bigint],
		inheritedResolutionBalances: readonly [bigint, bigint, bigint],
		inheritedNullifierRoots: readonly [Hex, Hex, Hex],
	) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: testSecurityPoolAddress,
					functionName: 'initializeForkCarrySnapshotWithResolutionBalances',
					args: [inheritedCarryPeaks, inheritedCarryLeafCounts, inheritedCarryTotals, inheritedResolutionBalances, inheritedNullifierRoots],
				}),
		)

	const withdrawDepositViaProofTestSecurityPool = async (
		testSecurityPoolAddress: Address,
		outcome: QuestionOutcome,
		proof: {
			depositor: Address
			amount: bigint
			parentDepositIndex: bigint
			cumulativeAmount: bigint
			sourceNodeId: bigint
			leafIndex: bigint
			merkleMountainRangeSiblings: readonly Hex[]
			merkleMountainRangePeakIndex: bigint
			nullifierSiblings: readonly Hex[]
		},
	) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: testSecurityPoolAddress,
					functionName: 'withdrawDeposit',
					args: [outcome, proof],
				}),
		)

	const claimDepositForWinningViaTestSecurityPool = async (testSecurityPoolAddress: Address, depositIndex: bigint, outcome: QuestionOutcome) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: testSecurityPoolAddress,
					functionName: 'claimDepositForWinning',
					args: [depositIndex, outcome],
				}),
		)

	const zeroHash = () => `0x${'0'.repeat(64)}` as Hex

	const hashCarryLeaf = (depositor: Address, outcome: QuestionOutcome, amount: bigint, parentDepositIndex: bigint, cumulativeAmount: bigint, sourceNodeId: bigint) =>
		keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [depositor, outcome, amount, parentDepositIndex, cumulativeAmount, sourceNodeId]))

	const readCarryLeafHash = async (escalationGameAddress: Address, nodeId: bigint) => {
		const node = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'nodes',
			args: [nodeId],
		})
		return hashCarryLeaf(node[1], node[2], node[3], node[4], node[5], nodeId)
	}

	const hashParent = (left: Hex, right: Hex) => keccak256(concatHex([left, right]))

	const buildZeroHashes = () => {
		const zeroHashes: Hex[] = [zeroHash()]
		for (let depth = 0; depth < NULLIFIER_DEPTH; depth += 1) {
			zeroHashes.push(hashParent(zeroHashes[depth], zeroHashes[depth]))
		}
		return zeroHashes
	}

	class SparseNullifierTree {
		private readonly zeroHashes = buildZeroHashes()
		private readonly nodes = new Map<string, Hex>()
		private readonly pathMask = (1n << BigInt(NULLIFIER_DEPTH)) - 1n
		root: Hex = this.zeroHashes[NULLIFIER_DEPTH]

		private getPath(parentDepositIndex: bigint) {
			return BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }], [parentDepositIndex]))) & this.pathMask
		}

		getProof(parentDepositIndex: bigint) {
			const path = this.getPath(parentDepositIndex)
			const siblings: Hex[] = []
			let nodeIndex = path
			for (let depth = 0; depth < NULLIFIER_DEPTH; depth += 1) {
				const siblingIndex = nodeIndex ^ 1n
				const siblingHash = this.nodes.get(`${depth}:${siblingIndex}`) ?? this.zeroHashes[depth]
				siblings.push(siblingHash)
				nodeIndex >>= 1n
			}
			return siblings
		}

		consume(parentDepositIndex: bigint) {
			const path = this.getPath(parentDepositIndex)
			let nodeIndex = path
			let nodeHash = `0x${'0'.repeat(63)}1` as Hex
			this.nodes.set(`0:${nodeIndex}`, nodeHash)
			for (let depth = 0; depth < NULLIFIER_DEPTH; depth += 1) {
				const isRightNode = (nodeIndex & 1n) === 1n
				const siblingIndex = nodeIndex ^ 1n
				const siblingHash = this.nodes.get(`${depth}:${siblingIndex}`) ?? this.zeroHashes[depth]
				const parentHash = isRightNode ? hashParent(siblingHash, nodeHash) : hashParent(nodeHash, siblingHash)
				nodeIndex >>= 1n
				nodeHash = parentHash
				this.nodes.set(`${depth + 1}:${nodeIndex}`, nodeHash)
			}
			this.root = nodeHash
		}
	}

	const createCarryProof = async (escalationGameAddress: Address, parentDepositIndex: bigint, leafIndex: bigint, merkleMountainRangePeakIndex: bigint, merkleMountainRangeSiblings: readonly Hex[], nullifierSiblings: readonly Hex[]) => {
		const node = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'nodes',
			args: [leafIndex + 1n],
		})
		return {
			depositor: node[1],
			amount: node[3],
			parentDepositIndex,
			cumulativeAmount: node[5],
			sourceNodeId: leafIndex + 1n,
			leafIndex,
			merkleMountainRangeSiblings,
			merkleMountainRangePeakIndex,
			nullifierSiblings,
		}
	}

	const depositOnOutcomeViaTestSecurityPool = async (testSecurityPoolAddress: Address, depositor: Address, outcome: QuestionOutcome, amount: bigint) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: testSecurityPoolAddress,
					functionName: 'depositOnOutcome',
					args: [depositor, outcome, amount],
				}),
		)

	const claimWinningDepositAndReadClaimLog = async (testSecurityPoolAddress: Address, depositIndex: bigint, outcome: QuestionOutcome) => {
		const claimHash = await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: testSecurityPoolAddress,
					functionName: 'claimDepositForWinning',
					args: [depositIndex, outcome],
				}),
		)
		const receipt = await client.waitForTransactionReceipt({ hash: claimHash })
		const claimLog = receipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.find(log => log?.eventName === 'ClaimDeposit')
		if (claimLog === undefined) throw new Error('ClaimDeposit log missing')
		return claimLog
	}

	beforeAll(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
	})

	test('can start a game', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		assert.ok(await contractExists(client, escalationGame), 'game was deployed')
		const outcomeBalances = await getBalances(client, escalationGame)
		assert.strictEqual(outcomeBalances.yes, 0n, 'yes stake')
		assert.strictEqual(outcomeBalances.no, 0n, 'no stake')
		assert.strictEqual(outcomeBalances.invalid, 0n, 'invalid stake')

		const activationTime = await getActivationTime(client, escalationGame)
		assert.strictEqual(activationTime !== 0n, true, 'game was started')
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.No, reportBond)
		const outcomeBalancesAfterDeposit = await getBalances(client, escalationGame)
		assert.strictEqual(outcomeBalancesAfterDeposit.yes, 0n, 'yes stake')
		assert.strictEqual(outcomeBalancesAfterDeposit.no, reportBond, 'no stake')
		assert.strictEqual(outcomeBalancesAfterDeposit.invalid, 0n, 'invalid stake')
	})

	test('constructor rejects a proof verifier address without contract code', async () => {
		const testSecurityPoolAddress = await deployProofTestSecurityPool()
		await assert.rejects(
			async () =>
				await client.sendTransaction({
					data: encodeDeployData({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						bytecode: `0x${peripherals_EscalationGame_EscalationGame.evm.bytecode.object}`,
						args: [testSecurityPoolAddress, getRepTokenAddress(0n), zeroAddress],
					}),
				}),
			/Proof verifier has no code/,
		)
	})

	test('constructor rejects a proof verifier address with incompatible contract code', async () => {
		const testSecurityPoolAddress = await deployProofTestSecurityPool()
		const incompatibleVerifierAddress = await deployIncompatibleProofVerifier()
		await assert.rejects(
			async () =>
				await client.sendTransaction({
					data: encodeDeployData({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						bytecode: `0x${peripherals_EscalationGame_EscalationGame.evm.bytecode.object}`,
						args: [testSecurityPoolAddress, getRepTokenAddress(0n), incompatibleVerifierAddress],
					}),
				}),
			/Proof verifier invalid/,
		)
	})

	test('empty started game resolves to invalid after timeout', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const activationTime = await getActivationTime(client, escalationGame)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		assert.strictEqual(await getQuestionResolution(client, escalationGame), QuestionOutcome.Invalid, 'empty game should resolve as invalid')
	})

	test('non-decision keeps question resolution at None even after the nominal timeout window', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, nonDecisionThreshold)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.No, nonDecisionThreshold)
		assert.strictEqual(await readHasReachedNonDecision(escalationGame), true, 'two threshold-reaching outcomes should trigger non-decision')
		assert.strictEqual(await getQuestionResolution(client, escalationGame), QuestionOutcome.None, 'non-decision should leave the question unresolved')

		const activationTime = await getActivationTime(client, escalationGame)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		assert.strictEqual(await readHasReachedNonDecision(escalationGame), true, 'non-decision should stay active after time advances')
		assert.strictEqual(await getQuestionResolution(client, escalationGame), QuestionOutcome.None, 'non-decision should still take precedence after time advances')
	})

	test('depositOnOutcome reverts when outcome is None', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		await assert.rejects(depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.None, reportBond))
	})

	test('depositOnOutcome reverts when outcome is out of enum range', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		// Values > 3 are outside enum (0=Invalid,1=Yes,2=No,3=None)
		await assert.rejects(depositOnOutcome(client, escalationGame, client.account.address, 4 as QuestionOutcome, reportBond))
		await assert.rejects(depositOnOutcome(client, escalationGame, client.account.address, 255 as QuestionOutcome, reportBond))
	})

	test('depositOnOutcome rejects tie adjustments that would drop the accepted deposit below the minimum bond', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Invalid, reportBond)
		await assert.rejects(depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond), /below start bond/i)
		const balances = await getBalances(client, escalationGameAddress)
		assert.strictEqual(balances.invalid, reportBond, 'original leading balance should stay untouched')
		assert.strictEqual(balances.yes, 0n, 'tying minimum deposit should not be partially accepted')
	})

	test('getEscalationGameDeposits paginates deposits without adding synthetic entries', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, reportBond * 2n)

		const deposits = await getEscalationGameDeposits(client, escalationGame, QuestionOutcome.Yes)
		const depositPage = deposits.slice(1, 6)
		const maxCountDepositPage = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'getDepositsByOutcome',
			args: [QuestionOutcome.Yes, 1n, MAX_UINT256],
		})

		assert.strictEqual(depositPage.length, 1, 'deposit paging should return only the remaining entries')
		assert.strictEqual(depositPage[0]?.amount, reportBond * 2n, 'paged deposit should retain its amount')
		assert.strictEqual(depositPage[0]?.depositor, client.account.address, 'paged deposit should retain its depositor')
		assert.strictEqual(depositPage[0]?.depositIndex, 1n, 'paged deposit should retain its index')
		assert.strictEqual(maxCountDepositPage.length, 1, 'max-count deposit paging should return only the remaining entries')
		assert.strictEqual(maxCountDepositPage[0]?.amount, reportBond * 2n, 'max-count paged deposit should retain its amount')
		assert.strictEqual(maxCountDepositPage[0]?.depositor, client.account.address, 'max-count paged deposit should retain its depositor')
	})

	test('claimDepositForWinning reverts when outcome is None', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, reportBond)
		await assert.rejects(
			writeContractAndWait(
				client,
				async () =>
					await client.writeContract({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						address: escalationGame,
						functionName: 'claimDepositForWinning',
						args: [0n, QuestionOutcome.None],
					}),
			),
		)
	})

	test('claimDepositForWinning reverts when outcome is out of enum range', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		await assert.rejects(
			writeContractAndWait(
				client,
				async () =>
					await client.writeContract({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						address: escalationGame,
						functionName: 'claimDepositForWinning',
						args: [0n, 4],
					}),
			),
		)
	})

	test('fork carry maintains an append-only Merkle Mountain Range root for inherited carryover deposits', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameWithProofPool()
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThreshold)

		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)

		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, 0n, reportBond, 1n)
		const rootAfterFirstDeposit = await readCarryRoot(escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(rootAfterFirstDeposit, firstLeafHash, 'single appended leaf should be its own Merkle Mountain Range root')

		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const secondLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, 1n, 2n * reportBond, 2n)
		const expectedTwoLeafRoot = keccak256(concatHex([firstLeafHash, secondLeafHash]))
		const rootAfterSecondDeposit = await readCarryRoot(escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(rootAfterSecondDeposit, expectedTwoLeafRoot, 'two appended leaves should bag into the expected Merkle Mountain Range root')
	})

	test('fork carry leaf paging uses node cursors and skips consumed local leaves', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameWithProofPool()
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)
		await assertEscrowAccounting(escalationGameAddress, 6n * reportBond)
		await assertOutcomeCarryTotalsMatchComponents(escalationGameAddress)
		assert.strictEqual(await readCarryTotal(escalationGameAddress, QuestionOutcome.Yes), 6n * reportBond, 'all local Yes deposits should be represented in the carry total')

		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		await claimDepositForWinningViaTestSecurityPool(testSecurityPoolAddress, 1n, QuestionOutcome.Yes)
		await assertEscrowAccounting(escalationGameAddress, 4n * reportBond)
		await assertOutcomeCarryTotalsMatchComponents(escalationGameAddress)
		assert.strictEqual(await readCarryTotal(escalationGameAddress, QuestionOutcome.Yes), 4n * reportBond, 'claiming the middle local deposit should remove only that unresolved carry')

		const [firstPage, firstNextNodeId] = await readCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, 0n, 1n)
		assert.strictEqual(firstPage.length, 1, 'first page should include one unresolved leaf')
		assert.strictEqual(firstPage[0]?.parentDepositIndex, 2n, 'first page should start from the newest unresolved leaf')
		assert.strictEqual(firstPage[0]?.amount, 3n * reportBond, 'first page should preserve the newest unresolved leaf amount')
		assert.strictEqual(firstNextNodeId, 2n, 'first page should return the next raw node cursor')

		const [secondPage, secondNextNodeId] = await readCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, firstNextNodeId, 2n)
		assert.strictEqual(secondPage.length, 1, 'second page should skip the consumed middle leaf and include the oldest unresolved leaf')
		assert.strictEqual(secondPage[0]?.parentDepositIndex, 0n, 'second page should return the remaining unresolved oldest leaf')
		assert.strictEqual(secondPage[0]?.amount, reportBond, 'second page should preserve the oldest unresolved leaf amount')
		assert.strictEqual(secondNextNodeId, 0n, 'second page should finish the cursor traversal')
	})

	test('fork carry leaf paging rejects cursors from another outcome chain', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameWithProofPool()
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.No, 2n * reportBond)

		const [yesPage] = await readCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, 0n, 1n)
		const yesNodeId = yesPage[0]?.sourceNodeId
		assert.notStrictEqual(yesNodeId, undefined)
		await assert.rejects(readCarryLeafPage(escalationGameAddress, QuestionOutcome.No, yesNodeId ?? 0n, 1n), /Outcome mismatch/)
	})

	test('fork carry snapshot initialization normalizes zero nullifier roots to the empty sparse-tree root', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)

		const initializeSnapshotHash = await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 0n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()])

		const emptyNullifierRoot = new SparseNullifierTree().root
		const snapshotInitialized = await readForkCarrySnapshotInitialized(child.escalationGameAddress)
		const yesNullifierRoot = await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Yes)
		const forkCarrySnapshot = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: child.escalationGameAddress,
			functionName: 'getForkCarrySnapshot',
			args: [],
		})
		const initializeSnapshotReceipt = await client.waitForTransactionReceipt({ hash: initializeSnapshotHash })
		const snapshotInitializedLog = initializeSnapshotReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.find(log => log?.eventName === 'ForkCarrySnapshotInitialized')

		if (snapshotInitializedLog === undefined) {
			throw new Error('missing ForkCarrySnapshotInitialized log')
		}

		assert.strictEqual(snapshotInitialized, true, 'initialized snapshots with empty nullifier roots should not look uninitialized')
		assert.strictEqual(yesNullifierRoot, emptyNullifierRoot, 'outcome state should expose the normalized empty nullifier root')
		assert.strictEqual(forkCarrySnapshot[3][1], emptyNullifierRoot, 'fork carry snapshots should export normalized empty nullifier roots')
		assert.deepStrictEqual(snapshotInitializedLog.args.inheritedNullifierRoots, [emptyNullifierRoot, emptyNullifierRoot, emptyNullifierRoot], 'snapshot initialization logs should emit normalized empty nullifier roots')
	})

	test('short carried proof reverts with a readable proof length reason', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, 2n, 0n], [0n, 2n * reportBond, 0n], [zeroHash(), zeroHash(), zeroHash()])

		const shortProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [], new SparseNullifierTree().getProof(0n))
		await assert.rejects(
			writeContractAndWait(client, async () =>
				client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: child.testSecurityPoolAddress,
					functionName: 'exportUnresolvedDeposit',
					args: [QuestionOutcome.Yes, shortProof],
				}),
			),
			/Bad MMR proof length/,
		)
	})

	test('fork carry child instances can settle multiple inherited carried deposits from proofs only', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)

		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, 0n, reportBond, 1n)
		const secondLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 2n * reportBond, 1n, 3n * reportBond, 2n)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const nullifierTree = new SparseNullifierTree()
		const firstProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [secondLeafHash], nullifierTree.getProof(0n))
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, firstProof)
		nullifierTree.consume(0n)

		const secondProof = await createCarryProof(parent.escalationGameAddress, 1n, 1n, 1n, [firstLeafHash], nullifierTree.getProof(1n))
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, secondProof)

		const remainingCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(remainingCarryTotal, 0n)
		const consumedIndexes = await readProofConsumedCarriedDepositIndexes(child.escalationGameAddress, QuestionOutcome.Yes, 0n, MAX_UINT256)
		assert.deepStrictEqual(consumedIndexes, [0n, 1n], 'max-count proof-consumed paging should return all consumed inherited indexes')
	})

	test('fork carry proof settlement rejects reusing the same carried proof twice', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)

		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress)

		const nullifierTree = new SparseNullifierTree()
		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], nullifierTree.getProof(0n))
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof), /Bad nullifier proof|Deposit settled/)
	})

	test('fork carry grandchild instances can settle inherited parent carry from a recursive child snapshot', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Invalid, 2n * reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const parentInvalidPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [parentInvalidPeaks, parentYesPeaks, zeroPeakArray()], [parentInvalidLeafCount, parentLeafCount, 0n], [parentInvalidCarryTotal, parentCarryTotal, 0n], [parentInvalidNullifierRoot, parentNullifierRoot, zeroHash()])
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const childInvalidPeaks = await readCarryPeaks(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesPeaks = await readCarryPeaks(child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidLeafCount = await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childLeafCount = await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidNullifierRoot = await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childNullifierRoot = await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Yes)

		const parentLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 3n * reportBond, 0n, 3n * reportBond, 2n)
		const childLocalLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, 1n << 255n, 4n * reportBond, 1n)

		const grandchild = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(grandchild.testSecurityPoolAddress, [childInvalidPeaks, childYesPeaks, zeroPeakArray()], [childInvalidLeafCount, childLeafCount, 0n], [childInvalidCarryTotal, childCarryTotal, 0n], [childInvalidNullifierRoot, childNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		const nullifierTree = new SparseNullifierTree()
		const proof = {
			depositor: client.account.address,
			amount: 3n * reportBond,
			parentDepositIndex: 0n,
			cumulativeAmount: 3n * reportBond,
			sourceNodeId: 2n,
			leafIndex: 0n,
			merkleMountainRangePeakIndex: 1n,
			merkleMountainRangeSiblings: [childLocalLeafHash],
			nullifierSiblings: nullifierTree.getProof(0n),
		}
		await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, proof)

		const remainingCarryTotal = await readCarryTotal(grandchild.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(remainingCarryTotal, reportBond, 'only the child-local unresolved carry should remain after settling the inherited parent leaf')
		const grandchildRoot = await readCarryRoot(grandchild.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(grandchildRoot, keccak256(concatHex([parentLeafHash, childLocalLeafHash])), 'grandchild should snapshot the recursive child carry set as a true two-leaf Merkle Mountain Range')
	})

	test('fork carry grandchild instances reject child-local leaves that were already settled before the recursive fork', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Invalid, 2n * reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const parentInvalidPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [parentInvalidPeaks, parentYesPeaks, zeroPeakArray()], [parentInvalidLeafCount, parentYesLeafCount, 0n], [parentInvalidCarryTotal, parentYesCarryTotal, 0n], [parentInvalidNullifierRoot, parentYesNullifierRoot, zeroHash()])
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		await claimDepositForWinningViaTestSecurityPool(child.testSecurityPoolAddress, 0n, QuestionOutcome.Yes)

		const childInvalidPeaks = await readCarryPeaks(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesPeaks = await readCarryPeaks(child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidLeafCount = await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesLeafCount = await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidNullifierRoot = await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesNullifierRoot = await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Yes)
		const parentLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 3n * reportBond, 0n, 3n * reportBond, 2n)
		const grandchild = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(grandchild.testSecurityPoolAddress, [childInvalidPeaks, childYesPeaks, zeroPeakArray()], [childInvalidLeafCount, childYesLeafCount, 0n], [childInvalidCarryTotal, childYesCarryTotal, 0n], [childInvalidNullifierRoot, childYesNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		const nullifierTree = new SparseNullifierTree()
		const settledChildLocalLeafProof = {
			depositor: client.account.address,
			amount: reportBond,
			parentDepositIndex: 1n << 255n,
			cumulativeAmount: 4n * reportBond,
			sourceNodeId: 1n,
			leafIndex: 1n,
			merkleMountainRangePeakIndex: 1n,
			merkleMountainRangeSiblings: [parentLeafHash],
			nullifierSiblings: nullifierTree.getProof(1n << 255n),
		}

		await assert.rejects(
			withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, settledChildLocalLeafProof),
			/Bad nullifier proof|Deposit settled|Carry peak absent|Bad carry proof|Bad MMR proof length/,
			'grandchild carry settlement must reject a child-local leaf that was already settled before the recursive fork',
		)

		const grandchildRoot = await readCarryRoot(grandchild.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(grandchildRoot, hashParent(parentLeafHash, zeroHash()), 'the recursive grandchild snapshot should keep the settled child-local position cleared in place')
	})

	test('proof-backed withdrawDeposit reverts before question finalization', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)

		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof), /Question not final/)
	})

	test('vault unresolved export is bounded and progresses by cursor across calls', async () => {
		const deployment = await deployEscalationGameWithProofPool()
		await startEscalation(deployment.escalationGameAddress, reportBond, nonDecisionThreshold)
		const depositCount = 65
		for (let index = 0; index < depositCount; index += 1) {
			await depositOnOutcomeViaProofTestSecurityPool(deployment.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		}
		await assertEscrowAccounting(deployment.escalationGameAddress, BigInt(depositCount) * reportBond)
		await assertOutcomeCarryTotalsMatchComponents(deployment.escalationGameAddress)

		const receiver = client.account.address
		const repToken = getRepTokenAddress(0n)
		const receiverBalanceBefore = await getERC20Balance(client, repToken, receiver)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: deployment.testSecurityPoolAddress,
				functionName: 'exportVaultUnresolvedDeposits',
				args: [client.account.address, receiver],
			}),
		)
		const receiverBalanceAfterFirstExport = await getERC20Balance(client, repToken, receiver)
		const hasUnexportedAfterFirstExport = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: deployment.escalationGameAddress,
			functionName: 'hasUnexportedLocalDepositRefs',
			args: [client.account.address],
		})
		await assertEscrowAccounting(deployment.escalationGameAddress, reportBond)
		await assertOutcomeCarryTotalsMatchComponents(deployment.escalationGameAddress)

		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: deployment.testSecurityPoolAddress,
				functionName: 'exportVaultUnresolvedDeposits',
				args: [client.account.address, receiver],
			}),
		)
		const receiverBalanceAfterSecondExport = await getERC20Balance(client, repToken, receiver)
		const hasUnexportedAfterSecondExport = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: deployment.escalationGameAddress,
			functionName: 'hasUnexportedLocalDepositRefs',
			args: [client.account.address],
		})
		await assertEscrowAccounting(deployment.escalationGameAddress, 0n)
		await assertOutcomeCarryTotalsMatchComponents(deployment.escalationGameAddress)

		assert.strictEqual(receiverBalanceAfterFirstExport - receiverBalanceBefore, 64n * reportBond, 'first export should only process the bounded batch size')
		assert.strictEqual(receiverBalanceAfterSecondExport - receiverBalanceAfterFirstExport, reportBond, 'second export should resume at the cursor')
		assert.strictEqual(hasUnexportedAfterFirstExport, true, 'first export should leave the final ref for a follow-up transaction')
		assert.strictEqual(hasUnexportedAfterSecondExport, false, 'second export should exhaust the cursor')
	})

	test('stateful local accounting model stays balanced across randomized deposits, exports, and claims', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameWithProofPool()
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThreshold)
		const vaults = [client.account.address, addressString(TEST_ADDRESSES[1]), addressString(TEST_ADDRESSES[2])]
		const deposits: LocalAccountingDeposit[] = []
		const nextRandom = createDeterministicRng(0x5eedn)

		const exportVault = async (vault: Address) => {
			await writeContractAndWait(client, async () =>
				client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: testSecurityPoolAddress,
					functionName: 'exportVaultUnresolvedDeposits',
					args: [vault, client.account.address],
				}),
			)
			for (const deposit of deposits) {
				if (deposit.vault === vault) deposit.active = false
			}
		}

		for (let depositIndex = 0; depositIndex < 18; depositIndex += 1) {
			const vault = vaults[nextRandom() % vaults.length]
			const amount = BigInt((nextRandom() % 5) + 1) * reportBond
			await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, vault, QuestionOutcome.Yes, amount)
			deposits.push({ vault, amount, depositIndex: BigInt(depositIndex), active: true })
			await assertLocalYesAccountingModel(escalationGameAddress, vaults, deposits)

			if (depositIndex % 5 === 4) {
				await exportVault(vaults[nextRandom() % vaults.length])
				await assertLocalYesAccountingModel(escalationGameAddress, vaults, deposits)
			}
		}

		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		const activeClaimOrder = deposits.filter(deposit => deposit.active).sort((left, right) => Number((left.depositIndex * 17n) % 31n) - Number((right.depositIndex * 17n) % 31n))

		for (const deposit of activeClaimOrder) {
			await claimDepositForWinningViaTestSecurityPool(testSecurityPoolAddress, deposit.depositIndex, QuestionOutcome.Yes)
			deposit.active = false
			await assertLocalYesAccountingModel(escalationGameAddress, vaults, deposits)
		}
	})

	test('deposit events expose updated local escrow totals', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		const vault = client.account.address
		const amount = 3n * reportBond
		const depositHash = await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, vault, QuestionOutcome.Yes, amount)
		const depositReceipt = await client.waitForTransactionReceipt({ hash: depositHash })
		const depositLog = depositReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.find(log => log?.eventName === 'DepositOnOutcome')
		if (depositLog === undefined) throw new Error('missing DepositOnOutcome log')

		const vaultEscrow = await readEscrowedRepByVault(escalationGameAddress, vault)
		const totalEscrow = await readTotalEscrowedRep(escalationGameAddress)
		const yesState = await readOutcomeState(escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(depositLog.args.depositor, vault, 'deposit log should identify the depositing vault')
		assert.strictEqual(depositLog.args.outcome, QuestionOutcome.Yes, 'deposit log should identify the outcome')
		assert.strictEqual(depositLog.args.amount, amount, 'deposit log should expose the requested amount')
		assert.strictEqual(depositLog.args.depositIndex, 0n, 'deposit log should expose the new deposit index')
		assert.strictEqual(depositLog.args.cumulativeAmount, yesState.balance, 'deposit log should expose the updated outcome balance')
		assert.strictEqual(depositLog.args.escrowedRepByVault, vaultEscrow, 'deposit log should expose the updated vault escrow')
		assert.strictEqual(depositLog.args.totalEscrowedRep, totalEscrow, 'deposit log should expose the updated total escrow')
	})

	test('forked-escrow winner payout is sent to the wallet', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, proof.amount, proof.amount],
			}),
		)

		const genRepToken = getRepTokenAddress(0n)
		const walletBalanceBefore = await getERC20Balance(client, genRepToken, client.account.address)
		const childEscrowBefore = await readEscrowedRepByVault(child.escalationGameAddress, client.account.address)
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		const walletBalanceAfter = await getERC20Balance(client, genRepToken, client.account.address)
		const childEscrowAfter = await readEscrowedRepByVault(child.escalationGameAddress, client.account.address)
		assert.strictEqual(walletBalanceAfter - walletBalanceBefore, proof.amount, 'winning forked escrow withdrawals should transfer REP to the beneficiary vault')
		assert.strictEqual(childEscrowBefore, proof.amount, 'test setup should record forked escrow as active child-game escrow')
		assert.strictEqual(childEscrowAfter, 0n, 'winning forked escrow withdrawals should clear the child-game escrow lock')
	})

	test('forked escrow events expose updated escrow totals and outcome balance', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 0n], [0n, reportBond, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()])

		const recordHash = await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, reportBond, reportBond],
			}),
		)
		const receipt = await client.waitForTransactionReceipt({ hash: recordHash })
		const decodedLogs = receipt.logs.map(log => {
			try {
				return decodeEventLog({
					abi: peripherals_EscalationGame_EscalationGame.abi,
					data: log.data,
					topics: log.topics,
				})
			} catch (error) {
				if (!isIgnorableLogDecodeError(error)) throw error
				return undefined
			}
		})
		const escrowRecordedLog = decodedLogs.find(log => log?.eventName === 'ForkedEscrowRecorded')
		if (escrowRecordedLog === undefined) throw new Error('missing ForkedEscrowRecorded log')

		const yesState = await readOutcomeState(child.escalationGameAddress, QuestionOutcome.Yes)
		const vaultEscrow = await readEscrowedRepByVault(child.escalationGameAddress, client.account.address)
		const totalEscrow = await readTotalEscrowedRep(child.escalationGameAddress)
		assert.strictEqual(escrowRecordedLog.args.depositor, client.account.address, 'forked escrow log should identify the vault')
		assert.strictEqual(escrowRecordedLog.args.outcome, QuestionOutcome.Yes, 'forked escrow log should identify the outcome')
		assert.strictEqual(escrowRecordedLog.args.sourcePrincipalTotal, reportBond, 'forked escrow log should expose the new source principal total')
		assert.strictEqual(escrowRecordedLog.args.childRepTotal, reportBond, 'forked escrow log should expose the new child REP total')
		assert.strictEqual(escrowRecordedLog.args.escrowedRepByVault, vaultEscrow, 'forked escrow log should expose the updated vault escrow')
		assert.strictEqual(escrowRecordedLog.args.totalEscrowedRep, totalEscrow, 'forked escrow log should expose the updated total escrow')
		assert.strictEqual(escrowRecordedLog.args.outcomeBalance, yesState.balance, 'forked escrow log should expose the updated outcome balance')

		const exportHash = await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'exportForkedEscrowByOutcomeWithoutTransfer',
				args: [client.account.address],
			}),
		)
		const exportReceipt = await client.waitForTransactionReceipt({ hash: exportHash })
		const vaultEscrowLog = exportReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.find(log => log?.eventName === 'VaultEscrowUpdated')
		if (vaultEscrowLog === undefined) throw new Error('missing VaultEscrowUpdated log')
		const vaultEscrowAfterExport = await readEscrowedRepByVault(child.escalationGameAddress, client.account.address)
		const totalEscrowAfterExport = await readTotalEscrowedRep(child.escalationGameAddress)
		assert.strictEqual(vaultEscrowLog.args.vault, client.account.address, 'vault escrow log should identify the vault')
		assert.strictEqual(vaultEscrowLog.args.escrowedRepByVault, vaultEscrowAfterExport, 'vault escrow log should expose the updated vault escrow')
		assert.strictEqual(vaultEscrowLog.args.totalEscrowedRep, totalEscrowAfterExport, 'vault escrow log should expose the updated total escrow')
	})

	test('forked carried proof cannot withdraw from another vaults escrow backing', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, 0n, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const relayer = addressString(TEST_ADDRESSES[1])
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: ReputationToken_ReputationToken.abi,
				address: getRepTokenAddress(0n),
				functionName: 'transfer',
				args: [child.escalationGameAddress, reportBond],
			}),
		)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [relayer, QuestionOutcome.Yes, reportBond, reportBond],
			}),
		)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof), /Forked escrow missing/)
	})

	test('escrow-backed forked carried proof cannot fall back when no escrow is recorded', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, 0n, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof), /Forked escrow missing/)
	})

	test('zero-child forked escrow lets dust proofs settle to zero without draining other outcomes', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.No, 2n * reportBond)
		const parentYesLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.No)
		const parentYesCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.No)
		const parentYesNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.No)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.No)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, parentNoPeaks], [0n, parentYesLeafCount, parentNoLeafCount], [0n, parentYesCarryTotal, parentNoCarryTotal], [0n, 0n, 1n], [zeroHash(), parentYesNullifierRoot, parentNoNullifierRoot])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: ReputationToken_ReputationToken.abi,
				address: getRepTokenAddress(0n),
				functionName: 'transfer',
				args: [child.escalationGameAddress, 1n],
			}),
		)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, reportBond, 0n],
			}),
		)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.No, parentNoCarryTotal, 1n],
			}),
		)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		const walletBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		const walletBalanceAfter = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		const childEscrowAfter = await readEscrowedRepByVault(child.escalationGameAddress, client.account.address)
		assert.strictEqual(walletBalanceAfter - walletBalanceBefore, 0n, 'zero-child dust proof should settle without paying REP')
		assert.strictEqual(childEscrowAfter, 1n, 'settling a zero-child proof must not drain escrow backing another outcome')
	})

	test('forked proof export is rejected in escrow-backed continuation mode', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, 0n, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		await assert.rejects(
			writeContractAndWait(client, async () =>
				client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: child.testSecurityPoolAddress,
					functionName: 'exportUnresolvedDeposit',
					args: [QuestionOutcome.Yes, proof],
				}),
			),
			/Forked proof unsupported/,
		)
	})

	test('forked-escrow winner payout applies the inherited reward schedule in child REP', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, addressString(TEST_ADDRESSES[1]), QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, addressString(TEST_ADDRESSES[2]), QuestionOutcome.No, reportBond)
		const parentYesLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.No)
		const parentYesCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.No)
		const parentYesNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.No)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.No)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, parentNoPeaks], [0n, parentYesLeafCount, parentNoLeafCount], [0n, parentYesCarryTotal, parentNoCarryTotal], [zeroHash(), parentYesNullifierRoot, parentNoNullifierRoot])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [await readCarryLeafHash(parent.escalationGameAddress, 2n)], new SparseNullifierTree().getProof(0n))
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, proof.amount, proof.amount],
			}),
		)

		const walletBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		const walletBalanceAfter = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		assert.ok(walletBalanceAfter - walletBalanceBefore > proof.amount, 'forked winning proof should receive reward upside, not only escrow principal')
	})

	test('recordForkedEscrowForOutcome rejects child REP backing without source principal', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await assert.rejects(
			writeContractAndWait(client, async () =>
				client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: child.testSecurityPoolAddress,
					functionName: 'recordForkedEscrowForOutcome',
					args: [client.account.address, QuestionOutcome.Yes, 0n, reportBond],
				}),
			),
			/Escrow principal missing/,
		)
	})

	test('residual sweep rejects while forked escrow remains unsettled', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 0n, 0n], [0n, 0n, 0n], [0n, reportBond, 0n], [zeroHash(), zeroHash(), zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, reportBond, reportBond],
			}),
		)
		await assert.rejects(
			writeContractAndWait(client, async () =>
				client.writeContract({
					abi: peripherals_EscalationGame_EscalationGame.abi,
					address: child.escalationGameAddress,
					functionName: 'sweepResidualRepToSecurityPool',
					args: [],
				}),
			),
			/Escrowed REP remains/,
		)
	})

	test('forked escrow export preserves original outcome buckets and cannot export twice', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		const receiver = addressString(TEST_ADDRESSES[1])
		const repToken = getRepTokenAddress(0n)
		const yesSourcePrincipal = 10n * reportBond
		const yesChildRep = 4n * reportBond
		const noSourcePrincipal = 20n * reportBond
		const noChildRep = 6n * reportBond
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: ReputationToken_ReputationToken.abi,
				address: repToken,
				functionName: 'transfer',
				args: [child.escalationGameAddress, yesChildRep + noChildRep],
			}),
		)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, yesSourcePrincipal, yesChildRep],
			}),
		)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.No, noSourcePrincipal, noChildRep],
			}),
		)

		const receiverBalanceBefore = await getERC20Balance(client, repToken, receiver)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'exportForkedEscrowByOutcome',
				args: [client.account.address, receiver],
			}),
		)
		const receiverBalanceAfter = await getERC20Balance(client, repToken, receiver)
		const yesEscrow = await readForkedEscrowByVaultAndOutcome(child.escalationGameAddress, client.account.address, QuestionOutcome.Yes)
		const noEscrow = await readForkedEscrowByVaultAndOutcome(child.escalationGameAddress, client.account.address, QuestionOutcome.No)
		assert.strictEqual(receiverBalanceAfter - receiverBalanceBefore, yesChildRep + noChildRep, 'export should transfer only child REP backing')
		assert.deepStrictEqual(yesEscrow, [yesSourcePrincipal, yesSourcePrincipal, yesChildRep, yesChildRep], 'yes forked escrow should be marked fully exported without affecting no')
		assert.deepStrictEqual(noEscrow, [noSourcePrincipal, noSourcePrincipal, noChildRep, noChildRep], 'no forked escrow should be marked fully exported without affecting yes')
		assert.strictEqual(await readEscrowedRepByVault(child.escalationGameAddress, client.account.address), 0n, 'export should clear the vault escrow lock')

		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'exportForkedEscrowByOutcome',
				args: [client.account.address, receiver],
			}),
		)
		const receiverBalanceAfterSecondExport = await getERC20Balance(client, repToken, receiver)
		assert.strictEqual(receiverBalanceAfterSecondExport, receiverBalanceAfter, 'already-exported forked escrow should not transfer twice')
	})

	// =================== Attrition Cost Function Tests ===================

	test('computeIterativeAttritionCost: edge cases - time 0 and max time', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// At time 0, cost should equal startBond
		const costAt0 = await readIterativeAttritionCost(escalationGame, 0n)
		assert.strictEqual(costAt0, reportBond, 'cost at time 0 equals startBond')

		// At full time, cost should equal nonDecisionThreshold
		const costAtMax = await readIterativeAttritionCost(escalationGame, ESCALATION_TIME_LENGTH)
		assert.strictEqual(costAtMax, nonDecisionThreshold, 'cost at max time equals nonDecisionThreshold')
	})

	// Quantifies the maximum round‑trip error in seconds across the entire time range.
	test('Round‑trip error: max deviation ≤ 20 seconds', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const step = ESCALATION_TIME_LENGTH / 100n
		let maxError = 0n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = await readIterativeAttritionCost(escalationGame, t)
			const recoveredT = await readTimeSinceStartFromAttritionCost(escalationGame, cost)
			const error = t > recoveredT ? t - recoveredT : recoveredT - t
			if (error > maxError) maxError = error
		}

		// The binary search tolerance is 64 iterations → ~2^-64 precision on time
		// In practice, observed error ≤20 seconds
		assert.ok(maxError <= 20n, `max round‑trip error ${maxError}s ≤ 20s`)
	})

	test('computeIterativeAttritionCost: monotonic increasing with loop', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const step = ESCALATION_TIME_LENGTH / 100n // test 101 points
		let previousCost = 0n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = await readIterativeAttritionCost(escalationGame, t)

			// Cost must always increase or stay same (should always increase for this function)
			assert.ok(cost >= previousCost, `cost at time ${t} should be >= cost at time ${t - step}`)

			// Cost must never exceed nonDecisionThreshold
			assert.ok(cost <= nonDecisionThreshold, `cost at time ${t} should not exceed nonDecisionThreshold`)

			previousCost = cost
		}
	})

	test('computeIterativeAttritionCost: dense sampling for monotonicity', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const step = ESCALATION_TIME_LENGTH / 250n

		let lastCost = 0n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = await readIterativeAttritionCost(escalationGame, t)

			assert.ok(cost >= lastCost, `Monotonicity violated at time ${t}: ${lastCost} -> ${cost}`)
			assert.ok(cost >= reportBond, `cost below startBond at time ${t}`)
			assert.ok(cost <= nonDecisionThreshold, `cost above threshold at time ${t}`)

			lastCost = cost
		}
	})

	test('computeTimeSinceStartFromAttritionCost: roundtrip accuracy with loop', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const step = ESCALATION_TIME_LENGTH / 50n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			// Get expected cost at this time
			const expectedCost = await readIterativeAttritionCost(escalationGame, t)

			// Compute time from this cost
			const recoveredTime = await readTimeSinceStartFromAttritionCost(escalationGame, expectedCost)

			// Allow some tolerance due to integer math and binary search termination
			const tolerance = 10n // maximum allowed deviation (in time units)
			const diff = t > recoveredTime ? t - recoveredTime : recoveredTime - t
			assert.ok(diff <= tolerance, `Roundtrip error for time ${t}: recovered ${recoveredTime}, diff ${diff}`)
		}
	})

	test('computeTimeSinceStartFromAttritionCost: handles boundary conditions', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// Cost <= startBond should return 0
		const timeFromLowCost = await readTimeSinceStartFromAttritionCost(escalationGame, reportBond)
		assert.strictEqual(timeFromLowCost, 0n, 'startBond maps to time 0')

		// Cost >= nonDecisionThreshold should return escalationTimeLength
		const timeFromHighCost = await readTimeSinceStartFromAttritionCost(escalationGame, nonDecisionThreshold)
		assert.strictEqual(timeFromHighCost, ESCALATION_TIME_LENGTH, 'threshold maps to max time')
	})

	test('totalCost: returns 0 before game starts and nonDecisionThreshold after timeout', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// totalCost before activationTime (3 days in the future) returns 0
		const costBeforeStart = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'totalCost',
			address: escalationGame,
			args: [],
		})
		assert.strictEqual(costBeforeStart, 0n, 'totalCost returns 0 before game starts')

		// Advance time past the escalation period to test after-timeout behavior
		const activationTime = await getActivationTime(client, escalationGame)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		const costAfterTimeout = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'totalCost',
			address: escalationGame,
			args: [],
		})
		assert.strictEqual(costAfterTimeout, nonDecisionThreshold, 'totalCost returns nonDecisionThreshold after timeout')
	})

	// =================== Inverse Relationship Tests ===================

	test('computeTimeSinceStartFromAttritionCost and computeIterativeAttritionCost are inverses', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// Test a dense grid of time values
		const step = ESCALATION_TIME_LENGTH / 50n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			// Compute cost at time t
			const cost = await readIterativeAttritionCost(escalationGame, t)

			// Recover time from that cost
			const recoveredT = await readTimeSinceStartFromAttritionCost(escalationGame, cost)

			// The recovered time should be within a small tolerance of original
			// Due to binary search termination and fixed-point errors
			const maxError = 20n // allow up to 20 time units error
			const error = t > recoveredT ? t - recoveredT : recoveredT - t
			assert.ok(error <= maxError, `Inverse error at t=${t}: cost=${cost}, recoveredT=${recoveredT}, error=${error}`)
		}
	})

	test('computeTimeSinceStartFromAttritionCost: monotonic increasing with cost', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const step = ESCALATION_TIME_LENGTH / 50n

		const costs: bigint[] = []
		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = await readIterativeAttritionCost(escalationGame, t)
			costs.push(cost)
		}

		// Ensure costs are non-decreasing
		for (let i = 1; i < costs.length; i++) {
			const prev = costs[i - 1]
			const curr = costs[i]
			if (prev === undefined || curr === undefined) throw new Error(`costs array element is undefined at index ${i}`)
			assert.ok(curr >= prev, `Costs should be non-decreasing: ${prev} vs ${curr}`)
		}

		// Verify recovered times also non-decreasing
		let prevRecoveredT = 0n
		for (let i = 0; i < costs.length; i++) {
			const cost = costs[i]
			if (cost === undefined) throw new Error(`costs array element is undefined at index ${i}`)
			const recoveredT = await readTimeSinceStartFromAttritionCost(escalationGame, cost)

			assert.ok(recoveredT >= prevRecoveredT, `Recovered time should be non-decreasing with cost: ${prevRecoveredT} -> ${recoveredT}`)
			prevRecoveredT = recoveredT
		}
	})

	test('computeTimeSinceStartFromAttritionCost: handles intermediate costs correctly', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)

		// Pick some intermediate cost values between startBond and nonDecisionThreshold
		// Use linear spacing to sample the exponential curve evenly
		const numSamples = 20n

		for (let i = 1n; i < numSamples; i++) {
			// Generate a target cost that's between startBond and threshold
			// Using linear interpolation for test simplicity
			const fraction = (i * 10000n) / numSamples // 0 to 10000 (basis points)
			const targetCost = reportBond + ((nonDecisionThreshold - reportBond) * fraction) / 10000n

			// Get the time for this cost
			const recoveredT = await readTimeSinceStartFromAttritionCost(escalationGame, targetCost)

			// Recovered time should be within [0, ESCALATION_TIME_LENGTH]
			assert.ok(recoveredT <= ESCALATION_TIME_LENGTH, `Recovered time ${recoveredT} <= max`)

			// Compute the expected cost at recoveredT and ensure it's close to targetCost
			const computedCost = await readIterativeAttritionCost(escalationGame, recoveredT)

			// The computed cost should be close to targetCost (within 5% for on-chain precision)
			const absError = computedCost > targetCost ? computedCost - targetCost : targetCost - computedCost
			const relErrorBps = (absError * 10000n) / nonDecisionThreshold // in basis points
			assert.ok(
				relErrorBps <= 500n, // 5% tolerance
				`Cost mismatch for fraction ${fraction / 10000n}: target=${targetCost}, got=${computedCost}, relError=${relErrorBps / 10000n}`,
			)
		}
	})

	test('depositOnOutcome prevents tie by refunding 1 wei', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const depositAmount = 100n * reportBond
		// Deposit on Yes to establish a leader
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, depositAmount)
		// Deposit same amount on Invalid; would tie, but fix reduces by 1 wei
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Invalid, depositAmount)
		const balances = await getBalances(client, escalationGame)
		assert.strictEqual(balances.yes, depositAmount, 'Yes balance as leader')
		assert.strictEqual(balances.invalid, depositAmount - 1n, 'Invalid balance reduced by 1 wei')
		assert.strictEqual(balances.no, 0n, 'No balance remains zero')
		// Advance time past game end
		const activationTime = await getActivationTime(client, escalationGame)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		const resolution = await getQuestionResolution(client, escalationGame)
		assert.strictEqual(resolution, QuestionOutcome.Yes, 'Winner should be Yes')
	})

	test('deposit on leading outcome does not trigger tie-breaking adjustment', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		const amount1 = 100n * reportBond
		const amount2 = 50n * reportBond
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, amount1)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, amount2)
		const balances = await getBalances(client, escalationGame)
		assert.strictEqual(balances.yes, amount1 + amount2, 'Yes balance increased without adjustment')
		assert.strictEqual(balances.invalid, 0n, 'Invalid balance zero')
		assert.strictEqual(balances.no, 0n, 'No balance zero')
		const activationTime = await getActivationTime(client, escalationGame)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		const resolution = await getQuestionResolution(client, escalationGame)
		assert.strictEqual(resolution, QuestionOutcome.Yes, 'Resolution should be Yes')
	})

	test('claimDepositForWinning pays the pro-rata reward for a deposit fully below binding capital', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		const winningDepositorAddress = client.account.address
		const losingDepositorAddress = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0).account.address
		const firstWinningDeposit = 5n * 10n ** 18n
		const secondWinningDeposit = 5n * 10n ** 18n
		const thirdWinningDeposit = 5n * 10n ** 18n
		const excessWinningDeposit = 2n * 10n ** 18n
		const losingDeposit = 10n * 10n ** 18n

		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, winningDepositorAddress, QuestionOutcome.Yes, firstWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, winningDepositorAddress, QuestionOutcome.Yes, secondWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, winningDepositorAddress, QuestionOutcome.Yes, thirdWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, winningDepositorAddress, QuestionOutcome.Yes, excessWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, losingDepositorAddress, QuestionOutcome.No, losingDeposit)

		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)

		assert.strictEqual(await getQuestionResolution(client, escalationGameAddress), QuestionOutcome.Yes, 'Resolution should be Yes')
		const claimLog = await claimWinningDepositAndReadClaimLog(testSecurityPoolAddress, 0n, QuestionOutcome.Yes)
		assert.strictEqual(await readBindingCapital(escalationGameAddress), losingDeposit, 'Binding capital should be the losing-side 10 REP depth')
		assert.strictEqual(claimLog.args.depositor, winningDepositorAddress, 'claim event should identify the winning depositor')
		assert.strictEqual(claimLog.args.outcome, QuestionOutcome.Yes, 'claim event should identify the winning outcome')
		assert.strictEqual(claimLog.args.parentDepositIndex, 0n, 'claim event should identify the stable parent deposit index')
		assert.strictEqual(claimLog.args.originalDepositAmount, firstWinningDeposit, 'claim event should include the original winning principal')
		assert.strictEqual(claimLog.args.amountToWithdraw, 7n * 10n ** 18n, 'The first 5 REP winning deposit should receive its 2 REP pro-rata reward share')
		assert.strictEqual(claimLog.args.transferredRep, true, 'direct winning claims should transfer REP to the depositor')
	})

	test('claimDepositForWinning treats the region between binding capital and the reward cap as the safety boundary', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		const firstWinningDepositorAddress = client.account.address
		const secondWinningDepositorAddress = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0).account.address
		const losingDepositorAddress = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0).account.address
		const firstWinningDeposit = 20n * 10n ** 18n
		const secondWinningDeposit = 14n * 10n ** 18n
		const losingDeposit = 20n * 10n ** 18n

		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, firstWinningDepositorAddress, QuestionOutcome.Yes, firstWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, secondWinningDepositorAddress, QuestionOutcome.Yes, secondWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, losingDepositorAddress, QuestionOutcome.No, losingDeposit)

		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)

		assert.strictEqual(await getQuestionResolution(client, escalationGameAddress), QuestionOutcome.Yes, 'Resolution should be Yes')
		const claimLog = await claimWinningDepositAndReadClaimLog(testSecurityPoolAddress, 1n, QuestionOutcome.Yes)
		assert.strictEqual(await readBindingCapital(escalationGameAddress), losingDeposit, 'Binding capital should be the losing-side 20 REP depth')
		assert.strictEqual(claimLog.args.depositor, secondWinningDepositorAddress, 'claim event should identify the crossing depositor')
		assert.strictEqual(claimLog.args.outcome, QuestionOutcome.Yes, 'claim event should identify the winning outcome')
		assert.strictEqual(claimLog.args.parentDepositIndex, 1n, 'claim event should identify the crossing deposit index')
		assert.strictEqual(claimLog.args.originalDepositAmount, secondWinningDeposit, 'claim event should include the crossing principal')
		assert.strictEqual(claimLog.args.amountToWithdraw, 18n * 10n ** 18n, 'The 14 REP crossing deposit should earn reward on its 10 REP safety-boundary slice and principal on its 4 REP excess slice')
		assert.strictEqual(claimLog.args.transferredRep, true, 'direct winning claims should transfer REP to the depositor')
	})

	test('claimDepositForWinning shares the full reward pool across actual winning principal when winning depth stays below the reward cap', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		const firstWinningDepositorAddress = client.account.address
		const secondWinningDepositorAddress = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0).account.address
		const losingDepositorAddress = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0).account.address
		const firstWinningDeposit = 14n * 10n ** 18n
		const secondWinningDeposit = 10n * 10n ** 18n
		const losingDeposit = 20n * 10n ** 18n

		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, firstWinningDepositorAddress, QuestionOutcome.Yes, firstWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, secondWinningDepositorAddress, QuestionOutcome.Yes, secondWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, losingDepositorAddress, QuestionOutcome.No, losingDeposit)

		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)

		assert.strictEqual(await getQuestionResolution(client, escalationGameAddress), QuestionOutcome.Yes, 'Resolution should be Yes')
		const firstClaimLog = await claimWinningDepositAndReadClaimLog(testSecurityPoolAddress, 0n, QuestionOutcome.Yes)
		const secondClaimLog = await claimWinningDepositAndReadClaimLog(testSecurityPoolAddress, 1n, QuestionOutcome.Yes)
		assert.strictEqual(await readBindingCapital(escalationGameAddress), losingDeposit, 'Binding capital should be the losing-side 20 REP depth')
		assert.strictEqual(firstClaimLog.args.depositor, firstWinningDepositorAddress, 'first claim event should identify its depositor')
		assert.strictEqual(firstClaimLog.args.parentDepositIndex, 0n, 'first claim event should identify the first deposit index')
		assert.strictEqual(firstClaimLog.args.originalDepositAmount, firstWinningDeposit, 'first claim event should include original principal')
		assert.strictEqual(firstClaimLog.args.amountToWithdraw, 21n * 10n ** 18n, 'The first 14 REP winning deposit should receive its 7 REP pro-rata reward share')
		assert.strictEqual(firstClaimLog.args.transferredRep, true, 'first direct claim should transfer REP')
		assert.strictEqual(secondClaimLog.args.depositor, secondWinningDepositorAddress, 'second claim event should identify its depositor')
		assert.strictEqual(secondClaimLog.args.parentDepositIndex, 1n, 'second claim event should identify the second deposit index')
		assert.strictEqual(secondClaimLog.args.originalDepositAmount, secondWinningDeposit, 'second claim event should include original principal')
		assert.strictEqual(secondClaimLog.args.amountToWithdraw, 15n * 10n ** 18n, 'The second 10 REP winning deposit should receive its 5 REP pro-rata reward share')
		assert.strictEqual(secondClaimLog.args.transferredRep, true, 'second direct claim should transfer REP')
	})
})
