import { statoblast_SecurityPoolForker_SecurityPoolForker, statoblast_SecurityPool_SecurityPool } from '../../../types/contractArtifact'
import { formatStorageSlot, getAddressMappingStorageSlot } from '../../../testSupport/storage'
import {
	createCompleteSet,
	depositRepToVault,
	depositToEscalationGame,
	getSettlementCollateralAttoEth,
	getTotalRepBackingUnits,
	getRepToken,
	getSecurityVault,
	getSystemState,
	getTotalAccruedFees,
	getTotalClaimableVaultFeesAttoEth,
	getVaultCount,
	backingUnitsToAttoRep,
	redeemRepFromVault,
	setUnderwritingLimit,
	updateVaultFees,
} from '../../../testSupport/simulator/utils/contracts/securityPool'
import { getTotalRepPurchasedAttoRep, getEthRaiseCapAttoEth } from '../../../testSupport/simulator/utils/contracts/auction'
import { getRepTokenAddress, getTotalTheoreticalSupply } from '../../../testSupport/simulator/utils/contracts/zoltar'
import { claimAuctionProceeds, finalizeTruthAuction, getQuestionOutcome, getSecurityPoolForkerForkData, migrateRepToZoltar, migrateVault, startTruthAuction } from '../../../testSupport/simulator/utils/contracts/securityPoolForker'
import { SystemState } from '../../../testSupport/simulator/types/statoblastTypes'
import { QuestionOutcome } from '../../../testSupport/simulator/types/types'
import { tickToPrice } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'
import { getQuestionEndDate, participateAuction } from '../../../testSupport/simulator/utils/contracts/statoblast'
import { getInfraContractAddresses, getSecurityPoolAddresses } from '../../../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveAndDepositRepToVault, manipulatePriceOracle, setVaultCapacityFixture } from '../../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { approveToken, getChildUniverseId, getERC20Balance, getETHBalance } from '../../../testSupport/simulator/utils/utilities'
import { DAY, TEST_ADDRESSES } from '../../../testSupport/simulator/utils/constants'
import { createWriteClient } from '../../../testSupport/simulator/utils/clients'
import { decodeEventLog, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { approximatelyEqual, strictEqualTypeSafe } from '../../../testSupport/simulator/utils/testUtils'
import assert from '../../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { useStatoblastTruthAuctionFixture, type StatoblastTruthAuctionFixture } from '../fixture'
import { getFeeEpochEndTimeStorageSlot, getPendingAuctionRefund, withdrawPendingAuctionRefund, getUnassignedPosition, setupFinalizedAuctionWithUnclaimedUnderwritingLimitAttoEth } from './helpers'

describe('Statoblast: truth auction', () => {
	const fixture = useStatoblastTruthAuctionFixture()
	const feeEpochEndTimeStorageSlot = getFeeEpochEndTimeStorageSlot()

	const { PRICE_PRECISION, reportBond, repDeposit, genesisUniverse, statoblastSecurityMultiplierBps, triggerExternalForkForSecurityPool, setupTruthAuctionWithMixedBids, setupTruthAuctionWithTwoWinningBids, getYesChildPool } = fixture

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

	const finalizeChildQuestionAsYes = async (childSecurityPool: typeof securityPoolAddresses) => {
		const childRepToken = await getRepToken(client, childSecurityPool.securityPool)
		const reporterBalanceSlot = formatStorageSlot(getAddressMappingStorageSlot(client.account.address, 0n))
		await mockWindow.addStateOverrides({
			[childRepToken]: {
				stateDiff: {
					[reporterBalanceSlot]: repDeposit,
				},
			},
		})
		await approveToken(client, childRepToken, getInfraContractAddresses().openOracle)
		await manipulatePriceOracle(client, mockWindow, childSecurityPool.openOraclePriceCoordinator)
		await depositToEscalationGame(client, childSecurityPool.securityPool, QuestionOutcome.Yes, reportBond)
		await mockWindow.advanceTime(10n * DAY)
	}

	describe('auction bidding and claim settlement', () => {
		test('terminal fee residue waits for a later checkpoint regardless of auction and vault reconciliation order', async () => {
			const { auctionParticipant, auctionTick, auctionedUnderwritingLimitAttoEth, yesSecurityPool } = await setupFinalizedAuctionWithUnclaimedUnderwritingLimitAttoEth(fixture, 'final auction fee residue source')
			const migratedUnderwritingLimitAttoEth = (await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)).underwritingLimitAttoEth
			const auctionFeesAtIndexOne = auctionedUnderwritingLimitAttoEth / PRICE_PRECISION
			const migratedFeesAtIndexOne = migratedUnderwritingLimitAttoEth / PRICE_PRECISION
			const aggregateOnlyReserveAttoEth = PRICE_PRECISION
			const migratedVaultFeeIndexSlot = getAddressMappingStorageSlot(client.account.address, 16n) + 3n
			const feeEpochEndTime = (await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: yesSecurityPool.securityPool, functionName: 'getPoolAccountingSnapshot', args: [] })).lastUpdatedFeeAccumulator
			await mockWindow.addStateOverrides({
				[yesSecurityPool.securityPool]: {
					stateDiff: {
						[formatStorageSlot(8n)]: 1n,
						[formatStorageSlot(11n)]: auctionFeesAtIndexOne + migratedFeesAtIndexOne + aggregateOnlyReserveAttoEth,
						[formatStorageSlot(13n)]: auctionedUnderwritingLimitAttoEth + migratedUnderwritingLimitAttoEth,
						[formatStorageSlot(20n)]: BigInt(SystemState.PoolForked),
						[formatStorageSlot(feeEpochEndTimeStorageSlot)]: feeEpochEndTime,
						[formatStorageSlot(migratedVaultFeeIndexSlot)]: 0n,
					},
				},
			})

			const collateralBeforeReconciliation = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const settlementSnapshot = await mockWindow.anvilSnapshot()
			const readAccounting = async () =>
				await client.readContract({
					abi: statoblast_SecurityPool_SecurityPool.abi,
					address: yesSecurityPool.securityPool,
					functionName: 'getPoolAccountingSnapshot',
					args: [],
				})

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			const auctionFirstAccounting = await readAccounting()

			await mockWindow.anvilRevert(settlementSnapshot)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])
			const vaultFirstAccounting = await readAccounting()

			strictEqualTypeSafe(auctionFirstAccounting.uncheckpointedFeeEligibleUnderwritingLimitAttoEth, 0n, 'both ownership slices should be reconciled')
			assert.ok(auctionFirstAccounting.unallocatedAccruedFeesAttoEth > 0n, 'the last vault reconciliation should leave residue for a separate checkpoint')
			strictEqualTypeSafe(vaultFirstAccounting.unallocatedAccruedFeesAttoEth, auctionFirstAccounting.unallocatedAccruedFeesAttoEth, 'terminal reserve must not depend on reconciliation order')
			strictEqualTypeSafe(vaultFirstAccounting.totalClaimableVaultFeesAttoEth, auctionFirstAccounting.totalClaimableVaultFeesAttoEth, 'claimable fees must not depend on reconciliation order')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), collateralBeforeReconciliation, 'terminal reconciliation should preserve collateral until a later checkpoint')
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), collateralBeforeReconciliation + vaultFirstAccounting.unallocatedAccruedFeesAttoEth, 'a subsequent checkpoint should release the unassignable residue')
			strictEqualTypeSafe(await getTotalAccruedFees(client, yesSecurityPool.securityPool), await getTotalClaimableVaultFeesAttoEth(client, yesSecurityPool.securityPool), 'all forked-pool fees should reconcile after the later checkpoint')
		})

		for (const percentSold of [1n, 10n, 49n]) {
			test(`partial truth auction selling about ${percentSold}% preserves the migrated vault and bidder REP claims`, async () => {
				const passiveVault = createWriteClient(mockWindow, TEST_ADDRESSES[6])
				await approveAndDepositRepToVault(passiveVault, repDeposit, questionId)
				await mockWindow.setTime((await getQuestionEndDate(client, questionId)) + 10000n)
				await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, repDeposit / 4n)
				await createCompleteSet(createWriteClient(mockWindow, TEST_ADDRESSES[1]), securityPoolAddresses.securityPool, 10n * 10n ** 18n)

				await triggerExternalForkForSecurityPool(undefined, `partial ${percentSold}% truth auction source`)
				await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
				await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
				const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
				const child = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
				const poolBackingUnitsBeforeAuction = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
				strictEqualTypeSafe(poolBackingUnitsBeforeAuction, 2n * repDeposit, 'two 10,000-REP deposits should form the pool backing-unit baseline')
				const migratedVaultBeforeAuction = await getSecurityVault(client, child.securityPool, client.account.address)
				strictEqualTypeSafe(migratedVaultBeforeAuction.repBackingUnits, repDeposit, 'only one vault should own child backing units before the auction')

				await mockWindow.advanceTime(8n * 7n * DAY + DAY)
				await startTruthAuction(client, child.securityPool)
				strictEqualTypeSafe(await getSystemState(client, child.securityPool), SystemState.ForkTruthAuction, 'a partially migrated child should require a truth auction')
				const requestedPurchase = (poolBackingUnitsBeforeAuction * percentSold) / 100n
				const bidder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
				const tick = await participateAuction(bidder, child.truthAuction, requestedPurchase, await getEthRaiseCapAttoEth(client, child.truthAuction))
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, child.securityPool)

				const purchasedRep = await getTotalRepPurchasedAttoRep(client, child.truthAuction)
				assert.ok(purchasedRep > 0n && purchasedRep < poolBackingUnitsBeforeAuction / 2n, 'the auction must remain partial and below the integer-rate rounding boundary')
				approximatelyEqual(purchasedRep, requestedPurchase, repDeposit / 100n, 'the auction should sell approximately the requested share of inventory')
				const residualRepForExistingOwners = poolBackingUnitsBeforeAuction - purchasedRep
				const expectedTotalBackingUnits = (poolBackingUnitsBeforeAuction * poolBackingUnitsBeforeAuction + residualRepForExistingOwners - 1n) / residualRepForExistingOwners
				const migratedVaultAfterAuction = await getSecurityVault(client, child.securityPool, client.account.address)
				strictEqualTypeSafe(migratedVaultAfterAuction.repBackingUnits, repDeposit, 'finalization must preserve the migrated vault backing-unit count')
				const expectedMigratedClaim = (repDeposit * residualRepForExistingOwners) / poolBackingUnitsBeforeAuction
				approximatelyEqual(await backingUnitsToAttoRep(client, child.securityPool, migratedVaultAfterAuction.repBackingUnits), expectedMigratedClaim, 1n, 'the migrated vault must retain its proportional REP claim')
				strictEqualTypeSafe(await getTotalRepBackingUnits(client, child.securityPool), expectedTotalBackingUnits, 'the denominator must preserve the fractional haircut')

				await claimAuctionProceeds(client, child.securityPool, bidder.account.address, [{ tick, bidIndex: 0n }])
				const bidderVault = await getSecurityVault(client, child.securityPool, bidder.account.address)
				approximatelyEqual(await backingUnitsToAttoRep(client, child.securityPool, bidderVault.repBackingUnits), purchasedRep, 1n, 'the bidder must receive the REP purchased')
				const unassignedPosition = await getUnassignedPosition(client, child.securityPool)
				strictEqualTypeSafe(unassignedPosition.repBackingUnits, repDeposit, 'the other vault must retain its unmigrated backing units without auction dust')
			})
		}

		test('simple truth auction: participant buys rep and can claim proceeds', async () => {
			// Setup: create open interest, trigger fork, migrate
			const endTime = await getQuestionEndDate(client, questionId)

			// Set capacity ownership and deposit extra REP for capacity
			const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6])
			await approveAndDepositRepToVault(passiveRepHolder, repDeposit, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			// Fork the security pool
			await triggerExternalForkForSecurityPool(undefined, 'simple truth auction fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const { yesSecurityPool } = getYesChildPool()

			// Migrate vault to yes
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			// Skip escalation game migration for simpler test
			// await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

			// Wait for migration period
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)

			// Start truth auction
			await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'Auction should start')

			// Get auction parameters
			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)

			// Participant bids: buy 1/4 of repAtFork for the full ethToBuy
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const repToBuy = repAtFork / 4n
			const auctionTick = await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repToBuy, expectedEthToBuy)

			// Finalize auction
			const childEthBalanceBeforeFinalize = await getETHBalance(client, yesSecurityPool.securityPool)
			const forkerEthBalanceBeforeFinalize = await getETHBalance(client, getInfraContractAddresses().securityPoolForker)
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getETHBalance(client, yesSecurityPool.securityPool), childEthBalanceBeforeFinalize + expectedEthToBuy, 'child pool should receive truth-auction ETH on finalization')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), childEthBalanceBeforeFinalize + expectedEthToBuy, 'child pool collateral accounting should include truth-auction ETH')
			strictEqualTypeSafe(await getETHBalance(client, getInfraContractAddresses().securityPoolForker), forkerEthBalanceBeforeFinalize, 'forker should not retain truth-auction ETH')

			const purchasedAttoRep = await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction)
			const incumbentResidualAttoRep = repAtFork - purchasedAttoRep
			const expectedDenominator = (repAtFork * repAtFork + incumbentResidualAttoRep - 1n) / incumbentResidualAttoRep
			strictEqualTypeSafe(await getTotalRepBackingUnits(client, yesSecurityPool.securityPool), expectedDenominator, 'partial auctions must preserve the fractional incumbent haircut')
			const incumbentVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			approximatelyEqual(await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, incumbentVault.repBackingUnits), (incumbentVault.repBackingUnits * incumbentResidualAttoRep) / repAtFork, 1n, 'incumbent claims must follow the proportional auction haircut')

			// Claim proceeds
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])

			// Verify they got backingUnits shares matching purchasedRep (with tolerance for rounding)
			const vault = await getSecurityVault(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
			const repFromBackingUnits = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, vault.repBackingUnits)
			strictEqualTypeSafe(repFromBackingUnits, purchasedAttoRep, 'the sole bidder must receive the purchased REP')
		})

		test('claimAuctionProceeds releases ETH for a finalized losing bid without mutating vault accounting', async () => {
			const endTime = await getQuestionEndDate(client, questionId)

			const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6])
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			await setVaultCapacityFixture(passiveRepHolder, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, passiveRepHolder.account.address, repDeposit / 4n)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'refund-only claim fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			const losingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const winningBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			const losingEth = expectedEthToBuy / 10n
			strictEqualTypeSafe(losingEth > 0n, true, 'losing bid should invest a positive amount')
			const losingTick = await participateAuction(losingBidder, yesSecurityPool.truthAuction, repAtFork, losingEth)
			await participateAuction(winningBidder, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			const totalAttoRepPurchased = await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction)
			strictEqualTypeSafe(totalAttoRepPurchased > 0n, true, 'setup should leave a finalized auction with purchased REP')

			const vaultCountBeforeClaim = await getVaultCount(client, yesSecurityPool.securityPool)
			const losingBidderBalanceBeforeClaim = await getETHBalance(client, losingBidder.account.address)
			const losingVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
			strictEqualTypeSafe(await getPendingAuctionRefund(client, yesSecurityPool.truthAuction, losingBidder.account.address), losingEth, 'finalized losing bidder refund credit')
			await withdrawPendingAuctionRefund(losingBidder, yesSecurityPool.truthAuction)

			const losingBidderBalanceAfterClaim = await getETHBalance(client, losingBidder.account.address)
			const losingVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)
			const vaultCountAfterClaim = await getVaultCount(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(losingBidderBalanceAfterClaim - losingBidderBalanceBeforeClaim, losingEth, 'finalized losing bidder should receive their full ETH refund')
			strictEqualTypeSafe(losingVaultAfterClaim.repBackingUnits, losingVaultBeforeClaim.repBackingUnits, 'refund-only finalized claim should not mint REP backing units')
			strictEqualTypeSafe(losingVaultAfterClaim.underwritingLimitAttoEth, losingVaultBeforeClaim.underwritingLimitAttoEth, 'refund-only finalized claim should not assign capacity ownership')
			strictEqualTypeSafe(losingVaultAfterClaim.feeIndex, losingVaultBeforeClaim.feeIndex, 'refund-only finalized claim should not alter fee accounting')
			strictEqualTypeSafe(vaultCountAfterClaim, vaultCountBeforeClaim, 'refund-only finalized claim should not create a new vault')
		})

		test('auction participants receive settled vault REP or credited ETH refunds and can redeem purchased REP', async () => {
			const { yesSecurityPool, expectedEthToBuy, losingBidder, losingEth, losingTick, winningBidder, winningTick } = await setupTruthAuctionWithMixedBids(false)
			const childRepToken = getRepTokenAddress(getChildUniverseId(genesisUniverse, QuestionOutcome.Yes))
			const childEthBeforeFinalize = await getETHBalance(client, yesSecurityPool.securityPool)
			const childCollateralBeforeFinalize = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			const childEthAfterFinalize = await getETHBalance(client, yesSecurityPool.securityPool)
			const childCollateralAfterFinalize = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(childEthAfterFinalize - childEthBeforeFinalize, expectedEthToBuy, 'child pool should receive the ETH filled by the truth auction')
			assert.ok(childCollateralAfterFinalize >= childCollateralBeforeFinalize + expectedEthToBuy, 'child pool collateral accounting should include the auction ETH backing open interest')
			strictEqualTypeSafe(childCollateralAfterFinalize, childEthAfterFinalize, 'child pool collateral accounting should match the final ETH backing')

			const winningVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidder.account.address)
			const losingVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)
			const winningEthBeforeClaim = await getETHBalance(client, winningBidder.account.address)
			const losingEthBeforeClaim = await getETHBalance(client, losingBidder.account.address)

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, winningBidder.account.address, [{ tick: winningTick, bidIndex: 0n }])
			strictEqualTypeSafe(await getPendingAuctionRefund(client, yesSecurityPool.truthAuction, losingBidder.account.address), losingEth, 'losing auction participant refund credit')
			await withdrawPendingAuctionRefund(losingBidder, yesSecurityPool.truthAuction)

			const winningVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidder.account.address)
			const losingVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)
			const winningRepClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, winningVaultAfterClaim.repBackingUnits)
			const losingRepClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, losingVaultAfterClaim.repBackingUnits)
			const winningLimitPrice = tickToPrice(winningTick)
			const minimumWinningRepAtLimit = (expectedEthToBuy * PRICE_PRECISION) / winningLimitPrice

			strictEqualTypeSafe((await getETHBalance(client, losingBidder.account.address)) - losingEthBeforeClaim, losingEth, 'losing auction participant should receive their ETH back')
			strictEqualTypeSafe(await getETHBalance(client, winningBidder.account.address), winningEthBeforeClaim, 'winning auction participant should not receive an ETH refund for a filled bid')
			strictEqualTypeSafe(losingVaultAfterClaim.repBackingUnits, losingVaultBeforeClaim.repBackingUnits, 'losing auction participant should not receive vault backingUnits')
			strictEqualTypeSafe(losingRepClaim, 0n, 'losing auction participant should not receive vault REP backing')
			strictEqualTypeSafe(winningVaultBeforeClaim.repBackingUnits, 0n, 'winning auction participant should start without child-pool vault backingUnits')
			assert.ok(winningRepClaim >= minimumWinningRepAtLimit, 'winning auction participant should receive a vault REP claim at least as good as their limit order')

			await finalizeChildQuestionAsYes(yesSecurityPool)
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'child question should eventually finalize before auction REP redemption')

			const winningRepBalanceBeforeRedeem = await getERC20Balance(client, childRepToken, winningBidder.account.address)
			await setUnderwritingLimit(winningBidder, yesSecurityPool.securityPool, 0n)
			await redeemRepFromVault(winningBidder, yesSecurityPool.securityPool, winningBidder.account.address)
			const winningRepBalanceAfterRedeem = await getERC20Balance(client, childRepToken, winningBidder.account.address)
			const winningVaultAfterRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidder.account.address)

			strictEqualTypeSafe(winningRepBalanceAfterRedeem - winningRepBalanceBeforeRedeem, winningRepClaim, 'winning auction participant should eventually redeem the purchased vault REP to their wallet')
			strictEqualTypeSafe(winningVaultAfterRedeem.repBackingUnits, 0n, 'redeeming purchased auction REP should empty the participants vault backingUnits')
		})

		test('multiple filled auction participants can all redeem purchased vault REP', async () => {
			const { yesSecurityPool, repAtFork, expectedEthToBuy, losingBidder, losingEth, losingTick, winningBidderA, winningBidderB, winningEthA, winningEthB, winningTickA, winningTickB, winningBidIndexB } = await setupTruthAuctionWithTwoWinningBids(false)
			const childRepToken = getRepTokenAddress(getChildUniverseId(genesisUniverse, QuestionOutcome.Yes))
			const childEthBeforeFinalize = await getETHBalance(client, yesSecurityPool.securityPool)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe((await getETHBalance(client, yesSecurityPool.securityPool)) - childEthBeforeFinalize, expectedEthToBuy, 'child pool should receive all ETH filled by multiple winning auction bids')

			const winningAEthBeforeClaim = await getETHBalance(client, winningBidderA.account.address)
			const winningBEthBeforeClaim = await getETHBalance(client, winningBidderB.account.address)
			const losingEthBeforeClaim = await getETHBalance(client, losingBidder.account.address)
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
			strictEqualTypeSafe(await getPendingAuctionRefund(client, yesSecurityPool.truthAuction, losingBidder.account.address), losingEth, 'multiple-participant losing-bid refund credit')
			await withdrawPendingAuctionRefund(losingBidder, yesSecurityPool.truthAuction)
			const claimHashA = await claimAuctionProceeds(client, yesSecurityPool.securityPool, winningBidderA.account.address, [{ tick: winningTickA, bidIndex: 0n }])
			const claimHashB = await claimAuctionProceeds(client, yesSecurityPool.securityPool, winningBidderB.account.address, [{ tick: winningTickB, bidIndex: winningBidIndexB }])

			strictEqualTypeSafe((await getETHBalance(client, losingBidder.account.address)) - losingEthBeforeClaim, losingEth, 'losing auction participant should receive their ETH back')
			strictEqualTypeSafe(await getETHBalance(client, winningBidderA.account.address), winningAEthBeforeClaim, 'first filled auction participant should not receive an ETH refund')
			strictEqualTypeSafe(await getETHBalance(client, winningBidderB.account.address), winningBEthBeforeClaim, 'second filled auction participant should not receive an ETH refund')

			const winningVaultAAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidderA.account.address)
			const winningVaultBAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidderB.account.address)
			const winningARepClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, winningVaultAAfterClaim.repBackingUnits)
			const winningBRepClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, winningVaultBAfterClaim.repBackingUnits)
			const minimumWinningARepAtLimit = (winningEthA * PRICE_PRECISION) / tickToPrice(winningTickA)
			const minimumWinningBRepAtLimit = (winningEthB * PRICE_PRECISION) / tickToPrice(winningTickB)
			const purchasedRepFromClaim = async (hash: Hex) => {
				const receipt = await client.waitForTransactionReceipt({ hash })
				for (const log of receipt.logs) {
					if (log.address.toLowerCase() !== getInfraContractAddresses().securityPoolForker.toLowerCase()) continue
					const event = decodeEventLog({ abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi, data: log.data, topics: log.topics })
					if (event.eventName === 'ClaimAuctionProceeds') return event.args.amountAttoRep
				}
				throw new Error('Missing auction purchase event')
			}
			const purchasedA = await purchasedRepFromClaim(claimHashA)
			const purchasedB = await purchasedRepFromClaim(claimHashB)
			assert.ok(purchasedA >= minimumWinningARepAtLimit, 'the first auction fill must satisfy its limit order')
			assert.ok(purchasedB >= minimumWinningBRepAtLimit, 'the second auction fill must satisfy its limit order')
			approximatelyEqual(winningARepClaim, purchasedA, 1n, "first bidder's REP claim must match its purchase within one attoREP of backing-unit rounding")
			approximatelyEqual(winningBRepClaim, purchasedB, 1n, "second bidder's REP claim must match its purchase within one attoREP of backing-unit rounding")
			strictEqualTypeSafe(purchasedA + purchasedB, await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), 'all auction REP must be assigned')
			strictEqualTypeSafe(winningVaultAAfterClaim.repBackingUnits + winningVaultBAfterClaim.repBackingUnits, (await getTotalRepBackingUnits(client, yesSecurityPool.securityPool)) - repAtFork, 'all bidder backing units must be assigned without dust')

			await finalizeChildQuestionAsYes(yesSecurityPool)
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'child question should eventually finalize before multi-winner auction REP redemption')

			const winningARepBeforeRedeem = await getERC20Balance(client, childRepToken, winningBidderA.account.address)
			const winningBRepBeforeRedeem = await getERC20Balance(client, childRepToken, winningBidderB.account.address)
			const childRepBeforeRedeem = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
			const winningARedeemClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, winningVaultAAfterClaim.repBackingUnits)
			const winningBRepBeforeFirstRedeem = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, winningVaultBAfterClaim.repBackingUnits)

			await setUnderwritingLimit(winningBidderA, yesSecurityPool.securityPool, 0n)
			await redeemRepFromVault(winningBidderA, yesSecurityPool.securityPool, winningBidderA.account.address)
			const winningBRedeemClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, winningVaultBAfterClaim.repBackingUnits)
			approximatelyEqual(winningBRedeemClaim, winningBRepBeforeFirstRedeem, 1n, 'the first redemption may redistribute only sub-attoREP rounding residue')
			await setUnderwritingLimit(winningBidderB, yesSecurityPool.securityPool, 0n)
			await redeemRepFromVault(winningBidderB, yesSecurityPool.securityPool, winningBidderB.account.address)

			const winningVaultAAfterRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidderA.account.address)
			const winningVaultBAfterRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidderB.account.address)
			const totalRedeemedRep = winningARedeemClaim + winningBRedeemClaim
			strictEqualTypeSafe((await getERC20Balance(client, childRepToken, winningBidderA.account.address)) - winningARepBeforeRedeem, winningARedeemClaim, 'first filled auction participant should redeem their purchased vault REP')
			strictEqualTypeSafe((await getERC20Balance(client, childRepToken, winningBidderB.account.address)) - winningBRepBeforeRedeem, winningBRedeemClaim, 'second filled auction participant should redeem their purchased vault REP')
			strictEqualTypeSafe(childRepBeforeRedeem - (await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)), totalRedeemedRep, 'multi-winner redemptions should debit only the REP paid to auction participants')
			strictEqualTypeSafe(winningVaultAAfterRedeem.repBackingUnits, 0n, 'redeeming purchased auction REP should empty the first participants vault backingUnits')
			strictEqualTypeSafe(winningVaultBAfterRedeem.repBackingUnits, 0n, 'redeeming purchased auction REP should empty the second participants vault backingUnits')
		})
	})
})
