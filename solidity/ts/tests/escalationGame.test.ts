import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { decodeEventLog, encodeDeployData, encodeFunctionData, type Abi, type Address, type Hex, zeroAddress } from '@zoltar/shared/ethereum'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { contractExists, requireAddress, requireArray, requireBigInt, setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import assert from '../testSupport/simulator/utils/assert'
import { deployEscalationGame, depositOnOutcome, getActivationTime, getBalances, getEscalationGameDeposits, getQuestionResolution } from '../testSupport/simulator/utils/contracts/escalationGame'
import { ensureZoltarDeployed, getRepTokenAddress, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { ensureInfraDeployed } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import {
	peripherals_EscalationGame_EscalationGame,
	peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier,
	ReputationToken_ReputationToken,
	test_peripherals_EscalationGameProofTestSecurityPool_EscalationGameProofTestSecurityPool as escalationGameProofTestPoolArtifact,
	test_peripherals_EscalationGameForkerHarness_EscalationGameForkerHarness as escalationGameForkerHarnessArtifact,
	test_peripherals_FalseReturningERC20_FalseReturningERC20,
	test_peripherals_IncompatibleEscalationGameProofVerifier_IncompatibleEscalationGameProofVerifier as incompatibleProofVerifierArtifact,
} from '../types/contractArtifact'
import { getERC20Balance } from '../testSupport/simulator/utils/utilities'
import { isIgnorableLogDecodeError } from './logDecodeErrors'
import { computeForkContinuationParentDepositIndex, createCarryProof as createCarryProofFromHelpers, hashCarryLeaf, hashParent, readCarryLeafHash as readCarryLeafHashFromHelpers, SparseNullifierTree } from './carryProofHelpers'
import { replayZoltarEvents, type ReplayLog } from './eventReplay/eventReplayModel'

const ESCALATION_TIME_LENGTH = 4233600n
const MAX_UINT256 = 2n ** 256n - 1n
const initializeForkCarrySnapshotAbi: Abi = [
	{
		inputs: [
			{ name: 'snapshotPeaksInput', type: 'bytes32[64][3]' },
			{ name: 'snapshotLeafCountsInput', type: 'uint256[3]' },
			{ name: 'snapshotCarryTotals', type: 'uint256[3]' },
			{ name: 'snapshotNullifierRoots', type: 'bytes32[3]' },
		],
		name: 'initializeForkCarrySnapshot',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
]
const initializeForkCarrySnapshotWithResolutionBalancesAbi: Abi = [
	{
		inputs: [
			{ name: 'snapshotPeaksInput', type: 'bytes32[64][3]' },
			{ name: 'snapshotLeafCountsInput', type: 'uint256[3]' },
			{ name: 'snapshotCarryTotals', type: 'uint256[3]' },
			{ name: 'snapshotResolutionBalances', type: 'uint256[3]' },
			{ name: 'snapshotNullifierRoots', type: 'bytes32[3]' },
		],
		name: 'initializeForkCarrySnapshotWithResolutionBalances',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
]
const initializeForkCarrySnapshotFromSourceAbi: Abi = [
	{
		inputs: [
			{ name: 'sourceGame', type: 'address' },
			{ name: 'snapshotId', type: 'bytes32' },
			{ name: 'snapshotPeaksInput', type: 'bytes32[64][3]' },
			{ name: 'snapshotLeafCountsInput', type: 'uint256[3]' },
			{ name: 'snapshotCarryTotals', type: 'uint256[3]' },
			{ name: 'snapshotNullifierRoots', type: 'bytes32[3]' },
		],
		name: 'initializeForkCarrySnapshotFromSource',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
]

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('Escalation Game Test Suite', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const reportBond = 1n * 10n ** 18n
	const nonDecisionThreshold = 1000n * 10n ** 18n
	const recursiveResolutionTargetCost = (25n * reportBond) / 10n

	type CarryLeaf = {
		depositor: Address
		amount: bigint
		parentDepositIndex: bigint
		sourceNodeId: bigint
	}

	const getTupleField = (value: unknown, index: number, key: string, context: string) => {
		if (Array.isArray(value)) return value[index]
		if (typeof value !== 'object' || value === null) throw new Error(`${context} must be a tuple`)
		return Reflect.get(value, key)
	}

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

	async function deployEscalationGameWithProofPool(repTokenAddress: Address = getRepTokenAddress(0n), forkerAddress: Address = addressString(0n)) {
		const testSecurityPoolAddress = await deployProofTestSecurityPool(forkerAddress)
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
				args: [testSecurityPoolAddress, repTokenAddress, proofVerifierAddress],
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

	async function deployEscalationGameForkerHarness() {
		const deploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: escalationGameForkerHarnessArtifact.abi,
				bytecode: `0x${escalationGameForkerHarnessArtifact.evm.bytecode.object}`,
			}),
		})
		const deploymentReceipt = await client.waitForTransactionReceipt({ hash: deploymentHash })
		return requireContractAddress(deploymentReceipt.contractAddress, 'escalation game forker harness deployment address')
	}

	async function deployProofTestSecurityPool(forkerAddress: Address = addressString(0n)) {
		const zoltarAddress = getZoltarAddress()
		const testSecurityPoolDeploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: escalationGameProofTestPoolArtifact.abi,
				bytecode: `0x${escalationGameProofTestPoolArtifact.evm.bytecode.object}`,
				args: [zoltarAddress, 0n, forkerAddress],
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

	async function deployFalseReturningToken() {
		const tokenDeploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: test_peripherals_FalseReturningERC20_FalseReturningERC20.abi,
				bytecode: `0x${test_peripherals_FalseReturningERC20_FalseReturningERC20.evm.bytecode.object}`,
			}),
		})
		const tokenDeploymentReceipt = await client.waitForTransactionReceipt({ hash: tokenDeploymentHash })
		return requireContractAddress(tokenDeploymentReceipt.contractAddress, 'false-returning token deployment address')
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

	const readIsForkCarryFundingComplete = async (escalationGameAddress: Address) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'isForkCarryFundingComplete',
			args: [],
		})
	const readNullifierRoot = async (escalationGameAddress: Address, outcome: QuestionOutcome) => (await readOutcomeState(escalationGameAddress, outcome)).currentNullifierRoot
	const readTotalEscrowedRep = async (escalationGameAddress: Address): Promise<bigint> =>
		requireBigInt(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGameAddress,
				functionName: 'totalEscrowedRep',
				args: [],
			}),
			'Total escrowed REP',
		)

	const readForkCarrySnapshotInitialized = async (escalationGameAddress: Address) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'forkCarrySnapshotInitialized',
			args: [],
		})

	const readEscrowedRepByVault = async (escalationGameAddress: Address, vault: Address): Promise<bigint> =>
		requireBigInt(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGameAddress,
				functionName: 'escrowedRepByVault',
				args: [vault],
			}),
			'Escrowed REP by vault',
		)

	const readForkedEscrowByVaultAndOutcome = async (escalationGameAddress: Address, vault: Address, outcome: QuestionOutcome): Promise<readonly [bigint, bigint, bigint, bigint]> => {
		const forkedEscrow = requireArray(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGameAddress,
				functionName: 'getForkedEscrowByVaultAndOutcome',
				args: [vault, outcome],
			}),
			'Forked escrow by vault and outcome',
		)
		return [requireBigInt(forkedEscrow[0], 'Forked escrow source principal'), requireBigInt(forkedEscrow[1], 'Forked escrow transferred principal'), requireBigInt(forkedEscrow[2], 'Forked escrow child REP'), requireBigInt(forkedEscrow[3], 'Forked escrow transferred child REP')]
	}

	const readCarryLeafPage = async (escalationGameAddress: Address, outcome: QuestionOutcome, startNodeId: bigint, maxEntries: bigint): Promise<readonly [CarryLeaf[], bigint]> => {
		const carryLeafPage = requireArray(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGameAddress,
				functionName: 'getCarryLeafPageByOutcome',
				args: [outcome, startNodeId, maxEntries],
			}),
			'Carry leaf page',
		)
		const leaves = requireArray(carryLeafPage[0], 'Carry leaf page leaves').map((leaf: unknown) => ({
			depositor: requireAddress(getTupleField(leaf, 0, 'depositor', 'Carry leaf'), 'Carry leaf depositor'),
			amount: requireBigInt(getTupleField(leaf, 1, 'amount', 'Carry leaf'), 'Carry leaf amount'),
			parentDepositIndex: requireBigInt(getTupleField(leaf, 2, 'parentDepositIndex', 'Carry leaf'), 'Carry leaf parent deposit index'),
			sourceNodeId: requireBigInt(getTupleField(leaf, 4, 'sourceNodeId', 'Carry leaf'), 'Carry leaf source node id'),
		}))
		const nextNodeId = requireBigInt(carryLeafPage[1], 'Carry leaf page next node id')
		return [leaves, nextNodeId]
	}

	const readProofConsumedCarriedDepositIndexes = async (escalationGameAddress: Address, outcome: QuestionOutcome, startIndex: bigint, numberOfEntries: bigint) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getProofConsumedCarriedDepositIndexesByOutcome',
			args: [outcome, startIndex, numberOfEntries],
		})

	const transactWithEscalationGame = async (escalationGameAddress: Address, data: Hex) => await writeContractAndWait(client, () => client.sendTransaction({ to: escalationGameAddress, data }))

	const traceCarryLeafPage = async (escalationGameAddress: Address, outcome: QuestionOutcome, startNodeId: bigint, maxEntries: bigint) =>
		await transactWithEscalationGame(
			escalationGameAddress,
			encodeFunctionData({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'getCarryLeafPageByOutcome',
				args: [outcome, startNodeId, maxEntries],
			}),
		)

	const traceProofConsumedCarriedDepositIndexes = async (escalationGameAddress: Address, outcome: QuestionOutcome, startIndex: bigint, numberOfEntries: bigint) =>
		await transactWithEscalationGame(
			escalationGameAddress,
			encodeFunctionData({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'getProofConsumedCarriedDepositIndexesByOutcome',
				args: [outcome, startIndex, numberOfEntries],
			}),
		)
	const traceForkedEscrowByVaultAndOutcome = async (escalationGameAddress: Address, vault: Address, outcome: QuestionOutcome) =>
		await transactWithEscalationGame(
			escalationGameAddress,
			encodeFunctionData({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'getForkedEscrowByVaultAndOutcome',
				args: [vault, outcome],
			}),
		)

	const assertEscrowAccounting = async (escalationGameAddress: Address, expectedTotalEscrowedRep: bigint) => {
		assert.strictEqual(await readTotalEscrowedRep(escalationGameAddress), expectedTotalEscrowedRep, 'total escrowed REP should match scenario accounting')
	}

	type LocalAccountingDeposit = {
		vault: Address
		amount: bigint
		depositIndex: bigint
		carryActive: boolean
		escrowed: boolean
	}

	const assertLocalYesAccountingModel = async (escalationGameAddress: Address, vaults: readonly Address[], deposits: readonly LocalAccountingDeposit[]) => {
		const activeCarryDeposits = deposits.filter(deposit => deposit.carryActive)
		const escrowedDeposits = deposits.filter(deposit => deposit.escrowed)
		const activeCarryTotal = activeCarryDeposits.reduce((total, deposit) => total + deposit.amount, 0n)
		await assertEscrowAccounting(
			escalationGameAddress,
			escrowedDeposits.reduce((total, deposit) => total + deposit.amount, 0n),
		)
		await assertOutcomeCarryTotalsMatchComponents(escalationGameAddress)
		assert.strictEqual(await readCarryTotal(escalationGameAddress, QuestionOutcome.Yes), activeCarryTotal, 'active local Yes commitments should match carry total')

		for (const vault of vaults) {
			const expectedVaultTotal = escrowedDeposits.filter(deposit => deposit.vault === vault).reduce((total, deposit) => total + deposit.amount, 0n)
			assert.strictEqual(await readEscrowedRepByVault(escalationGameAddress, vault), expectedVaultTotal, 'vault escrow should match active local deposits')
		}

		const [carryPage] = await readCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, 0n, BigInt(activeCarryDeposits.length + 1))
		const expectedNewestFirst = activeCarryDeposits.slice().reverse()
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
					abi: initializeForkCarrySnapshotAbi,
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
					abi: initializeForkCarrySnapshotWithResolutionBalancesAbi,
					address: testSecurityPoolAddress,
					functionName: 'initializeForkCarrySnapshotWithResolutionBalances',
					args: [inheritedCarryPeaks, inheritedCarryLeafCounts, inheritedCarryTotals, inheritedResolutionBalances, inheritedNullifierRoots],
				}),
		)

	const initializeSnapshotFromSourceViaTestSecurityPool = async (
		testSecurityPoolAddress: Address,
		sourceGame: Address,
		snapshotId: Hex,
		inheritedCarryPeaks: readonly [PeakArray, PeakArray, PeakArray],
		inheritedCarryLeafCounts: readonly [bigint, bigint, bigint],
		inheritedCarryTotals: readonly [bigint, bigint, bigint],
		inheritedNullifierRoots: readonly [Hex, Hex, Hex],
	) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: initializeForkCarrySnapshotFromSourceAbi,
					address: testSecurityPoolAddress,
					functionName: 'initializeForkCarrySnapshotFromSource',
					args: [sourceGame, snapshotId, inheritedCarryPeaks, inheritedCarryLeafCounts, inheritedCarryTotals, inheritedNullifierRoots],
				}),
		)

	const getEscalationReplayLogs = async (transactionHashes: readonly Hex[], gameAddresses: ReadonlySet<string>) => {
		const chainId = BigInt(await client.getChainId())
		const replayLogs: ReplayLog[] = []
		for (const transactionHash of transactionHashes) {
			const receipt = await client.getTransactionReceipt({ hash: transactionHash })
			for (const log of receipt.logs) {
				if (!gameAddresses.has(log.address.toLowerCase())) continue
				let decoded: ReturnType<typeof decodeEventLog>
				try {
					decoded = decodeEventLog({ abi: peripherals_EscalationGame_EscalationGame.abi, data: log.data, topics: log.topics })
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					continue
				}
				if (typeof decoded.args !== 'object' || decoded.args === null || Array.isArray(decoded.args)) throw new Error('escalation event arguments are not named')
				replayLogs.push({
					chainId,
					blockHash: receipt.blockHash,
					blockNumber: receipt.blockNumber,
					transactionHash: receipt.transactionHash,
					transactionIndex: Number(receipt.transactionIndex),
					logIndex: Number(log.logIndex),
					emitter: log.address,
					eventName: decoded.eventName,
					args: Object.fromEntries(Object.entries(decoded.args)),
				})
			}
		}
		return replayLogs
	}

	const recordForkedEscrowForOutcomeViaTestSecurityPool = async (testSecurityPoolAddress: Address, depositor: Address, outcome: QuestionOutcome, sourcePrincipal: bigint, childRepAmount: bigint) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: testSecurityPoolAddress,
					functionName: 'recordForkedEscrowForOutcome',
					args: [depositor, outcome, sourcePrincipal, childRepAmount],
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

	const withdrawDepositViaProofTestSecurityPoolWithGas = async (
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
				await client.sendTransaction({
					to: testSecurityPoolAddress,
					data: encodeFunctionData({
						abi: escalationGameProofTestPoolArtifact.abi,
						functionName: 'withdrawDeposit',
						args: [outcome, proof],
					}),
					gas: 10_000_000n,
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
	const oneHash = () => `0x${'0'.repeat(63)}1` as Hex

	const readCarryLeafHash = async (escalationGameAddress: Address, nodeId: bigint) => await readCarryLeafHashFromHelpers(client, escalationGameAddress, nodeId)

	const createCarryProof = async (escalationGameAddress: Address, parentDepositIndex: bigint, leafIndex: bigint, merkleMountainRangePeakIndex: bigint, merkleMountainRangeSiblings: readonly Hex[], nullifierSiblings: readonly Hex[], sourceNodeId?: bigint) =>
		await createCarryProofFromHelpers(client, escalationGameAddress, {
			parentDepositIndex,
			leafIndex,
			merkleMountainRangePeakIndex,
			merkleMountainRangeSiblings,
			nullifierSiblings,
			sourceNodeId,
		})

	const computeLocalParentDepositIndex = (escalationGameAddress: Address, outcome: QuestionOutcome, depositIndex: bigint) => computeForkContinuationParentDepositIndex(escalationGameAddress, outcome, depositIndex)

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
		const noneOutcomeDepositPage = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'getDepositsByOutcome',
			args: [QuestionOutcome.None, 0n, 1n],
		})

		assert.strictEqual(depositPage.length, 1, 'deposit paging should return only the remaining entries')
		assert.strictEqual(depositPage[0]?.amount, reportBond * 2n, 'paged deposit should retain its amount')
		assert.strictEqual(depositPage[0]?.depositor, client.account.address, 'paged deposit should retain its depositor')
		assert.strictEqual(depositPage[0]?.depositIndex, 1n, 'paged deposit should retain its index')
		assert.strictEqual(maxCountDepositPage.length, 1, 'max-count deposit paging should return only the remaining entries')
		assert.strictEqual(maxCountDepositPage[0]?.amount, reportBond * 2n, 'max-count paged deposit should retain its amount')
		assert.strictEqual(maxCountDepositPage[0]?.depositor, client.account.address, 'max-count paged deposit should retain its depositor')
		assert.strictEqual(noneOutcomeDepositPage.length, 0, 'none-outcome deposit paging should always return an empty page')
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

	test('claimDepositForWinning rejects false-returning REP transfers', async () => {
		const falseReturningRepToken = await deployFalseReturningToken()
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameWithProofPool(falseReturningRepToken)
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await mockWindow.advanceTime(4n * DAY)

		await assert.rejects(claimDepositForWinningViaTestSecurityPool(testSecurityPoolAddress, 0n, QuestionOutcome.Yes), /token returned false/i)
	})

	test('local unresolved export rejects none outcome', async () => {
		const { testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		await assert.rejects(
			writeContractAndWait(client, async () =>
				client.sendTransaction({
					to: testSecurityPoolAddress,
					data: encodeFunctionData({
						abi: escalationGameProofTestPoolArtifact.abi,
						functionName: 'exportLocalUnresolvedDeposit',
						args: [0n, QuestionOutcome.None],
					}),
					gas: 10_000_000n,
				}),
			),
			/No outcome/,
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
		const expectedTwoLeafRoot = hashParent(firstLeafHash, secondLeafHash)
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

		await traceCarryLeafPage(escalationGameAddress, QuestionOutcome.None, 0n, 1n)
		await traceCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, 0n, 0n)
		await traceCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, 0n, 1n)
		await traceCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, firstNextNodeId, 2n)
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
		const carryCheckpointLog = initializeSnapshotReceipt.logs
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
			.find(log => log?.eventName === 'ForkCarryCheckpoint')

		if (carryCheckpointLog === undefined) {
			throw new Error('missing ForkCarryCheckpoint log')
		}

		assert.strictEqual(snapshotInitialized, true, 'initialized snapshots with empty nullifier roots should not look uninitialized')
		assert.strictEqual(yesNullifierRoot, emptyNullifierRoot, 'outcome state should expose the normalized empty nullifier root')
		assert.strictEqual(forkCarrySnapshot[3][1], emptyNullifierRoot, 'fork carry snapshots should export normalized empty nullifier roots')
		assert.deepStrictEqual(carryCheckpointLog.args.nullifierRoots, [emptyNullifierRoot, emptyNullifierRoot, emptyNullifierRoot], 'snapshot checkpoints should emit normalized empty nullifier roots')
	})

	test('short carried proof reverts with a readable proof length reason', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, 2n, 0n], [0n, 2n * reportBond, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()])
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond, 2n * reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const shortProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [], new SparseNullifierTree().getProof(0n))
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, shortProof), /Bad MMR proof length/)
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
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, parentCarryTotal, parentCarryTotal)
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
		await traceProofConsumedCarriedDepositIndexes(child.escalationGameAddress, QuestionOutcome.None, 0n, 1n)
		await traceProofConsumedCarriedDepositIndexes(child.escalationGameAddress, QuestionOutcome.Yes, 2n, 1n)
		await traceProofConsumedCarriedDepositIndexes(child.escalationGameAddress, QuestionOutcome.Yes, 0n, MAX_UINT256)
	})

	test('carried proof settlement consumes local unresolved overflow when inherited total is smaller than the proof amount', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, reportBond, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond, 3n * reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)

		assert.strictEqual(await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes), 0n, 'settling the proof should consume inherited REP first and then the local unresolved overflow')
		await assertOutcomeCarryTotalsMatchComponents(child.escalationGameAddress)
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
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, parentCarryTotal, parentCarryTotal)
		await advanceForkContinuationPastStart(child.escalationGameAddress)

		const nullifierTree = new SparseNullifierTree()
		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], nullifierTree.getProof(0n))
		const invalidNullifierProof = { ...proof, nullifierSiblings: [oneHash(), ...nullifierTree.getProof(0n).slice(1)] }
		await assert.rejects(withdrawDepositViaProofTestSecurityPoolWithGas(child.testSecurityPoolAddress, QuestionOutcome.Yes, { ...proof, nullifierSiblings: [] }), /Bad nullifier length/)
		await assert.rejects(withdrawDepositViaProofTestSecurityPoolWithGas(child.testSecurityPoolAddress, QuestionOutcome.Yes, invalidNullifierProof), /Bad nullifier proof/)
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof), /Bad nullifier proof|Deposit settled/)
	})

	test('fork carry proof settlement rejects when no carry snapshot is available', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await advanceForkContinuationPastStart(child.escalationGameAddress)

		await assert.rejects(
			withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, {
				depositor: client.account.address,
				amount: reportBond,
				parentDepositIndex: 0n,
				cumulativeAmount: reportBond,
				sourceNodeId: 1n,
				leafIndex: 0n,
				merkleMountainRangeSiblings: [],
				merkleMountainRangePeakIndex: 0n,
				nullifierSiblings: new SparseNullifierTree().getProof(0n),
			}),
			/Carry peak absent/,
		)
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
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, parentCarryTotal + reportBond, parentCarryTotal + reportBond)
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
		const childLocalParentDepositIndex = computeLocalParentDepositIndex(child.escalationGameAddress, QuestionOutcome.Yes, 0n)
		const childLocalLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, childLocalParentDepositIndex, 4n * reportBond, 1n)

		const grandchild = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(grandchild.testSecurityPoolAddress, [childInvalidPeaks, childYesPeaks, zeroPeakArray()], [childInvalidLeafCount, childLeafCount, 0n], [childInvalidCarryTotal, childCarryTotal, 0n], [childInvalidNullifierRoot, childNullifierRoot, zeroHash()])
		await recordForkedEscrowForOutcomeViaTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, childCarryTotal, childCarryTotal)
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
		assert.strictEqual(grandchildRoot, hashParent(parentLeafHash, childLocalLeafHash), 'grandchild should snapshot the recursive child carry set as a true two-leaf Merkle Mountain Range')
	})

	test('fork carry grandchild instances reject child-local leaves that were already settled before the recursive fork', async () => {
		const parent = await deployEscalationGameWithProofPool()
		const parentStartHash = await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		const parentInvalidDepositHash = await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Invalid, 2n * reportBond)
		const parentYesDepositHash = await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const parentInvalidPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		const childStartHash = await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		const childCheckpointHash = await initializeSnapshotFromSourceViaTestSecurityPool(
			child.testSecurityPoolAddress,
			parent.escalationGameAddress,
			zeroHash(),
			[parentInvalidPeaks, parentYesPeaks, zeroPeakArray()],
			[parentInvalidLeafCount, parentYesLeafCount, 0n],
			[parentInvalidCarryTotal, parentYesCarryTotal, 0n],
			[parentInvalidNullifierRoot, parentYesNullifierRoot, zeroHash()],
		)
		const childLocalDepositHash = await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		const childClaimHash = await claimDepositForWinningViaTestSecurityPool(child.testSecurityPoolAddress, 0n, QuestionOutcome.Yes)

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
		const grandchildStartHash = await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		const grandchildCheckpointHash = await initializeSnapshotFromSourceViaTestSecurityPool(
			grandchild.testSecurityPoolAddress,
			child.escalationGameAddress,
			zeroHash(),
			[childInvalidPeaks, childYesPeaks, zeroPeakArray()],
			[childInvalidLeafCount, childYesLeafCount, 0n],
			[childInvalidCarryTotal, childYesCarryTotal, 0n],
			[childInvalidNullifierRoot, childYesNullifierRoot, zeroHash()],
		)
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		const nullifierTree = new SparseNullifierTree()
		const settledChildLocalLeafProof = {
			depositor: client.account.address,
			amount: reportBond,
			parentDepositIndex: computeLocalParentDepositIndex(child.escalationGameAddress, QuestionOutcome.Yes, 0n),
			cumulativeAmount: 4n * reportBond,
			sourceNodeId: 1n,
			leafIndex: 1n,
			merkleMountainRangePeakIndex: 1n,
			merkleMountainRangeSiblings: [parentLeafHash],
			nullifierSiblings: nullifierTree.getProof(computeLocalParentDepositIndex(child.escalationGameAddress, QuestionOutcome.Yes, 0n)),
		}

		await assert.rejects(
			withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, settledChildLocalLeafProof),
			/Bad nullifier proof|Deposit settled|Carry peak absent|Bad carry proof|Bad MMR proof length/,
			'grandchild carry settlement must reject a child-local leaf that was already settled before the recursive fork',
		)

		const grandchildRoot = await readCarryRoot(grandchild.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(grandchildRoot, hashParent(parentLeafHash, zeroHash()), 'the recursive grandchild snapshot should keep the settled child-local position cleared in place')
		const replayLogs = await getEscalationReplayLogs(
			[parentStartHash, parentInvalidDepositHash, parentYesDepositHash, childStartHash, childCheckpointHash, childLocalDepositHash, childClaimHash, grandchildStartHash, grandchildCheckpointHash],
			new Set([parent.escalationGameAddress.toLowerCase(), child.escalationGameAddress.toLowerCase(), grandchild.escalationGameAddress.toLowerCase()]),
		)
		const replayed = replayZoltarEvents(replayLogs)
		assert.strictEqual(replayed.escalationCarryRoots.get(grandchild.escalationGameAddress)?.[QuestionOutcome.Yes], grandchildRoot, 'event-only replay should match the recursive grandchild carry root')
		assert.strictEqual(replayed.escalationCarryPeaks.get(grandchild.escalationGameAddress)?.[QuestionOutcome.Yes]?.[1], childYesPeaks[1], 'event-only replay should match the recursive grandchild carry peak')
	})

	test('grandchild local settlement does not lock an inherited child-local carried deposit with the same deposit index', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(
			child.testSecurityPoolAddress,
			[zeroPeakArray(), await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes), zeroPeakArray()],
			[0n, await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
			[0n, await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
			[zeroHash(), await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes), zeroHash()],
		)
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const childYesPeaks = await readCarryPeaks(child.escalationGameAddress, QuestionOutcome.Yes)
		const childYesLeafCount = await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.Yes)
		const childYesCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes)
		const childYesNullifierRoot = await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Yes)
		const parentLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 3n * reportBond, 0n, 3n * reportBond, 1n)
		const childLocalParentDepositIndex = computeLocalParentDepositIndex(child.escalationGameAddress, QuestionOutcome.Yes, 0n)
		const childLocalLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, childLocalParentDepositIndex, 4n * reportBond, 1n)

		const grandchild = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(grandchild.testSecurityPoolAddress, [zeroPeakArray(), childYesPeaks, zeroPeakArray()], [0n, childYesLeafCount, 0n], [0n, childYesCarryTotal, 0n], [zeroHash(), childYesNullifierRoot, zeroHash()])
		await depositOnOutcomeViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, childYesCarryTotal, childYesCarryTotal)
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		await claimDepositForWinningViaTestSecurityPool(grandchild.testSecurityPoolAddress, 0n, QuestionOutcome.Yes)

		const nullifierTree = new SparseNullifierTree()
		const inheritedChildLocalProof = await createCarryProof(child.escalationGameAddress, childLocalParentDepositIndex, 1n, 1n, [parentLeafHash], nullifierTree.getProof(childLocalParentDepositIndex), 1n)
		await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, inheritedChildLocalProof)
		nullifierTree.consume(childLocalParentDepositIndex)

		const inheritedParentProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [childLocalLeafHash], nullifierTree.getProof(0n), 1n)
		await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, inheritedParentProof)

		assert.strictEqual(await readCarryTotal(grandchild.escalationGameAddress, QuestionOutcome.Yes), 0n, 'grandchild local settlement should not lock inherited carried deposits from the child snapshot')
		await assertOutcomeCarryTotalsMatchComponents(grandchild.escalationGameAddress)
	})

	test('settling an inherited child-local carried deposit first still clears the matching grandchild-local unresolved carry', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(
			child.testSecurityPoolAddress,
			[zeroPeakArray(), await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes), zeroPeakArray()],
			[0n, await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
			[0n, await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
			[zeroHash(), await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes), zeroHash()],
		)
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const childYesPeaks = await readCarryPeaks(child.escalationGameAddress, QuestionOutcome.Yes)
		const childYesLeafCount = await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.Yes)
		const childYesCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes)
		const childYesNullifierRoot = await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Yes)
		const parentLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 3n * reportBond, 0n, 3n * reportBond, 1n)
		const childLocalParentDepositIndex = computeLocalParentDepositIndex(child.escalationGameAddress, QuestionOutcome.Yes, 0n)

		const grandchild = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(grandchild.testSecurityPoolAddress, [zeroPeakArray(), childYesPeaks, zeroPeakArray()], [0n, childYesLeafCount, 0n], [0n, childYesCarryTotal, 0n], [zeroHash(), childYesNullifierRoot, zeroHash()])
		await depositOnOutcomeViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, childYesCarryTotal, childYesCarryTotal)
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		const nullifierTree = new SparseNullifierTree()
		const inheritedChildLocalProof = await createCarryProof(child.escalationGameAddress, childLocalParentDepositIndex, 1n, 1n, [parentLeafHash], nullifierTree.getProof(childLocalParentDepositIndex), 1n)
		await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, inheritedChildLocalProof)
		nullifierTree.consume(childLocalParentDepositIndex)

		await claimDepositForWinningViaTestSecurityPool(grandchild.testSecurityPoolAddress, 0n, QuestionOutcome.Yes)

		const inheritedParentProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, childLocalParentDepositIndex, 4n * reportBond, 1n)], nullifierTree.getProof(0n), 1n)
		await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, inheritedParentProof)

		assert.strictEqual(await readCarryTotal(grandchild.escalationGameAddress, QuestionOutcome.Yes), 0n, 'inherited settlement first should still leave the matching grandchild-local deposit claimable and clear all unresolved carry')
		await assertOutcomeCarryTotalsMatchComponents(grandchild.escalationGameAddress)
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

	test('vault unresolved export moves aggregate totals once without scanning deposit history', async () => {
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
		const carryTotalBeforeExport = await readCarryTotal(deployment.escalationGameAddress, QuestionOutcome.Yes)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: deployment.testSecurityPoolAddress,
				functionName: 'exportVaultUnresolvedDeposits',
				args: [client.account.address, receiver],
			}),
		)
		const receiverBalanceAfterExport = await getERC20Balance(client, repToken, receiver)
		const localPrincipalAfterExport = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: deployment.escalationGameAddress,
			functionName: 'getLocalUnresolvedPrincipalByVaultAndOutcome',
			args: [client.account.address, QuestionOutcome.Yes],
		})
		await assertEscrowAccounting(deployment.escalationGameAddress, 0n)
		await assert.rejects(
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: deployment.testSecurityPoolAddress,
				functionName: 'exportVaultUnresolvedDeposits',
				args: [client.account.address, receiver],
			}),
			/Vault totals exported/,
		)
		assert.strictEqual(receiverBalanceAfterExport - receiverBalanceBefore, BigInt(depositCount) * reportBond, 'one export should transfer the complete aggregate vault principal')
		assert.strictEqual(localPrincipalAfterExport, 0n, 'aggregate export should clear the vault outcome total')
		assert.strictEqual(await readCarryTotal(deployment.escalationGameAddress, QuestionOutcome.Yes), carryTotalBeforeExport, 'aggregate export should leave the immutable parent carry commitment unchanged')
	})

	test('local unresolved export by deposit index consumes only the selected local deposit', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameWithProofPool()
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)
		await assertEscrowAccounting(escalationGameAddress, 3n * reportBond)

		const preview = await client.simulateContract({
			abi: escalationGameProofTestPoolArtifact.abi,
			address: testSecurityPoolAddress,
			functionName: 'exportLocalUnresolvedDeposit',
			args: [0n, QuestionOutcome.Yes],
		})
		assert.deepStrictEqual(preview.result, [client.account.address, reportBond, 0n], 'local export should return the selected depositor, amount, and stable parent index')

		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: testSecurityPoolAddress,
				functionName: 'exportLocalUnresolvedDeposit',
				args: [0n, QuestionOutcome.Yes],
			}),
		)
		await assertEscrowAccounting(escalationGameAddress, 2n * reportBond)
		await assertOutcomeCarryTotalsMatchComponents(escalationGameAddress)
		const [carryPage] = await readCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, 0n, 2n)
		assert.deepStrictEqual(
			carryPage.map(leaf => ({
				depositor: leaf.depositor,
				amount: leaf.amount,
				parentDepositIndex: leaf.parentDepositIndex,
			})),
			[
				{
					depositor: client.account.address,
					amount: 2n * reportBond,
					parentDepositIndex: 1n,
				},
			],
			'exporting one local deposit should leave only the unresolved sibling deposit in newest-first paging',
		)
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
				if (deposit.vault === vault) deposit.escrowed = false
			}
		}

		for (let depositIndex = 0; depositIndex < 18; depositIndex += 1) {
			const vault = vaults[nextRandom() % vaults.length]
			const amount = BigInt((nextRandom() % 5) + 1) * reportBond
			await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, vault, QuestionOutcome.Yes, amount)
			deposits.push({ vault, amount, depositIndex: BigInt(depositIndex), carryActive: true, escrowed: true })
			await assertLocalYesAccountingModel(escalationGameAddress, vaults, deposits)
		}
		await exportVault(vaults[0])
		await assertLocalYesAccountingModel(escalationGameAddress, vaults, deposits)
		await exportVault(vaults[1])
		await assertLocalYesAccountingModel(escalationGameAddress, vaults, deposits)

		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		const activeClaimOrder = deposits.filter(deposit => deposit.escrowed).sort((left, right) => Number((left.depositIndex * 17n) % 31n) - Number((right.depositIndex * 17n) % 31n))

		for (const deposit of activeClaimOrder) {
			await claimDepositForWinningViaTestSecurityPool(testSecurityPoolAddress, deposit.depositIndex, QuestionOutcome.Yes)
			deposit.carryActive = false
			deposit.escrowed = false
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
		assert.strictEqual(depositLog.args.outcome, BigInt(QuestionOutcome.Yes), 'deposit log should identify the outcome')
		assert.strictEqual(depositLog.args.repAmount, amount, 'deposit log should expose the requested amount')
		assert.strictEqual(depositLog.args.depositIndex, 0n, 'deposit log should expose the new deposit index')
		assert.strictEqual(depositLog.args.cumulativeRepAmount, yesState.balance, 'deposit log should expose the updated outcome balance')
		assert.strictEqual(depositLog.args.resultingVaultEscrowedRep, vaultEscrow, 'deposit log should expose the updated vault escrow')
		assert.strictEqual(depositLog.args.resultingTotalEscrowedRep, totalEscrow, 'deposit log should expose the updated total escrow')
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

	test('forked-escrow winner payouts release child REP proportionally across multiple carried proofs', async () => {
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
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, parentCarryTotal, parentCarryTotal],
			}),
		)

		const repToken = getRepTokenAddress(0n)
		const nullifierTree = new SparseNullifierTree()
		const firstProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [secondLeafHash], nullifierTree.getProof(0n))
		const walletBalanceBefore = await getERC20Balance(client, repToken, client.account.address)
		assert.strictEqual(await readEscrowedRepByVault(child.escalationGameAddress, client.account.address), parentCarryTotal, 'test setup should escrow child REP for the carried parent principal')
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, firstProof)
		nullifierTree.consume(0n)
		assert.strictEqual(await readEscrowedRepByVault(child.escalationGameAddress, client.account.address), 2n * reportBond, 'the first partial proof should release only its proportional child REP')

		const secondProof = await createCarryProof(parent.escalationGameAddress, 1n, 1n, 1n, [firstLeafHash], nullifierTree.getProof(1n))
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, secondProof)
		const walletBalanceAfter = await getERC20Balance(client, repToken, client.account.address)
		assert.strictEqual(walletBalanceAfter - walletBalanceBefore, parentCarryTotal, 'both partial proof payouts should eventually release all child REP')
		assert.strictEqual(await readEscrowedRepByVault(child.escalationGameAddress, client.account.address), 0n, 'the final partial proof should clear the vault escrow lock')
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
		assert.strictEqual(escrowRecordedLog.args.outcome, BigInt(QuestionOutcome.Yes), 'forked escrow log should identify the outcome')
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

	test('fork carry funding completeness tracks migrated source principal even when child REP backing is smaller', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 0n], [0n, 3n * reportBond, 0n], [0n, 3n * reportBond, 0n], [zeroHash(), zeroHash(), zeroHash()])

		assert.strictEqual(await readIsForkCarryFundingComplete(child.escalationGameAddress), false, 'a fork continuation should start incomplete before any carried escrow is recorded')

		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, reportBond, 1n],
			}),
		)
		assert.strictEqual(await readIsForkCarryFundingComplete(child.escalationGameAddress), false, 'partial carried-principal funding should keep the continuation incomplete')

		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, 2n * reportBond, 2n],
			}),
		)

		const yesState = await readOutcomeState(child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(yesState.balance, 3n * reportBond, 'preserved continuation balances should stay at the parent live principal, not the child REP backing')
		assert.strictEqual(yesState.inheritedUnresolvedTotal, 3n * reportBond, 'test setup should preserve the inherited carried principal in source units')
		assert.strictEqual(await readIsForkCarryFundingComplete(child.escalationGameAddress), true, 'full carried-principal migration should mark the continuation complete even when child REP backing stays smaller')
	})

	test('zero-live-balance carry snapshots still require escrow before inherited proofs can settle', async () => {
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
		assert.strictEqual(await readIsForkCarryFundingComplete(child.escalationGameAddress), false, 'inherited carry alone should keep fork funding incomplete')

		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof), /Forked escrow missing/)

		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, parentCarryTotal, parentCarryTotal)
		assert.strictEqual(await readIsForkCarryFundingComplete(child.escalationGameAddress), true, 'matching carried escrow should complete funding even when preserved live balances were zero')
	})

	test('preserved continuation balances do not rebase when forked escrow arrives after the live balance already shrank', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 0n], [0n, 3n * reportBond, 0n], [0n, reportBond, 0n], [zeroHash(), zeroHash(), zeroHash()])

		const yesBalanceBeforeEscrow = (await readOutcomeState(child.escalationGameAddress, QuestionOutcome.Yes)).balance
		assert.strictEqual(yesBalanceBeforeEscrow, reportBond, 'test setup should model a preserved live balance that is already smaller than inherited unresolved total')

		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond, 3n)

		const yesState = await readOutcomeState(child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(yesState.balance, reportBond, 'forked escrow funding should not mutate a preserved live continuation balance')
		assert.deepStrictEqual(await readForkedEscrowByVaultAndOutcome(child.escalationGameAddress, client.account.address, QuestionOutcome.Yes), [3n * reportBond, 0n, 3n, 0n], 'funding progress should still track the inherited principal separately from the preserved live balance')
	})

	test('fork continuation snapshot preserves tied parent leaders below non-decision', async () => {
		const child = await deployEscalationGameWithProofPool()
		const tiedBalance = 2n * reportBond
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 1n], [0n, tiedBalance, tiedBalance], [0n, tiedBalance, tiedBalance], [zeroHash(), zeroHash(), zeroHash()])

		assert.strictEqual((await readOutcomeState(child.escalationGameAddress, QuestionOutcome.Yes)).balance, tiedBalance, 'the yes balance should match the tied parent snapshot')
		assert.strictEqual((await readOutcomeState(child.escalationGameAddress, QuestionOutcome.No)).balance, tiedBalance, 'the no balance should match the tied parent snapshot')
		assert.strictEqual(await getQuestionResolution(client, child.escalationGameAddress), QuestionOutcome.None, 'the inherited tie should remain unresolved')
	})

	test('fork continuation snapshot allows tied preserved leaders at non-decision threshold', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 1n], [0n, nonDecisionThreshold, nonDecisionThreshold], [0n, nonDecisionThreshold, nonDecisionThreshold], [zeroHash(), zeroHash(), zeroHash()])

		assert.strictEqual(await getQuestionResolution(client, child.escalationGameAddress), QuestionOutcome.None, 'threshold-tied carried non-decision states should remain unresolved')
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
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
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
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
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
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])

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
		await traceForkedEscrowByVaultAndOutcome(child.escalationGameAddress, client.account.address, QuestionOutcome.Yes)
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

	test('source-only forked escrow can migrate into the next continuation without child REP backing', async () => {
		const forkerHarnessAddress = await deployEscalationGameForkerHarness()
		const parent = await deployEscalationGameWithProofPool(getRepTokenAddress(0n), forkerHarnessAddress)
		const child = await deployEscalationGameWithProofPool(getRepTokenAddress(0n), forkerHarnessAddress)
		await startEscalationFromFork(parent.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: parent.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, reportBond, 0n],
			}),
		)

		const exportResult = await client.simulateContract({
			abi: escalationGameForkerHarnessArtifact.abi,
			address: forkerHarnessAddress,
			functionName: 'migrateForkedEscrowWithoutTransferForTest',
			args: [parent.escalationGameAddress, child.escalationGameAddress, client.account.address],
		})
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameForkerHarnessArtifact.abi,
				address: forkerHarnessAddress,
				functionName: 'migrateForkedEscrowWithoutTransferForTest',
				args: [parent.escalationGameAddress, child.escalationGameAddress, client.account.address],
			}),
		)

		assert.deepStrictEqual(exportResult.result[0], [0n, reportBond, 0n], 'source-only forked escrow should still export its original principal bucket')
		assert.deepStrictEqual(exportResult.result[1], [0n, 0n, 0n], 'source-only forked escrow should not fabricate child REP backing during export')
		assert.deepStrictEqual(await readForkedEscrowByVaultAndOutcome(child.escalationGameAddress, client.account.address, QuestionOutcome.Yes), [reportBond, 0n, 0n, 0n], 'the next continuation should retain the migrated source-only escrow instead of dropping it')
		assert.strictEqual(await readEscrowedRepByVault(child.escalationGameAddress, client.account.address), 0n, 'source-only migration should not create a new child REP escrow lock')
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
		assert.strictEqual(claimLog.args.outcome, BigInt(QuestionOutcome.Yes), 'claim event should identify the winning outcome')
		assert.strictEqual(claimLog.args.parentDepositIndex, 0n, 'claim event should identify the stable parent deposit index')
		assert.strictEqual(claimLog.args.originalDepositAmount, firstWinningDeposit, 'claim event should include the original winning principal')
		assert.strictEqual(claimLog.args.amountToWithdraw, 7n * 10n ** 18n, 'The first 5 REP winning deposit should receive its 2 REP pro-rata reward share')
		assert.strictEqual(claimLog.args.transferredRep, true, 'direct winning claims should transfer REP to the depositor')
	})

	test('claimDepositForWinning treats the region between binding capital and the reward cap as the first-come safety boundary', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		const firstWinningDepositorAddress = client.account.address
		const secondWinningDepositorAddress = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0).account.address
		const losingDepositorAddress = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0).account.address
		const firstWinningDeposit = 20n * 10n ** 18n
		const secondWinningDeposit = 14n * 10n ** 18n
		const losingDeposit = 20n * 10n ** 18n

		// Reward eligibility is intentionally append-order dependent on the winning side.
		// The first 20 REP deposit fills the binding-capital region, so the later 14 REP deposit
		// only overlaps the final 10 REP safety-boundary slice and earns bonus on that slice alone.
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, firstWinningDepositorAddress, QuestionOutcome.Yes, firstWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, secondWinningDepositorAddress, QuestionOutcome.Yes, secondWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, losingDepositorAddress, QuestionOutcome.No, losingDeposit)

		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)

		assert.strictEqual(await getQuestionResolution(client, escalationGameAddress), QuestionOutcome.Yes, 'Resolution should be Yes')
		const claimLog = await claimWinningDepositAndReadClaimLog(testSecurityPoolAddress, 1n, QuestionOutcome.Yes)
		assert.strictEqual(await readBindingCapital(escalationGameAddress), losingDeposit, 'Binding capital should be the losing-side 20 REP depth')
		assert.strictEqual(claimLog.args.depositor, secondWinningDepositorAddress, 'claim event should identify the crossing depositor')
		assert.strictEqual(claimLog.args.outcome, BigInt(QuestionOutcome.Yes), 'claim event should identify the winning outcome')
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
