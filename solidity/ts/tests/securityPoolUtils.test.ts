import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import type { Address } from '@zoltar/shared/ethereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { createWriteClient, WriteClient } from '../testSupport/simulator/utils/clients'
import { strictEqualTypeSafe } from '../testSupport/simulator/utils/testUtils'
import { statoblast_SecurityPoolUtils_SecurityPoolUtils, test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

const PRICE_PRECISION = 1n * 10n ** 18n
const MAX_RETENTION_RATE = 999_999_996_848_000_000n
const MIN_RETENTION_RATE = 999_999_977_880_000_000n
const RETENTION_RATE_DIP = 800_000_000_000_000_000n
const RATE_SPAN = MAX_RETENTION_RATE - MIN_RETENTION_RATE

const expectedRetentionRate = (settlementCollateralAttoEth: bigint, capacityOwnershipAttoRep: bigint) => {
	if (capacityOwnershipAttoRep === 0n) return MAX_RETENTION_RATE
	const utilization = (settlementCollateralAttoEth * PRICE_PRECISION) / capacityOwnershipAttoRep
	if (utilization > RETENTION_RATE_DIP) return MIN_RETENTION_RATE
	const utilizationRatio = (utilization * PRICE_PRECISION) / RETENTION_RATE_DIP
	return MAX_RETENTION_RATE - (RATE_SPAN * utilizationRatio) / PRICE_PRECISION
}

describe('SecurityPoolUtils', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient
	let securityPoolUtilsAddress: Address

	const calculateRetentionRate = async (settlementCollateralAttoEth: bigint, capacityOwnershipAttoRep: bigint) =>
		await client.readContract({
			abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi,
			address: securityPoolUtilsAddress,
			functionName: 'calculateRetentionRate',
			args: [settlementCollateralAttoEth, capacityOwnershipAttoRep],
		})

	const calculateBundledLiquidationTransfer = async () =>
		await client.readContract({
			abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi,
			address: securityPoolUtilsAddress,
			functionName: 'calculateBundledLiquidationTransfer',
			args: [500n * PRICE_PRECISION, 100n * PRICE_PRECISION, 50n * PRICE_PRECISION, 50n * PRICE_PRECISION, PRICE_PRECISION, 1000n * PRICE_PRECISION, 1000n * PRICE_PRECISION, 0n],
		})

	beforeEach(async () => {
		const mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		const hash = await client.sendTransaction({
			data: `0x${statoblast_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object}`,
		})
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('SecurityPoolUtils deployment address missing')
		securityPoolUtilsAddress = receipt.contractAddress
	})

	test('retention rate starts at max when capacity ownership is zero', async () => {
		strictEqualTypeSafe(await calculateRetentionRate(1n * 10n ** 18n, 0n), MAX_RETENTION_RATE, 'capacity ownership')
		strictEqualTypeSafe(await calculateRetentionRate(0n, 1n * 10n ** 18n), MAX_RETENTION_RATE, 'zero utilization should use the max retention rate')
	})

	test('retention rate uses fixed-point precision below one percent utilization', async () => {
		const collateral = 1n * 10n ** 18n
		const capacityOwnershipAttoRep = 1000n * 10n ** 18n
		const retentionRate = await calculateRetentionRate(collateral, capacityOwnershipAttoRep)

		strictEqualTypeSafe(retentionRate < MAX_RETENTION_RATE, true, 'sub-1% utilization should still move the rate down the curve')
		strictEqualTypeSafe(retentionRate, expectedRetentionRate(collateral, capacityOwnershipAttoRep), 'sub-1% utilization should use fixed-point precision')
	})

	test('retention rate is linear until the utilization dip and then caps at min', async () => {
		const capacityOwnershipAttoRep = 100n * 10n ** 18n
		const midpointCollateral = 40n * 10n ** 18n
		const dipCollateral = 80n * 10n ** 18n
		const aboveDipCollateral = 81n * 10n ** 18n

		strictEqualTypeSafe(await calculateRetentionRate(midpointCollateral, capacityOwnershipAttoRep), expectedRetentionRate(midpointCollateral, capacityOwnershipAttoRep), '40% utilization should sit halfway through the rate span')
		strictEqualTypeSafe(await calculateRetentionRate(dipCollateral, capacityOwnershipAttoRep), MIN_RETENTION_RATE, '80% utilization should hit the min retention rate')
		strictEqualTypeSafe(await calculateRetentionRate(aboveDipCollateral, capacityOwnershipAttoRep), MIN_RETENTION_RATE, 'above 80% utilization should stay capped at the min retention rate')
	})

	test('REP-denominated ownership converts aggregate capacity at the live oracle price', async () => {
		const ownershipAttoRep = 200n * PRICE_PRECISION
		const capacityAtOneRepPerEth = await client.readContract({ abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi, address: securityPoolUtilsAddress, functionName: 'calculateMintingCapacityAttoEth', args: [ownershipAttoRep, PRICE_PRECISION, 20_000n] })
		const capacityAfterRepPriceDoubles = await client.readContract({ abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi, address: securityPoolUtilsAddress, functionName: 'calculateMintingCapacityAttoEth', args: [ownershipAttoRep, 2n * PRICE_PRECISION, 20_000n] })
		strictEqualTypeSafe(capacityAtOneRepPerEth, 100n * PRICE_PRECISION, 'initial capacity')
		strictEqualTypeSafe(capacityAfterRepPriceDoubles, 50n * PRICE_PRECISION, 'live price conversion')
	})

	test('initial escalation deposit uses a one-REP floor below the supply fraction', async () => {
		for (const [theoreticalSupplyAttoRep, expectedDepositAttoRep] of [
			[0n, PRICE_PRECISION],
			[9_999_999n * PRICE_PRECISION, PRICE_PRECISION],
			[10_000_000n * PRICE_PRECISION, PRICE_PRECISION],
			[20_000_000n * PRICE_PRECISION, 2n * PRICE_PRECISION],
		] as const) {
			strictEqualTypeSafe(
				await client.readContract({
					abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi,
					address: securityPoolUtilsAddress,
					functionName: 'calculateInitialEscalationDepositAttoRep',
					args: [theoreticalSupplyAttoRep],
				}),
				expectedDepositAttoRep,
				`theoretical supply ${theoreticalSupplyAttoRep.toString()}`,
			)
		}
	})

	test('vault REP deposit uses the supply default while honoring exact constructor overrides', async () => {
		const theoreticalSupplyAttoRep = 2_000_000n * PRICE_PRECISION
		for (const [configuredMinimumAttoRep, expectedMinimumAttoRep] of [
			[0n, 20n * PRICE_PRECISION],
			[10n * PRICE_PRECISION, 10n * PRICE_PRECISION],
			[20n * PRICE_PRECISION, 20n * PRICE_PRECISION],
			[30n * PRICE_PRECISION, 30n * PRICE_PRECISION],
		] as const) {
			strictEqualTypeSafe(
				await client.readContract({
					abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi,
					address: securityPoolUtilsAddress,
					functionName: 'calculateMinimumVaultRepDepositAttoRep',
					args: [theoreticalSupplyAttoRep, configuredMinimumAttoRep],
				}),
				expectedMinimumAttoRep,
				`configured minimum ${configuredMinimumAttoRep.toString()}`,
			)
		}
	})

	test('open interest remains and is allocated by price-independent capacity ownership', async () => {
		const vaultOpenInterest = await client.readContract({ abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi, address: securityPoolUtilsAddress, functionName: 'calculateVaultOpenInterestAttoEth', args: [101n, 1n, 3n] })
		strictEqualTypeSafe(vaultOpenInterest, 34n, 'vault open interest rounds upward')
	})

	test('receiver health factor rounds both associated and free REP requirements upward', async () => {
		const requiredBoundary = await client.readContract({ abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi, address: securityPoolUtilsAddress, functionName: 'isVaultHealthyAtFactor', args: [225n, 75n, 100n, PRICE_PRECISION, 20_000n, 15_000n] })
		const belowAssociatedBoundary = await client.readContract({ abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi, address: securityPoolUtilsAddress, functionName: 'isVaultHealthyAtFactor', args: [225n, 74n, 100n, PRICE_PRECISION, 20_000n, 15_000n] })
		const belowFreeBoundary = await client.readContract({ abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi, address: securityPoolUtilsAddress, functionName: 'isVaultHealthyAtFactor', args: [224n, 76n, 100n, PRICE_PRECISION, 20_000n, 15_000n] })
		strictEqualTypeSafe(requiredBoundary, true, 'exact signed boundary')
		strictEqualTypeSafe(belowAssociatedBoundary, false, 'associated requirement applies the signed factor')
		strictEqualTypeSafe(belowFreeBoundary, false, 'free requirement applies the signed factor')
	})

	test('liquidation compensation pays the complete 5% pool-held vault REP backing bonus', async () => {
		const liquidation = await calculateBundledLiquidationTransfer()
		strictEqualTypeSafe(liquidation[2], (105n * PRICE_PRECISION) / 2n, 'liquidation should receive the complete 5%-bonus pool-held vault REP backing award')
	})

	test('liquidation award conversion rounds backing units upward independently of gross REP', async () => {
		const backingUnits = await client.readContract({
			abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi,
			address: securityPoolUtilsAddress,
			functionName: 'calculateLiquidationBackingUnitsAward',
			args: [2n, PRICE_PRECISION, 5n, 2n],
		})
		const representedAttoRep = (backingUnits * 5n) / 2n
		strictEqualTypeSafe(backingUnits, 2n, 'a three-attoREP gross award rounds upward to two backing units')
		strictEqualTypeSafe(representedAttoRep, 5n, 'the credited backing units can represent more current REP than the three-attoREP gross award')
	})

	test('minimum-multiplier health reserves the complete liquidation award in pool-held vault REP backing', async () => {
		const capacityOwnershipAttoRep = 100n * PRICE_PRECISION
		const isHealthy = async (poolHeldVaultRepBackingAttoRep: bigint, disputeStakedAttoRep: bigint) =>
			await client.readContract({
				abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi,
				address: securityPoolUtilsAddress,
				functionName: 'isVaultHealthy',
				args: [poolHeldVaultRepBackingAttoRep, disputeStakedAttoRep, capacityOwnershipAttoRep, PRICE_PRECISION, 10_002n],
			})

		strictEqualTypeSafe(await isHealthy(100n * PRICE_PRECISION + 10n ** 16n, 100n * PRICE_PRECISION), false, 'the 10,001-BPS halfway reserve must not admit a vault that cannot fund its 105% award')
		strictEqualTypeSafe(await isHealthy(105n * PRICE_PRECISION + 1n, 100n * PRICE_PRECISION), true, 'strictly more than the complete 105% pool-held vault REP backing reserve should be healthy')
	})

	test('maximum funded liquidation debt is capped to the complete award funded by pool-held vault REP backing', async () => {
		const targetVaultRepBackingAttoRep = 100n * PRICE_PRECISION
		const targetCapacityOwnershipAttoRep = 900n * PRICE_PRECISION
		const price = 2n * PRICE_PRECISION
		const liquidation = await client.readContract({
			abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi,
			address: securityPoolUtilsAddress,
			functionName: 'calculateBundledLiquidationTransfer',
			args: [targetVaultRepBackingAttoRep, targetCapacityOwnershipAttoRep, targetCapacityOwnershipAttoRep, targetCapacityOwnershipAttoRep, price, 1000n * PRICE_PRECISION, 1000n * PRICE_PRECISION, 0n],
		})
		const expectedDebtMovedAttoEth = (targetVaultRepBackingAttoRep * PRICE_PRECISION * 10_000n) / (price * 10_500n)

		strictEqualTypeSafe(liquidation[0], expectedDebtMovedAttoEth, 'liquidation debt should stop at the fully funded 105% boundary')
		strictEqualTypeSafe(liquidation[2], targetVaultRepBackingAttoRep - 1n, 'the funded award should consume pool-held vault REP backing only up to atomic rounding')
	})

	test('partial liquidation moves proportional capacity ownership up to the requested debt', async () => {
		const targetCapacityOwnershipAttoRep = PRICE_PRECISION / 2n
		const partialLiquidation = await client.readContract({
			abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi,
			address: securityPoolUtilsAddress,
			functionName: 'calculateBundledLiquidationTransfer',
			args: [100n * PRICE_PRECISION, targetCapacityOwnershipAttoRep, targetCapacityOwnershipAttoRep, targetCapacityOwnershipAttoRep / 2n, PRICE_PRECISION, 100n * PRICE_PRECISION, 100n * PRICE_PRECISION, 0n],
		})
		const maximumLiquidation = await client.readContract({
			abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi,
			address: securityPoolUtilsAddress,
			functionName: 'calculateBundledLiquidationTransfer',
			args: [100n * PRICE_PRECISION, targetCapacityOwnershipAttoRep, targetCapacityOwnershipAttoRep, targetCapacityOwnershipAttoRep, PRICE_PRECISION, 100n * PRICE_PRECISION, 100n * PRICE_PRECISION, 0n],
		})

		strictEqualTypeSafe(partialLiquidation[0], targetCapacityOwnershipAttoRep / 2n, 'partial debt request')
		strictEqualTypeSafe(partialLiquidation[1], targetCapacityOwnershipAttoRep / 2n, 'partial request moves proportional ownership')
		strictEqualTypeSafe(maximumLiquidation[0], targetCapacityOwnershipAttoRep, 'maximum debt request')
	})

	test('coarse liquidation ownership rounding never moves more receiver debt than requested', async () => {
		const regression = await client.readContract({
			abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi,
			address: securityPoolUtilsAddress,
			functionName: 'calculateBundledLiquidationTransfer',
			args: [10n ** 30n, 2n, 20n, 1n, PRICE_PRECISION, 10n ** 30n, 10n ** 30n, 0n],
		})
		strictEqualTypeSafe(regression[0], 0n, 'a one-attoETH request must not round one of two ownership units into a ten-attoETH receiver liability')
		strictEqualTypeSafe(regression[1], 0n, 'unsafe coarse ownership must remain with the target')

		for (let seed = 1n; seed <= 32n; seed++) {
			const totalOwnership = 97n + seed
			const targetOwnership = 1n + (seed % 13n)
			const receiverOwnership = (seed * 7n) % (totalOwnership - targetOwnership)
			const activeOpenInterest = totalOwnership * (100n + seed)
			const targetOpenInterest = (activeOpenInterest * targetOwnership + totalOwnership - 1n) / totalOwnership
			const requestedDebt = 1n + ((seed * 17n) % (targetOpenInterest - 1n))
			const liquidation = await client.readContract({
				abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi,
				address: securityPoolUtilsAddress,
				functionName: 'calculateBundledLiquidationTransfer',
				args: [10n ** 30n, targetOwnership, targetOpenInterest, requestedDebt, PRICE_PRECISION, 10n ** 30n, 10n ** 30n, 0n],
			})
			const receiverDebtBefore = await client.readContract({
				abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi,
				address: securityPoolUtilsAddress,
				functionName: 'calculateVaultOpenInterestAttoEth',
				args: [activeOpenInterest, receiverOwnership, totalOwnership],
			})
			const receiverDebtAfter = await client.readContract({
				abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi,
				address: securityPoolUtilsAddress,
				functionName: 'calculateVaultOpenInterestAttoEth',
				args: [activeOpenInterest, receiverOwnership + liquidation[1], totalOwnership],
			})
			const receiverDebtIncrease = receiverDebtAfter - receiverDebtBefore
			strictEqualTypeSafe(receiverDebtIncrease <= requestedDebt, true, `seed ${seed.toString()} receiver debt bound`)
			strictEqualTypeSafe(receiverDebtIncrease <= liquidation[0], true, `seed ${seed.toString()} nominal liquidation bound`)
		}
	})

	test('receiver rounding that moves zero debt cannot remove funded target ownership or create bad debt', async () => {
		const targetVault = addressString(TEST_ADDRESSES[0])
		const receiverVault = addressString(TEST_ADDRESSES[1])
		const linkedHarnessBytecode = test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.evm.bytecode.object.replace(/__\$[0-9a-f]{34}\$__/g, securityPoolUtilsAddress.slice(2))
		const deploymentHash = await client.sendTransaction({
			data: `0x${linkedHarnessBytecode}`,
		})
		const deploymentReceipt = await client.waitForTransactionReceipt({ hash: deploymentHash })
		if (deploymentReceipt.contractAddress === undefined || deploymentReceipt.contractAddress === null) throw new Error('Coarse rounding harness deployment address missing')
		const harnessAddress = deploymentReceipt.contractAddress
		const configureHash = await client.writeContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'configure',
			args: [targetVault, receiverVault],
		})
		await client.waitForTransactionReceipt({ hash: configureHash })
		const targetBefore = await client.readContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'vaultState',
			args: [targetVault],
		})

		await expect(
			client.writeContract({
				abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
				address: harnessAddress,
				functionName: 'performBundledLiquidation',
				args: [{ receiverVault, targetVault, requestedDebtAttoEth: 1n, snapshotTargetBackingUnits: 2n, snapshotTargetCapacityOwnershipAttoRep: 1n, repEthPrice: PRICE_PRECISION, minimumReceiverHealthFactorBps: 10_000n, minLiquidationPriceDistanceBps: 0n }],
			}),
		).rejects.toThrow('Receiver debt below minimum')

		const targetAfter = await client.readContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'vaultState',
			args: [targetVault],
		})
		strictEqualTypeSafe(targetAfter[0], targetBefore[0], 'failed receiver rounding must preserve target backing')
		strictEqualTypeSafe(targetAfter[1], targetBefore[1], 'failed receiver rounding must preserve target ownership')
		strictEqualTypeSafe(targetAfter[2], targetBefore[2], 'failed receiver rounding must not create bad debt')
	})

	test('liquidation execution rechecks price distance against live open interest', async () => {
		const targetVault = addressString(TEST_ADDRESSES[0])
		const receiverVault = addressString(TEST_ADDRESSES[1])
		const linkedHarnessBytecode = test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.evm.bytecode.object.replace(/__\$[0-9a-f]{34}\$__/g, securityPoolUtilsAddress.slice(2))
		const deploymentHash = await client.sendTransaction({ data: `0x${linkedHarnessBytecode}` })
		const deploymentReceipt = await client.waitForTransactionReceipt({ hash: deploymentHash })
		if (deploymentReceipt.contractAddress === undefined || deploymentReceipt.contractAddress === null) throw new Error('Live liquidation distance harness deployment address missing')
		const harnessAddress = deploymentReceipt.contractAddress
		const configureHash = await client.writeContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'configureLiveLiquidationDistance',
			args: [targetVault, receiverVault],
		})
		await client.waitForTransactionReceipt({ hash: configureHash })

		await client.simulateContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'performBundledLiquidation',
			args: [{ receiverVault, targetVault, requestedDebtAttoEth: 5n, snapshotTargetBackingUnits: 7n, snapshotTargetCapacityOwnershipAttoRep: 10n, repEthPrice: PRICE_PRECISION, minimumReceiverHealthFactorBps: 10_000n, minLiquidationPriceDistanceBps: 2_000n }],
		})

		const reduceOpenInterestHash = await client.writeContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'setSettlementCollateralAttoEth',
			args: [4n],
		})
		await client.waitForTransactionReceipt({ hash: reduceOpenInterestHash })
		await expect(
			client.writeContract({
				abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
				address: harnessAddress,
				functionName: 'performBundledLiquidation',
				args: [{ receiverVault, targetVault, requestedDebtAttoEth: 5n, snapshotTargetBackingUnits: 7n, snapshotTargetCapacityOwnershipAttoRep: 10n, repEthPrice: PRICE_PRECISION, minimumReceiverHealthFactorBps: 10_000n, minLiquidationPriceDistanceBps: 2_000n }],
			}),
		).rejects.toThrow('Liquidation distance too low')
	})

	test('liquidation execution assigns debt against total capacity before auction ownership is claimed', async () => {
		const targetVault = addressString(TEST_ADDRESSES[0])
		const receiverVault = addressString(TEST_ADDRESSES[1])
		const linkedHarnessBytecode = test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.evm.bytecode.object.replace(/__\$[0-9a-f]{34}\$__/g, securityPoolUtilsAddress.slice(2))
		const deploymentHash = await client.sendTransaction({ data: `0x${linkedHarnessBytecode}` })
		const deploymentReceipt = await client.waitForTransactionReceipt({ hash: deploymentHash })
		if (deploymentReceipt.contractAddress === undefined || deploymentReceipt.contractAddress === null) throw new Error('Unclaimed capacity harness deployment address missing')
		const harnessAddress = deploymentReceipt.contractAddress
		const configureHash = await client.writeContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'configureUnclaimedCapacity',
			args: [targetVault, receiverVault],
		})
		await client.waitForTransactionReceipt({ hash: configureHash })

		const typedRequest = { receiverVault, targetVault, requestedDebtAttoEth: 4n, snapshotTargetBackingUnits: 7n, snapshotTargetCapacityOwnershipAttoRep: 2n, repEthPrice: PRICE_PRECISION, minimumReceiverHealthFactorBps: 10_000n, minLiquidationPriceDistanceBps: 0n }
		const liquidationGas = await client.estimateContractGas({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'performBundledLiquidation',
			args: [typedRequest],
		})
		expect(liquidationGas, `typed liquidation request exceeds the audited gas bound: ${liquidationGas.toString()}`).toBeLessThan(1_000_000n)
		const liquidation = await client.simulateContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'performBundledLiquidation',
			args: [typedRequest],
		})
		strictEqualTypeSafe(liquidation.result[0], 4n, 'receiver accepts the target debt assigned by total capacity')
		strictEqualTypeSafe(liquidation.result[1], 2n, 'receiver receives the target capacity ownership')
		strictEqualTypeSafe(liquidation.result[2], 0n, 'fully backed debt does not become bad debt')
	})

	test('full-target liquidation records exact positive allocation residue after settling less than the nominal quote', async () => {
		const targetVault = addressString(TEST_ADDRESSES[0])
		const receiverVault = addressString(TEST_ADDRESSES[1])
		const linkedHarnessBytecode = test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.evm.bytecode.object.replace(/__\$[0-9a-f]{34}\$__/g, securityPoolUtilsAddress.slice(2))
		const deploymentHash = await client.sendTransaction({ data: `0x${linkedHarnessBytecode}` })
		const deploymentReceipt = await client.waitForTransactionReceipt({ hash: deploymentHash })
		if (deploymentReceipt.contractAddress === undefined || deploymentReceipt.contractAddress === null) throw new Error('Coarse rounding harness deployment address missing')
		const harnessAddress = deploymentReceipt.contractAddress
		const configureHash = await client.writeContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'configurePositiveResidual',
			args: [targetVault, receiverVault],
		})
		await client.waitForTransactionReceipt({ hash: configureHash })
		const targetDebtBefore = await client.readContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'getVaultOpenInterestAttoEth',
			args: [targetVault],
		})
		const receiverDebtBefore = await client.readContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'getVaultOpenInterestAttoEth',
			args: [receiverVault],
		})

		const liquidationPreview = await client.simulateContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'performBundledLiquidation',
			args: [{ receiverVault, targetVault, requestedDebtAttoEth: 2n, snapshotTargetBackingUnits: 3n, snapshotTargetCapacityOwnershipAttoRep: 1n, repEthPrice: PRICE_PRECISION, minimumReceiverHealthFactorBps: 10_000n, minLiquidationPriceDistanceBps: 0n }],
		})
		strictEqualTypeSafe(liquidationPreview.result[0], 1n, 'receiver exact debt increase is below the two-attoETH nominal quote')
		strictEqualTypeSafe(liquidationPreview.result[1], 1n, 'full-target quote moves the target ownership')
		strictEqualTypeSafe(liquidationPreview.result[2], 1n, 'full-target residual records integer allocation rounding')
		const liquidationHash = await client.writeContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'performBundledLiquidation',
			args: [{ receiverVault, targetVault, requestedDebtAttoEth: 2n, snapshotTargetBackingUnits: 3n, snapshotTargetCapacityOwnershipAttoRep: 1n, repEthPrice: PRICE_PRECISION, minimumReceiverHealthFactorBps: 10_000n, minLiquidationPriceDistanceBps: 0n }],
		})
		await client.waitForTransactionReceipt({ hash: liquidationHash })
		const targetAfter = await client.readContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'vaultState',
			args: [targetVault],
		})
		const receiverAfter = await client.readContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'vaultState',
			args: [receiverVault],
		})
		const targetDebtAfter = await client.readContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'getVaultOpenInterestAttoEth',
			args: [targetVault],
		})
		const receiverDebtAfter = await client.readContract({
			abi: test_statoblast_LiquidationApprovalTestMocks_CoarseLiquidationRoundingHarness.abi,
			address: harnessAddress,
			functionName: 'getVaultOpenInterestAttoEth',
			args: [receiverVault],
		})
		strictEqualTypeSafe(targetDebtBefore - targetDebtAfter, 2n, 'the target independently loses two attoETH of rounded debt')
		strictEqualTypeSafe(receiverDebtAfter - receiverDebtBefore, 1n, 'the receiver incurs the exact one-attoETH reported debt increase')
		strictEqualTypeSafe(targetAfter[0], 1n, 'the award uses exact moved debt rather than the larger nominal quote')
		strictEqualTypeSafe(targetAfter[1], 0n, 'full-target ownership moves to the receiver')
		strictEqualTypeSafe(targetAfter[2], 1n, 'target bad debt records nominal debt minus the exact receiver allocation increase')
		strictEqualTypeSafe(receiverAfter[0], 12n, 'receiver receives the award derived from one attoETH of exact moved debt')
		strictEqualTypeSafe(receiverAfter[1], 2n, 'receiver receives the floor-rounded ownership quote')
	})
})
