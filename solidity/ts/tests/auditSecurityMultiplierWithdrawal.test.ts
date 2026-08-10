import { describe, test } from 'bun:test'
import { usePeripheralsVaultAccountingFixture } from './peripherals/fixture'
import { createCompleteSet, getSettlementCollateralAttoEth, getSecurityVault, getTotalPoolHeldAttoRep, backingUnitsToAttoRep } from '../testSupport/simulator/utils/contracts/securityPool'

const PRICE_PRECISION = 10n ** 18n
const BPS_DENOMINATOR = 10_000n

describe('Audit PoC: security multiplier withdrawal bypass', () => {
	const fixture = usePeripheralsVaultAccountingFixture()
	const { assert, depositToEscalationGame, manipulatePriceOracleAndPerformOperation, manipulatePriceOracle, OperationType, QuestionOutcome, repDeposit, reportedRepEthPrice, statoblastSecurityMultiplierBps } = fixture

	test('a multiplier-safe vault cannot withdraw below multiplier-adjusted coverage', async () => {
		const { client, mockWindow, securityPoolAddresses } = fixture
		const securityPool = securityPoolAddresses.securityPool
		const coordinator = securityPoolAddresses.priceOracleManagerAndOperatorQueuer

		const capacityOwnershipAttoRep = (repDeposit * PRICE_PRECISION * BPS_DENOMINATOR) / (statoblastSecurityMultiplierBps * reportedRepEthPrice)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.PriceRefresh, client.account.address, capacityOwnershipAttoRep, reportedRepEthPrice)
		await createCompleteSet(client, securityPool, 1n * 10n ** 18n)

		const getVaultRep = async (vault: typeof client.account.address) => {
			const state = await getSecurityVault(client, securityPool, vault)
			return await backingUnitsToAttoRep(client, securityPool, state.repBackingUnits)
		}

		const targetRepBefore = await getVaultRep(client.account.address)
		assert.strictEqual(targetRepBefore * PRICE_PRECISION * BPS_DENOMINATOR, capacityOwnershipAttoRep * statoblastSecurityMultiplierBps * reportedRepEthPrice, 'target should begin exactly at the multiplier-adjusted non-liquidatable boundary')

		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.WithdrawRep, client.account.address, targetRepBefore - 1n, reportedRepEthPrice)

		const targetAfterWithdrawal = await getSecurityVault(client, securityPool, client.account.address)
		const targetRepAfterWithdrawal = await getVaultRep(client.account.address)
		assert.strictEqual(targetRepAfterWithdrawal, targetRepBefore, 'unsafe withdrawal should leave vault REP unchanged')
		assert.strictEqual(targetAfterWithdrawal.capacityOwnershipAttoRep, capacityOwnershipAttoRep, 'capacity ownership')
		assert.ok((await getSettlementCollateralAttoEth(client, securityPool)) > 0n, 'open-interest collateral should remain live while the security buffer is withdrawn')
		const poolRepAfterWithdrawal = await getTotalPoolHeldAttoRep(client, securityPool)
		assert.strictEqual(poolRepAfterWithdrawal, targetRepBefore, 'unsafe withdrawal should leave aggregate REP unchanged')
		assert.ok(poolRepAfterWithdrawal * PRICE_PRECISION * BPS_DENOMINATOR >= targetAfterWithdrawal.capacityOwnershipAttoRep * statoblastSecurityMultiplierBps * reportedRepEthPrice, 'vault and pool should retain multiplier-adjusted backing')
	})

	test('a vault without open interest can exit and relinquish its dynamic capacity ownership', async () => {
		const { client, mockWindow, securityPoolAddresses } = fixture
		const securityPool = securityPoolAddresses.securityPool
		const coordinator = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
		const capacityOwnershipAttoRep = (repDeposit * PRICE_PRECISION * BPS_DENOMINATOR) / (2n * statoblastSecurityMultiplierBps * reportedRepEthPrice)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.PriceRefresh, client.account.address, capacityOwnershipAttoRep, reportedRepEthPrice)

		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.WithdrawRep, client.account.address, repDeposit, reportedRepEthPrice)
		const exitedVault = await getSecurityVault(client, securityPool, client.account.address)
		assert.strictEqual(await backingUnitsToAttoRep(client, securityPool, exitedVault.repBackingUnits), 0n, 'vault should return all REP when it has no open interest')
		assert.strictEqual(exitedVault.capacityOwnershipAttoRep, 0n, 'exiting vault should relinquish all capacity ownership')
	})

	test('a vault cannot move multiplier-required REP into an escalation game', async () => {
		const { client, mockWindow, questionData, securityPoolAddresses } = fixture
		const securityPool = securityPoolAddresses.securityPool
		const coordinator = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
		const capacityOwnershipAttoRep = (repDeposit * PRICE_PRECISION * BPS_DENOMINATOR) / (statoblastSecurityMultiplierBps * reportedRepEthPrice)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.PriceRefresh, client.account.address, capacityOwnershipAttoRep, reportedRepEthPrice)
		await mockWindow.setTime(questionData.endTime + 1n)
		await manipulatePriceOracle(client, mockWindow, coordinator, reportedRepEthPrice)

		await assert.rejects(depositToEscalationGame(client, securityPool, QuestionOutcome.Yes, repDeposit - 1n), /Vault REP below minimum|Vault backing insufficient/)
		const target = await getSecurityVault(client, securityPool, client.account.address)
		assert.strictEqual(await backingUnitsToAttoRep(client, securityPool, target.repBackingUnits), repDeposit, 'rejected escalation deposit should preserve multiplier backing')
	})
})
