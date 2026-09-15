import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { manipulatePriceOracle, setVaultCapacityFixture } from '../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { getSecurityPoolsEscalationGame, redeemRepFromVault, withdrawFromEscalationGame, depositToEscalationGame } from '../testSupport/simulator/utils/contracts/securityPool'
import { getQuestionOutcome } from '../testSupport/simulator/utils/contracts/securityPoolForker'
import assert from '../testSupport/simulator/utils/assert'
import { describe, test } from 'bun:test'
import { encodeAbiParameters, keccak256 } from '@zoltar/core-shared/evm/ethereum'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/core-shared/deployment/protocolConfig'
import { useStatoblastVaultAccountingFixture } from './statoblast/fixture'
import { createCompleteSet, getSettlementCollateralAttoEth, redeemShares } from '../testSupport/simulator/utils/contracts/securityPool'
import { statoblast_EscalationGame_EscalationGame } from '../types/contractArtifact'

const ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT = 2n
const ESCALATION_TIME_LENGTH = 4_233_600n

describe('Audit PoC: escalation logarithm precision liveness', () => {
	const fixture = useStatoblastVaultAccountingFixture()

	const { reportBond, reportedRepEthPrice } = fixture

	test('a funded game with a power-of-two threshold ratio resolves and releases its assets', async () => {
		const { client, genesisUniverse, mockWindow, questionData, securityPoolAddresses } = fixture
		const capacityOwnershipAttoRep = 25n * 10n ** 18n
		await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, capacityOwnershipAttoRep, reportedRepEthPrice)
		await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)
		assert.ok((await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)) > 0n, 'PoC pool must hold redeemable ETH collateral')

		const nonDecisionThresholdAttoRep = reportBond * 2n
		const trackedSupply = 2n * nonDecisionThresholdAttoRep * DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
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
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond + 2n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond + 1n)

		const escalationGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		const activationTime = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'activationTime',
		})
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)

		assert.strictEqual(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'getQuestionResolution',
			}),
			BigInt(QuestionOutcome.Yes),
			'the balance comparison itself should have a strict winner',
		)
		const escalationEndDate = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'getEscalationGameEndDate',
		})
		assert.ok(escalationEndDate < activationTime + ESCALATION_TIME_LENGTH, 'strict winner should end the game before the maximum escalation duration')
		assert.strictEqual(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.Yes, 'pool should expose the strict winner after the computed deadline')
		await assert.rejects(depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond), /Invalid deposit preview/)
		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, [0n])
		await redeemShares(client, securityPoolAddresses.securityPool)
		await redeemRepFromVault(client, securityPoolAddresses.securityPool, client.account.address)
	})
})
