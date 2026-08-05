import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { decodeEventLog, encodeDeployData, encodeFunctionData, type Abi, type Address, type Hex, zeroAddress } from '@zoltar/shared/ethereum'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { BURN_ADDRESS, DAY, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { contractExists, requireAddress, requireArray, requireBigInt, setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import assert from '../testSupport/simulator/utils/assert'
import { deployEscalationGame, depositOnOutcome, getActivationTime, getBalances, getEscalationGameDeposits, getQuestionResolution } from '../testSupport/simulator/utils/contracts/escalationGame'
import { ensureZoltarDeployed, getRepTokenAddress, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { ensureInfraDeployed, getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import {
	peripherals_EscalationGame_EscalationGame,
	peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier,
	peripherals_SecurityPoolForker_SecurityPoolForker,
	ReputationToken_ReputationToken,
	test_peripherals_EscalationGameProofTestSecurityPool_EscalationGameProofTestSecurityPool as escalationGameProofTestPoolArtifact,
	test_peripherals_EscalationGameForkerHarness_EscalationGameForkerHarness as escalationGameForkerHarnessArtifact,
	test_peripherals_FalseReturningERC20_FalseReturningERC20,
	test_peripherals_IncompatibleEscalationGameProofVerifier_IncompatibleEscalationGameProofVerifier as incompatibleProofVerifierArtifact,
	test_peripherals_SecurityPoolAncestorTestNode_SecurityPoolAncestorTestNode as securityPoolAncestorTestNodeArtifact,
} from '../types/contractArtifact'
import { getERC20Balance } from '../testSupport/simulator/utils/utilities'
import { isIgnorableLogDecodeError } from './logDecodeErrors'
import { computeForkContinuationParentDepositIndex, createCarryProof as createCarryProofFromHelpers, hashCarryLeaf, hashParent, readCarryLeafHash as readCarryLeafHashFromHelpers, SparseNullifierTree } from './carryProofHelpers'
import { replayZoltarEvents, type ReplayLog } from './eventReplay/eventReplayModel'

const ESCALATION_TIME_LENGTH = 4233600n
const FRESH_FORK_RESPONSE_PERIOD = 3n * 24n * 60n * 60n
const MAX_UINT256 = 2n ** 256n - 1n
const NON_DECISION_STATE_NONE = 0n
const NON_DECISION_STATE_LOCAL = 1n
const NON_DECISION_STATE_INHERITED_THRESHOLD_TIE = 2n
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
const initializeGameForkCarrySnapshotAbi: Abi = [
	{
		inputs: [
			{ name: 'sourceGame', type: 'address' },
			{ name: 'snapshotId', type: 'bytes32' },
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

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('Escalation Game Test Suite', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const reportBond = 1n * 10n ** 18n
	const nonDecisionThresholdAttoRep = 1000n * 10n ** 18n
	const recursiveResolutionTargetCost = (25n * reportBond) / 10n

	type CarryLeaf = {
		depositor: Address
		amountAttoRep: bigint
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
			functionName: 'computeIterativeAttritionCostAttoRep',
			address: escalationGame,
			args: [timeSinceStart],
		})

	const readTimeSinceStartFromAttritionCost = async (escalationGame: Address, attritionCost: bigint) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'computeTimeSinceStartFromAttritionCostAttoRep',
			address: escalationGame,
			args: [attritionCost],
		})

	const readBindingCapital = async (escalationGame: Address) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getBindingCapitalAttoRep',
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

	const readNonDecisionState = async (escalationGame: Address) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'nonDecisionState',
			address: escalationGame,
			args: [],
		})

	const readCanTriggerOwnFork = async (escalationGame: Address) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'canTriggerOwnFork',
			address: escalationGame,
			args: [],
		})

	const readNonDecisionTimestamp = async (escalationGame: Address) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'nonDecisionTimestamp',
			address: escalationGame,
			args: [],
		})

	const requireContractAddress = (value: `0x${string}` | null | undefined, context: string): `0x${string}` => {
		if (value === undefined || value === null) throw new Error(`${context} missing`)
		return value
	}

	const securityPoolByEscalationGame = new Map<Address, Address>()

	const deployEscalationGameTestSecurityPool = async () => {
		const deployment = await deployEscalationGameWithProofPool()
		await startEscalation(deployment.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
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
				args: [testSecurityPoolAddress, repTokenAddress, proofVerifierAddress, getInfraContractAddresses().escalationGameClaimDelegate],
			}),
		})
		const escalationGameDeploymentReceipt = await client.waitForTransactionReceipt({ hash: escalationGameDeploymentHash })
		const escalationGameAddress = requireContractAddress(escalationGameDeploymentReceipt.contractAddress, 'escalation game deployment address')
		securityPoolByEscalationGame.set(escalationGameAddress, testSecurityPoolAddress)
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
		return { escalationGameAddress, testSecurityPoolAddress, proofVerifierAddress }
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

	async function deploySecurityPoolAncestorNode(parent: Address) {
		const deploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: securityPoolAncestorTestNodeArtifact.abi,
				bytecode: `0x${securityPoolAncestorTestNodeArtifact.evm.bytecode.object}`,
				args: [parent],
			}),
		})
		const deploymentReceipt = await client.waitForTransactionReceipt({ hash: deploymentHash })
		return requireContractAddress(deploymentReceipt.contractAddress, 'security pool ancestor node deployment address')
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

	const startEscalation = async (escalationGameAddress: Address, startBondAttoRep: bigint, nonDecisionThresholdAttoRep: bigint) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_EscalationGame_EscalationGame.abi,
					address: escalationGameAddress,
					functionName: 'start',
					args: [startBondAttoRep, nonDecisionThresholdAttoRep],
				}),
		)

	const startEscalationFromFork = async (escalationGameAddress: Address, startBondAttoRep: bigint, nonDecisionThresholdAttoRep: bigint, elapsedAtFork: bigint, fixedQuestionOutcome = QuestionOutcome.None) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_EscalationGame_EscalationGame.abi,
					address: escalationGameAddress,
					functionName: 'startFromFork',
					args: [startBondAttoRep, nonDecisionThresholdAttoRep, elapsedAtFork, fixedQuestionOutcome, false, 0n],
				}),
		)

	const resumeEscalationFromFork = async (escalationGameAddress: Address) => {
		const securityPoolAddress = securityPoolByEscalationGame.get(escalationGameAddress)
		if (securityPoolAddress === undefined) throw new Error('Missing escalation game security pool')
		return await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: securityPoolAddress,
					functionName: 'resumeEscalationGameFromFork',
					args: [],
				}),
		)
	}

	const fundEscalationGame = async (escalationGameAddress: Address, amountAttoRep: bigint) =>
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: ReputationToken_ReputationToken.abi,
				address: getRepTokenAddress(0n),
				functionName: 'transfer',
				args: [escalationGameAddress, amountAttoRep],
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
		const elapsedAfterResume = elapsedAtTargetCost > FRESH_FORK_RESPONSE_PERIOD ? elapsedAtTargetCost : FRESH_FORK_RESPONSE_PERIOD
		await mockWindow.setTime(forkResumedAt + elapsedAfterResume + 1n)
	}

	const depositOnOutcomeViaProofTestSecurityPool = async (testSecurityPoolAddress: Address, depositor: Address, outcome: QuestionOutcome, amountAttoRep: bigint) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: testSecurityPoolAddress,
					functionName: 'depositOnOutcome',
					args: [depositor, outcome, amountAttoRep],
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
	const readCarryTotal = async (escalationGameAddress: Address, outcome: QuestionOutcome) => (await readOutcomeState(escalationGameAddress, outcome)).currentCarryTotalAttoRep

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
				functionName: 'totalDisputeStakedRepAttoRep',
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
				functionName: 'disputeStakedRepByVaultAttoRep',
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
			amountAttoRep: requireBigInt(getTupleField(leaf, 1, 'amountAttoRep', 'Carry leaf'), 'Carry leaf amount'),
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

	const assertEscrowAccounting = async (escalationGameAddress: Address, expectedTotalEscrowedRepAttoRep: bigint) => {
		assert.strictEqual(await readTotalEscrowedRep(escalationGameAddress), expectedTotalEscrowedRepAttoRep, 'total escrowed REP should match scenario accounting')
	}

	type LocalAccountingDeposit = {
		vault: Address
		amountAttoRep: bigint
		depositIndex: bigint
		carryActive: boolean
		escrowed: boolean
	}

	const assertLocalYesAccountingModel = async (escalationGameAddress: Address, vaults: readonly Address[], deposits: readonly LocalAccountingDeposit[]) => {
		const activeCarryDeposits = deposits.filter(deposit => deposit.carryActive)
		const escrowedDeposits = deposits.filter(deposit => deposit.escrowed)
		const activeCarryTotal = activeCarryDeposits.reduce((total, deposit) => total + deposit.amountAttoRep, 0n)
		await assertEscrowAccounting(
			escalationGameAddress,
			escrowedDeposits.reduce((total, deposit) => total + deposit.amountAttoRep, 0n),
		)
		await assertOutcomeCarryTotalsMatchComponents(escalationGameAddress)
		assert.strictEqual(await readCarryTotal(escalationGameAddress, QuestionOutcome.Yes), activeCarryTotal, 'active local Yes commitments should match carry total')

		for (const vault of vaults) {
			const expectedVaultTotal = escrowedDeposits.filter(deposit => deposit.vault === vault).reduce((total, deposit) => total + deposit.amountAttoRep, 0n)
			assert.strictEqual(await readEscrowedRepByVault(escalationGameAddress, vault), expectedVaultTotal, 'vault escrow should match active local deposits')
		}

		const [carryPage] = await readCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, 0n, BigInt(activeCarryDeposits.length + 1))
		const expectedNewestFirst = activeCarryDeposits.slice().reverse()
		assert.deepStrictEqual(
			carryPage.map(leaf => ({
				depositor: leaf.depositor,
				amountAttoRep: leaf.amountAttoRep,
				parentDepositIndex: leaf.parentDepositIndex,
			})),
			expectedNewestFirst.map(deposit => ({
				depositor: deposit.vault,
				amountAttoRep: deposit.amountAttoRep,
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
			assert.strictEqual(state.currentCarryTotalAttoRep, state.inheritedUnresolvedTotalAttoRep + state.localUnresolvedTotalAttoRep, 'outcome carry total should equal inherited plus local unresolved REP')
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

	const recordForkedEscrowForOutcomeViaTestSecurityPool = async (testSecurityPoolAddress: Address, depositor: Address, outcome: QuestionOutcome, sourcePrincipalAttoRep: bigint, childRepAmountAttoRep: bigint) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: testSecurityPoolAddress,
					functionName: 'recordForkedEscrowForOutcome',
					args: [depositor, outcome, sourcePrincipalAttoRep, childRepAmountAttoRep],
				}),
		)

	const applyTruthAuctionHaircutViaTestSecurityPool = async (testSecurityPoolAddress: Address, repToRemove: bigint) =>
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: testSecurityPoolAddress,
				functionName: 'applyTruthAuctionHaircut',
				args: [repToRemove],
			}),
		)

	const withdrawDepositViaProofTestSecurityPool = async (
		testSecurityPoolAddress: Address,
		outcome: QuestionOutcome,
		proof: {
			depositor: Address
			amountAttoRep: bigint
			parentDepositIndex: bigint
			cumulativeAmountAttoRep: bigint
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
			amountAttoRep: bigint
			parentDepositIndex: bigint
			cumulativeAmountAttoRep: bigint
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

	const bagCarryPeaks = (peaks: readonly Hex[], leafCount: bigint) => {
		if (leafCount === 0n) return zeroHash()
		const occupiedPeaks: Hex[] = []
		for (let peakHeight = 0; peakHeight < 64; peakHeight += 1) {
			if (((leafCount >> BigInt(peakHeight)) & 1n) === 0n) continue
			const peak = peaks[peakHeight]
			if (peak === undefined) throw new Error(`missing carry peak ${peakHeight.toString()}`)
			occupiedPeaks.push(peak)
		}
		const lastPeak = occupiedPeaks.at(-1)
		if (lastPeak === undefined) throw new Error('nonzero leaf count has no occupied carry peak')
		let root = lastPeak
		for (let peakIndex = occupiedPeaks.length - 2; peakIndex >= 0; peakIndex -= 1) {
			const peak = occupiedPeaks[peakIndex]
			if (peak === undefined) throw new Error(`missing occupied carry peak ${peakIndex.toString()}`)
			root = hashParent(peak, root)
		}
		return root
	}

	const assertCarryCommitmentStructure = async (escalationGameAddress: Address, label: string) => {
		const snapshot = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getForkCarrySnapshot',
			args: [],
		})
		const roots = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getForkCarryRoots',
			args: [],
		})
		const outcomes = [
			{ outcome: QuestionOutcome.Invalid, snapshotIndex: 0 },
			{ outcome: QuestionOutcome.Yes, snapshotIndex: 1 },
			{ outcome: QuestionOutcome.No, snapshotIndex: 2 },
		] as const

		for (const { outcome, snapshotIndex } of outcomes) {
			const state = await readOutcomeState(escalationGameAddress, outcome)
			const snapshotPeaks = snapshot[0][snapshotIndex]
			const snapshotLeafCount = snapshot[1][snapshotIndex]
			const snapshotCarryTotal = snapshot[2][snapshotIndex]
			const snapshotNullifierRoot = snapshot[3][snapshotIndex]
			const snapshotRoot = roots[snapshotIndex]
			assert.deepStrictEqual(snapshotPeaks, state.currentPeaks, `${label}: exported peaks should match outcome ${outcome.toString()} state`)
			assert.strictEqual(snapshotLeafCount, state.currentLeafCount, `${label}: exported leaf count should match outcome ${outcome.toString()} state`)
			assert.strictEqual(snapshotCarryTotal, state.currentCarryTotalAttoRep, `${label}: exported carry total should match outcome ${outcome.toString()} state`)
			assert.strictEqual(snapshotNullifierRoot, state.currentNullifierRoot, `${label}: exported nullifier should match outcome ${outcome.toString()} state`)
			assert.strictEqual(state.currentCarryTotalAttoRep, state.inheritedUnresolvedTotalAttoRep + state.localUnresolvedTotalAttoRep, `${label}: carry total should equal inherited plus local unresolved REP`)

			for (let peakHeight = 0; peakHeight < 64; peakHeight += 1) {
				if (((state.currentLeafCount >> BigInt(peakHeight)) & 1n) !== 0n) continue
				assert.strictEqual(state.currentPeaks[peakHeight], zeroHash(), `${label}: unoccupied peak ${peakHeight.toString()} should be zero for outcome ${outcome.toString()}`)
			}
			const independentlyBaggedRoot = bagCarryPeaks(state.currentPeaks, state.currentLeafCount)
			assert.strictEqual(state.currentCarryRoot, independentlyBaggedRoot, `${label}: outcome ${outcome.toString()} root should independently bag its occupied peaks`)
			assert.strictEqual(snapshotRoot, independentlyBaggedRoot, `${label}: exported outcome ${outcome.toString()} root should match independent peak bagging`)
		}
	}

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

	const depositOnOutcomeViaTestSecurityPool = async (testSecurityPoolAddress: Address, depositor: Address, outcome: QuestionOutcome, amountAttoRep: bigint) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: escalationGameProofTestPoolArtifact.abi,
					address: testSecurityPoolAddress,
					functionName: 'depositOnOutcome',
					args: [depositor, outcome, amountAttoRep],
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
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
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
						args: [testSecurityPoolAddress, getRepTokenAddress(0n), zeroAddress, getInfraContractAddresses().escalationGameClaimDelegate],
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
						args: [testSecurityPoolAddress, getRepTokenAddress(0n), incompatibleVerifierAddress, getInfraContractAddresses().escalationGameClaimDelegate],
					}),
				}),
			/Proof verifier invalid/,
		)
	})

	test('start and fork-resume lifecycle guards report every reachable failure reason', async () => {
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const unauthorized = await deployEscalationGameWithProofPool()
		await assert.rejects(
			attacker.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: unauthorized.escalationGameAddress,
				functionName: 'start',
				args: [reportBond, nonDecisionThresholdAttoRep],
			}),
			/execution reverted/,
		)

		const thresholdTooLow = await deployEscalationGameWithProofPool()
		await assert.rejects(startEscalation(thresholdTooLow.escalationGameAddress, reportBond, reportBond), /Invalid game start/)
		const zeroBond = await deployEscalationGameWithProofPool()
		await assert.rejects(startEscalation(zeroBond.escalationGameAddress, 0n, reportBond), /Invalid game start/)
		const subRepBond = await deployEscalationGameWithProofPool()
		await startEscalation(subRepBond.escalationGameAddress, 1n, 2n)
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: subRepBond.escalationGameAddress,
				functionName: 'startBondAttoRep',
				args: [],
			}),
			1n,
			'a positive one-attoREP bond must remain available when live REP supply falls below one whole REP',
		)

		const alreadyStarted = await deployEscalationGameWithProofPool()
		await startEscalation(alreadyStarted.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await assert.rejects(startEscalation(alreadyStarted.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep), /Invalid game start/)
		await assert.rejects(resumeEscalationFromFork(alreadyStarted.escalationGameAddress), /No fork mode/)

		const excessiveForkTime = await deployEscalationGameWithProofPool()
		await assert.rejects(startEscalationFromFork(excessiveForkTime.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, ESCALATION_TIME_LENGTH + 1n), /execution reverted|Reverted without a reason/i)

		const fork = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(fork.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await assert.rejects(
			attacker.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: fork.escalationGameAddress,
				functionName: 'resumeFromFork',
				args: [],
			}),
			/Only pool/,
		)
		await resumeEscalationFromFork(fork.escalationGameAddress)
		await assert.rejects(resumeEscalationFromFork(fork.escalationGameAddress), /Fork resumed/)
	})

	test('carry snapshot initialization guards reject wrong callers, modes, repeated snapshots, oversized counts, and bad ids', async () => {
		const normal = await deployEscalationGameTestSecurityPool()
		await assert.rejects(initializeSnapshotViaTestSecurityPool(normal.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 0n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()]), /No fork mode/)

		const unauthorized = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(unauthorized.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await assert.rejects(
			client.writeContract({
				abi: initializeGameForkCarrySnapshotAbi,
				address: unauthorized.escalationGameAddress,
				functionName: 'initializeForkCarrySnapshotWithResolutionBalances',
				args: [zeroAddress, zeroHash(), [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 0n, 0n], [0n, 0n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()]],
			}),
			/Only pool/,
		)

		const repeated = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(repeated.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		const emptySnapshot = [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()] as const
		await initializeSnapshotViaTestSecurityPool(repeated.testSecurityPoolAddress, emptySnapshot, [0n, 0n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()])
		await assert.rejects(initializeSnapshotViaTestSecurityPool(repeated.testSecurityPoolAddress, emptySnapshot, [0n, 0n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()]), /Snapshot initialized/)

		const oversized = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(oversized.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await assert.rejects(initializeSnapshotViaTestSecurityPool(oversized.testSecurityPoolAddress, emptySnapshot, [1n << 64n, 0n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()]), /Leaf count high/)

		const badId = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(badId.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await assert.rejects(initializeSnapshotFromSourceViaTestSecurityPool(badId.testSecurityPoolAddress, client.account.address, `0x${'0'.repeat(63)}1`, emptySnapshot, [0n, 0n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()]), /Snapshot id mismatch/)
	})

	test('deposit preview and recording guards cover resolved, full, zero, mismatched, oversized, and maximum-height deposits', async () => {
		const record = (testSecurityPoolAddress: Address, amountAttoRep: bigint, expectedCumulativeAmount: bigint) =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: testSecurityPoolAddress,
				functionName: 'recordDeposit',
				args: [client.account.address, QuestionOutcome.Yes, amountAttoRep, expectedCumulativeAmount],
			})

		const fresh = await deployEscalationGameTestSecurityPool()
		await assert.rejects(record(fresh.testSecurityPoolAddress, 0n, 0n), /Deposit zero/)
		await assert.rejects(record(fresh.testSecurityPoolAddress, reportBond, reportBond + 1n), /Preview mismatch/)
		await assert.rejects(record(fresh.testSecurityPoolAddress, nonDecisionThresholdAttoRep + 1n, nonDecisionThresholdAttoRep + 1n), /Deposit exceeds room/)

		const full = await deployEscalationGameTestSecurityPool()
		await depositOnOutcomeViaProofTestSecurityPool(full.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, nonDecisionThresholdAttoRep)
		await assert.rejects(
			client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: full.escalationGameAddress,
				functionName: 'previewDepositOnOutcome',
				args: [QuestionOutcome.Yes, reportBond],
			}),
			/Invalid deposit preview/,
		)
		await assert.rejects(record(full.testSecurityPoolAddress, reportBond, nonDecisionThresholdAttoRep + reportBond), /Outcome full/)

		const resolved = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(resolved.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, ESCALATION_TIME_LENGTH, QuestionOutcome.Yes)
		await resumeEscalationFromFork(resolved.escalationGameAddress)
		await mockWindow.advanceTime(FRESH_FORK_RESPONSE_PERIOD + 1n)
		await assert.rejects(
			client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: resolved.escalationGameAddress,
				functionName: 'previewDepositOnOutcome',
				args: [QuestionOutcome.Yes, reportBond],
			}),
			/Invalid deposit preview/,
		)
		await assert.rejects(record(resolved.testSecurityPoolAddress, reportBond, reportBond), /Question resolved/)

		const maximumHeight = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(maximumHeight.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(maximumHeight.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, (1n << 64n) - 1n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()])
		await assert.rejects(record(maximumHeight.testSecurityPoolAddress, reportBond, reportBond), /MMR too tall/)
	})

	test('proof verifier public boundaries expose deterministic error reasons', async () => {
		const { proofVerifierAddress } = await deployEscalationGameWithProofPool()
		const verifierAbi = peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier.abi

		await assert.rejects(client.readContract({ abi: verifierAbi, address: proofVerifierAddress, functionName: 'computeIterativeAttritionCostAttoRep', args: [1n, 2n, 0n, 2n, 1n] }), /Time too high/)
		await assert.rejects(client.readContract({ abi: verifierAbi, address: proofVerifierAddress, functionName: 'computeAcceptedDepositAmount', args: [1n, 0n, 0n, 10n, 1n, 10n, [1n, 0n, 0n]] }), /Below start bond/)
		await assert.rejects(client.readContract({ abi: verifierAbi, address: proofVerifierAddress, functionName: 'getCurrentCarryPeakForLeaf', args: [0n, 0n] }), /Carry peak absent/)
		await assert.rejects(client.readContract({ abi: verifierAbi, address: proofVerifierAddress, functionName: 'computeMerkleMountainRangeRootFromProof', args: [zeroHash(), 1n, 0n, 64n, []] }), /Bad carry peak/)
		await assert.rejects(client.readContract({ abi: verifierAbi, address: proofVerifierAddress, functionName: 'computeMerkleMountainRangeRootFromProof', args: [zeroHash(), 1n, 0n, 1n, []] }), /Carry peak absent/)
		await assert.rejects(client.readContract({ abi: verifierAbi, address: proofVerifierAddress, functionName: 'computeMerkleMountainRangeRootFromProof', args: [zeroHash(), 2n, 2n, 1n, []] }), /Bad carry leaf/)
		await assert.rejects(client.readContract({ abi: verifierAbi, address: proofVerifierAddress, functionName: 'computeMerkleMountainRangeRootFromProof', args: [zeroHash(), 2n, 0n, 1n, []] }), /Bad MMR proof length/)
	})

	test('proof verifier preserves exact power-of-two logarithm components', async () => {
		const { proofVerifierAddress } = await deployEscalationGameWithProofPool()
		const verifierAbi = peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier.abi
		const lowValue = 10n ** 18n
		const ln2Scaled = 693_147n

		for (let exponent = 1n; exponent <= 8n; exponent++) {
			const highValue = lowValue << exponent
			assert.strictEqual(
				await client.readContract({
					abi: verifierAbi,
					address: proofVerifierAddress,
					functionName: 'computeLnRatioScaled',
					args: [lowValue, highValue],
				}),
				exponent * ln2Scaled,
				`exact 2^${exponent} ratio should preserve its logarithm component`,
			)
		}

		const belowBoundary = await client.readContract({
			abi: verifierAbi,
			address: proofVerifierAddress,
			functionName: 'computeLnRatioScaled',
			args: [lowValue, 2n * lowValue - 1n],
		})
		const aboveBoundary = await client.readContract({
			abi: verifierAbi,
			address: proofVerifierAddress,
			functionName: 'computeLnRatioScaled',
			args: [lowValue, 2n * lowValue + 1n],
		})
		assert.ok(belowBoundary > 0n && belowBoundary <= ln2Scaled, 'ratio immediately below two should remain positive and bounded')
		assert.ok(aboveBoundary >= ln2Scaled, 'ratio immediately above two should retain the normalized ln(2) component')
	})

	test('carried proof verification rejects a zero amount before mutating the inherited snapshot', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, ESCALATION_TIME_LENGTH, QuestionOutcome.Yes)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await resumeEscalationFromFork(child.escalationGameAddress)
		await mockWindow.advanceTime(FRESH_FORK_RESPONSE_PERIOD + 1n)
		assert.strictEqual(await getQuestionResolution(client, child.escalationGameAddress), QuestionOutcome.Yes, 'real inherited snapshot should resolve to the fixed child outcome')
		const childNullifierRootBefore = await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Yes)

		const zeroAmountProof = {
			depositor: client.account.address,
			amountAttoRep: 0n,
			parentDepositIndex: 0n,
			cumulativeAmountAttoRep: 0n,
			sourceNodeId: 0n,
			leafIndex: 0n,
			merkleMountainRangeSiblings: [],
			merkleMountainRangePeakIndex: 0n,
			nullifierSiblings: [],
		}
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, zeroAmountProof), /Proof amount zero/)
		assert.strictEqual(await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.Yes), parentLeafCount, 'a rejected zero-amount proof must preserve the inherited leaf count')
		assert.strictEqual(await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes), parentCarryTotal, 'a rejected zero-amount proof must preserve the inherited carry total')
		assert.strictEqual(await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Yes), childNullifierRootBefore, 'a rejected zero-amount proof must preserve the inherited nullifier root')
	})

	test('escrow and settlement entry points cover authorization, argument, lifecycle, and residual-state guards', async () => {
		const deployment = await deployEscalationGameTestSecurityPool()
		await assert.rejects(
			client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: deployment.escalationGameAddress,
				functionName: 'getLocalUnresolvedPrincipalByVaultAndOutcome',
				args: [client.account.address, QuestionOutcome.None],
			}),
			/No outcome/,
		)
		await assert.rejects(
			client.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: deployment.escalationGameAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, 1n, 0n],
			}),
			/execution reverted|Reverted without a reason/i,
		)
		await assert.rejects(recordForkedEscrowForOutcomeViaTestSecurityPool(deployment.testSecurityPoolAddress, client.account.address, QuestionOutcome.None, 1n, 0n), /No outcome/)
		await assert.rejects(recordForkedEscrowForOutcomeViaTestSecurityPool(deployment.testSecurityPoolAddress, zeroAddress, QuestionOutcome.Yes, 1n, 0n), /Depositor is zero/)
		await assert.rejects(
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: deployment.testSecurityPoolAddress,
				functionName: 'exportForkedEscrowByOutcome',
				args: [client.account.address, zeroAddress],
			}),
			/REP receiver zero/,
		)
		await assert.rejects(
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: deployment.testSecurityPoolAddress,
				functionName: 'exportVaultUnresolvedDeposits',
				args: [zeroAddress, client.account.address],
			}),
			/Vault is zero/,
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: deployment.testSecurityPoolAddress,
				functionName: 'exportVaultUnresolvedDeposits',
				args: [client.account.address, client.account.address],
			}),
		)
		await assert.rejects(
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: deployment.testSecurityPoolAddress,
				functionName: 'exportVaultUnresolvedDeposits',
				args: [client.account.address, client.account.address],
			}),
			/Vault totals exported/,
		)
		await assert.rejects(
			client.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: deployment.escalationGameAddress,
				functionName: 'drainAllRep',
				args: [client.account.address],
			}),
			/Only pool/,
		)
		await assert.rejects(
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: deployment.testSecurityPoolAddress,
				functionName: 'drainAllRep',
				args: [zeroAddress],
			}),
			/REP receiver zero/,
		)
		await assert.rejects(
			client.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: deployment.escalationGameAddress,
				functionName: 'sweepResidualRepToSecurityPool',
				args: [],
			}),
			/Question not final/,
		)

		const emptyFinal = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(emptyFinal.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, ESCALATION_TIME_LENGTH, QuestionOutcome.Yes)
		await resumeEscalationFromFork(emptyFinal.escalationGameAddress)
		await mockWindow.advanceTime(FRESH_FORK_RESPONSE_PERIOD + 1n)
		await assert.rejects(
			client.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: emptyFinal.escalationGameAddress,
				functionName: 'sweepResidualRepToSecurityPool',
				args: [],
			}),
			/No sweepable REP/,
		)

		const unresolved = await deployEscalationGameTestSecurityPool()
		await depositOnOutcomeViaProofTestSecurityPool(unresolved.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const activationTime = await getActivationTime(client, unresolved.escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		await assert.rejects(
			client.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: unresolved.escalationGameAddress,
				functionName: 'sweepResidualRepToSecurityPool',
				args: [],
			}),
			/Principal remains/,
		)

		const escrowed = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(escrowed.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, ESCALATION_TIME_LENGTH, QuestionOutcome.Yes)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(escrowed.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 1n, 1n)
		await resumeEscalationFromFork(escrowed.escalationGameAddress)
		await mockWindow.advanceTime(FRESH_FORK_RESPONSE_PERIOD + 1n)
		await assert.rejects(
			client.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escrowed.escalationGameAddress,
				functionName: 'sweepResidualRepToSecurityPool',
				args: [],
			}),
			/Escrowed REP remains/,
		)
	})

	test('empty started game resolves to invalid after timeout', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		const activationTime = await getActivationTime(client, escalationGame)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		assert.strictEqual(await getQuestionResolution(client, escalationGame), QuestionOutcome.Invalid, 'empty game should resolve as invalid')
	})

	test('non-decision keeps question resolution at None even after the nominal timeout window', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, nonDecisionThresholdAttoRep)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.No, nonDecisionThresholdAttoRep)
		assert.strictEqual(await readHasReachedNonDecision(escalationGame), true, 'two threshold-reaching outcomes should trigger non-decision')
		assert.strictEqual(await readNonDecisionState(escalationGame), NON_DECISION_STATE_LOCAL, 'a local threshold-crossing deposit should record local non-decision')
		assert.strictEqual(await readCanTriggerOwnFork(escalationGame), true, 'a local non-decision should authorize the own-fork path')
		assert.ok((await readNonDecisionTimestamp(escalationGame)) > 0n, 'a local non-decision should record its event time')
		assert.strictEqual(await getQuestionResolution(client, escalationGame), QuestionOutcome.None, 'non-decision should leave the question unresolved')

		const activationTime = await getActivationTime(client, escalationGame)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		assert.strictEqual(await readHasReachedNonDecision(escalationGame), true, 'non-decision should stay active after time advances')
		assert.strictEqual(await getQuestionResolution(client, escalationGame), QuestionOutcome.None, 'non-decision should still take precedence after time advances')
	})

	test('depositOnOutcome reverts when outcome is None', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		await assert.rejects(depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.None, reportBond))
	})

	test('depositOnOutcome reverts when outcome is out of enum range', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
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
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
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
		assert.strictEqual(depositPage[0]?.amountAttoRep, reportBond * 2n, 'paged deposit should retain its amount')
		assert.strictEqual(depositPage[0]?.depositor, client.account.address, 'paged deposit should retain its depositor')
		assert.strictEqual(depositPage[0]?.depositIndex, 1n, 'paged deposit should retain its index')
		assert.strictEqual(maxCountDepositPage.length, 1, 'max-count deposit paging should return only the remaining entries')
		assert.strictEqual(maxCountDepositPage[0]?.amountAttoRep, reportBond * 2n, 'max-count paged deposit should retain its amount')
		assert.strictEqual(maxCountDepositPage[0]?.depositor, client.account.address, 'max-count paged deposit should retain its depositor')
		assert.strictEqual(noneOutcomeDepositPage.length, 0, 'none-outcome deposit paging should always return an empty page')
	})

	test('claimDepositForWinning reverts when outcome is None', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
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
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
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
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await mockWindow.advanceTime(4n * DAY)

		await assert.rejects(claimDepositForWinningViaTestSecurityPool(testSecurityPoolAddress, 0n, QuestionOutcome.Yes), /SafeERC20Ops token returned false from ERC20 call/)
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
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)

		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await assertCarryCommitmentStructure(escalationGameAddress, 'after first Yes deposit')

		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, 0n, reportBond, 1n)
		const rootAfterFirstDeposit = await readCarryRoot(escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(rootAfterFirstDeposit, firstLeafHash, 'single appended leaf should be its own Merkle Mountain Range root')

		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await assertCarryCommitmentStructure(escalationGameAddress, 'after second Yes deposit')
		const secondLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, 1n, 2n * reportBond, 2n)
		const expectedTwoLeafRoot = hashParent(firstLeafHash, secondLeafHash)
		const rootAfterSecondDeposit = await readCarryRoot(escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(rootAfterSecondDeposit, expectedTwoLeafRoot, 'two appended leaves should bag into the expected Merkle Mountain Range root')

		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Invalid, 3n * reportBond)
		await assertCarryCommitmentStructure(escalationGameAddress, 'after multi-peak and multi-outcome deposits')
	})

	test('fork carry leaf paging uses node cursors and skips consumed local leaves', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameWithProofPool()
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
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
		assert.strictEqual(firstPage[0]?.amountAttoRep, 3n * reportBond, 'first page should preserve the newest unresolved leaf amount')
		assert.strictEqual(firstNextNodeId, 2n, 'first page should return the next raw node cursor')

		const [secondPage, secondNextNodeId] = await readCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, firstNextNodeId, 2n)
		assert.strictEqual(secondPage.length, 1, 'second page should skip the consumed middle leaf and include the oldest unresolved leaf')
		assert.strictEqual(secondPage[0]?.parentDepositIndex, 0n, 'second page should return the remaining unresolved oldest leaf')
		assert.strictEqual(secondPage[0]?.amountAttoRep, reportBond, 'second page should preserve the oldest unresolved leaf amount')
		assert.strictEqual(secondNextNodeId, 0n, 'second page should finish the cursor traversal')

		await traceCarryLeafPage(escalationGameAddress, QuestionOutcome.None, 0n, 1n)
		await traceCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, 0n, 0n)
		await traceCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, 0n, 1n)
		await traceCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, firstNextNodeId, 2n)
	})

	test('fork carry leaf paging rejects cursors from another outcome chain', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameWithProofPool()
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.No, 2n * reportBond)

		const [yesPage] = await readCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, 0n, 1n)
		const yesNodeId = yesPage[0]?.sourceNodeId
		assert.notStrictEqual(yesNodeId, undefined)
		await assert.rejects(readCarryLeafPage(escalationGameAddress, QuestionOutcome.No, yesNodeId ?? 0n, 1n), /Outcome mismatch/)
	})

	test('fork carry snapshot initialization normalizes zero nullifier roots to the empty sparse-tree root', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)

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
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, 2n, 0n], [0n, 2n * reportBond, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()])
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond, 2n * reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await fundEscalationGame(child.escalationGameAddress, 2n * reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const shortProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [], new SparseNullifierTree().getProof(0n))
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, shortProof), /Bad MMR proof length/)
	})

	test('fork carry child instances can settle multiple inherited carried deposits from proofs only', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)

		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, 0n, reportBond, 1n)
		const secondLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 2n * reportBond, 1n, 3n * reportBond, 2n)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, parentCarryTotal, parentCarryTotal)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		await assertCarryCommitmentStructure(parent.escalationGameAddress, 'parent before inherited proof settlement')
		await assertCarryCommitmentStructure(child.escalationGameAddress, 'child before inherited proof settlement')

		const nullifierTree = new SparseNullifierTree()
		const firstProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [secondLeafHash], nullifierTree.getProof(0n))
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, firstProof)
		nullifierTree.consume(0n)
		await assertCarryCommitmentStructure(child.escalationGameAddress, 'child after first inherited proof settlement')

		const secondProof = await createCarryProof(parent.escalationGameAddress, 1n, 1n, 1n, [firstLeafHash], nullifierTree.getProof(1n))
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, secondProof)
		await assertCarryCommitmentStructure(child.escalationGameAddress, 'child after all inherited proof settlements')

		const remainingCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(remainingCarryTotal, 0n)
		const consumedIndexes = await readProofConsumedCarriedDepositIndexes(child.escalationGameAddress, QuestionOutcome.Yes, 0n, MAX_UINT256)
		assert.deepStrictEqual(consumedIndexes, [0n, 1n], 'max-count proof-consumed paging should return all consumed inherited indexes')
		assert.strictEqual(new Set(consumedIndexes).size, consumedIndexes.length, 'consumed inherited proof indexes should remain unique')
		await traceProofConsumedCarriedDepositIndexes(child.escalationGameAddress, QuestionOutcome.None, 0n, 1n)
		await traceProofConsumedCarriedDepositIndexes(child.escalationGameAddress, QuestionOutcome.Yes, 2n, 1n)
		await traceProofConsumedCarriedDepositIndexes(child.escalationGameAddress, QuestionOutcome.Yes, 0n, MAX_UINT256)
	})

	test('carried proof settlement consumes local unresolved overflow when inherited total is smaller than the proof amount', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
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
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)

		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
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
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await advanceForkContinuationPastStart(child.escalationGameAddress)

		await assert.rejects(
			withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, {
				depositor: client.account.address,
				amountAttoRep: reportBond,
				parentDepositIndex: 0n,
				cumulativeAmountAttoRep: reportBond,
				sourceNodeId: 1n,
				leafIndex: 0n,
				merkleMountainRangeSiblings: [],
				merkleMountainRangePeakIndex: 0n,
				nullifierSiblings: new SparseNullifierTree().getProof(0n),
			}),
			/Not winning outcome|Carry peak absent/,
		)
	})

	test('fork carry grandchild instances can settle inherited parent carry from a recursive child snapshot', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
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
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
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
		await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(grandchild.testSecurityPoolAddress, [childInvalidPeaks, childYesPeaks, zeroPeakArray()], [childInvalidLeafCount, childLeafCount, 0n], [childInvalidCarryTotal, childCarryTotal, 0n], [childInvalidNullifierRoot, childNullifierRoot, zeroHash()])
		await recordForkedEscrowForOutcomeViaTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, childCarryTotal, childCarryTotal)
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		const nullifierTree = new SparseNullifierTree()
		const proof = {
			depositor: client.account.address,
			amountAttoRep: 3n * reportBond,
			parentDepositIndex: 0n,
			cumulativeAmountAttoRep: 3n * reportBond,
			sourceNodeId: 2n,
			leafIndex: 0n,
			merkleMountainRangePeakIndex: 1n,
			merkleMountainRangeSiblings: [childLocalLeafHash],
			nullifierSiblings: nullifierTree.getProof(0n),
		}
		const settlementHash = await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		const settlementReceipt = await client.waitForTransactionReceipt({ hash: settlementHash })
		assert.ok(settlementReceipt.gasUsed < 2_000_000n, `recursive grandchild carry proof settlement must stay below the 2,000,000 gas bound; used ${settlementReceipt.gasUsed}`)

		const remainingCarryTotal = await readCarryTotal(grandchild.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(remainingCarryTotal, reportBond, 'only the child-local unresolved carry should remain after settling the inherited parent leaf')
		const grandchildRoot = await readCarryRoot(grandchild.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(grandchildRoot, hashParent(parentLeafHash, childLocalLeafHash), 'grandchild should snapshot the recursive child carry set as a true two-leaf Merkle Mountain Range')
	})

	test('grandchild settlement preserves an ancestor truth-auction haircut on inherited carry', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
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
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(
			child.testSecurityPoolAddress,
			parent.escalationGameAddress,
			zeroHash(),
			[parentInvalidPeaks, parentYesPeaks, zeroPeakArray()],
			[parentInvalidLeafCount, parentYesLeafCount, 0n],
			[parentInvalidCarryTotal, parentYesCarryTotal, 0n],
			[parentInvalidNullifierRoot, parentYesNullifierRoot, zeroHash()],
		)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, parentYesCarryTotal, parentYesCarryTotal)
		const childRepBefore = await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress)
		await applyTruthAuctionHaircutViaTestSecurityPool(child.testSecurityPoolAddress, childRepBefore / 4n)
		assert.strictEqual(await client.readContract({ abi: peripherals_EscalationGame_EscalationGame.abi, address: child.escalationGameAddress, functionName: 'truthAuctionRepBeforeAttoRep', args: [] }), childRepBefore)
		assert.strictEqual(await client.readContract({ abi: peripherals_EscalationGame_EscalationGame.abi, address: child.escalationGameAddress, functionName: 'truthAuctionRepRemainingAttoRep', args: [] }), childRepBefore - childRepBefore / 4n)
		const childRootSource = await client.call({ to: child.escalationGameAddress, data: '0xc028bc2a' })
		assert.strictEqual(addressString(BigInt(childRootSource.data ?? '0x')).toLowerCase(), parent.escalationGameAddress.toLowerCase())
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const childInvalidPeaks = await readCarryPeaks(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesPeaks = await readCarryPeaks(child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidLeafCount = await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesLeafCount = await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(childYesCarryTotal, (parentYesCarryTotal * 3n) / 4n)
		const childInvalidNullifierRoot = await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesNullifierRoot = await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Yes)

		const grandchild = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(
			grandchild.testSecurityPoolAddress,
			child.escalationGameAddress,
			zeroHash(),
			[childInvalidPeaks, childYesPeaks, zeroPeakArray()],
			[childInvalidLeafCount, childYesLeafCount, 0n],
			[childInvalidCarryTotal, childYesCarryTotal, 0n],
			[childInvalidNullifierRoot, childYesNullifierRoot, zeroHash()],
		)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, childYesCarryTotal, childYesCarryTotal)
		assert.strictEqual(await readCarryTotal(grandchild.escalationGameAddress, QuestionOutcome.Yes), childYesCarryTotal)
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, {
			depositor: client.account.address,
			amountAttoRep: 3n * reportBond,
			parentDepositIndex: 0n,
			cumulativeAmountAttoRep: 3n * reportBond,
			sourceNodeId: 2n,
			leafIndex: 0n,
			merkleMountainRangeSiblings: [],
			merkleMountainRangePeakIndex: 0n,
			nullifierSiblings: new SparseNullifierTree().getProof(0n),
		})
		assert.strictEqual(await readCarryTotal(grandchild.escalationGameAddress, QuestionOutcome.Yes), 0n)
	})

	test('recursive carry consumption allocates aggregate retention rounding by cumulative leaf position', async () => {
		const firstAmount = reportBond + 1n
		const secondAmount = reportBond + 3n
		const aggregateAmount = firstAmount + secondAmount
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, firstAmount)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, secondAmount)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(
			child.testSecurityPoolAddress,
			parent.escalationGameAddress,
			zeroHash(),
			[zeroPeakArray(), await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes), zeroPeakArray()],
			[0n, await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
			[0n, aggregateAmount, 0n],
			[zeroHash(), await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes), zeroHash()],
		)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, aggregateAmount, aggregateAmount)
		const childRepBefore = await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress)
		await applyTruthAuctionHaircutViaTestSecurityPool(child.testSecurityPoolAddress, childRepBefore / 4n)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const childCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(childCarryTotal, (aggregateAmount * 3n) / 4n)
		assert.strictEqual((firstAmount * 3n) / 4n + (secondAmount * 3n) / 4n + 1n, childCarryTotal, 'the fixture must expose an aggregate-versus-leaf floor difference')
		const childPeaks = await readCarryPeaks(child.escalationGameAddress, QuestionOutcome.Yes)
		const childLeafCount = await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.Yes)
		const childNullifierRoot = await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Yes)
		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, firstAmount, 0n, firstAmount, 1n)
		const secondLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, secondAmount, 1n, aggregateAmount, 2n)

		const settleInOrder = async (leafOrder: readonly [0 | 1, 0 | 1]) => {
			const grandchild = await deployEscalationGameWithProofPool()
			await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
			await initializeSnapshotFromSourceViaTestSecurityPool(grandchild.testSecurityPoolAddress, child.escalationGameAddress, zeroHash(), [zeroPeakArray(), childPeaks, zeroPeakArray()], [0n, childLeafCount, 0n], [0n, childCarryTotal, 0n], [zeroHash(), childNullifierRoot, zeroHash()])
			await recordForkedEscrowForOutcomeViaTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, childCarryTotal, childCarryTotal)
			await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)
			const nullifierTree = new SparseNullifierTree()
			for (const leafIndex of leafOrder) {
				const isFirst = leafIndex === 0
				const proof = await createCarryProof(parent.escalationGameAddress, BigInt(leafIndex), BigInt(leafIndex), 1n, [isFirst ? secondLeafHash : firstLeafHash], nullifierTree.getProof(BigInt(leafIndex)), BigInt(leafIndex + 1))
				await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
				nullifierTree.consume(BigInt(leafIndex))
			}
			assert.strictEqual(await readCarryTotal(grandchild.escalationGameAddress, QuestionOutcome.Yes), 0n, 'every settlement order must consume the aggregate retained checkpoint exactly')
		}

		await settleInOrder([0, 1])
		await settleInOrder([1, 0])
	})

	test('direct child settlement applies its truth-auction haircut once and consumes the inherited source basis', async () => {
		const inheritedPrincipal = 100n * reportBond
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, inheritedPrincipal)

		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(child.testSecurityPoolAddress, parent.escalationGameAddress, zeroHash(), [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentYesLeafCount, 0n], [0n, parentYesCarryTotal, 0n], [zeroHash(), parentYesNullifierRoot, zeroHash()])
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, inheritedPrincipal, inheritedPrincipal)
		const childRepBefore = await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress)
		await applyTruthAuctionHaircutViaTestSecurityPool(child.testSecurityPoolAddress, childRepBefore / 4n)
		await advanceForkContinuationPastStart(child.escalationGameAddress)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		const walletBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		const walletBalanceAfter = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)

		assert.strictEqual(walletBalanceAfter - walletBalanceBefore, (inheritedPrincipal * 3n) / 4n, 'the direct child payout should apply the current truth-auction haircut exactly once')
		assert.strictEqual(await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes), 0n, 'the retained payout should consume all inherited principal stored in source units')
	})

	test('direct-claim replay lookup gas does not grow with security-pool ancestry', async () => {
		const shallowAncestor = await deploySecurityPoolAncestorNode(zeroAddress)
		let deepestAncestor = shallowAncestor
		const ancestorDepth = 32
		for (let depth = 1; depth < ancestorDepth; depth++) deepestAncestor = await deploySecurityPoolAncestorNode(deepestAncestor)

		const forkerAddress = getInfraContractAddresses().securityPoolForker
		const shallowCheckHash = await client.sendTransaction({
			to: forkerAddress,
			data: encodeFunctionData({
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'isEscalationDepositClaimedDirectly',
				args: [shallowAncestor, QuestionOutcome.Yes, 0n],
			}),
			gas: 2_000_000n,
		})
		const shallowCheckReceipt = await client.waitForTransactionReceipt({ hash: shallowCheckHash })
		const deepCheckHash = await client.sendTransaction({
			to: forkerAddress,
			data: encodeFunctionData({
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'isEscalationDepositClaimedDirectly',
				args: [deepestAncestor, QuestionOutcome.Yes, 0n],
			}),
			gas: 2_000_000n,
		})
		const deepCheckReceipt = await client.waitForTransactionReceipt({ hash: deepCheckHash })

		assert.strictEqual(deepCheckReceipt.status, 'success', 'the 32-level replay lookup should complete successfully')
		assert.ok(deepCheckReceipt.gasUsed <= shallowCheckReceipt.gasUsed + 10_000n, `replay lookup should be depth-independent; shallow used ${shallowCheckReceipt.gasUsed}, deep used ${deepCheckReceipt.gasUsed}`)
	})

	test('fork carry grandchild instances reject child-local leaves that were already settled before the recursive fork', async () => {
		const parent = await deployEscalationGameWithProofPool()
		const parentStartHash = await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
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
		const childStartHash = await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
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
		const grandchildStartHash = await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
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
			amountAttoRep: reportBond,
			parentDepositIndex: computeLocalParentDepositIndex(child.escalationGameAddress, QuestionOutcome.Yes, 0n),
			cumulativeAmountAttoRep: 4n * reportBond,
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
		const childLocalDepositor = addressString(TEST_ADDRESSES[1])
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(
			child.testSecurityPoolAddress,
			parent.escalationGameAddress,
			zeroHash(),
			[zeroPeakArray(), await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes), zeroPeakArray()],
			[0n, await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
			[0n, await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
			[zeroHash(), await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes), zeroHash()],
		)
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, childLocalDepositor, QuestionOutcome.Yes, reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		const childYesPeaks = await readCarryPeaks(child.escalationGameAddress, QuestionOutcome.Yes)
		const childYesLeafCount = await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.Yes)
		const childYesCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes)
		const childYesNullifierRoot = await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Yes)
		const parentLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 3n * reportBond, 0n, 3n * reportBond, 1n)
		const childLocalParentDepositIndex = computeLocalParentDepositIndex(child.escalationGameAddress, QuestionOutcome.Yes, 0n)
		const childLocalLeafHash = hashCarryLeaf(childLocalDepositor, QuestionOutcome.Yes, reportBond, childLocalParentDepositIndex, 4n * reportBond, 1n)

		const grandchild = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(grandchild.testSecurityPoolAddress, child.escalationGameAddress, zeroHash(), [zeroPeakArray(), childYesPeaks, zeroPeakArray()], [0n, childYesLeafCount, 0n], [0n, childYesCarryTotal, 0n], [zeroHash(), childYesNullifierRoot, zeroHash()])
		await depositOnOutcomeViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, childYesCarryTotal, childYesCarryTotal)
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		await claimDepositForWinningViaTestSecurityPool(grandchild.testSecurityPoolAddress, 0n, QuestionOutcome.Yes)

		const nullifierTree = new SparseNullifierTree()
		const inheritedChildLocalProof = await createCarryProof(child.escalationGameAddress, childLocalParentDepositIndex, 1n, 1n, [parentLeafHash], nullifierTree.getProof(childLocalParentDepositIndex), 1n)
		const childLocalBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), childLocalDepositor)
		await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, inheritedChildLocalProof)
		const childLocalBalanceAfter = await getERC20Balance(client, getRepTokenAddress(0n), childLocalDepositor)
		assert.ok(childLocalBalanceAfter > childLocalBalanceBefore, 'the committed depositor should receive the inherited payout')
		nullifierTree.consume(childLocalParentDepositIndex)

		const inheritedParentProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [childLocalLeafHash], nullifierTree.getProof(0n), 1n)
		await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, inheritedParentProof)

		assert.strictEqual(await readCarryTotal(grandchild.escalationGameAddress, QuestionOutcome.Yes), 0n, 'grandchild local settlement should not lock inherited carried deposits from the child snapshot')
		await assertOutcomeCarryTotalsMatchComponents(grandchild.escalationGameAddress)
	})

	test('settling an inherited child-local carried deposit first still clears the matching grandchild-local unresolved carry', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
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
		await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
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
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)

		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof), /Question not final/)
	})

	test('vault unresolved export moves aggregate totals once without scanning deposit history', async () => {
		const deployment = await deployEscalationGameWithProofPool()
		await startEscalation(deployment.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
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
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
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
				amountAttoRep: leaf.amountAttoRep,
				parentDepositIndex: leaf.parentDepositIndex,
			})),
			[
				{
					depositor: client.account.address,
					amountAttoRep: 2n * reportBond,
					parentDepositIndex: 1n,
				},
			],
			'exporting one local deposit should leave only the unresolved sibling deposit in newest-first paging',
		)
	})

	test('stateful local accounting model stays balanced across randomized deposits, exports, and claims', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameWithProofPool()
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
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
			const amountAttoRep = BigInt((nextRandom() % 5) + 1) * reportBond
			await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, vault, QuestionOutcome.Yes, amountAttoRep)
			deposits.push({ vault, amountAttoRep, depositIndex: BigInt(depositIndex), carryActive: true, escrowed: true })
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
		assert.strictEqual(depositLog.args.repAmountAttoRep, amount, 'deposit log should expose the requested amount')
		assert.strictEqual(depositLog.args.depositIndex, 0n, 'deposit log should expose the new deposit index')
		assert.strictEqual(depositLog.args.cumulativeRepAmountAttoRep, yesState.balanceAttoRep, 'deposit log should expose the updated outcome balance')
		assert.strictEqual(depositLog.args.resultingVaultDisputeStakedRepAttoRep, vaultEscrow, 'deposit log should expose the updated vault escrow')
		assert.strictEqual(depositLog.args.resultingTotalDisputeStakedRepAttoRep, totalEscrow, 'deposit log should expose the updated total escrow')
	})

	test('aggregate-backed winner payout is sent to the authenticated wallet', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		const genRepToken = getRepTokenAddress(0n)
		const walletBalanceBefore = await getERC20Balance(client, genRepToken, client.account.address)
		const withdrawalHash = await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		const replayLogs = await getEscalationReplayLogs([withdrawalHash], new Set([child.escalationGameAddress.toLowerCase()]))
		const consumptionLog = replayLogs.find(log => log.eventName === 'CarryDepositConsumed')
		const walletBalanceAfter = await getERC20Balance(client, genRepToken, client.account.address)
		assert.strictEqual(consumptionLog?.args['reason'], 0n, 'aggregate-backed proof consumption should be a winning claim')
		assert.strictEqual(walletBalanceAfter - walletBalanceBefore, proof.amountAttoRep, 'the winning proof should transfer REP to its authenticated beneficiary')
		assert.strictEqual(await readEscrowedRepByVault(child.escalationGameAddress, client.account.address), 0n, 'proof-only claims should not create vault escrow')
	})

	test('aggregate-backed winner payouts consume multiple carried proofs independently', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)

		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)
		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, 0n, reportBond, 1n)
		const secondLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 2n * reportBond, 1n, 3n * reportBond, 2n)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		const repToken = getRepTokenAddress(0n)
		const nullifierTree = new SparseNullifierTree()
		const firstProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [secondLeafHash], nullifierTree.getProof(0n))
		const walletBalanceBefore = await getERC20Balance(client, repToken, client.account.address)
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, firstProof)
		nullifierTree.consume(0n)
		assert.strictEqual(await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes), 2n * reportBond, 'the first proof should leave only the second winning principal unresolved')

		const secondProof = await createCarryProof(parent.escalationGameAddress, 1n, 1n, 1n, [firstLeafHash], nullifierTree.getProof(1n))
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, secondProof)
		const walletBalanceAfter = await getERC20Balance(client, repToken, client.account.address)
		assert.strictEqual(walletBalanceAfter - walletBalanceBefore, parentCarryTotal, 'both winning proofs should eventually release their aggregate principal')
		assert.strictEqual(await readEscrowedRepByVault(child.escalationGameAddress, client.account.address), 0n, 'aggregate-backed claims should never create vault escrow')
	})

	test('forked escrow events expose updated escrow totals and outcome balance', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
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
		assert.strictEqual(escrowRecordedLog.args.sourcePrincipalTotalAttoRep, reportBond, 'forked escrow log should expose the new source principal total')
		assert.strictEqual(escrowRecordedLog.args.childRepTotalAttoRep, reportBond, 'forked escrow log should expose the new child REP total')
		assert.strictEqual(escrowRecordedLog.args.disputeStakedRepByVaultAttoRep, vaultEscrow, 'forked escrow log should expose the updated vault escrow')
		assert.strictEqual(escrowRecordedLog.args.totalDisputeStakedRepAttoRep, totalEscrow, 'forked escrow log should expose the updated total escrow')
		assert.strictEqual(escrowRecordedLog.args.outcomeBalanceAttoRep, yesState.balanceAttoRep, 'forked escrow log should expose the updated outcome balance')

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
		assert.strictEqual(vaultEscrowLog.args.disputeStakedRepByVaultAttoRep, vaultEscrowAfterExport, 'vault escrow log should expose the updated vault escrow')
		assert.strictEqual(vaultEscrowLog.args.totalDisputeStakedRepAttoRep, totalEscrowAfterExport, 'vault escrow log should expose the updated total escrow')
	})

	test('fork carry funding completeness requires aggregate REP backing at a one-to-one ratio', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 0n], [0n, 3n * reportBond, 0n], [0n, 3n * reportBond, 0n], [zeroHash(), zeroHash(), zeroHash()])

		const yesState = await readOutcomeState(child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(yesState.balanceAttoRep, 3n * reportBond, 'preserved continuation balances should stay at the parent live principal')
		assert.strictEqual(yesState.inheritedUnresolvedTotalAttoRep, 3n * reportBond, 'test setup should preserve the inherited carried principal in source units')
		assert.strictEqual(await readIsForkCarryFundingComplete(child.escalationGameAddress), true, 'one-to-one aggregate REP backing should fully fund the carry without vault records')
	})

	test('zero-live-balance carry snapshots require aggregate REP rather than vault escrow', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, 0n, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		assert.strictEqual(await readIsForkCarryFundingComplete(child.escalationGameAddress), false, 'an unfunded inherited carry should be incomplete')
		await assert.rejects(resumeEscalationFromFork(child.escalationGameAddress), /Fork carry underfunded/)

		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await fundEscalationGame(child.escalationGameAddress, parentCarryTotal)
		assert.strictEqual(await readIsForkCarryFundingComplete(child.escalationGameAddress), true, 'one-to-one aggregate REP should complete funding without a vault record')
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
	})

	test('preserved continuation balances do not rebase when forked escrow arrives after the live balance already shrank', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 0n], [0n, 3n * reportBond, 0n], [0n, reportBond, 0n], [zeroHash(), zeroHash(), zeroHash()])

		const yesBalanceBeforeEscrow = (await readOutcomeState(child.escalationGameAddress, QuestionOutcome.Yes)).balanceAttoRep
		assert.strictEqual(yesBalanceBeforeEscrow, reportBond, 'test setup should model a preserved live balance that is already smaller than inherited unresolved total')

		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond, 3n)

		const yesState = await readOutcomeState(child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(yesState.balanceAttoRep, reportBond, 'forked escrow funding should not mutate a preserved live continuation balance')
		assert.deepStrictEqual(await readForkedEscrowByVaultAndOutcome(child.escalationGameAddress, client.account.address, QuestionOutcome.Yes), [3n * reportBond, 0n, 3n, 0n], 'funding progress should still track the inherited principal separately from the preserved live balance')
	})

	test('fork continuation snapshot preserves tied parent leaders below non-decision', async () => {
		const child = await deployEscalationGameWithProofPool()
		const tiedBalance = 2n * reportBond
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 1n], [0n, tiedBalance, tiedBalance], [0n, tiedBalance, tiedBalance], [zeroHash(), zeroHash(), zeroHash()])

		assert.strictEqual((await readOutcomeState(child.escalationGameAddress, QuestionOutcome.Yes)).balanceAttoRep, tiedBalance, 'the yes balance should match the tied parent snapshot')
		assert.strictEqual((await readOutcomeState(child.escalationGameAddress, QuestionOutcome.No)).balanceAttoRep, tiedBalance, 'the no balance should match the tied parent snapshot')
		assert.strictEqual(await getQuestionResolution(client, child.escalationGameAddress), QuestionOutcome.None, 'the inherited tie should remain unresolved')
		assert.strictEqual(await readNonDecisionState(child.escalationGameAddress), NON_DECISION_STATE_NONE, 'a below-threshold inherited tie should remain an ordinary live continuation')
		assert.strictEqual(await readCanTriggerOwnFork(child.escalationGameAddress), false, 'a below-threshold inherited tie should not authorize a fork')
	})

	test('fork continuation records an inherited threshold tie without fabricating a local timestamp', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		const snapshotHash = await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(
			child.testSecurityPoolAddress,
			[zeroPeakArray(), zeroPeakArray(), zeroPeakArray()],
			[0n, 1n, 1n],
			[0n, nonDecisionThresholdAttoRep, nonDecisionThresholdAttoRep],
			[0n, nonDecisionThresholdAttoRep, nonDecisionThresholdAttoRep],
			[zeroHash(), zeroHash(), zeroHash()],
		)

		assert.strictEqual(await getQuestionResolution(client, child.escalationGameAddress), QuestionOutcome.None, 'threshold-tied carried non-decision states should remain unresolved')
		assert.strictEqual(await readHasReachedNonDecision(child.escalationGameAddress), true, 'the inherited balances should satisfy the structural threshold predicate')
		assert.strictEqual(await readNonDecisionState(child.escalationGameAddress), NON_DECISION_STATE_INHERITED_THRESHOLD_TIE, 'the lifecycle state should identify an inherited threshold tie')
		assert.strictEqual(await readNonDecisionTimestamp(child.escalationGameAddress), 0n, 'snapshot initialization should not fabricate a local non-decision timestamp')
		assert.strictEqual(await readCanTriggerOwnFork(child.escalationGameAddress), true, 'an inherited threshold tie without a fixed outcome should authorize its own fork')
		await assert.rejects(
			client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: child.escalationGameAddress,
				functionName: 'previewDepositOnOutcome',
				args: [QuestionOutcome.Invalid, reportBond],
			}),
			/Invalid deposit preview/,
			'an inherited threshold tie should close the deposit path without requiring a synthetic local deposit',
		)
		const snapshotReceipt = await client.getTransactionReceipt({ hash: snapshotHash })
		const snapshotEventNames = snapshotReceipt.logs
			.filter(log => log.address.toLowerCase() === child.escalationGameAddress.toLowerCase())
			.flatMap(log => {
				try {
					return [decodeEventLog({ abi: peripherals_EscalationGame_EscalationGame.abi, data: log.data, topics: log.topics }).eventName]
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return []
				}
			})
		assert.strictEqual(snapshotEventNames.filter(eventName => eventName === 'InheritedThresholdTie').length, 1, 'snapshot initialization should emit one inherited-threshold-tie lifecycle event')
	})

	test('a fixed-outcome continuation settles an inherited threshold tie instead of authorizing another fork', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n, QuestionOutcome.Yes)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(
			child.testSecurityPoolAddress,
			[zeroPeakArray(), zeroPeakArray(), zeroPeakArray()],
			[0n, 1n, 1n],
			[0n, nonDecisionThresholdAttoRep, nonDecisionThresholdAttoRep],
			[0n, nonDecisionThresholdAttoRep, nonDecisionThresholdAttoRep],
			[zeroHash(), zeroHash(), zeroHash()],
		)

		assert.strictEqual(await readNonDecisionState(child.escalationGameAddress), NON_DECISION_STATE_INHERITED_THRESHOLD_TIE, 'the fixed child should retain the inherited threshold-tie lifecycle state')
		assert.strictEqual(await readCanTriggerOwnFork(child.escalationGameAddress), false, 'a fixed child should continue to its selected outcome instead of forking again')
		await resumeEscalationFromFork(child.escalationGameAddress)
		const continuationEndDate = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: child.escalationGameAddress,
			functionName: 'getEscalationGameEndDate',
			args: [],
		})
		await mockWindow.setTime(continuationEndDate + 1n)
		assert.strictEqual(await getQuestionResolution(client, child.escalationGameAddress), QuestionOutcome.Yes, 'the fixed branch should resolve normally after its continuation deadline')
	})

	test('carried proof pays its authenticated depositor without consulting vault escrow', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		const walletBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		assert.strictEqual((await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)) - walletBalanceBefore, reportBond, 'the proof beneficiary should receive the aggregate-backed REP')
	})

	test('carried proof needs no per-vault escrow record', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		assert.strictEqual(await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes), 0n, 'a proof-only claim should consume the winning liability')
	})

	test('aggregate-funded fork carry pays winning proofs without vault migration and retires losing principal', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, addressString(TEST_ADDRESSES[2]), QuestionOutcome.Invalid, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, addressString(TEST_ADDRESSES[1]), QuestionOutcome.No, 2n * reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const parentInvalidPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.No)
		const parentInvalidNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.No)
		const parentInvalidTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.No)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, ESCALATION_TIME_LENGTH, QuestionOutcome.Yes)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(
			child.testSecurityPoolAddress,
			[parentInvalidPeaks, parentYesPeaks, parentNoPeaks],
			[1n, 1n, 1n],
			[parentInvalidTotal, parentYesTotal, parentNoTotal],
			[parentInvalidTotal, parentYesTotal, parentNoTotal],
			[parentInvalidNullifierRoot, parentYesNullifierRoot, parentNoNullifierRoot],
		)
		await resumeEscalationFromFork(child.escalationGameAddress)
		await mockWindow.advanceTime(FRESH_FORK_RESPONSE_PERIOD + 1n)

		const winnerBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		const winningProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n), 3n)
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, winningProof)

		assert.ok((await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)) > winnerBalanceBefore, 'the authenticated winner should be paid from aggregate child REP')
		assert.strictEqual(await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes), 0n, 'the winning proof should consume its liability')
		assert.strictEqual(await readCarryTotal(child.escalationGameAddress, QuestionOutcome.No), 0n, 'the losing outcome should terminate without per-leaf proofs')

		const residualRep = await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress)
		assert.ok(residualRep > 0n, 'three nonzero outcome buckets should leave terminal losing carry after the winner is paid')
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: child.escalationGameAddress,
				functionName: 'sweepResidualRepToSecurityPool',
				args: [],
			}),
		)
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress), 0n, 'terminal losing carry should become sweepable after every logical liability is zero')
	})

	test('losing carried proofs are unnecessary and cannot drain aggregate backing', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
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
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, parentNoPeaks], [0n, parentYesLeafCount, parentNoLeafCount], [0n, parentYesCarryTotal, parentNoCarryTotal], [0n, 0n, 1n], [zeroHash(), parentYesNullifierRoot, parentNoNullifierRoot])
		await fundEscalationGame(child.escalationGameAddress, parentYesCarryTotal + parentNoCarryTotal - 1n)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		const walletBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof), /Not winning outcome/)
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(0n), client.account.address), walletBalanceBefore, 'a losing proof must not transfer REP')
		assert.strictEqual(await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes), 0n, 'the losing inherited outcome should already be terminal')
	})

	test('forked-escrow winner payout applies the inherited reward schedule in child REP', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
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
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, parentNoPeaks], [0n, parentYesLeafCount, parentNoLeafCount], [0n, parentYesCarryTotal, parentNoCarryTotal], [zeroHash(), parentYesNullifierRoot, parentNoNullifierRoot])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [await readCarryLeafHash(parent.escalationGameAddress, 2n)], new SparseNullifierTree().getProof(0n))
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, proof.amountAttoRep, proof.amountAttoRep],
			}),
		)

		const walletBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		const walletBalanceAfter = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		assert.ok(walletBalanceAfter - walletBalanceBefore > proof.amountAttoRep, 'forked winning proof should receive reward upside, not only escrow principal')
	})

	test('recordForkedEscrowForOutcome preserves child REP backing when an owner source-principal share rounds to zero', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await fundEscalationGame(child.escalationGameAddress, 1n)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 0n, 1n)
		assert.strictEqual(await readEscrowedRepByVault(child.escalationGameAddress, client.account.address), 1n)
		const balanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'exportForkedEscrowByOutcome',
				args: [client.account.address, client.account.address],
			}),
		)
		assert.strictEqual((await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)) - balanceBefore, 1n)
	})

	test('fork continuation inherits claim commitments without copying payout bundles', async () => {
		const source = await deployEscalationGameWithProofPool()
		await startEscalation(source.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		for (let ownerIndex = 1; ownerIndex <= 9; ownerIndex++) {
			await depositOnOutcomeViaProofTestSecurityPool(source.testSecurityPoolAddress, addressString(0x0000000000030000000000000000000000000000n + BigInt(ownerIndex)), QuestionOutcome.Yes, reportBond)
		}
		const sourcePeaks = await readCarryPeaks(source.escalationGameAddress, QuestionOutcome.Yes)
		const sourceLeafCount = await readCarryLeafCount(source.escalationGameAddress, QuestionOutcome.Yes)
		const sourceCarryTotal = await readCarryTotal(source.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(
			child.testSecurityPoolAddress,
			source.escalationGameAddress,
			zeroHash(),
			[zeroPeakArray(), sourcePeaks, zeroPeakArray()],
			[0n, sourceLeafCount, 0n],
			[0n, sourceCarryTotal, 0n],
			[zeroHash(), await readNullifierRoot(source.escalationGameAddress, QuestionOutcome.Yes), zeroHash()],
		)
		await resumeEscalationFromFork(child.escalationGameAddress)
		assert.strictEqual(await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.Yes), sourceLeafCount)
		assert.strictEqual(await readCarryRoot(child.escalationGameAddress, QuestionOutcome.Yes), await readCarryRoot(source.escalationGameAddress, QuestionOutcome.Yes))
		assert.ok((await client.readContract({ abi: peripherals_EscalationGame_EscalationGame.abi, address: child.escalationGameAddress, functionName: 'forkResumedAt', args: [] })) > 0n, 'continuation should resume in one call regardless of reporter count')
	})

	test('sybil reporters cannot exhaust a global payout-claim cap', async () => {
		const source = await deployEscalationGameWithProofPool()
		await startEscalation(source.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		for (let ownerIndex = 1; ownerIndex <= 65; ownerIndex++) {
			await depositOnOutcomeViaProofTestSecurityPool(source.testSecurityPoolAddress, addressString(0x0000000000040000000000000000000000000000n + BigInt(ownerIndex)), QuestionOutcome.Yes, reportBond)
		}
		assert.strictEqual(await readCarryLeafCount(source.escalationGameAddress, QuestionOutcome.Yes), 65n)
	})

	test('an inherited commitment preserves child-local reporting capacity', async () => {
		const source = await deployEscalationGameWithProofPool()
		await startEscalation(source.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		for (let ownerIndex = 1; ownerIndex <= 65; ownerIndex++) {
			await depositOnOutcomeViaProofTestSecurityPool(source.testSecurityPoolAddress, addressString(0x0000000000050000000000000000000000000000n + BigInt(ownerIndex)), QuestionOutcome.Yes, reportBond)
		}

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(
			child.testSecurityPoolAddress,
			source.escalationGameAddress,
			zeroHash(),
			[zeroPeakArray(), await readCarryPeaks(source.escalationGameAddress, QuestionOutcome.Yes), zeroPeakArray()],
			[0n, 65n, 0n],
			[0n, 65n * reportBond, 0n],
			[zeroHash(), await readNullifierRoot(source.escalationGameAddress, QuestionOutcome.Yes), zeroHash()],
		)
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.No, 66n * reportBond)
		await resumeEscalationFromFork(child.escalationGameAddress)

		assert.strictEqual(await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.No), 1n)
		assert.strictEqual(await readEscrowedRepByVault(child.escalationGameAddress, client.account.address), 66n * reportBond)
	})

	test('residual sweep rejects while forked escrow remains unsettled', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
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
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
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
		await startEscalationFromFork(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
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

	test('computeIterativeAttritionCostAttoRep: edge cases - time 0 and max time', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)

		// At time 0, cost should equal startBondAttoRep
		const costAt0 = await readIterativeAttritionCost(escalationGame, 0n)
		assert.strictEqual(costAt0, reportBond, 'cost at time 0 equals startBondAttoRep')

		// At full time, cost should equal nonDecisionThresholdAttoRep
		const costAtMax = await readIterativeAttritionCost(escalationGame, ESCALATION_TIME_LENGTH)
		assert.strictEqual(costAtMax, nonDecisionThresholdAttoRep, 'cost at max time equals nonDecisionThresholdAttoRep')
	})

	// Quantifies the maximum round‑trip error in seconds across the entire time range.
	test('Round‑trip error: max deviation ≤ 20 seconds', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
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

	test('computeIterativeAttritionCostAttoRep: monotonic increasing with loop', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		const step = ESCALATION_TIME_LENGTH / 100n // test 101 points
		let previousCost = 0n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = await readIterativeAttritionCost(escalationGame, t)

			// Cost must always increase or stay same (should always increase for this function)
			assert.ok(cost >= previousCost, `cost at time ${t} should be >= cost at time ${t - step}`)

			// Cost must never exceed nonDecisionThresholdAttoRep
			assert.ok(cost <= nonDecisionThresholdAttoRep, `cost at time ${t} should not exceed nonDecisionThresholdAttoRep`)

			previousCost = cost
		}
	})

	test('computeIterativeAttritionCostAttoRep: dense sampling for monotonicity', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		const step = ESCALATION_TIME_LENGTH / 250n

		let lastCost = 0n

		for (let t = 0n; t <= ESCALATION_TIME_LENGTH; t += step) {
			const cost = await readIterativeAttritionCost(escalationGame, t)

			assert.ok(cost >= lastCost, `Monotonicity violated at time ${t}: ${lastCost} -> ${cost}`)
			assert.ok(cost >= reportBond, `cost below startBondAttoRep at time ${t}`)
			assert.ok(cost <= nonDecisionThresholdAttoRep, `cost above threshold at time ${t}`)

			lastCost = cost
		}
	})

	test('computeTimeSinceStartFromAttritionCostAttoRep: roundtrip accuracy with loop', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
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

	test('computeTimeSinceStartFromAttritionCostAttoRep: handles boundary conditions', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)

		// Cost <= startBondAttoRep should return 0
		const timeFromLowCost = await readTimeSinceStartFromAttritionCost(escalationGame, reportBond)
		assert.strictEqual(timeFromLowCost, 0n, 'startBondAttoRep maps to time 0')

		// Cost >= nonDecisionThresholdAttoRep should return escalationTimeLength
		const timeFromHighCost = await readTimeSinceStartFromAttritionCost(escalationGame, nonDecisionThresholdAttoRep)
		assert.strictEqual(timeFromHighCost, ESCALATION_TIME_LENGTH, 'threshold maps to max time')
	})

	test('totalCostAttoRep: returns 0 before game starts and nonDecisionThresholdAttoRep after timeout', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)

		// totalCostAttoRep before activationTime (3 days in the future) returns 0
		const costBeforeStart = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'totalCostAttoRep',
			address: escalationGame,
			args: [],
		})
		assert.strictEqual(costBeforeStart, 0n, 'totalCostAttoRep returns 0 before game starts')

		// Advance time past the escalation period to test after-timeout behavior
		const activationTime = await getActivationTime(client, escalationGame)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		const costAfterTimeout = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'totalCostAttoRep',
			address: escalationGame,
			args: [],
		})
		assert.strictEqual(costAfterTimeout, nonDecisionThresholdAttoRep, 'totalCostAttoRep returns nonDecisionThresholdAttoRep after timeout')
	})

	// =================== Inverse Relationship Tests ===================

	test('computeTimeSinceStartFromAttritionCostAttoRep and computeIterativeAttritionCostAttoRep are inverses', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)

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

	test('computeTimeSinceStartFromAttritionCostAttoRep: monotonic increasing with cost', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
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

	test('computeTimeSinceStartFromAttritionCostAttoRep: handles intermediate costs correctly', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)

		// Pick some intermediate cost values between startBondAttoRep and nonDecisionThresholdAttoRep
		// Use linear spacing to sample the exponential curve evenly
		const numSamples = 20n

		for (let i = 1n; i < numSamples; i++) {
			// Generate a target cost that's between startBondAttoRep and threshold
			// Using linear interpolation for test simplicity
			const fraction = (i * 10000n) / numSamples // 0 to 10000 (basis points)
			const targetCost = reportBond + ((nonDecisionThresholdAttoRep - reportBond) * fraction) / 10000n

			// Get the time for this cost
			const recoveredT = await readTimeSinceStartFromAttritionCost(escalationGame, targetCost)

			// Recovered time should be within [0, ESCALATION_TIME_LENGTH]
			assert.ok(recoveredT <= ESCALATION_TIME_LENGTH, `Recovered time ${recoveredT} <= max`)

			// Compute the expected cost at recoveredT and ensure it's close to targetCost
			const computedCost = await readIterativeAttritionCost(escalationGame, recoveredT)

			// The computed cost should be close to targetCost (within 5% for on-chain precision)
			const absError = computedCost > targetCost ? computedCost - targetCost : targetCost - computedCost
			const relErrorBps = (absError * 10000n) / nonDecisionThresholdAttoRep // in basis points
			assert.ok(
				relErrorBps <= 500n, // 5% tolerance
				`Cost mismatch for fraction ${fraction / 10000n}: target=${targetCost}, got=${computedCost}, relError=${relErrorBps / 10000n}`,
			)
		}
	})

	test('depositOnOutcome prevents tie by refunding 1 attoREP', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		const depositAmount = 100n * reportBond
		// Deposit on Yes to establish a leader
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, depositAmount)
		// Deposit same amount on Invalid; would tie, but fix reduces by 1 attoREP
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Invalid, depositAmount)
		const balances = await getBalances(client, escalationGame)
		assert.strictEqual(balances.yes, depositAmount, 'Yes balance as leader')
		assert.strictEqual(balances.invalid, depositAmount - 1n, 'Invalid balance reduced by 1 attoREP')
		assert.strictEqual(balances.no, 0n, 'No balance remains zero')
		// Advance time past game end
		const activationTime = await getActivationTime(client, escalationGame)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		const resolution = await getQuestionResolution(client, escalationGame)
		assert.strictEqual(resolution, QuestionOutcome.Yes, 'Winner should be Yes')
	})

	test('deposit on leading outcome does not trigger tie-breaking adjustment', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
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
		const burnBalanceBeforeClaim = await getERC20Balance(client, getRepTokenAddress(0n), addressString(BURN_ADDRESS))
		const claimLog = await claimWinningDepositAndReadClaimLog(testSecurityPoolAddress, 0n, QuestionOutcome.Yes)
		assert.strictEqual(await readBindingCapital(escalationGameAddress), losingDeposit, 'Binding capital should be the losing-side 10 REP depth')
		assert.strictEqual(claimLog.args.depositor, winningDepositorAddress, 'claim event should identify the winning depositor')
		assert.strictEqual(claimLog.args.outcome, BigInt(QuestionOutcome.Yes), 'claim event should identify the winning outcome')
		assert.strictEqual(claimLog.args.parentDepositIndex, 0n, 'claim event should identify the stable parent deposit index')
		assert.strictEqual(claimLog.args.originalDepositAmountAttoRep, firstWinningDeposit, 'claim event should include the original winning principal')
		assert.strictEqual(claimLog.args.amountToWithdrawAttoRep, 7n * 10n ** 18n, 'The first 5 REP winning deposit should receive its 2 REP pro-rata reward share')
		assert.ok(claimLog.args.burnAmountAttoRep > 0n, 'a winning escalation claim should charge a positive deterrence haircut')
		assert.strictEqual((await getERC20Balance(client, getRepTokenAddress(0n), addressString(BURN_ADDRESS))) - burnBalanceBeforeClaim, claimLog.args.burnAmountAttoRep, 'a non-forking escalation game should burn the winner haircut outside fork migration')
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
		assert.strictEqual(claimLog.args.originalDepositAmountAttoRep, secondWinningDeposit, 'claim event should include the crossing principal')
		assert.strictEqual(claimLog.args.amountToWithdrawAttoRep, 18n * 10n ** 18n, 'The 14 REP crossing deposit should earn reward on its 10 REP safety-boundary slice and principal on its 4 REP excess slice')
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
		assert.strictEqual(firstClaimLog.args.originalDepositAmountAttoRep, firstWinningDeposit, 'first claim event should include original principal')
		assert.strictEqual(firstClaimLog.args.amountToWithdrawAttoRep, 21n * 10n ** 18n, 'The first 14 REP winning deposit should receive its 7 REP pro-rata reward share')
		assert.strictEqual(firstClaimLog.args.transferredRep, true, 'first direct claim should transfer REP')
		assert.strictEqual(secondClaimLog.args.depositor, secondWinningDepositorAddress, 'second claim event should identify its depositor')
		assert.strictEqual(secondClaimLog.args.parentDepositIndex, 1n, 'second claim event should identify the second deposit index')
		assert.strictEqual(secondClaimLog.args.originalDepositAmountAttoRep, secondWinningDeposit, 'second claim event should include original principal')
		assert.strictEqual(secondClaimLog.args.amountToWithdrawAttoRep, 15n * 10n ** 18n, 'The second 10 REP winning deposit should receive its 5 REP pro-rata reward share')
		assert.strictEqual(secondClaimLog.args.transferredRep, true, 'second direct claim should transfer REP')
	})
})
