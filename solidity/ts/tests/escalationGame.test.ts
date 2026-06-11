import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { concatHex, decodeEventLog, encodeAbiParameters, encodeDeployData, keccak256, type Address, type Hex } from 'viem'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient, writeContractAndWait } from '../testsuite/simulator/utils/viem'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { contractExists, setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { QuestionOutcome } from '../testsuite/simulator/types/types'
import assert from 'node:assert/strict'
import { deployEscalationGame, depositOnOutcome, getActivationTime, getBalances, getEscalationGameDeposits, getQuestionResolution } from '../testsuite/simulator/utils/contracts/escalationGame'
import { ensureZoltarDeployed, getZoltarAddress } from '../testsuite/simulator/utils/contracts/zoltar'
import { ensureInfraDeployed } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { peripherals_EscalationGame_EscalationGame, peripherals_test_EscalationGameProofTestSecurityPool_EscalationGameProofTestSecurityPool as escalationGameProofTestPoolArtifact, peripherals_test_EscalationGameTestSecurityPool_EscalationGameTestSecurityPool } from '../types/contractArtifact'
import { isIgnorableLogDecodeError } from './logDecodeErrors'

const ESCALATION_TIME_LENGTH = 4233600n
const NULLIFIER_DEPTH = 64

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('Escalation Game Test Suite', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const reportBond = 1n * 10n ** 18n
	const nonDecisionThreshold = 1000n * 10n ** 18n

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

	const deployEscalationGameTestSecurityPool = async () => {
		const zoltarAddress = getZoltarAddress()
		const deploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: peripherals_test_EscalationGameTestSecurityPool_EscalationGameTestSecurityPool.abi,
				bytecode: `0x${peripherals_test_EscalationGameTestSecurityPool_EscalationGameTestSecurityPool.evm.bytecode.object}`,
				args: [zoltarAddress, 0n, client.account.address],
			}),
		})
		const deploymentReceipt = await client.waitForTransactionReceipt({ hash: deploymentHash })
		const testSecurityPoolAddress = deploymentReceipt.contractAddress
		if (testSecurityPoolAddress === undefined || testSecurityPoolAddress === null) throw new Error('test security pool deployment address missing')
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_test_EscalationGameTestSecurityPool_EscalationGameTestSecurityPool.abi,
					address: testSecurityPoolAddress,
					functionName: 'deployEscalationGame',
					args: [reportBond, nonDecisionThreshold],
				}),
		)
		const escalationGameAddress = await client.readContract({
			abi: peripherals_test_EscalationGameTestSecurityPool_EscalationGameTestSecurityPool.abi,
			functionName: 'escalationGame',
			address: testSecurityPoolAddress,
			args: [],
		})
		return { escalationGameAddress, testSecurityPoolAddress }
	}

	const deployEscalationGameWithProofPool = async () => {
		const zoltarAddress = getZoltarAddress()
		const testSecurityPoolDeploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: escalationGameProofTestPoolArtifact.abi,
				bytecode: `0x${escalationGameProofTestPoolArtifact.evm.bytecode.object}`,
				args: [zoltarAddress, 0n, client.account.address],
			}),
		})
		const testSecurityPoolDeploymentReceipt = await client.waitForTransactionReceipt({ hash: testSecurityPoolDeploymentHash })
		const testSecurityPoolAddress = testSecurityPoolDeploymentReceipt.contractAddress
		if (testSecurityPoolAddress === undefined || testSecurityPoolAddress === null) throw new Error('proof test security pool deployment address missing')
		const escalationGameDeploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				bytecode: `0x${peripherals_EscalationGame_EscalationGame.evm.bytecode.object}`,
				args: [testSecurityPoolAddress],
			}),
		})
		const escalationGameDeploymentReceipt = await client.waitForTransactionReceipt({ hash: escalationGameDeploymentHash })
		const escalationGameAddress = escalationGameDeploymentReceipt.contractAddress
		if (escalationGameAddress === undefined || escalationGameAddress === null) throw new Error('escalation game deployment address missing')
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

	const advanceForkContinuationPastStart = async (escalationGameAddress: Address) => {
		await resumeEscalationFromFork(escalationGameAddress)
		const forkResumedAt = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'forkResumedAt',
			args: [],
		})
		await mockWindow.setTime(forkResumedAt + 1n)
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
	const readForkCarrySnapshotInitialized = async (escalationGameAddress: Address) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'forkCarrySnapshotInitialized',
			args: [],
		})

	const readCarryLeafPage = async (escalationGameAddress: Address, outcome: QuestionOutcome, startNodeId: bigint, maxEntries: bigint) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getCarryLeafPageByOutcome',
			args: [outcome, startNodeId, maxEntries],
		})

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
					abi: peripherals_test_EscalationGameTestSecurityPool_EscalationGameTestSecurityPool.abi,
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
					abi: peripherals_test_EscalationGameTestSecurityPool_EscalationGameTestSecurityPool.abi,
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
		await assert.rejects(depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond), /tie adjustment would break min deposit/i)
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

		assert.strictEqual(depositPage.length, 1, 'deposit paging should return only the remaining entries')
		assert.strictEqual(depositPage[0]?.amount, reportBond * 2n, 'paged deposit should retain its amount')
		assert.strictEqual(depositPage[0]?.depositor, client.account.address, 'paged deposit should retain its depositor')
		assert.strictEqual(depositPage[0]?.depositIndex, 1n, 'paged deposit should retain its index')
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

	test('claimDepositForWinning reverts when outcome is not the winning outcome', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		await assert.rejects(claimDepositForWinningViaTestSecurityPool(testSecurityPoolAddress, 0n, QuestionOutcome.No), /outcome not winning/i)
	})

	test('fork carry maintains an append-only Merkle Mountain Range root for inherited carryover deposits', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameWithProofPool()
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThreshold)

		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)

		const firstLeafHash = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'previewLeafHash',
			args: [client.account.address, QuestionOutcome.Yes, reportBond, 0n, reportBond, 1n],
		})
		const rootAfterFirstDeposit = await readCarryRoot(escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(rootAfterFirstDeposit, firstLeafHash, 'single appended leaf should be its own Merkle Mountain Range root')

		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const secondLeafHash = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'previewLeafHash',
			args: [client.account.address, QuestionOutcome.Yes, reportBond, 1n, 2n * reportBond, 2n],
		})
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

		await claimDepositForWinningViaTestSecurityPool(testSecurityPoolAddress, 1n, QuestionOutcome.Yes)

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
		await assert.rejects(readCarryLeafPage(escalationGameAddress, QuestionOutcome.No, yesNodeId ?? 0n, 1n), /cursor outcome mismatch/i)
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

	test('fork carry child instances can settle multiple inherited carried deposits from proofs only', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThreshold)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)

		const parentLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)

		const firstLeafHash = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: parent.escalationGameAddress,
			functionName: 'previewLeafHash',
			args: [client.account.address, QuestionOutcome.Yes, reportBond, 0n, reportBond, 1n],
		})
		const secondLeafHash = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: parent.escalationGameAddress,
			functionName: 'previewLeafHash',
			args: [client.account.address, QuestionOutcome.Yes, 2n * reportBond, 1n, 3n * reportBond, 2n],
		})

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress)

		const nullifierTree = new SparseNullifierTree()
		const firstProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [secondLeafHash], nullifierTree.getProof(0n))
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, firstProof)
		nullifierTree.consume(0n)

		const secondProof = await createCarryProof(parent.escalationGameAddress, 1n, 1n, 1n, [firstLeafHash], nullifierTree.getProof(1n))
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, secondProof)

		const remainingCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(remainingCarryTotal, 0n)
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
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof), /invalid nullifier proof|deposit already settled/)
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
		await resumeEscalationFromFork(child.escalationGameAddress)
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)

		const childInvalidPeaks = await readCarryPeaks(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesPeaks = await readCarryPeaks(child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidLeafCount = await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childLeafCount = await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidNullifierRoot = await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childNullifierRoot = await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Yes)

		const parentLeafHash = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: parent.escalationGameAddress,
			functionName: 'previewLeafHash',
			args: [client.account.address, QuestionOutcome.Yes, 3n * reportBond, 0n, 3n * reportBond, 2n],
		})
		const childLocalLeafHash = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: child.escalationGameAddress,
			functionName: 'previewLeafHash',
			args: [client.account.address, QuestionOutcome.Yes, reportBond, 1n << 255n, 4n * reportBond, 1n],
		})

		const grandchild = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(grandchild.testSecurityPoolAddress, [childInvalidPeaks, childYesPeaks, zeroPeakArray()], [childInvalidLeafCount, childLeafCount, 0n], [childInvalidCarryTotal, childCarryTotal, 0n], [childInvalidNullifierRoot, childNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress)

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
		await resumeEscalationFromFork(child.escalationGameAddress)
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await claimDepositForWinningViaTestSecurityPool(child.testSecurityPoolAddress, 0n, QuestionOutcome.Yes)

		const childInvalidPeaks = await readCarryPeaks(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesPeaks = await readCarryPeaks(child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidLeafCount = await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesLeafCount = await readCarryLeafCount(child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesCarryTotal = await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidNullifierRoot = await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesNullifierRoot = await readNullifierRoot(child.escalationGameAddress, QuestionOutcome.Yes)
		const parentLeafHash = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: parent.escalationGameAddress,
			functionName: 'previewLeafHash',
			args: [client.account.address, QuestionOutcome.Yes, 3n * reportBond, 0n, 3n * reportBond, 2n],
		})
		const grandchild = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThreshold, 0n)
		await initializeSnapshotViaTestSecurityPool(grandchild.testSecurityPoolAddress, [childInvalidPeaks, childYesPeaks, zeroPeakArray()], [childInvalidLeafCount, childYesLeafCount, 0n], [childInvalidCarryTotal, childYesCarryTotal, 0n], [childInvalidNullifierRoot, childYesNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress)

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
			/invalid nullifier proof|deposit already settled|peak absent|invalid carry inclusion proof/,
			'grandchild carry settlement must reject a child-local leaf that was already settled before the recursive fork',
		)

		const grandchildRoot = await readCarryRoot(grandchild.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(grandchildRoot, parentLeafHash, 'the recursive grandchild snapshot should exclude child-local leaves that were already settled before the fork')
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
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof), /Question has not finalized!/i)
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
		assert.strictEqual(claimLog.args.amountToWithdraw, 7n * 10n ** 18n, 'The first 5 REP winning deposit should receive its 2 REP pro-rata reward share')
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
		assert.strictEqual(claimLog.args.amountToWithdraw, 18n * 10n ** 18n, 'The 14 REP crossing deposit should earn reward on its 10 REP safety-boundary slice and principal on its 4 REP excess slice')
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
		assert.strictEqual(firstClaimLog.args.amountToWithdraw, 21n * 10n ** 18n, 'The first 14 REP winning deposit should receive its 7 REP pro-rata reward share')
		assert.strictEqual(secondClaimLog.args.amountToWithdraw, 15n * 10n ** 18n, 'The second 10 REP winning deposit should receive its 5 REP pro-rata reward share')
	})
})
