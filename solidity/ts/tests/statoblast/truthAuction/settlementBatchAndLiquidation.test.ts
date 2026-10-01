import { statoblast_SecurityPoolForker_SecurityPoolForker, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_SecurityPool_SecurityPool } from '../../../types/contractArtifact'
import { formatStorageSlot, getAddressMappingStorageSlot } from '../../../testSupport/storage'
import { createCompleteSet, getSettlementCollateralAttoEth, getRepToken, getSecurityVault, getSystemState, getTotalAccruedFees, getTotalClaimableVaultFeesAttoEth, getTotalUnderwritingLimitAttoEth, backingUnitsToAttoRep, updateVaultFees } from '../../../testSupport/simulator/utils/contracts/securityPool'
import { isIgnorableLogDecodeError } from '../../logDecodeErrors'
import { getTotalRepPurchasedAttoRep, getEthRaiseCapAttoEth } from '../../../testSupport/simulator/utils/contracts/auction'
import { claimAuctionProceeds, finalizeTruthAuction, getSecurityPoolForkerForkData, migrateRepToZoltar, migrateVault, settleAuctionBids, startTruthAuction } from '../../../testSupport/simulator/utils/contracts/securityPoolForker'
import { SystemState } from '../../../testSupport/simulator/types/statoblastTypes'
import { QuestionOutcome } from '../../../testSupport/simulator/types/types'
import { tickToPrice } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'
import { getQuestionEndDate, participateAuction, queueLiquidationAtForcedPrice } from '../../../testSupport/simulator/utils/contracts/statoblast'
import { getInfraContractAddresses } from '../../../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveAndDepositRepToVault, handleOracleReporting, setVaultCapacityFixture } from '../../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { addressString } from '../../../testSupport/simulator/utils/bigint'
import { approveToken, getETHBalance } from '../../../testSupport/simulator/utils/utilities'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../../testSupport/simulator/utils/constants'
import { createWriteClient } from '../../../testSupport/simulator/utils/clients'
import { decodeEventLog } from '@zoltar/core-shared/evm/ethereum'
import { approximatelyEqual, strictEqualTypeSafe } from '../../../testSupport/simulator/utils/testUtils'
import assert from '../../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { useStatoblastTruthAuctionFixture, type StatoblastTruthAuctionFixture } from '../fixture'
import { getFeeEpochEndTimeStorageSlot, getPendingAuctionRefund, withdrawPendingAuctionRefund } from './helpers'

