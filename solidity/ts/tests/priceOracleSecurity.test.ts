import { test, beforeEach, describe } from 'bun:test'
import assert from 'node:assert'
import { getMockedEthSimulateWindowEthereum, AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum.js'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem.js'
import { TEST_ADDRESSES, DAY } from '../testsuite/simulator/utils/constants.js'
import { addressString, dateToBigintSeconds } from '../testsuite/simulator/utils/bigint.js'
import { setupTestAccounts, getETHBalance } from '../testsuite/simulator/utils/utilities.js'
import { approveAndDepositRep } from '../testsuite/simulator/utils/contracts/peripheralsTestUtils.js'
import { deployOriginSecurityPool, ensureInfraDeployed, getSecurityPoolAddresses, getMarketId } from '../testsuite/simulator/utils/contracts/deployPeripherals.js'
import { ensureZoltarDeployed } from '../testsuite/simulator/utils/contracts/zoltar.js'
import { OperationType, getRequestPriceEthCost } from '../testsuite/simulator/utils/contracts/peripherals.js'
import { peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer } from '../types/contractArtifact'

describe('Price Oracle Refund Security Tests', () => {
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const repDeposit = 1000n * 10n ** 18n
	const currentTimestamp = dateToBigintSeconds(new Date())
	const marketEndDate = currentTimestamp + 365n * DAY
	let priceOracle: `0x${string}`
	const genesisUniverse = 0n
	const securityMultiplier = 2n
	const startingRepEthPrice = 10n
	const MAX_RETENTION_RATE = 999_999_996_848_000_000n
	const EXTRA_INFO = 'test market!'
	const marketId = getMarketId(genesisUniverse, securityMultiplier, EXTRA_INFO, marketEndDate)

	beforeEach(async () => {
		mockWindow = await getMockedEthSimulateWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		await deployOriginSecurityPool(client, genesisUniverse, EXTRA_INFO, marketEndDate, securityMultiplier, MAX_RETENTION_RATE, startingRepEthPrice)
		await approveAndDepositRep(client, repDeposit, marketId)
		const addresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, marketId, securityMultiplier)
		priceOracle = addresses.priceOracleManagerAndOperatorQueuer
	})

	test('requestPrice should refund excess Ether when overpaid', async () => {
		// Test that overpayment is refunded, not kept by contract
		const initialBalance = await getETHBalance(client, client.account.address)
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const overpayment = ethCost * 2n

		// Call requestPrice with overpayment
		await client.writeContract({
			abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
			address: priceOracle,
			functionName: 'requestPrice',
			value: overpayment,
		})

		const finalBalance = await getETHBalance(client, client.account.address)

		// With bug: finalBalance = initialBalance - overpayment (excess not refunded)
		// With fix: finalBalance = initialBalance - ethCost (excess refunded)
		const expectedNetCost = ethCost
		assert.strictEqual(initialBalance - finalBalance, expectedNetCost, `Caller should net pay only ethCost (${ethCost}), but paid ${initialBalance - finalBalance}`)
	})

	test('requestPriceIfNeededAndQueueOperation should not drain preexisting contract balance', async () => {
		// This test verifies that pre-existing ETH in the contract is not refunded to the caller
		// (drain vulnerability). It works even when price is invalid (so requestPrice is called internally).

		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const preBalance = ethCost * 3n // some arbitrary pre-existing balance

		// Use Anvil admin method to directly set the contract's ETH balance
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await (mockWindow as any).request({
			method: 'anvil_setBalance',
			params: [priceOracle, `0x${preBalance.toString(16)}`],
		})

		// Verify initial contract balance
		const balanceBefore = await getETHBalance(client, priceOracle)
		assert.strictEqual(balanceBefore, preBalance, 'Pre-set balance should be set correctly')

		// Call requestPriceIfNeededAndQueueOperation with overpayment
		const caller = client.account.address
		const sendValue = ethCost * 2n
		await client.writeContract({
			abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
			address: priceOracle,
			functionName: 'requestPriceIfNeededAndQueueOperation',
			args: [OperationType.WithdrawRep, caller, 100n],
			value: sendValue,
		})

		// After the call, the pre-existing balance should remain intact.
		// The contract should have retained ethCost (to pay OpenOracle) and refunded the excess (sendValue - ethCost).
		// Final balance = preBalance (unchanged)
		const balanceAfter = await getETHBalance(client, priceOracle)
		assert.strictEqual(balanceAfter, preBalance, `Contract should retain preexisting balance (${preBalance}) after requestPriceIfNeededAndQueueOperation, but it was drained to ${balanceAfter}`)
	})
})
