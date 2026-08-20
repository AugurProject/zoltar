import { test, beforeEach, describe, setDefaultTimeout } from 'bun:test'
import { encodeAbiParameters, encodeDeployData, keccak256, type Address, type Hex } from '@zoltar/shared/ethereum'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/shared/protocolConfig'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { approveToken, getERC20Balance, setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import assert from '../testSupport/simulator/utils/assert'
import { applyLibraries, ensureInfraDeployed, getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { ensureZoltarDeployed } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { deployOriginSecurityPool, getSecurityPoolAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveAndDepositRepToVault, manipulatePriceOracle } from '../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { depositToEscalationGame, getSecurityVault, backingUnitsToAttoRep, redeemRepFromVault, withdrawFromEscalationGame } from '../testSupport/simulator/utils/contracts/securityPool'
import { getNonDecisionThresholdAttoRep } from '../testSupport/simulator/utils/contracts/escalationGame'
import { addRepToMigrationBalance, forkUniverse, getRepTokenAddress, getTotalTheoreticalSupplyAttoRep, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { addressString } from '../testSupport/simulator/utils/bigint'
import {
	statoblast_EscalationGame_EscalationGame,
	statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
	statoblast_SecurityPool_SecurityPool,
	test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkBoundarySecurityPool,
	test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkBoundaryZoltar,
	test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkThresholdHarness,
	Zoltar_Zoltar,
} from '../types/contractArtifact'
import { GENESIS_REPUTATION_TOKEN } from '../testSupport/simulator/utils/constants'

const DAY = 86400n
const ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT = 2n

setDefaultTimeout(TEST_TIMEOUT_MS)

const getUserRepClaim = async (client: WriteClient, securityPoolAddress: Address) => {
	const vault = await getSecurityVault(client, securityPoolAddress, client.account.address)
	return await backingUnitsToAttoRep(client, securityPoolAddress, vault.repBackingUnits)
}

describe('Escalation Game Fork Threshold Test', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const genesisUniverse = 0n
	const statoblastSecurityMultiplierBps = 20_000n
	const currentTimestamp = BigInt(Math.floor(Date.now() / 1000))
	const questionEndDate = currentTimestamp + 365n * DAY
	let securityPoolAddresses: {
		securityPool: Address
		escalationGame: Address
		priceOracleManagerAndOperatorQueuer: Address
	}
	let questionId: bigint

	const deployContract = async (deploymentData: Hex): Promise<Address> => {
		const hash = await client.sendTransaction({ data: deploymentData })
		const receipt = await client.waitForTransactionReceipt({ hash })
		const contractAddress = receipt.contractAddress
		if (contractAddress === undefined || contractAddress === null) throw new Error('deployment address missing')
		return contractAddress
	}

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)

		const questionData = {
			title: 'Test',
			description: '',
			startTime: 0n,
			endTime: questionEndDate,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = ['Yes', 'No']
		questionId = getQuestionId(questionData, outcomes)
		await createQuestion(client, questionData, outcomes)

		await deployOriginSecurityPool(client, genesisUniverse, questionId, statoblastSecurityMultiplierBps)
		await approveAndDepositRepToVault(client, 10_000n * 10n ** 18n, questionId)

		securityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, statoblastSecurityMultiplierBps)
	})

	test('withdrawal amount scaled by actual fork threshold after decrease', async () => {
		const depositAmount = 100n * 10n ** 18n

		// Advance time past the question's end date to allow escalation game deposit
		await mockWindow.setTime(questionEndDate + 1n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

		// Deploy escalation game and deposit on Yes
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, depositAmount)
		const escalationGameAddress = securityPoolAddresses.escalationGame

		// Get escalation threshold (fixed)
		const escalationThreshold = await getNonDecisionThresholdAttoRep(client, escalationGameAddress)

		// Get current total supply of REP
		const repToken = getRepTokenAddress(genesisUniverse)
		const initialTotalSupply = await getTotalTheoreticalSupplyAttoRep(client, repToken)

		// Ensure initial fork threshold > escalationThreshold (should be twice)
		const initialForkThreshold = initialTotalSupply / DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		assert.ok(initialForkThreshold > escalationThreshold, 'initial fork threshold must be greater than escalation threshold')

		// Lower the tracked universe theoretical supply to make actual fork threshold less than escalationThreshold
		const newTotalSupply = initialTotalSupply / 10n // reduce to 10% to get significant ratio
		const universeSupplySlot = keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [genesisUniverse, ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT]))
		await mockWindow.addStateOverrides({
			[getZoltarAddress()]: {
				stateDiff: {
					[universeSupplySlot]: newTotalSupply,
				},
			},
		})

		const actualForkThreshold = newTotalSupply / DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		assert.ok(actualForkThreshold < escalationThreshold, 'actual fork threshold should be lower after override')

		// Advance time to allow the escalation game to finish and outcome to be known
		await mockWindow.advanceTime(10n * DAY)

		// Withdraw via SecurityPool's withdrawFromEscalationGame
		const repBefore = await getUserRepClaim(client, securityPoolAddresses.securityPool)
		const walletRepBefore = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: statoblast_SecurityPool_SecurityPool.abi,
					address: securityPoolAddresses.securityPool,
					functionName: 'withdrawFromEscalationGame',
					args: [QuestionOutcome.Yes, [0n]], // deposit index 0
				}),
		)
		const repAfter = await getUserRepClaim(client, securityPoolAddresses.securityPool)
		const walletRepAfter = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		assert.strictEqual(repAfter, repBefore, 'settlement should not re-mint vault claim under escrow custody')
		assert.strictEqual(walletRepAfter - walletRepBefore, depositAmount / 5n, 'winning payout should be scaled by the lowered fork threshold after applying the single-sided winner payout schedule')
	})

	test('reduced-threshold scaling remains active immediately before and exactly at game end, but not one second after', async () => {
		const proofVerifier = await deployContract(
			encodeDeployData({
				abi: statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.abi,
				bytecode: `0x${statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.evm.bytecode.object}`,
			}),
		)
		const actualForkThreshold = 25n * 10n ** 18n
		const nonDecisionThresholdAttoRep = 100n * 10n ** 18n
		const winningDeposit = 40n * 10n ** 18n
		const gameEndDate = 10_000_000n
		const zoltar = await deployContract(
			encodeDeployData({
				abi: test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkBoundaryZoltar.abi,
				bytecode: `0x${test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkBoundaryZoltar.evm.bytecode.object}`,
				args: [actualForkThreshold],
			}),
		)
		const securityPool = await deployContract(
			encodeDeployData({
				abi: test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkBoundarySecurityPool.abi,
				bytecode: `0x${test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkBoundarySecurityPool.evm.bytecode.object}`,
				args: [zoltar],
			}),
		)
		const harness = await deployContract(
			encodeDeployData({
				abi: test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkThresholdHarness.abi,
				bytecode: `0x${test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkThresholdHarness.evm.bytecode.object}`,
				args: [securityPool, proofVerifier],
			}),
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkThresholdHarness.abi,
				address: harness,
				functionName: 'configureBoundary',
				args: [gameEndDate, nonDecisionThresholdAttoRep, winningDeposit],
			}),
		)

		const expectedScaledPayout = (winningDeposit * actualForkThreshold) / nonDecisionThresholdAttoRep
		for (const boundaryCase of [
			{ expectedPayout: expectedScaledPayout, forkTime: gameEndDate - 1n, name: 'one second before' },
			{ expectedPayout: expectedScaledPayout, forkTime: gameEndDate, name: 'exactly at' },
			{ expectedPayout: winningDeposit, forkTime: gameEndDate + 1n, name: 'one second after' },
		]) {
			await writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkBoundaryZoltar.abi,
					address: zoltar,
					functionName: 'setForkTime',
					args: [boundaryCase.forkTime],
				}),
			)
			const [amountToWithdrawAttoRep, burnAmount] = await client.readContract({
				abi: test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkThresholdHarness.abi,
				address: harness,
				functionName: 'computeWinningWithdrawal',
				args: [winningDeposit, winningDeposit],
			})
			assert.strictEqual(amountToWithdrawAttoRep, boundaryCase.expectedPayout, `${boundaryCase.name} game end should preserve the documented fork-threshold payout boundary`)
			assert.strictEqual(burnAmount, 0n, 'the single-sided boundary harness should not create a reward haircut')
		}
	})

	test('late unrelated fork migration cannot reprice a finalized winning deposit or create sweepable residual', async () => {
		const depositAmount = 10_000n * 10n ** 18n
		const firstDeposit = (depositAmount * 3n) / 10n
		const secondDeposit = depositAmount - firstDeposit
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(attacker, depositAmount, questionId)

		await mockWindow.setTime(questionEndDate + 1n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, firstDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, secondDeposit)
		const configuredThreshold = await getNonDecisionThresholdAttoRep(client, securityPoolAddresses.escalationGame)
		await mockWindow.advanceTime(10n * DAY)
		const victimWalletBeforeFirstSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await withdrawFromEscalationGame(attacker, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		const victimWalletAfterFirstSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		assert.strictEqual(victimWalletAfterFirstSettlement - victimWalletBeforeFirstSettlement, firstDeposit, 'a finalized winner settled before the unrelated fork must receive its frozen principal')

		const forkInitiator = createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
		const forkQuestionEnd = (await mockWindow.getTime()) + DAY
		const forkQuestionData = {
			title: 'Late unrelated finalized-game fork',
			description: '',
			startTime: 0n,
			endTime: forkQuestionEnd,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const forkQuestionId = getQuestionId(forkQuestionData, ['Yes', 'No'])
		await createQuestion(forkInitiator, forkQuestionData, ['Yes', 'No'])
		await mockWindow.setTime(forkQuestionEnd + 1n)
		await approveToken(forkInitiator, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(forkInitiator, genesisUniverse, forkQuestionId)

		for (let accountIndex = 1; accountIndex < TEST_ADDRESSES.length; accountIndex++) {
			const migratorAddress = TEST_ADDRESSES[accountIndex]
			if (migratorAddress === undefined) throw new Error(`Missing migration test account ${accountIndex}`)
			const migrator = createWriteClient(mockWindow, migratorAddress, 0)
			const migratorBalance = await getERC20Balance(migrator, addressString(GENESIS_REPUTATION_TOKEN), migrator.account.address)
			if (migratorBalance === 0n) continue
			await approveToken(migrator, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await addRepToMigrationBalance(migrator, genesisUniverse, migratorBalance)
		}

		const reducedForkThreshold = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			address: getZoltarAddress(),
			functionName: 'getForkThresholdAttoRep',
			args: [genesisUniverse],
		})
		assert.ok(reducedForkThreshold < configuredThreshold, 'real post-fork migration should reduce the live threshold below the finalized game threshold')

		const victimWalletBeforeSecondSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await withdrawFromEscalationGame(attacker, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [1n])
		const victimWalletAfterSecondSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		assert.strictEqual(victimWalletAfterSecondSettlement - victimWalletBeforeSecondSettlement, secondDeposit, 'a remaining finalized winner settled after unrelated migration must receive the same frozen principal')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.escalationGame), 0n, 'late migration must not leave confiscated winner principal in the escalation game')
		await assert.rejects(
			client.writeContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: securityPoolAddresses.escalationGame,
				functionName: 'sweepResidualRepToSecurityPool',
				args: [],
			}),
			/No sweepable REP/,
		)

		const attackerWalletBefore = await getERC20Balance(attacker, addressString(GENESIS_REPUTATION_TOKEN), attacker.account.address)
		await redeemRepFromVault(attacker, securityPoolAddresses.securityPool, attacker.account.address)
		const attackerWalletAfter = await getERC20Balance(attacker, addressString(GENESIS_REPUTATION_TOKEN), attacker.account.address)
		assert.strictEqual(attackerWalletAfter - attackerWalletBefore, depositAmount, 'remaining REP backing units must redeem only its original REP, not a winner haircut')
	})

	test('deploys the escalation game with the tracked Zoltar fork threshold instead of the token supply', async () => {
		const depositAmount = 100n * 10n ** 18n
		const repToken = getRepTokenAddress(genesisUniverse)
		const initialTotalSupply = await getTotalTheoreticalSupplyAttoRep(client, repToken)
		const approximateForkThreshold = initialTotalSupply / 10n / DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		const oddForkThreshold = approximateForkThreshold % 2n === 0n ? approximateForkThreshold + 1n : approximateForkThreshold
		const overriddenTotalSupply = oddForkThreshold * DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		const expectedThreshold = (oddForkThreshold + 1n) / 2n
		const universeSupplySlot = keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [genesisUniverse, ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT]))

		await mockWindow.addStateOverrides({
			[getZoltarAddress()]: {
				stateDiff: {
					[universeSupplySlot]: overriddenTotalSupply,
				},
			},
		})

		await mockWindow.setTime(questionEndDate + 1n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, depositAmount)

		assert.strictEqual(
			await client.readContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: securityPoolAddresses.securityPool,
				functionName: 'initialEscalationGameDepositAttoRep',
				args: [],
			}),
			initialTotalSupply / 10_000_000n,
			'initial escalation deposit should apply the theoretical-supply floor',
		)
		assert.strictEqual(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddresses.securityPool, functionName: 'minimumVaultRepDepositAttoRep', args: [] }), initialTotalSupply / 100_000n, 'the default vault REP floor should follow the theoretical supply')
		assert.strictEqual(await getNonDecisionThresholdAttoRep(client, securityPoolAddresses.escalationGame), expectedThreshold, 'escalation threshold should follow Zoltar tracked supply')
	})

	test('rejects an escalation baseline that could exceed the exact supply-based minimum', async () => {
		const infra = getInfraContractAddresses()
		const deploymentData = encodeDeployData({
			abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			bytecode: applyLibraries(statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.evm.bytecode.object),
			args: [
				infra.securityPoolForker,
				infra.zoltarQuestionData,
				infra.escalationGameFactory,
				infra.openOracle,
				infra.zoltar,
				infra.shareTokenFactory,
				infra.uniformPriceDualCapBatchAuctionFactory,
				infra.priceOracleManagerAndOperatorQueuerFactory,
				DEFAULT_PROTOCOL_CONFIG.initialEscalationGameDepositAttoRep + 1n,
				DEFAULT_PROTOCOL_CONFIG.minimumSecurityBondDebtAttoEth,
				DEFAULT_PROTOCOL_CONFIG.minimumVaultRepDepositAttoRep,
			],
		})
		await assert.rejects(client.sendTransaction({ data: deploymentData }), /Initial escalation game deposit must equal 1 REP/)
	})

	test.each([
		{ name: 'even', forkThresholdAttoRep: 100n },
		{ name: 'odd', forkThresholdAttoRep: 101n },
	])('uses ceiling-half non-decision funding boundaries for an $name fork threshold', async ({ forkThresholdAttoRep }) => {
		const overriddenTotalSupply = forkThresholdAttoRep * DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		const universeSupplySlot = keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [genesisUniverse, ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT]))
		await mockWindow.addStateOverrides({
			[getZoltarAddress()]: {
				stateDiff: {
					[universeSupplySlot]: overriddenTotalSupply,
				},
			},
		})

		const nonDecisionThresholdAttoRep = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			address: getZoltarAddress(),
			functionName: 'getNonDecisionThresholdAttoRep',
			args: [genesisUniverse],
		})
		const expectedThreshold = (forkThresholdAttoRep + 1n) / 2n
		const twoOutcomeTotal = 2n * nonDecisionThresholdAttoRep

		assert.strictEqual(nonDecisionThresholdAttoRep, expectedThreshold, 'non-decision should use ceiling division by two')
		assert.ok(twoOutcomeTotal >= forkThresholdAttoRep, 'two threshold outcomes must always fund the fork threshold')
		assert.ok(2n * (nonDecisionThresholdAttoRep - 1n) < forkThresholdAttoRep, 'one attoREP less on both outcomes must remain below fork funding')
		assert.strictEqual(forkThresholdAttoRep - 1n >= twoOutcomeTotal, false, 'F - 1 total REP must never fund two threshold outcomes')
		assert.strictEqual(forkThresholdAttoRep >= twoOutcomeTotal, forkThresholdAttoRep % 2n === 0n, 'exactly F total REP funds two threshold outcomes only when F is even')
		assert.strictEqual(forkThresholdAttoRep + 1n >= twoOutcomeTotal, true, 'F + 1 total REP must fund two threshold outcomes')
	})
})