describe('Statoblast: truth auction', () => {
	const fixture = useStatoblastTruthAuctionFixture()
	const feeEpochEndTimeStorageSlot = getFeeEpochEndTimeStorageSlot()

	const { PRICE_PRECISION, repDeposit, statoblastSecurityMultiplierBps, triggerExternalForkForSecurityPool, setupStartedTruthAuction, setupTruthAuctionWithMixedBids, setupFinalizedTruthAuctionWithMixedBids, getYesChildPool } = fixture

	let mockWindow: StatoblastTruthAuctionFixture['mockWindow']

	let client: StatoblastTruthAuctionFixture['client']

	let securityPoolAddresses: StatoblastTruthAuctionFixture['securityPoolAddresses']

	let questionId: StatoblastTruthAuctionFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionId = fixture.questionId
	})

	describe('auction bidding and claim settlement', () => {
		test('settleAuctionBids can refund a losing bid before truth auction finalization', async () => {
			const { yesSecurityPool, losingBidder, losingEth, losingTick } = await setupTruthAuctionWithMixedBids(false)
			const thirdParty = createWriteClient(mockWindow, TEST_ADDRESSES[5])
			const thirdPartyBalanceBeforeSettlement = await getETHBalance(client, thirdParty.account.address)
			const losingBidderBalanceBeforeSettlement = await getETHBalance(client, losingBidder.account.address)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'setup should leave the child pool in an active truth auction')
			await settleAuctionBids(thirdParty, yesSecurityPool.securityPool, losingBidder.account.address, [], [{ tick: losingTick, bidIndex: 0n }])
			strictEqualTypeSafe(await getPendingAuctionRefund(client, yesSecurityPool.truthAuction, losingBidder.account.address), losingEth, 'pre-finalization settlement should credit the bidder')
			await withdrawPendingAuctionRefund(losingBidder, yesSecurityPool.truthAuction)

			const thirdPartyBalanceAfterSettlement = await getETHBalance(client, thirdParty.account.address)
			const losingBidderBalanceAfterSettlement = await getETHBalance(client, losingBidder.account.address)

			strictEqualTypeSafe(losingBidderBalanceAfterSettlement - losingBidderBalanceBeforeSettlement, losingEth, 'pre-finalization settlement should refund losing-bid ETH to the bidder')
			strictEqualTypeSafe(thirdPartyBalanceAfterSettlement, thirdPartyBalanceBeforeSettlement, 'pre-finalization settlement should not redirect refunded ETH to the caller')
		})

		test('settleAuctionBids can settle mixed finalized winning and losing bids for the same bidder in one call', async () => {
			const { yesSecurityPool, expectedEthToBuy, repAtFork } = await setupStartedTruthAuction('mixed claim and refund settlement source')
			const mixedBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const competingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			const losingEth = expectedEthToBuy / 10n
			const competingWinningEth = expectedEthToBuy / 100n
			const winningAttoEth = expectedEthToBuy - competingWinningEth
			strictEqualTypeSafe(losingEth > 0n, true, 'mixed settlement losing bid should invest a positive amount')
			strictEqualTypeSafe(winningAttoEth > 0n, true, 'mixed settlement winning bid should invest a positive amount')
			strictEqualTypeSafe(competingWinningEth > 0n, true, 'mixed settlement competing bid should invest a positive amount')

			const losingTick = await participateAuction(mixedBidder, yesSecurityPool.truthAuction, repAtFork, losingEth)
			const winningTick = await participateAuction(mixedBidder, yesSecurityPool.truthAuction, repAtFork / 4n, winningAttoEth)
			await participateAuction(competingBidder, yesSecurityPool.truthAuction, repAtFork / 400n, competingWinningEth)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			const mixedBidderBalanceBeforeSettlement = await getETHBalance(client, mixedBidder.account.address)
			const mixedVaultBeforeSettlement = await getSecurityVault(client, yesSecurityPool.securityPool, mixedBidder.account.address)
			const expectedWinningRep = (winningAttoEth * PRICE_PRECISION) / tickToPrice(winningTick)

			await settleAuctionBids(client, yesSecurityPool.securityPool, mixedBidder.account.address, [{ tick: winningTick, bidIndex: 0n }], [{ tick: losingTick, bidIndex: 0n }])
			strictEqualTypeSafe(await getPendingAuctionRefund(client, yesSecurityPool.truthAuction, mixedBidder.account.address), losingEth, 'mixed settlement should credit the losing bid refund')
			await withdrawPendingAuctionRefund(mixedBidder, yesSecurityPool.truthAuction)

			const mixedBidderBalanceAfterSettlement = await getETHBalance(client, mixedBidder.account.address)
			const mixedVaultAfterSettlement = await getSecurityVault(client, yesSecurityPool.securityPool, mixedBidder.account.address)
			const settledWinningRep = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, mixedVaultAfterSettlement.repBackingUnits)

			strictEqualTypeSafe(mixedBidderBalanceAfterSettlement - mixedBidderBalanceBeforeSettlement, losingEth, 'mixed finalized settlement should return the losing-bid ETH in the same call')
			approximatelyEqual(settledWinningRep, expectedWinningRep, 1_000n, 'mixed finalized settlement should still mint the expected winning REP')
			assert.ok(mixedVaultAfterSettlement.repBackingUnits > mixedVaultBeforeSettlement.repBackingUnits, 'mixed finalized settlement should increase REP backing units for the winning bid')
		})

		test('claimAuctionProceeds preserves winner accounting when a finalized losing refund is settled first', async () => {
			const { yesSecurityPool, expectedEthToBuy, losingBidder, losingTick, winningBidder, winningTick } = await setupFinalizedTruthAuctionWithMixedBids()
			const forkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, winningBidder.account.address, [{ tick: winningTick, bidIndex: 0n }])

			const winningVault = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidder.account.address)
			const winningRep = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, winningVault.repBackingUnits)
			const expectedWinningRep = (expectedEthToBuy * PRICE_PRECISION) / tickToPrice(winningTick)

			approximatelyEqual(winningRep, expectedWinningRep, 1_000n, 'winning claims should still receive the expected REP after a losing refund settles first')
			strictEqualTypeSafe(winningVault.underwritingLimitAttoEth, forkData.auctionedUnderwritingLimitAttoEth, 'capacity ownership')
		})

		test('claimAuctionProceeds allows a third party to settle a finalized losing refund for the bidder', async () => {
			const { yesSecurityPool, losingBidder, losingEth, losingTick } = await setupFinalizedTruthAuctionWithMixedBids()
			const thirdParty = createWriteClient(mockWindow, TEST_ADDRESSES[4])
			const thirdPartyBalanceBeforeClaim = await getETHBalance(client, thirdParty.account.address)
			const losingBidderBalanceBeforeClaim = await getETHBalance(client, losingBidder.account.address)

			await claimAuctionProceeds(thirdParty, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
			strictEqualTypeSafe(await getPendingAuctionRefund(client, yesSecurityPool.truthAuction, losingBidder.account.address), losingEth, 'permissionless settlement should credit only the bidder')
			await withdrawPendingAuctionRefund(losingBidder, yesSecurityPool.truthAuction)

			const thirdPartyBalanceAfterClaim = await getETHBalance(client, thirdParty.account.address)
			const losingBidderBalanceAfterClaim = await getETHBalance(client, losingBidder.account.address)

			strictEqualTypeSafe(losingBidderBalanceAfterClaim - losingBidderBalanceBeforeClaim, losingEth, 'permissionless callers should still refund ETH to the losing bidder')
			strictEqualTypeSafe(thirdPartyBalanceAfterClaim, thirdPartyBalanceBeforeClaim, 'permissionless settlement should not redirect refund ETH to the caller')
		})

		test('claimAuctionProceeds does not emit ClaimAuctionProceeds for refund-only settlements', async () => {
			const { yesSecurityPool, losingBidder, losingTick } = await setupFinalizedTruthAuctionWithMixedBids()
			const claimHash = await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
			const receipt = await client.waitForTransactionReceipt({ hash: claimHash })
			const claimLogs = receipt.logs
				.map(log => {
					try {
						return decodeEventLog({
							abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
							data: log.data,
							topics: log.topics,
						})
					} catch (error) {
						if (!isIgnorableLogDecodeError(error)) throw error
						return undefined
					}
				})
				.filter(log => log?.eventName === 'ClaimAuctionProceeds')

			strictEqualTypeSafe(claimLogs.length, 0, 'refund-only settlements should not emit ClaimAuctionProceeds')
		})

		test('unclaimed finalized auction proceeds survive partial vault liquidation and remain claimable by the original bidder', async () => {
			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			const settlementCaller = createWriteClient(mockWindow, TEST_ADDRESSES[5])
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6])
			const liquidatorGenesisRepBalanceSlot = formatStorageSlot(getAddressMappingStorageSlot(liquidatorClient.account.address, 0n))
			await mockWindow.addStateOverrides({
				[addressString(GENESIS_REPUTATION_TOKEN)]: {
					stateDiff: {
						[liquidatorGenesisRepBalanceSlot]: 10n ** 30n,
					},
				},
			})
			await approveAndDepositRepToVault(liquidatorClient, repDeposit * 500n, questionId)
			// This accounting scenario starts with a backed vault whose capacity has been removed.
			await setVaultCapacityFixture(liquidatorClient, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, liquidatorClient.account.address, 0n)
			await approveAndDepositRepToVault(passiveRepHolder, repDeposit * 50n, questionId)

			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			await mockWindow.advanceTime(10n * 60n)
			await setVaultCapacityFixture(passiveRepHolder, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, passiveRepHolder.account.address, securityPoolUnderwritingLimitAttoEth / 2n)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, 'liquidated unclaimed auction proceeds fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(liquidatorClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			const winningTick = await participateAuction(client, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)
			const childRepToken = await getRepToken(client, yesSecurityPool.securityPool)
			const liquidatorChildRepBalanceSlot = formatStorageSlot(getAddressMappingStorageSlot(liquidatorClient.account.address, 0n))
			const liquidateClaimableChildVault = async (amount: bigint) => {
				await mockWindow.addStateOverrides({
					[childRepToken]: {
						stateDiff: {
							[liquidatorChildRepBalanceSlot]: forcedPrice * 1_000n,
						},
					},
				})
				await approveToken(liquidatorClient, childRepToken, getInfraContractAddresses().openOracle)
				await queueLiquidationAtForcedPrice(liquidatorClient, yesSecurityPool.openOraclePriceCoordinator, client.account.address, amount, forcedPrice)
				await handleOracleReporting(liquidatorClient, mockWindow, yesSecurityPool.openOraclePriceCoordinator, forcedPrice)
			}

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			await mockWindow.advanceTime(10n * 60n)

			const targetVaultBeforeLiquidation = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const liquidatorVaultBeforeLiquidation = await getSecurityVault(client, yesSecurityPool.securityPool, liquidatorClient.account.address)
			const targetRepBeforeLiquidation = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, targetVaultBeforeLiquidation.repBackingUnits)
			const targetOpenInterestAttoEth = await client.readContract({ address: yesSecurityPool.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'getVaultOpenInterestAttoEth', args: [client.account.address] })
			const valueScale = PRICE_PRECISION * 10_000n
			const associatedRepThreshold = ((targetRepBeforeLiquidation + targetVaultBeforeLiquidation.disputeStakedAttoRep) * valueScale) / (targetOpenInterestAttoEth * statoblastSecurityMultiplierBps)
			const migrationSecurityMultiplierBps = 10_000n + (statoblastSecurityMultiplierBps - 10_000n) / 2n
			const liquidationReserveMultiplierBps = 10_500n
			const effectiveMigrationMultiplierBps = migrationSecurityMultiplierBps > liquidationReserveMultiplierBps ? migrationSecurityMultiplierBps : liquidationReserveMultiplierBps
			const migrationThreshold = (targetRepBeforeLiquidation * valueScale) / (targetOpenInterestAttoEth * effectiveMigrationMultiplierBps)
			const liquidationThresholdPrice = associatedRepThreshold < migrationThreshold ? associatedRepThreshold : migrationThreshold
			const forcedPrice = (liquidationThresholdPrice + 1n) * 2n
			const liquidationChunk = targetVaultBeforeLiquidation.underwritingLimitAttoEth / 10n

			strictEqualTypeSafe(targetVaultBeforeLiquidation.underwritingLimitAttoEth > 0n, true, 'capacity ownership')
			assert.ok(targetRepBeforeLiquidation > 0n, 'migrated bidder vault should carry REP before liquidation')
			strictEqualTypeSafe(liquidationChunk > 0n, true, 'test setup needs a positive liquidation chunk')

			const liquidationAttemptStartBlock = await client.getBlockNumber()
			await liquidateClaimableChildVault(liquidationChunk)

			const targetVaultAfterLiquidation = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const liquidatorVaultAfterLiquidation = await getSecurityVault(client, yesSecurityPool.securityPool, liquidatorClient.account.address)
			const targetRepAfterLiquidation = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, targetVaultAfterLiquidation.repBackingUnits)

			if (targetVaultAfterLiquidation.underwritingLimitAttoEth >= targetVaultBeforeLiquidation.underwritingLimitAttoEth) {
				const coordinatorLogs = await client.getLogs({
					address: yesSecurityPool.openOraclePriceCoordinator,
					fromBlock: liquidationAttemptStartBlock,
				})
				const executionReasons = coordinatorLogs
					.map(log => {
						try {
							return decodeEventLog({
								abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
								data: log.data,
								topics: log.topics,
							})
						} catch (error) {
							if (!isIgnorableLogDecodeError(error)) throw error
							return undefined
						}
					})
					.filter(log => log?.eventName === 'ExecutedStagedOperation')
					.map(log => `${log?.args.success === true ? 'success' : 'failure'}:${log?.args.errorMessage ?? ''}`)
				throw new Error(`pre-claim liquidation did not reduce underwritingLimitAttoEth; coordinator results=${executionReasons.join('|')}`)
			}

			const capacityOwnershipTransferredAttoRep = targetVaultBeforeLiquidation.underwritingLimitAttoEth - targetVaultAfterLiquidation.underwritingLimitAttoEth

			const targetRepMoved = targetRepBeforeLiquidation - targetRepAfterLiquidation
			const liquidatorRepBeforeLiquidation = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, liquidatorVaultBeforeLiquidation.repBackingUnits)
			const liquidatorRepAfterLiquidation = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, liquidatorVaultAfterLiquidation.repBackingUnits)
			strictEqualTypeSafe(capacityOwnershipTransferredAttoRep > 0n, true, 'capacity ownership')
			strictEqualTypeSafe(targetRepMoved > 0n, true, 'liquidation should transfer migrated vault REP backing before claim')
			approximatelyEqual(liquidatorRepAfterLiquidation - liquidatorRepBeforeLiquidation, targetRepMoved, 2n, 'liquidation should conserve migrated vault REP backing between target and receiver')
			strictEqualTypeSafe(liquidatorVaultAfterLiquidation.underwritingLimitAttoEth, liquidatorVaultBeforeLiquidation.underwritingLimitAttoEth + capacityOwnershipTransferredAttoRep, 'capacity ownership')

			const childCollateralAfterLiquidation = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const childUnderwritingLimitAttoEthAfterLiquidation = await getTotalUnderwritingLimitAttoEth(client, yesSecurityPool.securityPool)
			const totalAttoRepPurchased = await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction)
			const forkDataBeforeClaim = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(forkDataBeforeClaim.auctionedUnderwritingLimitAttoEth > 0n, true, 'capacity ownership')
			strictEqualTypeSafe(totalAttoRepPurchased > 0n, true, 'test setup should leave finalized auction REP for the bidder to claim')

			const childFeesBeforeClaim = await getTotalAccruedFees(client, yesSecurityPool.securityPool)
			await claimAuctionProceeds(settlementCaller, yesSecurityPool.securityPool, client.account.address, [{ tick: winningTick, bidIndex: 0n }])
			const claimFeeDelta = (await getTotalAccruedFees(client, yesSecurityPool.securityPool)) - childFeesBeforeClaim

			const targetVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const liquidatorVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, liquidatorClient.account.address)
			const targetRepAfterClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, targetVaultAfterClaim.repBackingUnits)

			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), childCollateralAfterLiquidation - claimFeeDelta, 'claim timing should change child collateral only by current fees after liquidation')
			strictEqualTypeSafe(await getTotalUnderwritingLimitAttoEth(client, yesSecurityPool.securityPool), childUnderwritingLimitAttoEthAfterLiquidation, 'capacity ownership')
			strictEqualTypeSafe(targetRepAfterClaim - targetRepAfterLiquidation, totalAttoRepPurchased, 'the original bidder should still receive the full finalized auction REP after their migrated vault was liquidated')
			strictEqualTypeSafe(targetVaultAfterClaim.underwritingLimitAttoEth - targetVaultAfterLiquidation.underwritingLimitAttoEth, forkDataBeforeClaim.auctionedUnderwritingLimitAttoEth, 'capacity ownership')
			strictEqualTypeSafe(liquidatorVaultAfterClaim.repBackingUnits, liquidatorVaultAfterLiquidation.repBackingUnits, 'unclaimed finalized auction proceeds should not be swept into the liquidator vault')
			strictEqualTypeSafe(liquidatorVaultAfterClaim.underwritingLimitAttoEth, liquidatorVaultAfterLiquidation.underwritingLimitAttoEth, 'capacity ownership')

			await mockWindow.advanceTime(DAY)
			await mockWindow.addStateOverrides({
				[yesSecurityPool.securityPool]: { stateDiff: { [formatStorageSlot(feeEpochEndTimeStorageSlot)]: (await client.getBlock()).timestamp } },
			})
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			await updateVaultFees(client, yesSecurityPool.securityPool, liquidatorClient.account.address)
			approximatelyEqual(await getTotalAccruedFees(client, yesSecurityPool.securityPool), await getTotalClaimableVaultFeesAttoEth(client, yesSecurityPool.securityPool), 1n, 'capacity ownerships')
		})

		test('settleAuctionBids does not emit ClaimAuctionProceeds for finalized refund-only settlements', async () => {
			const { yesSecurityPool, losingBidder, losingEth, losingTick } = await setupFinalizedTruthAuctionWithMixedBids()
			const losingBidderBalanceBeforeSettlement = await getETHBalance(client, losingBidder.account.address)
			const settlementHash = await settleAuctionBids(client, yesSecurityPool.securityPool, losingBidder.account.address, [], [{ tick: losingTick, bidIndex: 0n }])
			strictEqualTypeSafe(await getPendingAuctionRefund(client, yesSecurityPool.truthAuction, losingBidder.account.address), losingEth, 'refund-only batch settlement should credit the bidder')
			await withdrawPendingAuctionRefund(losingBidder, yesSecurityPool.truthAuction)
			const receipt = await client.waitForTransactionReceipt({ hash: settlementHash })
			const settlementLogs = receipt.logs
				.map(log => {
					try {
						return decodeEventLog({
							abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
							data: log.data,
							topics: log.topics,
						})
					} catch (error) {
						if (!isIgnorableLogDecodeError(error)) throw error
						return undefined
					}
				})
				.filter(log => log?.eventName === 'ClaimAuctionProceeds')
			const losingBidderBalanceAfterSettlement = await getETHBalance(client, losingBidder.account.address)

			strictEqualTypeSafe(losingBidderBalanceAfterSettlement - losingBidderBalanceBeforeSettlement, losingEth, 'refund-only batch settlement should still release the losing-bid ETH')
			strictEqualTypeSafe(settlementLogs.length, 0, 'refund-only batch settlement should not emit ClaimAuctionProceeds')
		})

		test('claimAuctionProceeds cannot settle the same finalized losing bid twice', async () => {
			const { yesSecurityPool, losingBidder, losingTick } = await setupFinalizedTruthAuctionWithMixedBids()

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
			await assert.rejects(async () => await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }]), /Bid has already been claimed or does not exist/)
		})
	})
})
