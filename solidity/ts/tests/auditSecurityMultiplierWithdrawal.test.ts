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

		const coverageCommitmentAttoEth = (repDeposit * PRICE_PRECISION * BPS_DENOMINATOR) / (statoblastSecurityMultiplierBps * reportedRepEthPrice)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.SetCoverageCommitment, client.account.address, coverageCommitmentAttoEth, reportedRepEthPrice)
		await createCompleteSet(client, securityPool, 1n * 10n ** 18n)

		const getVaultRep = async (vault: typeof client.account.address) => {
			const state = await getSecurityVault(client, securityPool, vault)
			return await backingUnitsToAttoRep(client, securityPool, state.repBackingUnits)
		}

		const targetRepBefore = await getVaultRep(client.account.address)
		assert.strictEqual(targetRepBefore * PRICE_PRECISION * BPS_DENOMINATOR, coverageCommitmentAttoEth * statoblastSecurityMultiplierBps * reportedRepEthPrice, 'target should begin exactly at the multiplier-adjusted non-liquidatable boundary')

		const faceValueRep = (coverageCommitmentAttoEth * reportedRepEthPrice) / PRICE_PRECISION
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.WithdrawRep, client.account.address, targetRepBefore - faceValueRep, reportedRepEthPrice)

		const targetAfterWithdrawal = await getSecurityVault(client, securityPool, client.account.address)
		const targetRepAfterWithdrawal = await getVaultRep(client.account.address)
		assert.strictEqual(targetRepAfterWithdrawal, targetRepBefore, 'unsafe withdrawal should leave vault REP unchanged')
		assert.strictEqual(targetAfterWithdrawal.coverageCommitmentAttoEth, coverageCommitmentAttoEth, 'coverage commitment')
		assert.ok((await getSettlementCollateralAttoEth(client, securityPool)) > 0n, 'open-interest collateral should remain live while the security buffer is withdrawn')
		const poolRepAfterWithdrawal = await getTotalPoolHeldAttoRep(client, securityPool)
		assert.strictEqual(poolRepAfterWithdrawal, targetRepBefore, 'unsafe withdrawal should leave aggregate REP unchanged')
		assert.ok(poolRepAfterWithdrawal * PRICE_PRECISION * BPS_DENOMINATOR >= targetAfterWithdrawal.coverageCommitmentAttoEth * statoblastSecurityMultiplierBps * reportedRepEthPrice, 'vault and pool should retain multiplier-adjusted backing')
	})

	test('withdrawal succeeds at the exact multiplier-adjusted boundary and rejects the next REP', async () => {
		const { client, mockWindow, securityPoolAddresses } = fixture
		const securityPool = securityPoolAddresses.securityPool
		const coordinator = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
		const coverageCommitmentAttoEth = (repDeposit * PRICE_PRECISION * BPS_DENOMINATOR) / (2n * statoblastSecurityMultiplierBps * reportedRepEthPrice)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.SetCoverageCommitment, client.account.address, coverageCommitmentAttoEth, reportedRepEthPrice)

		const requiredAttoRep = (coverageCommitmentAttoEth * statoblastSecurityMultiplierBps * reportedRepEthPrice) / (PRICE_PRECISION * BPS_DENOMINATOR)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.WithdrawRep, client.account.address, repDeposit - requiredAttoRep, reportedRepEthPrice)
		const boundaryVault = await getSecurityVault(client, securityPool, client.account.address)
		assert.strictEqual(await backingUnitsToAttoRep(client, securityPool, boundaryVault.repBackingUnits), requiredAttoRep, 'withdrawal should reach the exact multiplier-adjusted boundary')

		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.WithdrawRep, client.account.address, 1n * 10n ** 18n, reportedRepEthPrice)
		const afterRejectedWithdrawal = await getSecurityVault(client, securityPool, client.account.address)
		assert.strictEqual(await backingUnitsToAttoRep(client, securityPool, afterRejectedWithdrawal.repBackingUnits), requiredAttoRep, 'withdrawal beyond the exact boundary should be consumed without changing vault backing')
	})

	test('a vault cannot move multiplier-required REP into an escalation game', async () => {
		const { client, mockWindow, questionData, securityPoolAddresses } = fixture
		const securityPool = securityPoolAddresses.securityPool
		const coordinator = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
		const coverageCommitmentAttoEth = (repDeposit * PRICE_PRECISION * BPS_DENOMINATOR) / (statoblastSecurityMultiplierBps * reportedRepEthPrice)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.SetCoverageCommitment, client.account.address, coverageCommitmentAttoEth, reportedRepEthPrice)
		await mockWindow.setTime(questionData.endTime + 1n)
		await manipulatePriceOracle(client, mockWindow, coordinator, reportedRepEthPrice)

		await assert.rejects(depositToEscalationGame(client, securityPool, QuestionOutcome.Yes, repDeposit / 2n), /Vault backing insufficient/)
		const target = await getSecurityVault(client, securityPool, client.account.address)
		assert.strictEqual(await backingUnitsToAttoRep(client, securityPool, target.repBackingUnits), repDeposit, 'rejected escalation deposit should preserve multiplier backing')
	})
})
