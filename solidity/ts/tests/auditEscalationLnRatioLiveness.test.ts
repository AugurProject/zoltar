import { describe, test } from 'bun:test'
import { encodeAbiParameters, keccak256 } from '@zoltar/shared/ethereum'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/shared/protocolConfig'
import { usePeripheralsVaultAccountingFixture } from './peripherals/fixture'
import { createCompleteSet, getCompleteSetCollateralAmount, redeemShares } from '../testSupport/simulator/utils/contracts/securityPool'
import { OperationType } from '../testSupport/simulator/utils/contracts/peripherals'
import { peripherals_EscalationGame_EscalationGame } from '../types/contractArtifact'

const ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT = 2n
const ESCALATION_TIME_LENGTH = 4_233_600n

describe('Audit PoC: escalation logarithm precision liveness', () => {
	const fixture = usePeripheralsVaultAccountingFixture()

	const { assert, getQuestionOutcome, getSecurityPoolsEscalationGame, getZoltarAddress, manipulatePriceOracle, manipulatePriceOracleAndPerformOperation, QuestionOutcome, redeemRep, reportBond, reportedRepEthPrice, withdrawFromEscalationGame } = fixture

	test('a funded game with a power-of-two threshold ratio resolves and releases its assets', async () => {
		const { client, genesisUniverse, mockWindow, questionData, securityPoolAddresses } = fixture
		const securityBondAllowance = 25n * 10n ** 18n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityBondAllowance, reportedRepEthPrice)
		await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)
		assert.ok((await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)) > 0n, 'PoC pool must hold redeemable ETH collateral')

		const nonDecisionThreshold = reportBond * 2n
		const trackedSupply = 2n * nonDecisionThreshold * DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		const universeSupplySlot = keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [genesisUniverse, ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT]))
		await mockWindow.addStateOverrides({
			[getZoltarAddress()]: {
				stateDiff: {
					[universeSupplySlot]: trackedSupply,
				},
			},
		})

		await mockWindow.setTime(questionData.endTime + 1n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, reportedRepEthPrice)
		await fixture.depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond + 2n)
		await fixture.depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond + 1n)

		const escalationGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		const activationTime = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'activationTime',
		})
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)

		assert.strictEqual(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'getQuestionResolution',
			}),
			BigInt(QuestionOutcome.Yes),
			'the balance comparison itself should have a strict winner',
		)
		const escalationEndDate = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'getEscalationGameEndDate',
		})
		assert.ok(escalationEndDate < activationTime + ESCALATION_TIME_LENGTH, 'strict winner should end the game before the maximum escalation duration')
		assert.strictEqual(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.Yes, 'pool should expose the strict winner after the computed deadline')
		await assert.rejects(fixture.depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond), /Question resolved/)
		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, [0n])
		await redeemShares(client, securityPoolAddresses.securityPool)
		await redeemRep(client, securityPoolAddresses.securityPool, client.account.address)
	})
})
