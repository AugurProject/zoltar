import { beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import type { Address } from 'viem'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem'
import { strictEqualTypeSafe } from '../testsuite/simulator/utils/testUtils'
import { peripherals_SecurityPoolUtils_SecurityPoolUtils } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

const PRICE_PRECISION = 1n * 10n ** 18n
const MAX_RETENTION_RATE = 999_999_996_848_000_000n
const MIN_RETENTION_RATE = 999_999_977_880_000_000n
const RETENTION_RATE_DIP = 800_000_000_000_000_000n
const RATE_SPAN = MAX_RETENTION_RATE - MIN_RETENTION_RATE

const expectedRetentionRate = (completeSetCollateralAmount: bigint, securityBondAllowance: bigint) => {
	if (securityBondAllowance === 0n) return MAX_RETENTION_RATE
	const utilization = (completeSetCollateralAmount * PRICE_PRECISION) / securityBondAllowance
	if (utilization > RETENTION_RATE_DIP) return MIN_RETENTION_RATE
	const utilizationRatio = (utilization * PRICE_PRECISION) / RETENTION_RATE_DIP
	return MAX_RETENTION_RATE - (RATE_SPAN * utilizationRatio) / PRICE_PRECISION
}

describe('SecurityPoolUtils', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient
	let securityPoolUtilsAddress: Address

	const calculateRetentionRate = async (completeSetCollateralAmount: bigint, securityBondAllowance: bigint) =>
		await client.readContract({
			abi: peripherals_SecurityPoolUtils_SecurityPoolUtils.abi,
			address: securityPoolUtilsAddress,
			functionName: 'calculateRetentionRate',
			args: [completeSetCollateralAmount, securityBondAllowance],
		})

	beforeEach(async () => {
		const mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		const hash = await client.sendTransaction({
			data: `0x${peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object}`,
		})
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('SecurityPoolUtils deployment address missing')
		securityPoolUtilsAddress = receipt.contractAddress
	})

	test('retention rate starts at max when security bond allowance is zero', async () => {
		strictEqualTypeSafe(await calculateRetentionRate(1n * 10n ** 18n, 0n), MAX_RETENTION_RATE, 'zero allowance should use the max retention rate')
		strictEqualTypeSafe(await calculateRetentionRate(0n, 1n * 10n ** 18n), MAX_RETENTION_RATE, 'zero utilization should use the max retention rate')
	})

	test('retention rate uses fixed-point precision below one percent utilization', async () => {
		const collateral = 1n * 10n ** 18n
		const allowance = 1000n * 10n ** 18n
		const retentionRate = await calculateRetentionRate(collateral, allowance)

		strictEqualTypeSafe(retentionRate < MAX_RETENTION_RATE, true, 'sub-1% utilization should still move the rate down the curve')
		strictEqualTypeSafe(retentionRate, expectedRetentionRate(collateral, allowance), 'sub-1% utilization should use fixed-point precision')
	})

	test('retention rate is linear until the utilization dip and then caps at min', async () => {
		const allowance = 100n * 10n ** 18n
		const midpointCollateral = 40n * 10n ** 18n
		const dipCollateral = 80n * 10n ** 18n
		const aboveDipCollateral = 81n * 10n ** 18n

		strictEqualTypeSafe(await calculateRetentionRate(midpointCollateral, allowance), expectedRetentionRate(midpointCollateral, allowance), '40% utilization should sit halfway through the rate span')
		strictEqualTypeSafe(await calculateRetentionRate(dipCollateral, allowance), MIN_RETENTION_RATE, '80% utilization should hit the min retention rate')
		strictEqualTypeSafe(await calculateRetentionRate(aboveDipCollateral, allowance), MIN_RETENTION_RATE, 'above 80% utilization should stay capped at the min retention rate')
	})
})
