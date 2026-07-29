import { describe, test } from 'bun:test'
import { usePeripheralsVaultAccountingFixture } from './peripherals/fixture'
import { createCompleteSet, getCompleteSetCollateralAmount, getSecurityVault, getTotalRepBalance, poolOwnershipToRep } from '../testSupport/simulator/utils/contracts/securityPool'

const PRICE_PRECISION = 10n ** 18n
const BPS_DENOMINATOR = 10_000n

describe('Audit PoC: security multiplier withdrawal bypass', () => {
	const fixture = usePeripheralsVaultAccountingFixture()
	const { assert, depositToEscalationGame, manipulatePriceOracleAndPerformOperation, manipulatePriceOracle, OperationType, QuestionOutcome, repDeposit, reportedRepEthPrice, statoblastSecurityMultiplierBps } = fixture

	test('a multiplier-safe vault cannot withdraw below multiplier-adjusted coverage', async () => {
		const { client, mockWindow, securityPoolAddresses } = fixture
		const securityPool = securityPoolAddresses.securityPool
		const coordinator = securityPoolAddresses.priceOracleManagerAndOperatorQueuer

		const allowance = (repDeposit * PRICE_PRECISION * BPS_DENOMINATOR) / (statoblastSecurityMultiplierBps * reportedRepEthPrice)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.SetSecurityBondsAllowance, client.account.address, allowance, reportedRepEthPrice)
		await createCompleteSet(client, securityPool, 1n * 10n ** 18n)

		const getVaultRep = async (vault: typeof client.account.address) => {
			const state = await getSecurityVault(client, securityPool, vault)
			return await poolOwnershipToRep(client, securityPool, state.repDepositShare)
		}

		const targetRepBefore = await getVaultRep(client.account.address)
		assert.strictEqual(targetRepBefore * PRICE_PRECISION * BPS_DENOMINATOR, allowance * statoblastSecurityMultiplierBps * reportedRepEthPrice, 'target should begin exactly at the multiplier-adjusted non-liquidatable boundary')

		const faceValueRep = (allowance * reportedRepEthPrice) / PRICE_PRECISION
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.WithdrawRep, client.account.address, targetRepBefore - faceValueRep, reportedRepEthPrice)

		const targetAfterWithdrawal = await getSecurityVault(client, securityPool, client.account.address)
		const targetRepAfterWithdrawal = await getVaultRep(client.account.address)
		assert.strictEqual(targetRepAfterWithdrawal, targetRepBefore, 'unsafe withdrawal should leave vault REP unchanged')
		assert.strictEqual(targetAfterWithdrawal.securityBondAllowance, allowance, 'unsafe withdrawal should leave allowance unchanged')
		assert.ok((await getCompleteSetCollateralAmount(client, securityPool)) > 0n, 'open-interest collateral should remain live while the security buffer is withdrawn')
		const poolRepAfterWithdrawal = await getTotalRepBalance(client, securityPool)
		assert.strictEqual(poolRepAfterWithdrawal, targetRepBefore, 'unsafe withdrawal should leave aggregate REP unchanged')
		assert.ok(poolRepAfterWithdrawal * PRICE_PRECISION * BPS_DENOMINATOR >= targetAfterWithdrawal.securityBondAllowance * statoblastSecurityMultiplierBps * reportedRepEthPrice, 'vault and pool should retain multiplier-adjusted backing')
	})

	test('withdrawal succeeds at the exact multiplier-adjusted boundary and rejects the next REP', async () => {
		const { client, mockWindow, securityPoolAddresses } = fixture
		const securityPool = securityPoolAddresses.securityPool
		const coordinator = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
		const allowance = (repDeposit * PRICE_PRECISION * BPS_DENOMINATOR) / (2n * statoblastSecurityMultiplierBps * reportedRepEthPrice)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.SetSecurityBondsAllowance, client.account.address, allowance, reportedRepEthPrice)

		const requiredRep = (allowance * statoblastSecurityMultiplierBps * reportedRepEthPrice) / (PRICE_PRECISION * BPS_DENOMINATOR)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.WithdrawRep, client.account.address, repDeposit - requiredRep, reportedRepEthPrice)
		const boundaryVault = await getSecurityVault(client, securityPool, client.account.address)
		assert.strictEqual(await poolOwnershipToRep(client, securityPool, boundaryVault.repDepositShare), requiredRep, 'withdrawal should reach the exact multiplier-adjusted boundary')

		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.WithdrawRep, client.account.address, 1n * 10n ** 18n, reportedRepEthPrice)
		const afterRejectedWithdrawal = await getSecurityVault(client, securityPool, client.account.address)
		assert.strictEqual(await poolOwnershipToRep(client, securityPool, afterRejectedWithdrawal.repDepositShare), requiredRep, 'withdrawal beyond the exact boundary should be consumed without changing vault backing')
	})

	test('a vault cannot move multiplier-required REP into an escalation game', async () => {
		const { client, mockWindow, questionData, securityPoolAddresses } = fixture
		const securityPool = securityPoolAddresses.securityPool
		const coordinator = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
		const allowance = (repDeposit * PRICE_PRECISION * BPS_DENOMINATOR) / (statoblastSecurityMultiplierBps * reportedRepEthPrice)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, coordinator, OperationType.SetSecurityBondsAllowance, client.account.address, allowance, reportedRepEthPrice)
		await mockWindow.setTime(questionData.endTime + 1n)
		await manipulatePriceOracle(client, mockWindow, coordinator, reportedRepEthPrice)

		await assert.rejects(depositToEscalationGame(client, securityPool, QuestionOutcome.Yes, repDeposit / 2n), /Vault bond/)
		const target = await getSecurityVault(client, securityPool, client.account.address)
		assert.strictEqual(await poolOwnershipToRep(client, securityPool, target.repDepositShare), repDeposit, 'rejected escalation deposit should preserve multiplier backing')
	})
})
