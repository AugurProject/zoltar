import { setUnderwritingLimit } from '../testSupport/simulator/utils/contracts/securityPool'
import { formatStorageSlot, getAddressMappingStorageSlot } from '../testSupport/storage'
import { manipulatePriceOracle } from '../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { participateAuction } from '../testSupport/simulator/utils/contracts/statoblast'
import { finalizeTruthAuction, migrateVault, startTruthAuction } from '../testSupport/simulator/utils/contracts/securityPoolForker'
import { createWriteClient } from '../testSupport/simulator/utils/clients'
import { createCompleteSet, depositToEscalationGame, getSystemState } from '../testSupport/simulator/utils/contracts/securityPool'
import { SystemState } from '../testSupport/simulator/types/statoblastTypes'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { DAY, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { strictEqualTypeSafe } from '../testSupport/simulator/utils/testUtils'
import assert from '../testSupport/simulator/utils/assert'
import { describe, test } from 'bun:test'
import { getSettlementCollateralAttoEth, getTotalPoolHeldAttoRep, getTotalRepBackingUnits } from '../testSupport/simulator/utils/contracts/securityPool'
import { getSecurityPoolForkerForkData } from '../testSupport/simulator/utils/contracts/securityPoolForker'
import { getMaxRepBeingSoldAttoRep, getEthRaiseCapAttoEth } from '../testSupport/simulator/utils/contracts/auction'
import { useStatoblastForkMigrationFixture } from './statoblast/fixture'

describe('Audit regression: post-escrow complete-set mint fork loss', () => {
	const fixture = useStatoblastForkMigrationFixture()

	const { PRICE_PRECISION, repDeposit, triggerExternalForkForSecurityPool, getYesChildPool } = fixture

	test('cannot mint collateral after all pool-held REP was escrowed', async () => {
		const { client, mockWindow, questionData, securityPoolAddresses } = fixture
		const victim = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const victimDepositAttoEth = 1n * 10n ** 18n

		await mockWindow.setTime(questionData.endTime + 1n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, 10n * PRICE_PRECISION)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, repDeposit)

		strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool), 0n, 'the attacker should escrow every attoREP held by the pool')
		await assert.rejects(createCompleteSet(victim, securityPoolAddresses.securityPool, victimDepositAttoEth))
		strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 0n, 'rejected unbacked minting must not add settlement collateral')
	})

	test('full-limit escrow checks cannot be bypassed by bad debt, and zero-pool-REP repair remains funded', async () => {
		const { client, mockWindow, questionData, securityPoolAddresses } = fixture
		const settlementCollateralAttoEth = 1n * 10n ** 18n
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)
		await setUnderwritingLimit(client, securityPoolAddresses.securityPool, settlementCollateralAttoEth)
		await mockWindow.setTime(questionData.endTime + 1n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, 10n * PRICE_PRECISION)
		await createCompleteSet(client, securityPoolAddresses.securityPool, settlementCollateralAttoEth)

		// Reconstruct the full-bad-debt accounting boundary so this regression isolates
		// fork finalization from the independent liquidation setup.
		await mockWindow.addStateOverrides({
			[securityPoolAddresses.securityPool]: {
				stateDiff: {
					[formatStorageSlot(21n)]: settlementCollateralAttoEth,
					[formatStorageSlot(getAddressMappingStorageSlot(client.account.address, 22n))]: settlementCollateralAttoEth,
				},
			},
		})
		await assert.rejects(depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, repDeposit), /Vault backing insufficient/)
		// Explicitly reconstruct an orphaned commitment to retain the independent
		// zero-pool-REP repair regression; ordinary escrow cannot reach this state.
		await mockWindow.addStateOverrides({ [securityPoolAddresses.securityPool]: { stateDiff: { [formatStorageSlot(getAddressMappingStorageSlot(client.account.address, 16n) + 1n)]: 0n, [formatStorageSlot(1n)]: 0n, [formatStorageSlot(12n)]: 0n } } })
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, repDeposit)
		await mockWindow.addStateOverrides({ [securityPoolAddresses.securityPool]: { stateDiff: { [formatStorageSlot(1n)]: settlementCollateralAttoEth } } })
		strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool), 0n, 'the synthetic orphaned position retains collateral repair coverage without pool-held REP')

		await triggerExternalForkForSecurityPool(undefined, 'zero-pool-rep collateral repair source')
		const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(parentForkData.auctionableAttoRepAtFork, 0n, 'the fork should snapshot no pool-held REP')
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const { yesSecurityPool } = getYesChildPool()
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'missing collateral must start repair even when the pool-held REP denominator is zero')
		const repairCollateralAttoEth = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
		assert.ok(repairCollateralAttoEth > 0n, 'the repair auction should raise the missing parent collateral from escrowed REP')

		const auctionCapAttoRep = await getMaxRepBeingSoldAttoRep(client, yesSecurityPool.truthAuction)
		assert.ok(auctionCapAttoRep > 0n, 'escrowed REP should fund the repair auction')
		const auctionWinner = createWriteClient(mockWindow, TEST_ADDRESSES[2])
		await participateAuction(auctionWinner, yesSecurityPool.truthAuction, auctionCapAttoRep, repairCollateralAttoEth * 2n)
		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'escrow-only repair should finalize the child pool')
		const repairedCollateralAttoEth = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
		assert.ok(repairedCollateralAttoEth <= settlementCollateralAttoEth, 'repair must not exceed the parent collateral snapshot')
		assert.ok(repairedCollateralAttoEth >= (settlementCollateralAttoEth * 999n) / 1000n, 'the funded repair should install substantially all missing collateral despite auction tick rounding')
		assert.ok((await getTotalPoolHeldAttoRep(client, yesSecurityPool.securityPool)) > 0n, 'repair should leave pool-held REP backing')
		assert.ok((await getTotalRepBackingUnits(client, yesSecurityPool.securityPool)) > 0n, 'repair should install a coherent backing-unit denominator')
	})
})
