import { beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { encodeAbiParameters, encodeDeployData, keccak256, type Abi, type Address, type Hex, zeroAddress } from '@zoltar/shared/ethereum'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import assert from '../testSupport/simulator/utils/assert'
import { getERC20Balance, setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { ensureZoltarDeployed, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { peripherals_EscalationGame_EscalationGame, peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier, ReputationToken_ReputationToken, test_peripherals_EscalationGameProofTestSecurityPool_EscalationGameProofTestSecurityPool as proofTestPoolArtifact, Zoltar_Zoltar } from '../types/contractArtifact'
import { hashCarryLeaf, SparseNullifierTree } from './carryProofHelpers'

const ESCALATION_TIME_LENGTH = 4_233_600n
const FORK_THRESHOLD = 20n * 10n ** 18n
const NON_DECISION_THRESHOLD = FORK_THRESHOLD / 2n
const START_BOND = 1n * 10n ** 18n
const MAX_UINT256 = 2n ** 256n - 1n
const ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT = 2n

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

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('Audit regression: escalation fork burn divisor solvency', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const repTokenAddress = addressString(GENESIS_REPUTATION_TOKEN)
	const zeroHash = `0x${'0'.repeat(64)}` as Hex
	const universeSupplySlot = keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [0n, ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT]))

	const deployContract = async (deploymentData: Hex): Promise<Address> => {
		const transactionHash = await client.sendTransaction({ data: deploymentData })
		const receipt = await client.waitForTransactionReceipt({ hash: transactionHash })
		if (receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('deployment address missing')
		return receipt.contractAddress
	}

	const zeroPeaks = () => Array.from({ length: 64 }, () => zeroHash)

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
	})

	test('rejects unsafe divisors and blocks fork resume until the maximum-bonus winner is fully backed', async () => {
		const canonicalQuestionData = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			address: getZoltarAddress(),
			functionName: 'zoltarQuestionData',
			args: [],
		})
		const proofVerifier = await deployContract(
			encodeDeployData({
				abi: peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier.abi,
				bytecode: `0x${peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier.evm.bytecode.object}`,
			}),
		)
		const expectedWinningPayout = NON_DECISION_THRESHOLD + (NON_DECISION_THRESHOLD * 3n) / 5n

		for (const unsafeForkBurnDivisor of [2n, 3n, 4n]) {
			await assert.rejects(
				deployContract(
					encodeDeployData({
						abi: Zoltar_Zoltar.abi,
						bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
						args: [canonicalQuestionData, 20n, unsafeForkBurnDivisor],
					}),
				),
				/Zoltar fork burn divisor must be at least five/,
			)
		}

		const forkBurnDivisor = 5n
		const zoltar = await deployContract(
			encodeDeployData({
				abi: Zoltar_Zoltar.abi,
				bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
				args: [canonicalQuestionData, 20n, forkBurnDivisor],
			}),
		)
		await mockWindow.addStateOverrides({
			[zoltar]: {
				stateDiff: {
					[universeSupplySlot]: FORK_THRESHOLD * 20n,
				},
			},
		})
		assert.strictEqual(
			await client.readContract({
				abi: Zoltar_Zoltar.abi,
				address: zoltar,
				functionName: 'getForkThreshold',
				args: [0n],
			}),
			FORK_THRESHOLD,
			'the isolated Zoltar deployment must use the intended fork threshold',
		)

		const childBacking = FORK_THRESHOLD - FORK_THRESHOLD / forkBurnDivisor
		const securityPool = await deployContract(
			encodeDeployData({
				abi: proofTestPoolArtifact.abi,
				bytecode: `0x${proofTestPoolArtifact.evm.bytecode.object}`,
				args: [zoltar, 0n, zeroAddress],
			}),
		)
		const escalationGame = await deployContract(
			encodeDeployData({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				bytecode: `0x${peripherals_EscalationGame_EscalationGame.evm.bytecode.object}`,
				args: [securityPool, repTokenAddress, proofVerifier],
			}),
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: proofTestPoolArtifact.abi,
				address: securityPool,
				functionName: 'setEscalationGame',
				args: [escalationGame],
			}),
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: ReputationToken_ReputationToken.abi,
				address: repTokenAddress,
				functionName: 'approve',
				args: [securityPool, MAX_UINT256],
			}),
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'startFromFork',
				args: [START_BOND, NON_DECISION_THRESHOLD, ESCALATION_TIME_LENGTH, QuestionOutcome.Yes, true, childBacking],
			}),
		)

		const yesParentDepositIndex = 1_001n + forkBurnDivisor
		const noParentDepositIndex = 2_001n + forkBurnDivisor
		const yesSourceNodeId = 1n
		const noSourceNodeId = 2n
		const invalidPeaks = zeroPeaks()
		const yesPeaks = zeroPeaks()
		const noPeaks = zeroPeaks()
		yesPeaks[0] = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, NON_DECISION_THRESHOLD, yesParentDepositIndex, NON_DECISION_THRESHOLD, yesSourceNodeId)
		noPeaks[0] = hashCarryLeaf(client.account.address, QuestionOutcome.No, NON_DECISION_THRESHOLD, noParentDepositIndex, NON_DECISION_THRESHOLD, noSourceNodeId)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: initializeForkCarrySnapshotWithResolutionBalancesAbi,
				address: securityPool,
				functionName: 'initializeForkCarrySnapshotWithResolutionBalances',
				args: [
					[invalidPeaks, yesPeaks, noPeaks],
					[0n, 1n, 1n],
					[0n, NON_DECISION_THRESHOLD, NON_DECISION_THRESHOLD],
					[0n, NON_DECISION_THRESHOLD, NON_DECISION_THRESHOLD],
					[zeroHash, zeroHash, zeroHash],
				],
			}),
		)

		// Snapshot initialization transfers the full parent REP principal. Replacing it
		// with one wei less than the exact post-fork backing tests both the view gate and
		// the state-changing resume guard at the solvency boundary.
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: proofTestPoolArtifact.abi,
				address: securityPool,
				functionName: 'drainAllRep',
				args: [client.account.address],
			}),
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: ReputationToken_ReputationToken.abi,
				address: repTokenAddress,
				functionName: 'transfer',
				args: [escalationGame, childBacking - 1n],
			}),
		)
		assert.strictEqual(await getERC20Balance(client, repTokenAddress, escalationGame), childBacking - 1n, 'child game must begin one wei below the safe post-fork backing')
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'isForkCarryFundingComplete',
				args: [],
			}),
			false,
			'the funding view must reject a one-wei shortfall',
		)
		await assert.rejects(
			client.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'resumeFromFork',
				args: [],
			}),
			/Fork carry underfunded/,
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: ReputationToken_ReputationToken.abi,
				address: repTokenAddress,
				functionName: 'transfer',
				args: [escalationGame, 1n],
			}),
		)
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'isForkCarryFundingComplete',
				args: [],
			}),
			true,
			'the funding view must accept the exact divisor-five backing',
		)

		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'resumeFromFork',
				args: [],
			}),
		)
		const forkResumedAt = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'forkResumedAt',
			args: [],
		})
		await mockWindow.setTime(forkResumedAt + 1n)
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'getFinalQuestionResolution',
				args: [],
			}),
			BigInt(QuestionOutcome.Yes),
			'the inherited fixed outcome must be final before settlement',
		)

		const proof = {
			depositor: client.account.address,
			amount: NON_DECISION_THRESHOLD,
			parentDepositIndex: yesParentDepositIndex,
			cumulativeAmount: NON_DECISION_THRESHOLD,
			sourceNodeId: yesSourceNodeId,
			leafIndex: 0n,
			merkleMountainRangeSiblings: [] as readonly Hex[],
			merkleMountainRangePeakIndex: 0n,
			nullifierSiblings: new SparseNullifierTree().getProof(yesParentDepositIndex),
		}
		const walletRepBeforeClaim = await getERC20Balance(client, repTokenAddress, client.account.address)

		assert.strictEqual(childBacking, expectedWinningPayout, 'divisor 5 must leave exactly enough REP for the maximum-bonus winner')
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: proofTestPoolArtifact.abi,
				address: securityPool,
				functionName: 'withdrawDeposit',
				args: [QuestionOutcome.Yes, proof],
			}),
		)
		assert.strictEqual((await getERC20Balance(client, repTokenAddress, client.account.address)) - walletRepBeforeClaim, expectedWinningPayout, 'the backed winner must receive the full payout')
		assert.strictEqual(await getERC20Balance(client, repTokenAddress, escalationGame), 0n, 'the exactly backed game should settle with no residual REP')
	})
})
