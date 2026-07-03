import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { concatHex, encodeAbiParameters, encodeDeployData, keccak256, type Address, type Hex } from 'viem'
import assert from '../testsuite/simulator/utils/assert'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testsuite/simulator/utils/viem'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { ensureInfraDeployed } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { deployEscalationGame, depositOnOutcome, getActivationTime, getBalances, getEscalationGameDeposits } from '../testsuite/simulator/utils/contracts/escalationGame'
import { ensureZoltarDeployed, getRepTokenAddress, getZoltarAddress } from '../testsuite/simulator/utils/contracts/zoltar'
import { QuestionOutcome } from '../testsuite/simulator/types/types'
import { ReputationToken_ReputationToken, peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier, peripherals_EscalationGame_EscalationGame, test_peripherals_EscalationGameProofTestSecurityPool_EscalationGameProofTestSecurityPool as escalationGameProofTestPoolArtifact } from '../types/contractArtifact'
import { computeEscalationTimeSinceStartFromAttritionCost, ESCALATION_TIME_LENGTH, getEscalationBindingCapital, getWinningEscalationDepositClaimAmount, getWinningImportedEscalationDepositClaimAmount, projectEscalationDeposit } from '@zoltar/shared/escalationMath'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('Escalation math parity', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	const MAX_UINT256 = 2n ** 256n - 1n
	const NULLIFIER_DEPTH = 64
	const ZERO_HASH: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'
	const reportBond = 1n * 10n ** 18n
	const nonDecisionThreshold = 1000n * 10n ** 18n
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	const requireContractAddress = (value: Address | null | undefined, context: string) => {
		if (value === undefined || value === null) throw new Error(`${context} missing`)
		return value
	}

	const readBindingCapital = async (escalationGame: `0x${string}`) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'getBindingCapital',
			args: [],
		})

	const readEscalationEndDate = async (escalationGame: `0x${string}`) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'getEscalationGameEndDate',
			args: [],
		})

	const readPreviewDepositOnOutcome = async (escalationGame: `0x${string}`, outcome: QuestionOutcome, amount: bigint) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'previewDepositOnOutcome',
			args: [outcome, amount],
		})

	const readTimeSinceStartFromAttritionCost = async (escalationGame: `0x${string}`, attritionCost: bigint) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'computeTimeSinceStartFromAttritionCost',
			args: [attritionCost],
		})

	const startEscalationFromFork = async (escalationGameAddress: Address, elapsedAtFork: bigint) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_EscalationGame_EscalationGame.abi,
					address: escalationGameAddress,
					functionName: 'startFromFork',
					args: [reportBond, nonDecisionThreshold, elapsedAtFork],
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

	const readOutcomeState = async (escalationGameAddress: Address, outcome: QuestionOutcome) =>
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getOutcomeState',
			args: [outcome],
		})

	const readCarryPeaks = async (escalationGameAddress: Address, outcome: QuestionOutcome) => (await readOutcomeState(escalationGameAddress, outcome)).currentPeaks
	const readCarryLeafCount = async (escalationGameAddress: Address, outcome: QuestionOutcome) => (await readOutcomeState(escalationGameAddress, outcome)).currentLeafCount
	const readCarryTotal = async (escalationGameAddress: Address, outcome: QuestionOutcome) => (await readOutcomeState(escalationGameAddress, outcome)).currentCarryTotal
	const readNullifierRoot = async (escalationGameAddress: Address, outcome: QuestionOutcome) => (await readOutcomeState(escalationGameAddress, outcome)).currentNullifierRoot

	const startEscalation = async (escalationGame: Address) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_EscalationGame_EscalationGame.abi,
					address: escalationGame,
					functionName: 'start',
					args: [reportBond, nonDecisionThreshold],
				}),
		)

	const deployProofTestSecurityPool = async () => {
		const deploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: escalationGameProofTestPoolArtifact.abi,
				bytecode: `0x${escalationGameProofTestPoolArtifact.evm.bytecode.object}`,
				args: [getZoltarAddress(), 0n, client.account.address],
			}),
		})
		const deploymentReceipt = await client.waitForTransactionReceipt({ hash: deploymentHash })
		return requireContractAddress(deploymentReceipt.contractAddress, 'proof test security pool deployment address')
	}

	const deployEscalationGameWithProofPool = async () => {
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

	const deployEscalationGameTestSecurityPool = async () => {
		const deployment = await deployEscalationGameWithProofPool()
		await startEscalation(deployment.escalationGameAddress)
		return deployment
	}

	const deployForkContinuationEscalationGame = async () => {
		const deployment = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(deployment.escalationGameAddress, 0n)
		return deployment
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

	type PeakArray = Awaited<ReturnType<typeof readCarryPeaks>>

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

	const hashCarryLeaf = (depositor: Address, outcome: QuestionOutcome, amount: bigint, parentDepositIndex: bigint, cumulativeAmount: bigint, sourceNodeId: bigint) =>
		keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [depositor, outcome, amount, parentDepositIndex, cumulativeAmount, sourceNodeId]))

	const hashParent = (left: Hex, right: Hex) => keccak256(concatHex([left, right]))

	const buildZeroHashes = () => {
		const zeroHashes: Hex[] = [ZERO_HASH]
		for (let depth = 0; depth < NULLIFIER_DEPTH; depth += 1) {
			const previousHash = zeroHashes[depth]
			if (previousHash === undefined) throw new Error(`Zero hash missing at depth ${depth.toString()}`)
			zeroHashes.push(hashParent(previousHash, previousHash))
		}
		return zeroHashes
	}

	const createNullifierPath = (parentDepositIndex: bigint) => BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }], [parentDepositIndex]))) & ((1n << BigInt(NULLIFIER_DEPTH)) - 1n)

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

	class SparseNullifierTree {
		private readonly zeroHashes = buildZeroHashes()
		private readonly nodes = new Map<string, Hex>()
		private readonly pathMask = (1n << BigInt(NULLIFIER_DEPTH)) - 1n

		getProof(parentDepositIndex: bigint) {
			const path = createNullifierPath(parentDepositIndex) & this.pathMask
			const siblings: Hex[] = []
			let nodeIndex = path
			for (let depth = 0; depth < NULLIFIER_DEPTH; depth += 1) {
				const siblingIndex = nodeIndex ^ 1n
				const defaultHash = this.zeroHashes[depth]
				if (defaultHash === undefined) throw new Error(`Sparse tree zero hash missing at depth ${depth.toString()}`)
				siblings.push(this.nodes.get(`${depth}:${siblingIndex}`) ?? defaultHash)
				nodeIndex >>= 1n
			}
			return siblings
		}
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

	test('shared binding capital and attrition-time inversion match the deployed contract', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.No, 15n * reportBond)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, 7n * reportBond)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Invalid, 11n * reportBond)

		const balances = await getBalances(client, escalationGame)
		const sharedBindingCapital = getEscalationBindingCapital([balances.invalid, balances.yes, balances.no])
		assert.strictEqual(await readBindingCapital(escalationGame), sharedBindingCapital, 'shared binding capital should match the contract median balance')

		for (const attritionCost of [reportBond, sharedBindingCapital, nonDecisionThreshold]) {
			const solidityTimeSinceStart = await readTimeSinceStartFromAttritionCost(escalationGame, attritionCost)
			const sharedTimeSinceStart = computeEscalationTimeSinceStartFromAttritionCost(reportBond, nonDecisionThreshold, attritionCost)
			assert.strictEqual(solidityTimeSinceStart, sharedTimeSinceStart, `attrition inversion mismatch at ${attritionCost.toString()}`)
		}
	})

	test('shared deposit projection matches previewDepositOnOutcome and projected end time', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, 9n * reportBond)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.No, 6n * reportBond)

		const balances = await getBalances(client, escalationGame)
		const requestedAmount = 8n * reportBond
		const projection = projectEscalationDeposit({
			amount: requestedAmount,
			balances: [balances.invalid, balances.yes, balances.no],
			nonDecisionThreshold,
			outcome: 'invalid',
			startBond: reportBond,
		})
		assert.ok(projection !== undefined, 'shared projection should accept this deposit')
		if (projection === undefined) return

		const [acceptedAmount, resultingCumulativeAmount] = await readPreviewDepositOnOutcome(escalationGame, QuestionOutcome.Invalid, requestedAmount)
		assert.strictEqual(acceptedAmount, projection.acceptedAmount, 'accepted amount should match previewDepositOnOutcome')
		assert.strictEqual(resultingCumulativeAmount, projection.projectedBalances[0], 'projected invalid balance should match preview cumulative amount')

		const activationTime = await getActivationTime(client, escalationGame)
		const projectedBindingCapital = getEscalationBindingCapital(projection.projectedBalances)
		const expectedEndTime = activationTime + computeEscalationTimeSinceStartFromAttritionCost(reportBond, nonDecisionThreshold, projectedBindingCapital)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Invalid, acceptedAmount)
		assert.strictEqual(await readEscalationEndDate(escalationGame), expectedEndTime, 'shared projected end time should match the contract after the same deposit')
	})

	test('shared winning-withdrawal math matches claimDepositForWinning', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 5n * reportBond)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 5n * reportBond)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.No, 10n * reportBond)

		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)

		const [firstWinningDeposit] = await getEscalationGameDeposits(client, escalationGameAddress, QuestionOutcome.Yes)
		assert.ok(firstWinningDeposit !== undefined, 'expected a winning deposit to claim')
		if (firstWinningDeposit === undefined) return

		const balances = await getBalances(client, escalationGameAddress)
		const sharedWithdrawal = getWinningEscalationDepositClaimAmount({
			bindingCapital: await readBindingCapital(escalationGameAddress),
			cumulativeAmount: firstWinningDeposit.cumulativeAmount,
			depositAmount: firstWinningDeposit.amount,
			forkThreshold: nonDecisionThreshold,
			nonDecisionThreshold,
			winningOutcomeBalance: balances.yes,
		})
		const preview = await client.simulateContract({
			abi: escalationGameProofTestPoolArtifact.abi,
			address: testSecurityPoolAddress,
			functionName: 'claimDepositForWinning',
			args: [0n, QuestionOutcome.Yes],
		})
		const [, claimedAmount, originalDepositAmount] = preview.result
		assert.strictEqual(originalDepositAmount, firstWinningDeposit.amount, 'claim preview should preserve the original winning principal size')
		assert.strictEqual(sharedWithdrawal, claimedAmount, 'shared model should match the contract winning-withdrawal amount')
	})

	test('shared imported winning-withdrawal math matches carried proof settlement at the reward-cap boundary', async () => {
		const parent = await deployEscalationGameTestSecurityPool()
		const firstWinningDepositAmount = 2n * reportBond
		const secondWinningDepositAmount = 2n * reportBond
		const losingDepositAmount = 2n * reportBond

		await depositOnOutcomeViaTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, firstWinningDepositAmount)
		await depositOnOutcomeViaTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, secondWinningDepositAmount)
		await depositOnOutcomeViaTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.No, losingDepositAmount)

		const emptyOutcomePeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const emptyOutcomeLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const emptyOutcomeCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const emptyOutcomeNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoPeaks = await readCarryPeaks(parent.escalationGameAddress, QuestionOutcome.No)
		const parentNoLeafCount = await readCarryLeafCount(parent.escalationGameAddress, QuestionOutcome.No)
		const parentNoCarryTotal = await readCarryTotal(parent.escalationGameAddress, QuestionOutcome.No)
		const parentNoNullifierRoot = await readNullifierRoot(parent.escalationGameAddress, QuestionOutcome.No)

		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, firstWinningDepositAmount, 0n, firstWinningDepositAmount, 1n)
		const child = await deployForkContinuationEscalationGame()
		await initializeSnapshotViaTestSecurityPool(
			child.testSecurityPoolAddress,
			[emptyOutcomePeaks, parentYesPeaks, parentNoPeaks],
			[emptyOutcomeLeafCount, parentYesLeafCount, parentNoLeafCount],
			[emptyOutcomeCarryTotal, parentYesCarryTotal, parentNoCarryTotal],
			[emptyOutcomeNullifierRoot, parentYesNullifierRoot, parentNoNullifierRoot],
		)
		const childBindingCapital = await readBindingCapital(child.escalationGameAddress)
		assert.strictEqual(childBindingCapital, losingDepositAmount, 'child fork should inherit the parent binding-capital depth for this snapshot')
		await resumeEscalationFromFork(child.escalationGameAddress)
		const forkResumedAt = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: child.escalationGameAddress,
			functionName: 'forkResumedAt',
			args: [],
		})
		const resolvingAttritionCost = (25n * reportBond) / 10n
		const elapsedAtTargetCost = await readTimeSinceStartFromAttritionCost(child.escalationGameAddress, resolvingAttritionCost)
		await mockWindow.setTime(forkResumedAt + (elapsedAtTargetCost > 0n ? elapsedAtTargetCost : 1n))

		const secondProof = await createCarryProof(parent.escalationGameAddress, 1n, 1n, 1n, [firstLeafHash], new SparseNullifierTree().getProof(1n))
		const childBalances = await getBalances(client, child.escalationGameAddress)
		const sharedWithdrawal = getWinningImportedEscalationDepositClaimAmount({
			bindingCapital: childBindingCapital,
			depositAmount: secondProof.amount,
			forkThreshold: nonDecisionThreshold,
			nonDecisionThreshold,
			postDepositCumulativeAmount: secondProof.cumulativeAmount,
			winningOutcomeBalance: childBalances.yes,
		})
		const preview = await client.simulateContract({
			abi: escalationGameProofTestPoolArtifact.abi,
			address: child.testSecurityPoolAddress,
			functionName: 'withdrawDeposit',
			args: [QuestionOutcome.Yes, secondProof],
		})
		const [, claimedAmount, originalDepositAmount] = preview.result
		assert.strictEqual(originalDepositAmount, secondProof.amount, 'proof preview should preserve the original imported winning principal size')
		assert.strictEqual(sharedWithdrawal, claimedAmount, 'shared imported model should match carried proof settlement')

		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, secondProof)
		assert.strictEqual(await readCarryTotal(child.escalationGameAddress, QuestionOutcome.Yes), firstWinningDepositAmount, 'withdrawing the later carried proof should leave only the first winning imported principal unresolved')
	})
})
