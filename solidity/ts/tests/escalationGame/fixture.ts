import assert from '../../testSupport/simulator/utils/assert'
import { beforeAll, beforeEach } from 'bun:test'
import { decodeEventLog, encodeDeployData, encodeFunctionData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES, MAX_UINT256 } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { getEscrowedRepByVault, getTotalEscrowedRep, readTimeSinceStartFromAttritionCost, readCarryTotal, readCarryLeafPage } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { ensureZoltarDeployed, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { ensureInfraDeployed, getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import {
	statoblast_EscalationGame_EscalationGame,
	statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier,
	ReputationToken_ReputationToken,
	test_statoblast_EscalationGameProofTestSecurityPool_EscalationGameProofTestSecurityPool as escalationGameProofTestPoolArtifact,
	test_statoblast_EscalationGameForkerHarness_EscalationGameForkerHarness as escalationGameForkerHarnessArtifact,
	test_statoblast_FalseReturningERC20_FalseReturningERC20,
	test_statoblast_IncompatibleEscalationGameProofVerifier_IncompatibleEscalationGameProofVerifier as incompatibleProofVerifierArtifact,
	test_statoblast_SecurityPoolAncestorTestNode_SecurityPoolAncestorTestNode as securityPoolAncestorTestNodeArtifact,
} from '../../types/contractArtifact'
import { isIgnorableLogDecodeError } from '../logDecodeErrors'
import { computeForkContinuationParentDepositIndex, createCarryProof as createCarryProofFromHelpers, readCarryLeafHash as readCarryLeafHashFromHelpers } from '../carryProofHelpers'
import { FRESH_FORK_RESPONSE_PERIOD, requireContractAddress, type LocalAccountingDeposit, createEscalationGameCarryHelpers } from './carryHelpers'

export function useEscalationGameFixture() {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const carryHelpers = createEscalationGameCarryHelpers(() => client)
	const { assertOutcomeCarryTotalsMatchComponents } = carryHelpers
	const reportBond = 1n * 10n ** 18n
	const nonDecisionThresholdAttoRep = 1000n * 10n ** 18n
	const recursiveResolutionTargetCost = (25n * reportBond) / 10n

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
				abi: statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.abi,
				bytecode: `0x${statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.evm.bytecode.object}`,
			}),
		})
		const verifierDeploymentReceipt = await client.waitForTransactionReceipt({ hash: verifierDeploymentHash })
		const proofVerifierAddress = requireContractAddress(verifierDeploymentReceipt.contractAddress, 'proof verifier deployment address')
		const escalationGameDeploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				bytecode: `0x${statoblast_EscalationGame_EscalationGame.evm.bytecode.object}`,
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
				abi: test_statoblast_FalseReturningERC20_FalseReturningERC20.abi,
				bytecode: `0x${test_statoblast_FalseReturningERC20_FalseReturningERC20.evm.bytecode.object}`,
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
					abi: statoblast_EscalationGame_EscalationGame.abi,
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
					abi: statoblast_EscalationGame_EscalationGame.abi,
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
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'forkResumedAt',
			args: [],
		})
		const elapsedAtTargetCost = await readTimeSinceStartFromAttritionCost(client, escalationGameAddress, targetAttritionCost)
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

	const transactWithEscalationGame = async (escalationGameAddress: Address, data: Hex) => await writeContractAndWait(client, () => client.sendTransaction({ to: escalationGameAddress, data }))

	const traceCarryLeafPage = async (escalationGameAddress: Address, outcome: QuestionOutcome, startNodeId: bigint, maxEntries: bigint) =>
		await transactWithEscalationGame(
			escalationGameAddress,
			encodeFunctionData({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				functionName: 'getCarryLeafPageByOutcome',
				args: [outcome, startNodeId, maxEntries],
			}),
		)

	const traceProofConsumedCarriedDepositIndexes = async (escalationGameAddress: Address, outcome: QuestionOutcome, startIndex: bigint, numberOfEntries: bigint) =>
		await transactWithEscalationGame(
			escalationGameAddress,
			encodeFunctionData({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				functionName: 'getProofConsumedCarriedDepositIndexesByOutcome',
				args: [outcome, startIndex, numberOfEntries],
			}),
		)
	const traceForkedEscrowByVaultAndOutcome = async (escalationGameAddress: Address, vault: Address, outcome: QuestionOutcome) =>
		await transactWithEscalationGame(
			escalationGameAddress,
			encodeFunctionData({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				functionName: 'getForkedEscrowByVaultAndOutcome',
				args: [vault, outcome],
			}),
		)

	const assertEscrowAccounting = async (escalationGameAddress: Address, expectedTotalEscrowedAttoRep: bigint) => {
		assert.strictEqual(await getTotalEscrowedRep(client, escalationGameAddress), expectedTotalEscrowedAttoRep, 'total escrowed REP should match scenario accounting')
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
		assert.strictEqual(await readCarryTotal(client, escalationGameAddress, QuestionOutcome.Yes), activeCarryTotal, 'active local Yes commitments should match carry total')

		for (const vault of vaults) {
			const expectedVaultTotal = escrowedDeposits.filter(deposit => deposit.vault === vault).reduce((total, deposit) => total + deposit.amountAttoRep, 0n)
			assert.strictEqual(await getEscrowedRepByVault(client, escalationGameAddress, vault), expectedVaultTotal, 'vault escrow should match active local deposits')
		}

		const [carryPage] = await readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Yes, 0n, BigInt(activeCarryDeposits.length + 1))
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
						abi: statoblast_EscalationGame_EscalationGame.abi,
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
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
	})

	return {
		get mockWindow() {
			return mockWindow
		},
		get client() {
			return client
		},
		reportBond,
		nonDecisionThresholdAttoRep,
		recursiveResolutionTargetCost,
		deployEscalationGameTestSecurityPool,
		deployEscalationGameWithProofPool,
		deployEscalationGameForkerHarness,
		deployProofTestSecurityPool,
		deploySecurityPoolAncestorNode,
		deployIncompatibleProofVerifier,
		deployFalseReturningToken,
		startEscalation,
		startEscalationFromFork,
		resumeEscalationFromFork,
		fundEscalationGame,
		advanceForkContinuationPastStart,
		depositOnOutcomeViaProofTestSecurityPool,
		traceCarryLeafPage,
		traceProofConsumedCarriedDepositIndexes,
		traceForkedEscrowByVaultAndOutcome,
		assertEscrowAccounting,
		assertLocalYesAccountingModel,
		recordForkedEscrowForOutcomeViaTestSecurityPool,
		applyTruthAuctionHaircutViaTestSecurityPool,
		withdrawDepositViaProofTestSecurityPool,
		withdrawDepositViaProofTestSecurityPoolWithGas,
		claimDepositForWinningViaTestSecurityPool,
		readCarryLeafHash,
		createCarryProof,
		computeLocalParentDepositIndex,
		depositOnOutcomeViaTestSecurityPool,
		claimWinningDepositAndReadClaimLog,
		...carryHelpers,
	}
}
