import { getLiquidationVaultRepBackingToTransfer } from '@zoltar/statoblast-shared/statoblast/liquidation'
import { formatStorageSlot, getAddressMappingStorageSlot } from '../../testSupport/storage'
import { REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT } from '@zoltar/zoltar-shared/constants'
import { beforeEach, describe, test } from 'bun:test'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import assert from '../../testSupport/simulator/utils/assert'
import { addressString, rpow } from '../../testSupport/simulator/utils/bigint'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { getTotalRepPurchasedAttoRep, getEthRaiseCapAttoEth } from '../../testSupport/simulator/utils/contracts/auction'
import { getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import {
	attoSharesToAttoEth,
	createCompleteSet,
	depositRepToVault,
	depositToEscalationGame,
	getAwaitingForkContinuation,
	getCurrentRetentionRate,
	getRepToken,
	getSecurityVault,
	getSettlementCollateralAttoEth,
	getShareTokenSupplyAttoShares,
	getSystemState,
	getTotalAccruedFees,
	getTotalClaimableVaultFeesAttoEth,
	getTotalUnderwritingLimitAttoEth,
	redeemCompleteSet,
	redeemFees,
	redeemRepFromVault,
	redeemShares,
	setUnderwritingLimit,
	updateSettlementCollateral,
	updateVaultFees,
	withdrawFromEscalationGame,
} from '../../testSupport/simulator/utils/contracts/securityPool'
import { claimForkedEscalationDeposits, createChildUniverse, finalizeTruthAuction, getMigratedAttoRep, getQuestionOutcome, getSecurityPoolForkerForkData, migrateRepToZoltar, migrateVault, startTruthAuction } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { balanceOfShares, getLastPrice, getQuestionEndDate, migrateShares, OperationType, participateAuction, requestPriceIfNeededAndStageOperation } from '../../testSupport/simulator/utils/contracts/statoblast'
import { approveAndDepositRepToVault, manipulatePriceOracle, setVaultCapacityFixture, triggerOwnGameFork } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { addRepToMigrationBalance, forkUniverse, getRepTokenAddress, getTotalTheoreticalSupply, getUniverseData, getZoltarAddress, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { approximatelyEqual, ensureDefined, strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { approveToken, contractExists, getChildUniverseId, getERC20Balance, getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { statoblast_SecurityPool_SecurityPool } from '../../types/contractArtifact'
import { useStatoblastForkMigrationFixture, type StatoblastForkMigrationFixture } from './fixture'

describe('Statoblast: fork migration', () => {
	const fixture = useStatoblastForkMigrationFixture()

	const { reportBond, PRICE_PRECISION, repDeposit, genesisUniverse, statoblastSecurityMultiplierBps, MAX_RETENTION_RATE, outcomes, getVaultRepClaim, finalizeQuestionAsYesWithoutFork, triggerExternalForkForSecurityPool, getYesChildPool } = fixture

	let mockWindow: StatoblastForkMigrationFixture['mockWindow']

	let client: StatoblastForkMigrationFixture['client']

	let securityPoolAddresses: StatoblastForkMigrationFixture['securityPoolAddresses']

	let questionData: StatoblastForkMigrationFixture['questionData']

	let questionId: StatoblastForkMigrationFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionData = fixture.questionData
		questionId = fixture.questionId
	})

	describe('open interest and share redemption', () => {
		for (const [label, forcedBalance] of [
			['one attoREP', 1n],
			['a large surplus', repDeposit],
		] as const) {
			test(`forced ${label} cannot brick the first complete-set mint`, async () => {
				const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
				await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
				await mockWindow.setBalance(securityPoolAddresses.securityPool, forcedBalance)

				await redeemFees(client, securityPoolAddresses.securityPool, addressString(TEST_ADDRESSES[4]))

				strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 0n, 'unsolicited ETH should remain outside complete-set collateral before bootstrap')
				strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), 0n, 'fee reconciliation should not create complete-set supply')

				const depositor = createWriteClient(mockWindow, TEST_ADDRESSES[2])
				const depositAmount = 1n * 10n ** 18n
				await createCompleteSet(depositor, securityPoolAddresses.securityPool, depositAmount)

				const depositorShares = await balanceOfShares(depositor, securityPoolAddresses.shareToken, genesisUniverse, depositor.account.address)
				const expectedShares = depositAmount
				strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), expectedShares, 'the first positive deposit should bootstrap positive complete-set supply')
				strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), depositAmount, 'only the depositor ETH should become complete-set collateral')
				strictEqualTypeSafe(await getETHBalance(client, securityPoolAddresses.securityPool), forcedBalance + depositAmount, 'the forced balance should remain isolated from complete-set accounting')
				strictEqualTypeSafe(depositorShares[0], expectedShares, 'the depositor should receive invalid shares')
				strictEqualTypeSafe(depositorShares[1], expectedShares, 'the depositor should receive yes shares')
				strictEqualTypeSafe(depositorShares[2], expectedShares, 'the depositor should receive no shares')
			})

			if (label === 'one attoREP')
				test('child liquidation leaves carried and local escalation claims with the target', async () => {
					const securityPoolUnderwritingLimitAttoEth = 200n * 10n ** 18n
					await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
					const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
					await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
					await depositRepToVault(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 2n)
					await depositRepToVault(client, securityPoolAddresses.securityPool, repDeposit * 2n)

					await mockWindow.setTime((await getQuestionEndDate(client, questionId)) + 10000n)
					await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)
					const lockedDeposit = 600n * 10n ** 18n
					await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)
					await depositToEscalationGame(liquidatorClient, securityPoolAddresses.securityPool, QuestionOutcome.No, lockedDeposit)
					await triggerExternalForkForSecurityPool(undefined, 'carried liquidation-owner payout')
					await migrateRepToZoltar(liquidatorClient, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
					await createChildUniverse(liquidatorClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
					const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
					const yesPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
					const reporterRep = 10n * 10n ** 18n
					await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
					await addRepToMigrationBalance(client, genesisUniverse, reporterRep)
					await splitMigrationRep(client, genesisUniverse, reporterRep, [QuestionOutcome.Yes])
					await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
					await migrateVault(liquidatorClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
					await mockWindow.advanceTime(8n * 7n * DAY + DAY)
					await startTruthAuction(liquidatorClient, yesPool.securityPool)
					if ((await getSystemState(liquidatorClient, yesPool.securityPool)) === SystemState.ForkTruthAuction) {
						await finalizeTruthAuction(liquidatorClient, yesPool.securityPool)
					}
					for (let progressCall = 0; progressCall < 16 && (await getAwaitingForkContinuation(liquidatorClient, yesPool.securityPool)); progressCall++) {
						await writeContractAndWait(liquidatorClient, () =>
							liquidatorClient.writeContract({
								abi: statoblast_SecurityPool_SecurityPool.abi,
								address: yesPool.securityPool,
								functionName: 'resumeForkedEscalationGame',
								args: [],
							}),
						)
					}
					strictEqualTypeSafe(await getAwaitingForkContinuation(liquidatorClient, yesPool.securityPool), false, 'bounded continuation progress should complete before child-local deposits')
					await manipulatePriceOracle(client, mockWindow, yesPool.openOraclePriceCoordinator)
					await depositToEscalationGame(client, yesPool.securityPool, QuestionOutcome.No, lockedDeposit)
					const targetChildVaultBefore = await getSecurityVault(client, yesPool.securityPool, client.account.address)
					const liquidatorChildVaultBefore = await getSecurityVault(client, yesPool.securityPool, liquidatorClient.account.address)
					const childLocalDeposit = targetChildVaultBefore.disputeStakedAttoRep
					assert.ok(childLocalDeposit > 0n, 'the resumed child should record its new local claim separately')
					assert.ok(targetChildVaultBefore.underwritingLimitAttoEth > 0n, 'capacity ownership')
					const targetVaultRepBackingBeforeAttoRep = await getVaultRepClaim(client.account.address)
					const liquidatorVaultRepBackingBefore = await getVaultRepClaim(liquidatorClient.account.address)
					await manipulatePriceOracle(client, mockWindow, yesPool.openOraclePriceCoordinator, PRICE_PRECISION * 4n)
					await requestPriceIfNeededAndStageOperation(liquidatorClient, yesPool.openOraclePriceCoordinator, OperationType.Liquidation, client.account.address, targetChildVaultBefore.underwritingLimitAttoEth)
					const targetChildVaultAfter = await getSecurityVault(client, yesPool.securityPool, client.account.address)
					const liquidatorChildVaultAfter = await getSecurityVault(client, yesPool.securityPool, liquidatorClient.account.address)
					strictEqualTypeSafe(targetChildVaultAfter.disputeStakedAttoRep, childLocalDeposit, 'liquidation must not move the target claim')
					strictEqualTypeSafe(liquidatorChildVaultAfter.disputeStakedAttoRep, liquidatorChildVaultBefore.disputeStakedAttoRep, 'the liquidator must not receive dispute-staked REP')
					const grossLiquidationAward = getLiquidationVaultRepBackingToTransfer(targetChildVaultBefore.underwritingLimitAttoEth, PRICE_PRECISION * 4n)
					const vaultRepBackingAwardAttoRep = grossLiquidationAward < targetVaultRepBackingBeforeAttoRep ? grossLiquidationAward : targetVaultRepBackingBeforeAttoRep
					approximatelyEqual(await getVaultRepClaim(client.account.address), targetVaultRepBackingBeforeAttoRep - vaultRepBackingAwardAttoRep, 2n, 'the liquidation award should come only from target pool-held vault REP backing')
					approximatelyEqual(await getVaultRepClaim(liquidatorClient.account.address), liquidatorVaultRepBackingBefore + vaultRepBackingAwardAttoRep, 2n, 'the liquidator should receive only the available pool-held vault REP backing award')
				})
		}

		test('forced ETH during migration remains surplus while accounted collateral moves to the child', async () => {
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 10n * 10n ** 18n)
			await triggerExternalForkForSecurityPool(undefined, 'forced ETH migration source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const { yesSecurityPool } = getYesChildPool()
			const forcedParentSurplus = 7n * 10n ** 18n
			const forcedChildSurplus = 11n * 10n ** 18n
			const parentRawBalanceBeforeForce = await getETHBalance(client, securityPoolAddresses.securityPool)
			await mockWindow.setBalance(securityPoolAddresses.securityPool, parentRawBalanceBeforeForce + forcedParentSurplus)
			await mockWindow.setBalance(yesSecurityPool.securityPool, forcedChildSurplus)
			const parentSettlementCollateralAttoEthBeforeMigration = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)

			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const parentSettlementCollateralAttoEthAfterMigration = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const migratedCollateral = parentSettlementCollateralAttoEthBeforeMigration - parentSettlementCollateralAttoEthAfterMigration
			assert.ok(migratedCollateral > 0n, 'test setup should migrate positive accounted collateral')
			strictEqualTypeSafe(await getETHBalance(client, securityPoolAddresses.securityPool), parentRawBalanceBeforeForce + forcedParentSurplus - migratedCollateral, 'parent migration should transfer only accounted collateral and retain forced surplus')
			strictEqualTypeSafe(await getETHBalance(client, yesSecurityPool.securityPool), forcedChildSurplus + migratedCollateral, 'child raw balance should separate forced surplus from migrated collateral')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), 0n, 'child collateral should remain unsettled until truth-auction finalization')
		})

		test('nonzero fee redemption does not classify forced ETH as complete-set collateral', async () => {
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 100n * 10n ** 18n)
			await mockWindow.advanceTime(30n * DAY)
			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)

			const vaultBeforeRedemption = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			assert.ok(vaultBeforeRedemption.claimableFeesAttoEth > 0n, 'test setup should accrue nonzero fees')
			const balanceBeforeForcedEth = await getETHBalance(client, securityPoolAddresses.securityPool)
			await mockWindow.setBalance(securityPoolAddresses.securityPool, balanceBeforeForcedEth + 1n)

			await redeemFees(client, securityPoolAddresses.securityPool, client.account.address)

			const collateralAfterRedemption = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const accruedFeesAfterRedemption = await getTotalAccruedFees(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getETHBalance(client, securityPoolAddresses.securityPool), collateralAfterRedemption + accruedFeesAfterRedemption + 1n, 'forced ETH should remain isolated from collateral and fee accounting after the payout')
		})

		test('a zero-output complete-set mint reverts without retaining user ETH', async () => {
			const victim = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			await mockWindow.addStateOverrides({
				[securityPoolAddresses.securityPool]: {
					stateDiff: {
						[formatStorageSlot(1n)]: 3n,
						[formatStorageSlot(2n)]: 2n,
						[formatStorageSlot(5n)]: 1n,
					},
				},
			})
			await mockWindow.setBalance(securityPoolAddresses.securityPool, 2n)
			const victimBalanceBefore = await getETHBalance(client, victim.account.address)
			const poolBalanceBefore = await getETHBalance(client, securityPoolAddresses.securityPool)

			await assert.rejects(createCompleteSet(victim, securityPoolAddresses.securityPool, 1n), /Exchange rate undefined/)

			strictEqualTypeSafe(await getETHBalance(client, victim.account.address), victimBalanceBefore, 'a failed zero-output mint should refund all user ETH')
			strictEqualTypeSafe(await getETHBalance(client, securityPoolAddresses.securityPool), poolBalanceBefore, 'a failed zero-output mint should not increase the pool balance')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 2n, 'a failed zero-output mint should not change collateral accounting')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), 1n, 'a failed zero-output mint should not change share supply')
		})

		test('Open Interest Fees (non forking)', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			strictEqualTypeSafe(endTime > (await mockWindow.getTime()), true, 'question has already ended')
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			const aMonthFromNow = (await mockWindow.getTime()) + 2628000n
			strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max')
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			assert.ok((await getLastPrice(client, securityPoolAddresses.openOraclePriceCoordinator)) > 0n, 'Price was not set!')
			strictEqualTypeSafe(await getTotalUnderwritingLimitAttoEth(client, securityPoolAddresses.securityPool), securityPoolUnderwritingLimitAttoEth, 'capacity ownership')

			const openInterestAmount = 100n * 10n ** 18n
			await mockWindow.setTime(aMonthFromNow)
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			const retentionRate = await getCurrentRetentionRate(client, securityPoolAddresses.securityPool)

			await mockWindow.setTime(endTime + 10000n)

			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)
			const feesAccrued = await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)
			const ethBalanceAttoEthBefore = await getETHBalance(client, client.account.address)
			const securityVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			await redeemFees(client, securityPoolAddresses.securityPool, client.account.address)
			strictEqualTypeSafe(securityVault.underwritingLimitAttoEth, securityPoolUnderwritingLimitAttoEth, 'Capacity ownership')
			const ethBalanceAttoEthAfter = await getETHBalance(client, client.account.address)
			strictEqualTypeSafe(ethBalanceAttoEthAfter - ethBalanceAttoEthBefore, securityVault.claimableFeesAttoEth, 'eth gained should be fees accrued')
			strictEqualTypeSafe(feesAccrued / 1000n, securityVault.claimableFeesAttoEth / 1000n, 'eth gained should be fees accrued (minus rounding issues)')
			const settlementCollateralAttoEth = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(feesAccrued + settlementCollateralAttoEth, openInterestAmount, 'no eth lost')
			const timePassed = endTime - aMonthFromNow
			strictEqualTypeSafe(timePassed / 8640n, 3345n, 'not enough time passed')
			assert.ok(retentionRate > 0n && retentionRate < MAX_RETENTION_RATE, 'utilized dynamic capacity should produce a valid non-maximum retention rate')
			const settlementCollateralAttoEthPercentage = Number.parseInt(((settlementCollateralAttoEth * 1000n) / openInterestAmount).toString(), 10) / 10
			const expected = Number.parseInt(((1000n * rpow(retentionRate, timePassed, PRICE_PRECISION)) / PRICE_PRECISION).toString(), 10) / 10
			strictEqualTypeSafe(settlementCollateralAttoEthPercentage, expected, 'return amount did not match')
			const contractBalance = await getETHBalance(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(contractBalance + ethBalanceAttoEthAfter - ethBalanceAttoEthBefore, openInterestAmount, 'contract balance + fees should equal initial open interest')
		})

		test('fee accrual splits intervals at deposits, rejected committed-capacity withdrawals, and oracle-price transitions', async () => {
			const initialUnderwritingLimitAttoEth = 75n * 10n ** 18n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, initialUnderwritingLimitAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 30n * 10n ** 18n)
			await mockWindow.advanceTime(1n)
			await writeContractAndWait(client, () =>
				client.writeContract({
					address: securityPoolAddresses.securityPool,
					abi: statoblast_SecurityPool_SecurityPool.abi,
					functionName: 'updateSettlementCollateral',
				}),
			)

			const getPoolAccountingSnapshot = async () =>
				await client.readContract({
					address: securityPoolAddresses.securityPool,
					abi: statoblast_SecurityPool_SecurityPool.abi,
					functionName: 'getPoolAccountingSnapshot',
				})
			const expectedCollateralAfterCheckpoint = (snapshot: Awaited<ReturnType<typeof getPoolAccountingSnapshot>>, nextTimestamp: bigint) => {
				const timeDelta = nextTimestamp - snapshot.lastUpdatedFeeAccumulator
				if (timeDelta === 0n || snapshot.feeEligibleUnderwritingLimitAttoEth === 0n) return snapshot.settlementCollateralAttoEth
				const retainedCollateral = (snapshot.settlementCollateralAttoEth * rpow(snapshot.currentRetentionRate, timeDelta, PRICE_PRECISION)) / PRICE_PRECISION
				const scaledFeeDelta = (snapshot.settlementCollateralAttoEth - retainedCollateral) * PRICE_PRECISION + snapshot.feeIndexRemainder
				const feeIndexDelta = scaledFeeDelta / snapshot.feeEligibleUnderwritingLimitAttoEth
				const feesOwedDelta = feeIndexDelta * snapshot.feeEligibleUnderwritingLimitAttoEth + snapshot.totalFeesOwedRemainder
				return snapshot.settlementCollateralAttoEth - feesOwedDelta / PRICE_PRECISION
			}
			const beforeDeposit = await getPoolAccountingSnapshot()
			await mockWindow.advanceTime(100n)
			const receiverClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveToken(receiverClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRepToVault(receiverClient, securityPoolAddresses.securityPool, repDeposit * 10n, 40_000n)
			const afterDeposit = await getPoolAccountingSnapshot()
			assert.ok(beforeDeposit.feeIndexRemainder > 0n, 'capacity-transition carry reset regression requires pre-existing fee-index carry')
			strictEqualTypeSafe(afterDeposit.totalUnderwritingLimitAttoEth, beforeDeposit.totalUnderwritingLimitAttoEth, 'REP deposits preserve commitment weights and their fee denominator')
			strictEqualTypeSafe(afterDeposit.settlementCollateralAttoEth, expectedCollateralAfterCheckpoint(beforeDeposit, afterDeposit.lastUpdatedFeeAccumulator), 'deposit must checkpoint the preceding interval at the old retention rate')
			assert.ok(afterDeposit.currentRetentionRate >= beforeDeposit.currentRetentionRate, 'fee decay may reduce utilization while deposits leave commitments unchanged')

			await mockWindow.advanceTime(100n)
			await requestPriceIfNeededAndStageOperation(receiverClient, securityPoolAddresses.openOraclePriceCoordinator, OperationType.WithdrawRep, receiverClient.account.address, repDeposit)
			const afterWithdrawal = await getPoolAccountingSnapshot()
			strictEqualTypeSafe(afterWithdrawal.settlementCollateralAttoEth, expectedCollateralAfterCheckpoint(afterDeposit, afterWithdrawal.lastUpdatedFeeAccumulator), 'rejected withdrawal must still checkpoint the preceding interval at the deposit-adjusted rate')
			strictEqualTypeSafe(afterWithdrawal.totalUnderwritingLimitAttoEth, afterDeposit.totalUnderwritingLimitAttoEth, 'rejected withdrawal must preserve total capacity while settlement collateral remains')
			strictEqualTypeSafe(afterWithdrawal.feeEligibleUnderwritingLimitAttoEth, afterDeposit.feeEligibleUnderwritingLimitAttoEth, 'rejected withdrawal must preserve fee-eligible capacity while settlement collateral remains')
			assert.ok(afterWithdrawal.currentRetentionRate >= afterDeposit.currentRetentionRate, 'unchanged capacity must not make the fee rate more aggressive as collateral decays')

			await mockWindow.advanceTime(100n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, 2n * PRICE_PRECISION)
			const afterPriceChange = await getPoolAccountingSnapshot()
			strictEqualTypeSafe(afterPriceChange.settlementCollateralAttoEth, expectedCollateralAfterCheckpoint(afterWithdrawal, afterPriceChange.lastUpdatedFeeAccumulator), 'oracle settlement must checkpoint the preceding interval at the old-price rate')
			assert.ok(afterPriceChange.currentRetentionRate >= afterWithdrawal.currentRetentionRate, 'price changes do not reduce standing commitments or increase fee utilization')

			await mockWindow.advanceTime(100n)
			await writeContractAndWait(receiverClient, () =>
				receiverClient.writeContract({
					address: securityPoolAddresses.securityPool,
					abi: statoblast_SecurityPool_SecurityPool.abi,
					functionName: 'updateRetentionRate',
				}),
			)
			const afterPublicUpdate = await getPoolAccountingSnapshot()
			strictEqualTypeSafe(afterPublicUpdate.settlementCollateralAttoEth, expectedCollateralAfterCheckpoint(afterPriceChange, afterPublicUpdate.lastUpdatedFeeAccumulator), 'public retention updates must checkpoint elapsed fees before retaining or changing the rate')
		})

		// Mints 100 ETH of complete sets shortly before question end, then updates settlement collateral once per second 128 times.
		const mintCompleteSetAndRunSplitCollateralUpdates = async (extraSecondsBeforeEnd: bigint) => {
			const splitUpdateCount = 128n
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - splitUpdateCount - extraSecondsBeforeEnd)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 100n * 10n ** 18n)
			for (let index = 1n; index <= splitUpdateCount; index++) {
				await mockWindow.advanceTime(1n)
				await updateSettlementCollateral(client, securityPoolAddresses.securityPool)
			}
			return endTime
		}

		test('frequent public collateral updates do not strand extra fee residue', async () => {
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n + 1n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)

			const endTime = await mintCompleteSetAndRunSplitCollateralUpdates(10n)
			await mockWindow.setTime(endTime + 10000n)
			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)

			const splitVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const totalFeesOwed = await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)

			assert.ok(totalFeesOwed > 0n, 'repeated public collateral updates should accrue nonzero fees in this setup')
			strictEqualTypeSafe(totalFeesOwed, splitVault.claimableFeesAttoEth, 'pool fee accounting should only record fees that the vault index can actually credit')
			await redeemFees(client, securityPoolAddresses.securityPool, client.account.address)
			const contractBalance = await getETHBalance(client, securityPoolAddresses.securityPool)
			const remainingCollateral = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(contractBalance, remainingCollateral + (await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)), 'final fee settlement should leave every remaining attoETH in either collateral or redeemable fees')
		})

		test('frequent public collateral updates keep multi-vault fee accounting sweepable', async () => {
			const firstVaultUnderwritingLimitAttoEth = repDeposit / 8n + 1n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, firstVaultUnderwritingLimitAttoEth)

			const secondVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(secondVaultClient, repDeposit, questionId)
			const secondVaultUnderwritingLimitAttoEth = repDeposit / 8n + 3n
			await setVaultCapacityFixture(secondVaultClient, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, secondVaultClient.account.address, secondVaultUnderwritingLimitAttoEth)

			const endTime = await mintCompleteSetAndRunSplitCollateralUpdates(10n)
			await mockWindow.setTime(endTime + 10000n)

			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)
			await updateVaultFees(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)

			const firstVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const secondVault = await getSecurityVault(client, securityPoolAddresses.securityPool, secondVaultClient.account.address)
			const totalFeesOwed = await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)
			const totalCreditedFees = firstVault.claimableFeesAttoEth + secondVault.claimableFeesAttoEth

			assert.ok(totalCreditedFees > 0n, 'repeated public collateral updates should accrue nonzero fees across both vaults in this setup')
			strictEqualTypeSafe(totalFeesOwed, totalCreditedFees, 'pool fee accounting should equal the sum of vault-creditable fees after both vaults sync')

			await redeemFees(client, securityPoolAddresses.securityPool, client.account.address)
			await redeemFees(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)

			strictEqualTypeSafe(await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool), 0n, 'pool fee accounting should fully clear once every credited vault fee is redeemed')
		})

		test('a checkpoint after every vault syncs returns aggregate-only fee dust to collateral', async () => {
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, 1n * 10n ** 18n)
			const secondVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(secondVaultClient, repDeposit, questionId)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 10n)
			await triggerExternalForkForSecurityPool(undefined, 'aggregate-only fee dust source')

			const firstVaultSlot = getAddressMappingStorageSlot(client.account.address, 16n)
			const secondVaultSlot = getAddressMappingStorageSlot(secondVaultClient.account.address, 16n)
			await mockWindow.addStateOverrides({
				[securityPoolAddresses.securityPool]: {
					stateDiff: {
						[formatStorageSlot(6n)]: 0n,
						[formatStorageSlot(8n)]: PRICE_PRECISION / 2n,
						[formatStorageSlot(11n)]: 1n,
						[formatStorageSlot(12n)]: 2n,
						[formatStorageSlot(13n)]: 2n,
						[formatStorageSlot(firstVaultSlot + 1n)]: 1n,
						[formatStorageSlot(firstVaultSlot + 2n)]: 0n,
						[formatStorageSlot(firstVaultSlot + 3n)]: 0n,
						[formatStorageSlot(secondVaultSlot + 1n)]: 1n,
						[formatStorageSlot(secondVaultSlot + 2n)]: 0n,
						[formatStorageSlot(secondVaultSlot + 3n)]: 0n,
					},
				},
			})

			const collateralBeforeCheckpoints = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getTotalAccruedFees(client, securityPoolAddresses.securityPool), 1n, 'test setup should create one aggregate reserve attoETH while each vault remains below one attoETH')
			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)
			strictEqualTypeSafe(await getTotalAccruedFees(client, securityPoolAddresses.securityPool), 1n, 'aggregate-only reserve must remain protected until every eligible vault checkpoints')
			await updateVaultFees(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)

			strictEqualTypeSafe(await getTotalAccruedFees(client, securityPoolAddresses.securityPool), 1n, 'the final ownership reconciliation should preserve reserve accounting until a later checkpoint')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), collateralBeforeCheckpoints, 'the final ownership reconciliation should not classify reserve dust based on which vault ran last')
			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)
			strictEqualTypeSafe(await getTotalAccruedFees(client, securityPoolAddresses.securityPool), 0n, 'a later checkpoint should clear reserve attoETH that no vault can individually claim')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), collateralBeforeCheckpoints + 1n, 'non-claimable final reserve should return to parent collateral')
		})

		test('public vault fee checkpoints keep aggregate fees equal to vault-claimable fees', async () => {
			const vaultClients = [client, createWriteClient(mockWindow, TEST_ADDRESSES[1])]
			const underwritingLimitAttoEthPerVault = (3n * 10n ** 18n) / 2n
			for (const vaultClient of vaultClients) {
				if (vaultClient.account.address !== client.account.address) {
					await approveAndDepositRepToVault(vaultClient, repDeposit, questionId)
				}
				await setVaultCapacityFixture(vaultClient, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, vaultClient.account.address, underwritingLimitAttoEthPerVault)
			}

			strictEqualTypeSafe(await getTotalUnderwritingLimitAttoEth(client, securityPoolAddresses.securityPool), BigInt(vaultClients.length) * underwritingLimitAttoEthPerVault, 'capacity ownership')

			const openInterestAmount = 1n * 10n ** 9n
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - 10n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)

			await mockWindow.advanceTime(1n)
			for (const vaultClient of vaultClients) {
				await updateVaultFees(client, securityPoolAddresses.securityPool, vaultClient.account.address)
			}

			const totalFeesOwed = await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)
			const vaults = await Promise.all(vaultClients.map(async vaultClient => await getSecurityVault(client, securityPoolAddresses.securityPool, vaultClient.account.address)))
			const totalCreditedVaultFees = vaults.reduce((sum, vault) => sum + vault.claimableFeesAttoEth, 0n)

			assert.ok(totalFeesOwed > 0n, 'the accrual step should produce a positive aggregate fee liability in this setup')
			assert.ok(totalCreditedVaultFees > 0n, 'fractional minimum-sized vaults should still receive some whole-attoETH fees in this setup')
			strictEqualTypeSafe(totalFeesOwed, totalCreditedVaultFees, 'capacity ownerships')
		})

		// Starts a backed second vault without capacity while 128 one-second collateral updates accrue fees to the first vault.
		const setupIdleSecondVaultAfterCollateralUpdates = async (secondsBeforeSplitUpdates: bigint) => {
			const firstVaultUnderwritingLimitAttoEth = repDeposit / 4n + 1n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, firstVaultUnderwritingLimitAttoEth)
			const secondVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(secondVaultClient, repDeposit, questionId)
			// This accounting scenario starts with a backed vault whose capacity has been removed.
			await setVaultCapacityFixture(secondVaultClient, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, secondVaultClient.account.address, 0n)

			await mintCompleteSetAndRunSplitCollateralUpdates(secondsBeforeSplitUpdates)
			return secondVaultClient
		}

		const assertNewOwnerEarnsOnlyNextAccrual = async (secondVaultClient: StatoblastForkMigrationFixture['client']) => {
			const secondVaultUnderwritingLimitAttoEth = repDeposit / 4n + 3n
			await setVaultCapacityFixture(secondVaultClient, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, secondVaultClient.account.address, secondVaultUnderwritingLimitAttoEth)

			const collateralBeforeSecondAccrual = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const retentionRate = await getCurrentRetentionRate(client, securityPoolAddresses.securityPool)
			const expectedNextSecondDelta = collateralBeforeSecondAccrual - (collateralBeforeSecondAccrual * rpow(retentionRate, 1n, PRICE_PRECISION)) / PRICE_PRECISION

			await mockWindow.advanceTime(1n)
			await updateVaultFees(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)

			const secondVault = await getSecurityVault(secondVaultClient, securityPoolAddresses.securityPool, secondVaultClient.account.address)
			assert.ok(secondVault.claimableFeesAttoEth <= expectedNextSecondDelta, 'capacity ownership')
		}

		test('a newly eligible vault cannot claim settlement collateral accrued before it joined', async () => {
			const secondVaultClient = await setupIdleSecondVaultAfterCollateralUpdates(20n)

			await assertNewOwnerEarnsOnlyNextAccrual(secondVaultClient)
		})

		test('settlement collateral pauses without eligible capacity and resumes for a new owner', async () => {
			const secondVaultClient = await setupIdleSecondVaultAfterCollateralUpdates(40n)

			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, 0n)
			const collateralAtZeroUnderwritingLimitAttoEth = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)

			await mockWindow.advanceTime(30n)
			await updateSettlementCollateral(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), collateralAtZeroUnderwritingLimitAttoEth, 'collateral should not decay while no vault backs the pool')

			await assertNewOwnerEarnsOnlyNextAccrual(secondVaultClient)
		})

		test('redeemCompleteSet exits at the fee-adjusted share exchange rate', async () => {
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)

			const firstHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const secondHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			await createCompleteSet(firstHolder, securityPoolAddresses.securityPool, 4n * 10n ** 18n)
			await createCompleteSet(secondHolder, securityPoolAddresses.securityPool, 6n * 10n ** 18n)

			await mockWindow.advanceTime(30n * DAY)
			await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)

			const firstHolderShares = await balanceOfShares(firstHolder, securityPoolAddresses.shareToken, genesisUniverse, firstHolder.account.address)
			const secondHolderShares = await balanceOfShares(secondHolder, securityPoolAddresses.shareToken, genesisUniverse, secondHolder.account.address)
			const redeemAmount = ensureDefined(firstHolderShares[0], 'first holder complete-set shares missing') / 2n
			const initialCollateral = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const initialShareSupply = await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool)
			const initialAccruedFees = await getTotalAccruedFees(client, securityPoolAddresses.securityPool)
			assert.ok(initialAccruedFees > 0n, 'test setup should accrue open-interest fees before redemption')

			const balanceBeforeRedeem = await getETHBalance(client, firstHolder.account.address)
			await redeemCompleteSet(firstHolder, securityPoolAddresses.securityPool, redeemAmount)

			const collateralAfterRedeem = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const feesAfterRedeem = await getTotalAccruedFees(client, securityPoolAddresses.securityPool)
			const firstHolderPayout = (await getETHBalance(client, firstHolder.account.address)) - balanceBeforeRedeem
			const feeDelta = feesAfterRedeem - initialAccruedFees
			const firstHolderSharesAfterRedeem = await balanceOfShares(firstHolder, securityPoolAddresses.shareToken, genesisUniverse, firstHolder.account.address)
			const secondHolderSharesAfterRedeem = await balanceOfShares(secondHolder, securityPoolAddresses.shareToken, genesisUniverse, secondHolder.account.address)
			const shareSupplyAfterRedeem = await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool)
			const feeDustTolerance = securityPoolUnderwritingLimitAttoEth / PRICE_PRECISION

			assert.ok(firstHolderPayout > 0n, 'redeeming complete sets should pay ETH to the holder')
			approximatelyEqual(collateralAfterRedeem + firstHolderPayout + feeDelta, initialCollateral, feeDustTolerance, 'complete-set redemption should conserve collateral after fee accrual up to bounded fee dust')
			strictEqualTypeSafe(shareSupplyAfterRedeem, initialShareSupply - redeemAmount, 'complete-set redemption should reduce share supply by the burned set amount')
			strictEqualTypeSafe(firstHolderSharesAfterRedeem[0], firstHolderShares[0] - redeemAmount, 'redeeming should burn the holders invalid-side share')
			strictEqualTypeSafe(firstHolderSharesAfterRedeem[1], firstHolderShares[1] - redeemAmount, 'redeeming should burn the holders yes-side share')
			strictEqualTypeSafe(firstHolderSharesAfterRedeem[2], firstHolderShares[2] - redeemAmount, 'redeeming should burn the holders no-side share')
			strictEqualTypeSafe(secondHolderSharesAfterRedeem[0], secondHolderShares[0], 'redeeming should not burn another holders invalid-side share')
			strictEqualTypeSafe(secondHolderSharesAfterRedeem[1], secondHolderShares[1], 'redeeming should not burn another holders yes-side share')
			strictEqualTypeSafe(secondHolderSharesAfterRedeem[2], secondHolderShares[2], 'redeeming should not burn another holders no-side share')
			strictEqualTypeSafe(await attoSharesToAttoEth(client, securityPoolAddresses.securityPool, shareSupplyAfterRedeem), collateralAfterRedeem, 'remaining complete sets should keep the fee-adjusted exchange rate')
		})

		test('can set capacity ownership, mint complete sets and fork happily', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, forkThresholdAttoRep * 2n)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max')
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			assert.ok((await getLastPrice(client, securityPoolAddresses.openOraclePriceCoordinator)) > 0n, 'Price was not set!')
			strictEqualTypeSafe(await getTotalUnderwritingLimitAttoEth(client, securityPoolAddresses.securityPool), securityPoolUnderwritingLimitAttoEth, 'capacity ownership')

			const openInterestAmount = 100n * 10n ** 18n
			const maxGasFees = openInterestAmount / 4n
			const ethBalanceAttoEth = await getETHBalance(client, client.account.address)
			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			assert.ok((await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)) > 0n, 'contract did not record collateral after minting complete sets')
			const completeSetBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, client.account.address)
			strictEqualTypeSafe(completeSetBalances[0], completeSetBalances[1], 'yes no and invalid share counts need to match')
			strictEqualTypeSafe(completeSetBalances[1], completeSetBalances[2], 'yes no and invalid share counts need to match')
			strictEqualTypeSafe(await attoSharesToAttoEth(client, securityPoolAddresses.securityPool, completeSetBalances[0]), openInterestAmount, 'Did not create enough complete sets')
			assert.ok(ethBalanceAttoEth - (await getETHBalance(client, client.account.address)) > maxGasFees, 'Did not lose eth to create complete sets')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), openInterestAmount, 'contract did not record the amount correctly')
			await redeemCompleteSet(client, securityPoolAddresses.securityPool, completeSetBalances[0])
			assert.ok(ethBalanceAttoEth - (await getETHBalance(client, client.account.address)) < maxGasFees, 'Did not get ETH back from complete sets')
			const newCompleteSetBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, client.account.address)
			strictEqualTypeSafe(newCompleteSetBalances[0], 0n, 'Did not lose complete sets')
			strictEqualTypeSafe(newCompleteSetBalances[1], 0n, 'Did not lose complete sets')
			strictEqualTypeSafe(newCompleteSetBalances[2], 0n, 'Did not lose complete sets')
			strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max after zero complete sets')

			await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
			const settlementCollateralAtForkAttoEth = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const repBalanceAttoRep = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)

			// forking
			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			assert.ok(forkData.auctionableAttoRepAtFork > 0n, 'rep at fork should stay positive after the own-game fork')
			assert.ok(forkData.auctionableAttoRepAtFork <= repBalanceAttoRep + forkThresholdAttoRep * 2n, 'rep at fork should stay bounded by the REP that actually participated in the own-game fork')
			strictEqualTypeSafe(forkData.migratedAttoRep, 0n, 'migrated rep should be 0 so far')
			strictEqualTypeSafe(forkData.outcomeIndex, 0n, 'there should be no outcome')
			strictEqualTypeSafe(forkData.ownFork, true, 'should be own fork')
			const totalClaimableVaultFeesAttoEthRightAfterFork = await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'Parent is forked')
			strictEqualTypeSafe(0n, await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool), "Parent's original rep is gone")
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
			const { yesSecurityPool } = getYesChildPool()

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'Fork Migration need to start')
			const migratedAttoRep = await getMigratedAttoRep(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(migratedAttoRep, 0n, 'escalation-only wallet claims should not count as migrated child-pool REP')
			assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'Did not create YES security pool')
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			const yesStateAfterStart = await getSystemState(client, yesSecurityPool.securityPool)
			let externalAuctionCollateral = 0n
			if (yesStateAfterStart === SystemState.ForkTruthAuction) {
				const yesAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2])
				const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
				const yesEthRaiseCap = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
				externalAuctionCollateral = yesEthRaiseCap
				await participateAuction(yesAuctionParticipant, yesSecurityPool.truthAuction, repAtFork / 2n, yesEthRaiseCap)
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			} else {
				strictEqualTypeSafe(yesStateAfterStart, SystemState.Operational, 'yes child should either enter the truth auction or finalize immediately when no child collateral remains to buy')
				strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
			}
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'yes System should become operational after the truth auction finalizes')

			const totalCollateral = (await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)) + (await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool))
			assert.ok(totalCollateral <= settlementCollateralAtForkAttoEth + externalAuctionCollateral, 'forked collateral should stay bounded by parent collateral at fork plus externally funded truth-auction ETH')

			const totalClaimableVaultFeesAttoEthAfterFork = await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)
			assert.ok(totalClaimableVaultFeesAttoEthAfterFork >= totalClaimableVaultFeesAttoEthRightAfterFork, 'parent fee accounting should remain readable after the fork path settles child state')
		})

		test('redeemShares updates security-pool accounting as winning shares are redeemed', async () => {
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)

			const firstHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const secondHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			await createCompleteSet(firstHolder, securityPoolAddresses.securityPool, 4n * 10n ** 18n)
			await createCompleteSet(secondHolder, securityPoolAddresses.securityPool, 6n * 10n ** 18n)

			const firstHolderShares = await balanceOfShares(firstHolder, securityPoolAddresses.shareToken, genesisUniverse, firstHolder.account.address)
			const secondHolderShares = await balanceOfShares(secondHolder, securityPoolAddresses.shareToken, genesisUniverse, secondHolder.account.address)
			const firstWinningShares = ensureDefined(firstHolderShares[1], 'first holder winning shares missing')
			const secondWinningShares = ensureDefined(secondHolderShares[1], 'second holder winning shares missing')
			const initialCollateral = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const initialShareSupply = await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool)
			const initialAccruedFees = await getTotalAccruedFees(client, securityPoolAddresses.securityPool)
			assert.ok(initialCollateral > 0n, 'collateral should be positive before finalization')
			strictEqualTypeSafe(initialShareSupply, firstWinningShares + secondWinningShares, 'share supply should equal the minted winning-share balances')

			await finalizeQuestionAsYesWithoutFork()
			const firstHolderBalanceBeforeRedemption = await getETHBalance(client, firstHolder.account.address)
			await redeemShares(firstHolder, securityPoolAddresses.securityPool)

			const collateralAfterFirstRedemption = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const feesAfterFirstRedemption = await getTotalAccruedFees(client, securityPoolAddresses.securityPool)
			const firstHolderPayout = (await getETHBalance(client, firstHolder.account.address)) - firstHolderBalanceBeforeRedemption
			const feeDelta = feesAfterFirstRedemption - initialAccruedFees
			const feeDustTolerance = securityPoolUnderwritingLimitAttoEth / PRICE_PRECISION

			assert.ok(feeDelta > 0n, 'first redemption should accrue open-interest fees')
			approximatelyEqual(collateralAfterFirstRedemption + firstHolderPayout + feeDelta, initialCollateral, feeDustTolerance, 'collateral should shrink by fees and first winning redemption up to bounded fee dust')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), initialShareSupply - firstWinningShares, 'share supply should shrink after first winning redemption')
			approximatelyEqual(await attoSharesToAttoEth(client, securityPoolAddresses.securityPool, secondWinningShares), collateralAfterFirstRedemption, 10n, 'remaining winning shares should not be double counted')

			await redeemShares(secondHolder, securityPoolAddresses.securityPool)

			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 0n, 'collateral should be empty after all winning shares are redeemed')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), 0n, 'share supply should be empty after all winning shares are redeemed')
		})

		test('redeemShares reserves collateral for winning shares that migrate after child redemption begins', async () => {
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - 1n)

			const firstHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const secondHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			await createCompleteSet(firstHolder, securityPoolAddresses.securityPool, 4n * 10n ** 18n)
			await createCompleteSet(secondHolder, securityPoolAddresses.securityPool, 6n * 10n ** 18n)
			const secondHolderParentShares = await balanceOfShares(secondHolder, securityPoolAddresses.shareToken, genesisUniverse, secondHolder.account.address)
			const secondWinningShares = ensureDefined(secondHolderParentShares[1], 'second holder parent winning shares missing')
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateShares(firstHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])

			const { yesUniverse, yesSecurityPool } = getYesChildPool()

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			}

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should become operational after migration accounting settles')
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'own-fork yes child should resolve as yes')

			const childCollateralBeforeRedemption = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const childShareSupplyBeforeRedemption = await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool)
			const firstHolderChildShares = await balanceOfShares(firstHolder, yesSecurityPool.shareToken, yesUniverse, firstHolder.account.address)
			const firstHolderWinningShares = ensureDefined(firstHolderChildShares[1], 'migrated yes child winning shares missing')
			const secondHolderChildShares = await balanceOfShares(secondHolder, yesSecurityPool.shareToken, yesUniverse, secondHolder.account.address)

			assert.ok(childCollateralBeforeRedemption > 0n, `child branch should hold collateral before redemption: ${childCollateralBeforeRedemption}`)
			strictEqualTypeSafe(childShareSupplyBeforeRedemption, firstHolderWinningShares + secondWinningShares, 'child pricing supply should reserve every fork-time parent claim')
			strictEqualTypeSafe(ensureDefined(secondHolderChildShares[1], 'second holder yes child winning shares missing'), 0n, 'second holder should not have migrated winning shares into the child')

			const firstHolderBalanceBeforeRedemption = await getETHBalance(client, firstHolder.account.address)
			const childFeesBeforeRedemption = await getTotalAccruedFees(client, yesSecurityPool.securityPool)
			await redeemShares(firstHolder, yesSecurityPool.securityPool)
			const firstHolderPayout = (await getETHBalance(client, firstHolder.account.address)) - firstHolderBalanceBeforeRedemption
			const childFeesAfterRedemption = await getTotalAccruedFees(client, yesSecurityPool.securityPool)
			const redemptionFeeDelta = childFeesAfterRedemption - childFeesBeforeRedemption

			const collateralAfterCurrentFees = childCollateralBeforeRedemption - redemptionFeeDelta
			const expectedFirstHolderPayout = (collateralAfterCurrentFees * firstHolderWinningShares) / (firstHolderWinningShares + secondWinningShares)
			strictEqualTypeSafe(firstHolderPayout, expectedFirstHolderPayout, 'the early migrant should receive only its fork-time share of child collateral')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), collateralAfterCurrentFees - expectedFirstHolderPayout, 'late winning claims should retain their collateral reserve after current fees')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool), secondWinningShares, 'redemption should consume economic claims instead of replacing them with materialized supply')

			await migrateShares(secondHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])
			const lateMigratedShares = await balanceOfShares(secondHolder, yesSecurityPool.shareToken, yesUniverse, secondHolder.account.address)
			strictEqualTypeSafe(ensureDefined(lateMigratedShares[1], 'late migrated winning shares missing'), secondWinningShares, 'source winning shares should remain migratable after child activation and redemption')
			await redeemShares(secondHolder, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), 0n, 'late winning redemption should consume the remaining child collateral')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool), 0n, 'all fork-time economic claims should be consumed after both holders redeem')
		})

		test('redeemShares accrues open-interest fees before paying winning shares', async () => {
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			const openInterestAmount = 10n * 10n ** 18n
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
			const balanceBefore = await getETHBalance(client, openInterestHolder.account.address)

			await finalizeQuestionAsYesWithoutFork()
			await redeemShares(openInterestHolder, securityPoolAddresses.securityPool)

			const balanceAfter = await getETHBalance(client, openInterestHolder.account.address)
			const accruedFees = await getTotalAccruedFees(client, securityPoolAddresses.securityPool)
			const payout = balanceAfter - balanceBefore

			assert.ok(accruedFees > 0n, 'redeemShares should accrue fees before paying winning shares')
			assert.ok(payout < openInterestAmount, 'winner payout should be net of accrued fees')
			approximatelyEqual(payout + accruedFees, openInterestAmount, 1000n, 'payout plus fees should conserve open interest')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 0n, 'all collateral should be consumed after sole winning redemption')
		})

		test('attoSharesToAttoEth returns zero for stale non-winning shares after all winning shares are redeemed', async () => {
			const completeSetAmountAttoShares = 1n * 10n ** 18n
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, completeSetAmountAttoShares)
			await finalizeQuestionAsYesWithoutFork()
			const shareBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, openInterestHolder.account.address)
			const winningSharesAttoShares = ensureDefined(shareBalances[1], 'winning shares should exist before redemption')
			const winningShareSettlementCollateralAttoEth = await attoSharesToAttoEth(client, securityPoolAddresses.securityPool, winningSharesAttoShares)

			assert.ok(winningShareSettlementCollateralAttoEth > 0n, 'winning shares should map to positive settlement collateral before redemption')
			await redeemShares(openInterestHolder, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 0n, 'winning redemption should consume the remaining collateral')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), 0n, 'winning redemption should consume the remaining share supply')
			strictEqualTypeSafe(await attoSharesToAttoEth(client, securityPoolAddresses.securityPool, winningSharesAttoShares), 0n, 'once winning supply is exhausted, leftover losing shares should no longer map to any settlement collateral')

			await redeemShares(openInterestHolder, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 0n, 'repeat winning redemption should remain a no-op once collateral is exhausted')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), 0n, 'repeat winning redemption should preserve zero resolved share supply')
		})

		test.each([{ checkpointBeforeFork: false }, { checkpointBeforeFork: true }])('redeemShares and redeemRepFromVault stay available after an unrelated late fork once the question has finalized (checkpoint before fork: $checkpointBeforeFork)', async ({ checkpointBeforeFork }) => {
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 5n * 10n ** 18n)
			await finalizeQuestionAsYesWithoutFork()

			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			const finalizedFeeEnd = await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddresses.securityPool, functionName: 'getFeeEpochEndTime' })
			if (checkpointBeforeFork) await updateSettlementCollateral(client, securityPoolAddresses.securityPool)
			const checkpointedAccounting = checkpointBeforeFork
				? {
						collateral: await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool),
						fees: await getTotalAccruedFees(client, securityPoolAddresses.securityPool),
					}
				: undefined
			await mockWindow.advanceTime(30n * DAY)
			const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
			const repTotalSupplySlot = formatStorageSlot(REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT)
			await mockWindow.addStateOverrides({
				[repToken]: {
					stateDiff: {
						[repTotalSupplySlot]: repDeposit * 10n,
					},
				},
			})

			const lateForkQuestionData = {
				...questionData,
				title: 'late unrelated fork',
				endTime: await mockWindow.getTime(),
			}
			const lateForkQuestionId = getQuestionId(lateForkQuestionData, outcomes)
			await createQuestion(attackerClient, lateForkQuestionData, outcomes)
			await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(attackerClient, genesisUniverse, lateForkQuestionId)
			strictEqualTypeSafe(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddresses.securityPool, functionName: 'getFeeEpochEndTime' }), finalizedFeeEnd, 'a late unrelated fork must preserve the finalized fee cutoff with or without a checkpoint')
			await updateSettlementCollateral(client, securityPoolAddresses.securityPool)
			const finalizedCollateral = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const finalizedFees = await getTotalAccruedFees(client, securityPoolAddresses.securityPool)
			if (checkpointedAccounting !== undefined) {
				strictEqualTypeSafe(finalizedCollateral, checkpointedAccounting.collateral, 'a late unrelated fork must preserve collateral checkpointed before the fork')
				strictEqualTypeSafe(finalizedFees, checkpointedAccounting.fees, 'a late unrelated fork must preserve fees checkpointed before the fork')
			}

			strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.Yes, 'late unrelated fork should not erase finalized market outcome')
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.Operational, 'late unrelated Zoltar fork should not initiate this security pool fork')
			const sourceBalancesBeforeRejectedMigration = await balanceOfShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, openInterestHolder.account.address)
			const assertFinalizedMarketMigrationRejected = async (boundary: string, rejection: RegExp) => {
				for (const sourceOutcome of [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]) {
					await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, sourceOutcome, [QuestionOutcome.Yes]), rejection, `${boundary}: finalized source outcome ${sourceOutcome.toString()} must not migrate`)
				}
				await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]), rejection, `${boundary}: finalized winning shares must not split across child outcomes`)
				assert.deepStrictEqual(await balanceOfShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, openInterestHolder.account.address), sourceBalancesBeforeRejectedMigration, `${boundary}: rejected migration must preserve every funded source outcome balance`)
			}

			await assertFinalizedMarketMigrationRejected('immediately after the unrelated fork', /Resolved/)
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			const migrationDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes]), /Resolved/, 'at the migration deadline: funded finalized winning shares must not migrate')
			assert.deepStrictEqual(await balanceOfShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, openInterestHolder.account.address), sourceBalancesBeforeRejectedMigration, 'at the migration deadline: rejected migration must preserve every funded source outcome balance')
			await mockWindow.setTime(migrationDeadline)
			await assertFinalizedMarketMigrationRejected('after the universe-level migration period', /Resolved/)
			const walletRepBeforeClaims = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
			const holderEthBeforeRedemption = await getETHBalance(client, openInterestHolder.account.address)
			await redeemShares(openInterestHolder, securityPoolAddresses.securityPool)
			strictEqualTypeSafe((await getETHBalance(client, openInterestHolder.account.address)) - holderEthBeforeRedemption, finalizedCollateral, 'a late unrelated fork must not reduce the finalized winning payout')
			strictEqualTypeSafe(await getTotalAccruedFees(client, securityPoolAddresses.securityPool), finalizedFees, 'a late unrelated fork must not reopen the finalized fee epoch')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), 0n, 'winning redemption should still complete after the unrelated fork')

			await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
			const walletRepAfterEscrowSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
			await setUnderwritingLimit(client, securityPoolAddresses.securityPool, 0n)
			await redeemRepFromVault(client, securityPoolAddresses.securityPool, client.account.address)
			const vaultAfterRedeem = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const walletRepAfterRedeem = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

			strictEqualTypeSafe(vaultAfterRedeem.repBackingUnits, 0n, 'rep redemption should still empty the vault after the unrelated fork')
			strictEqualTypeSafe(vaultAfterRedeem.disputeStakedAttoRep, 0n, 'rep redemption should leave no escrowed REP after the unrelated fork')
			strictEqualTypeSafe(walletRepAfterEscrowSettlement - walletRepBeforeClaims, reportBond, 'escrow settlement should return dispute-staked REP after the unrelated fork')
			strictEqualTypeSafe(walletRepAfterRedeem - walletRepAfterEscrowSettlement, repDeposit - reportBond, 'rep redemption should return vault-held REP after the unrelated fork')
		})
	})
})
