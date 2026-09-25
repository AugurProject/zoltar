import { describe, test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { createWriteClient } from '../testSupport/simulator/utils/clients'
import { approveToken } from '../testSupport/simulator/utils/utilities'
import { manipulatePriceOracle } from '../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { createCompleteSet, depositRepToVault, depositToEscalationGame, getSecurityVault, getSettlementCollateralAttoEth, getTotalPoolHeldAttoRep, getTotalCapacityOwnershipAttoRep, backingUnitsToAttoRep } from '../testSupport/simulator/utils/contracts/securityPool'
import { useStatoblastVaultAccountingFixture } from './statoblast/fixture'

const ATTO = 10n ** 18n

describe('Audit regression: post-escrow mint liquidation', () => {
	const fixture = useStatoblastVaultAccountingFixture()

	test('new complete sets cannot turn an escrowed vault into a liquidation target at a constant price', async () => {
		const { client, mockWindow, questionData, securityPoolAddresses, transferRepToAddress, reportedRepEthPrice } = fixture
		const pool = securityPoolAddresses.securityPool
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const victim = client.account.address
		const attackerDeposit = 30_000n * ATTO
		const victimEscrow = 6_000n * ATTO
		const attackMint = 1_000n * ATTO

		await transferRepToAddress(client, attacker.account.address, attackerDeposit)
		await approveToken(attacker, addressString(GENESIS_REPUTATION_TOKEN), pool)
		await depositRepToVault(attacker, pool, attackerDeposit, 60_000n)
		assert.strictEqual(await getTotalCapacityOwnershipAttoRep(client, pool), 20_000n * ATTO)

		await mockWindow.setTime(questionData.endTime + 1n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, reportedRepEthPrice)
		await depositToEscalationGame(client, pool, QuestionOutcome.Yes, victimEscrow)

		const victimVault = await getSecurityVault(client, pool, victim)
		const attackerVault = await getSecurityVault(client, pool, attacker.account.address)
		assert.strictEqual(victimVault.capacityOwnershipAttoRep, 10_000n * ATTO, 'escrow retains victim capacity ownership')
		assert.strictEqual(attackerVault.capacityOwnershipAttoRep, 10_000n * ATTO, 'attacker has half the capacity')
		assert.strictEqual(await backingUnitsToAttoRep(client, pool, victimVault.repBackingUnits), 4_000n * ATTO, 'victim has only 4,000 pool-held REP')
		assert.strictEqual(await getTotalPoolHeldAttoRep(client, pool), 34_000n * ATTO, 'the pool has ample aggregate REP')
		const victimRequiredPoolHeldRep = ((((attackMint / 2n) * reportedRepEthPrice) / ATTO) * 15n) / 10n
		assert.strictEqual(victimRequiredPoolHeldRep, 7_500n * ATTO)
		assert.ok(4_000n * ATTO < victimRequiredPoolHeldRep, 'victim cannot meet the migration-safety requirement after minting')

		await assert.rejects(createCompleteSet(attacker, pool, attackMint), /Escalation mint closed/)
		assert.strictEqual(await getSettlementCollateralAttoEth(client, pool), 0n, 'rejected mint leaves no obligations')
		assert.strictEqual(await getTotalCapacityOwnershipAttoRep(client, pool), 20_000n * ATTO, 'rejected mint does not change vault capacity')
	})
})
