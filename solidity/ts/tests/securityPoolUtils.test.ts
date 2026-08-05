import { beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import type { Address } from '@zoltar/shared/ethereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { createWriteClient, WriteClient } from '../testSupport/simulator/utils/clients'
import { strictEqualTypeSafe } from '../testSupport/simulator/utils/testUtils'
import { peripherals_SecurityPoolUtils_SecurityPoolUtils } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

const PRICE_PRECISION = 1n * 10n ** 18n
const MAX_RETENTION_RATE = 999_999_996_848_000_000n
const MIN_RETENTION_RATE = 999_999_977_880_000_000n
const RETENTION_RATE_DIP = 800_000_000_000_000_000n
const RATE_SPAN = MAX_RETENTION_RATE - MIN_RETENTION_RATE

const expectedRetentionRate = (settlementCollateralAttoEth: bigint, coverageCommitmentAttoEth: bigint) => {
	if (coverageCommitmentAttoEth === 0n) return MAX_RETENTION_RATE
	const utilization = (settlementCollateralAttoEth * PRICE_PRECISION) / coverageCommitmentAttoEth
	if (utilization > RETENTION_RATE_DIP) return MIN_RETENTION_RATE
	const utilizationRatio = (utilization * PRICE_PRECISION) / RETENTION_RATE_DIP
	return MAX_RETENTION_RATE - (RATE_SPAN * utilizationRatio) / PRICE_PRECISION
}

describe('SecurityPoolUtils', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient
	let securityPoolUtilsAddress: Address

	const calculateRetentionRate = async (settlementCollateralAttoEth: bigint, coverageCommitmentAttoEth: bigint) =>
		await client.readContract({
			abi: peripherals_SecurityPoolUtils_SecurityPoolUtils.abi,
			address: securityPoolUtilsAddress,
			functionName: 'calculateRetentionRate',
			args: [settlementCollateralAttoEth, coverageCommitmentAttoEth],
		})

	const calculateBundledLiquidationTransfer = async () =>
		await client.readContract({
			abi: peripherals_SecurityPoolUtils_SecurityPoolUtils.abi,
			address: securityPoolUtilsAddress,
			functionName: 'calculateBundledLiquidationTransfer',
			args: [500n * PRICE_PRECISION, 100n * PRICE_PRECISION, 50n * PRICE_PRECISION, PRICE_PRECISION, 1000n * PRICE_PRECISION, 1000n * PRICE_PRECISION],
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

	test('retention rate starts at max when coverage commitment is zero', async () => {
		strictEqualTypeSafe(await calculateRetentionRate(1n * 10n ** 18n, 0n), MAX_RETENTION_RATE, 'coverage commitment')
		strictEqualTypeSafe(await calculateRetentionRate(0n, 1n * 10n ** 18n), MAX_RETENTION_RATE, 'zero utilization should use the max retention rate')
	})

	test('retention rate uses fixed-point precision below one percent utilization', async () => {
		const collateral = 1n * 10n ** 18n
		const coverageCommitmentAttoEth = 1000n * 10n ** 18n
		const retentionRate = await calculateRetentionRate(collateral, coverageCommitmentAttoEth)

		strictEqualTypeSafe(retentionRate < MAX_RETENTION_RATE, true, 'sub-1% utilization should still move the rate down the curve')
		strictEqualTypeSafe(retentionRate, expectedRetentionRate(collateral, coverageCommitmentAttoEth), 'sub-1% utilization should use fixed-point precision')
	})

	test('retention rate is linear until the utilization dip and then caps at min', async () => {
		const coverageCommitmentAttoEth = 100n * 10n ** 18n
		const midpointCollateral = 40n * 10n ** 18n
		const dipCollateral = 80n * 10n ** 18n
		const aboveDipCollateral = 81n * 10n ** 18n

		strictEqualTypeSafe(await calculateRetentionRate(midpointCollateral, coverageCommitmentAttoEth), expectedRetentionRate(midpointCollateral, coverageCommitmentAttoEth), '40% utilization should sit halfway through the rate span')
		strictEqualTypeSafe(await calculateRetentionRate(dipCollateral, coverageCommitmentAttoEth), MIN_RETENTION_RATE, '80% utilization should hit the min retention rate')
		strictEqualTypeSafe(await calculateRetentionRate(aboveDipCollateral, coverageCommitmentAttoEth), MIN_RETENTION_RATE, 'above 80% utilization should stay capped at the min retention rate')
	})

	test('liquidation distance uses whichever vault-health boundary fails first', async () => {
		const coverageCommitmentAttoEth = 100n * 10n ** 18n
		const poolMultiplierBps = 20_000n
		const minDistanceBps = 1_000n
		const isBeyondDistance = async (poolHeldVaultRepBackingAttoRep: bigint, disputeStakedAttoRep: bigint, price: bigint) =>
			await client.readContract({
				abi: peripherals_SecurityPoolUtils_SecurityPoolUtils.abi,
				address: securityPoolUtilsAddress,
				functionName: 'isLiquidationBeyondMinPriceDistance',
				args: [poolHeldVaultRepBackingAttoRep, disputeStakedAttoRep, coverageCommitmentAttoEth, poolMultiplierBps, price, minDistanceBps],
			})

		strictEqualTypeSafe(await isBeyondDistance(200n * 10n ** 18n, 0n, (PRICE_PRECISION * 11n) / 10n), false, 'associated-REP boundary should enforce the configured distance')
		strictEqualTypeSafe(await isBeyondDistance(200n * 10n ** 18n, 0n, (PRICE_PRECISION * 12n) / 10n), true, 'associated-REP boundary should allow a price beyond the configured distance')
		strictEqualTypeSafe(await isBeyondDistance(100n * 10n ** 18n, 100n * 10n ** 18n, (PRICE_PRECISION * 3n) / 4n), true, 'pool-held vault REP backing migration boundary should bind before the associated-REP boundary')
	})

	test('liquidation compensation pays the complete 5% pool-held vault REP backing bonus', async () => {
		const liquidation = await calculateBundledLiquidationTransfer()
		strictEqualTypeSafe(liquidation[1], (105n * PRICE_PRECISION) / 2n, 'liquidation should receive the complete 5%-bonus pool-held vault REP backing award')
	})

	test('minimum-multiplier health reserves the complete liquidation award in pool-held vault REP backing', async () => {
		const coverageCommitmentAttoEth = 100n * PRICE_PRECISION
		const isHealthy = async (poolHeldVaultRepBackingAttoRep: bigint, disputeStakedAttoRep: bigint) =>
			await client.readContract({
				abi: peripherals_SecurityPoolUtils_SecurityPoolUtils.abi,
				address: securityPoolUtilsAddress,
				functionName: 'isVaultHealthy',
				args: [poolHeldVaultRepBackingAttoRep, disputeStakedAttoRep, coverageCommitmentAttoEth, PRICE_PRECISION, 10_002n],
			})

		strictEqualTypeSafe(await isHealthy(100n * PRICE_PRECISION + 10n ** 16n, 100n * PRICE_PRECISION), false, 'the 10,001-BPS halfway reserve must not admit a vault that cannot fund its 105% award')
		strictEqualTypeSafe(await isHealthy(105n * PRICE_PRECISION + 1n, 100n * PRICE_PRECISION), true, 'strictly more than the complete 105% pool-held vault REP backing reserve should be healthy')
	})

	test('maximum liquidation coverage commitment is capped to the complete award funded by pool-held vault REP backing', async () => {
		const targetVaultRepBackingAttoRep = 100n * PRICE_PRECISION
		const targetCoverageCommitmentAttoEth = 900n * PRICE_PRECISION
		const price = 2n * PRICE_PRECISION
		const liquidation = await client.readContract({
			abi: peripherals_SecurityPoolUtils_SecurityPoolUtils.abi,
			address: securityPoolUtilsAddress,
			functionName: 'calculateBundledLiquidationTransfer',
			args: [targetVaultRepBackingAttoRep, targetCoverageCommitmentAttoEth, targetCoverageCommitmentAttoEth, price, 1000n * PRICE_PRECISION, 1000n * PRICE_PRECISION],
		})
		const expectedCoverageCommitmentTransferAttoEth = (targetVaultRepBackingAttoRep * PRICE_PRECISION * 10_000n) / (price * 10_500n)

		strictEqualTypeSafe(liquidation[0], expectedCoverageCommitmentTransferAttoEth, 'ordinary coverage commitment should stop at the fully funded 105% boundary')
		strictEqualTypeSafe(liquidation[1], targetVaultRepBackingAttoRep - 1n, 'the funded award should consume pool-held vault REP backing only up to atomic rounding')
	})

	test('coverage commitment', async () => {
		const targetCoverageCommitmentAttoEth = PRICE_PRECISION / 2n
		const partialLiquidation = await client.readContract({
			abi: peripherals_SecurityPoolUtils_SecurityPoolUtils.abi,
			address: securityPoolUtilsAddress,
			functionName: 'calculateBundledLiquidationTransfer',
			args: [100n * PRICE_PRECISION, targetCoverageCommitmentAttoEth, targetCoverageCommitmentAttoEth / 2n, PRICE_PRECISION, 100n * PRICE_PRECISION, 100n * PRICE_PRECISION],
		})
		const maximumLiquidation = await client.readContract({
			abi: peripherals_SecurityPoolUtils_SecurityPoolUtils.abi,
			address: securityPoolUtilsAddress,
			functionName: 'calculateBundledLiquidationTransfer',
			args: [100n * PRICE_PRECISION, targetCoverageCommitmentAttoEth, targetCoverageCommitmentAttoEth, PRICE_PRECISION, 100n * PRICE_PRECISION, 100n * PRICE_PRECISION],
		})

		strictEqualTypeSafe(partialLiquidation[0], 0n, 'coverage commitment')
		strictEqualTypeSafe(partialLiquidation[1], 0n, 'a rejected partial request must not quote a REP award')
		strictEqualTypeSafe(maximumLiquidation[0], targetCoverageCommitmentAttoEth, 'coverage commitment')
	})
})
