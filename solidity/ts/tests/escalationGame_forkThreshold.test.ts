import { test, beforeEach, describe, setDefaultTimeout } from 'bun:test'
import { encodeAbiParameters, keccak256, type Address } from 'viem'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/shared/protocolConfig'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient, writeContractAndWait } from '../testsuite/simulator/utils/viem'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { QuestionOutcome } from '../testsuite/simulator/types/types'
import assert from '../testsuite/simulator/utils/assert'
import { ensureInfraDeployed } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { ensureZoltarDeployed } from '../testsuite/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from '../testsuite/simulator/utils/contracts/zoltarQuestionData'
import { deployOriginSecurityPool, getSecurityPoolAddresses } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { approveAndDepositRep } from '../testsuite/simulator/utils/contracts/peripheralsTestUtils'
import { depositToEscalationGame, getSecurityVault, poolOwnershipToRep } from '../testsuite/simulator/utils/contracts/securityPool'
import { getNonDecisionThreshold } from '../testsuite/simulator/utils/contracts/escalationGame'
import { getRepTokenAddress, getTotalTheoreticalSupply, getZoltarAddress } from '../testsuite/simulator/utils/contracts/zoltar'
import { addressString } from '../testsuite/simulator/utils/bigint'
import { peripherals_SecurityPool_SecurityPool } from '../types/contractArtifact'
import { getERC20Balance } from '../testsuite/simulator/utils/utilities'
import { GENESIS_REPUTATION_TOKEN } from '../testsuite/simulator/utils/constants'

const DAY = 86400n
const ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT = 2n

setDefaultTimeout(TEST_TIMEOUT_MS)

const getUserRepClaim = async (client: WriteClient, securityPoolAddress: Address) => {
	const vault = await getSecurityVault(client, securityPoolAddress, client.account.address)
	return await poolOwnershipToRep(client, securityPoolAddress, vault.repDepositShare)
}

describe('Escalation Game Fork Threshold Test', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const genesisUniverse = 0n
	const securityMultiplier = 2n
	const currentTimestamp = BigInt(Math.floor(Date.now() / 1000))
	const questionEndDate = currentTimestamp + 365n * DAY
	let securityPoolAddresses: {
		securityPool: Address
		escalationGame: Address
	}
	let questionId: bigint

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

		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier)
		await approveAndDepositRep(client, 1000n * 10n ** 18n, questionId)

		securityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, securityMultiplier)
	})

	test('withdrawal amount scaled by actual fork threshold after decrease', async () => {
		const depositAmount = 1n * 10n ** 18n // 1 ether

		// Advance time past the question's end date to allow escalation game deposit
		await mockWindow.setTime(questionEndDate + 1n)

		// Deploy escalation game and deposit on Yes
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, depositAmount)
		const escalationGameAddress = securityPoolAddresses.escalationGame

		// Get escalation threshold (fixed)
		const escalationThreshold = await getNonDecisionThreshold(client, escalationGameAddress)

		// Get current total supply of REP
		const repToken = getRepTokenAddress(genesisUniverse)
		const initialTotalSupply = await getTotalTheoreticalSupply(client, repToken)

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
					abi: peripherals_SecurityPool_SecurityPool.abi,
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

	test('deploys the escalation game with the tracked Zoltar fork threshold instead of the token supply', async () => {
		const depositAmount = 1n * 10n ** 18n
		const repToken = getRepTokenAddress(genesisUniverse)
		const initialTotalSupply = await getTotalTheoreticalSupply(client, repToken)
		const overriddenTotalSupply = initialTotalSupply / 10n
		const expectedThreshold = overriddenTotalSupply / DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor / 2n
		const universeSupplySlot = keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [genesisUniverse, ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT]))

		await mockWindow.addStateOverrides({
			[getZoltarAddress()]: {
				stateDiff: {
					[universeSupplySlot]: overriddenTotalSupply,
				},
			},
		})

		await mockWindow.setTime(questionEndDate + 1n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, depositAmount)

		assert.strictEqual(
			await client.readContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: securityPoolAddresses.securityPool,
				functionName: 'initialEscalationGameDeposit',
				args: [],
			}),
			DEFAULT_PROTOCOL_CONFIG.initialEscalationGameDeposit,
			'initial escalation deposit should match deployment config',
		)
		assert.strictEqual(await getNonDecisionThreshold(client, securityPoolAddresses.escalationGame), expectedThreshold, 'escalation threshold should follow Zoltar tracked supply')
	})
})
