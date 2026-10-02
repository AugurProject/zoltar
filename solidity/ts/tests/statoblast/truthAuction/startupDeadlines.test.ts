import { TRUTH_AUCTION_MAX_TICK } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'
import { statoblast_SecurityPoolForker_SecurityPoolForker, statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../../../types/contractArtifact'
import { formatStorageSlot, getAddressMappingStorageSlot } from '../../../testSupport/storage'
import { createCompleteSet, depositRepToVault, getSettlementCollateralAttoEth, getTotalRepBackingUnits, getRepToken, getSecurityVault, getSystemState, getTotalAccruedFees, getTotalUnderwritingLimitAttoEth, redeemFees } from '../../../testSupport/simulator/utils/contracts/securityPool'
import { getTotalRepPurchasedAttoRep, getEthRaiseCapAttoEth, getMaxRepBeingSoldAttoRep, getMinBidSizeAttoEth, isFinalized, submitBid } from '../../../testSupport/simulator/utils/contracts/auction'
import { getRepTokenAddress, getTotalTheoreticalSupply } from '../../../testSupport/simulator/utils/contracts/zoltar'
import { claimAuctionProceeds, createChildUniverse, finalizeTruthAuction, getMigratedAttoRep, getSecurityPoolForkerForkData, migrateRepToZoltar, migrateVault, startTruthAuction, getForkActivationTime } from '../../../testSupport/simulator/utils/contracts/securityPoolForker'
import { SystemState } from '../../../testSupport/simulator/types/statoblastTypes'
import { QuestionOutcome } from '../../../testSupport/simulator/types/types'
import { getQuestionEndDate, participateAuction } from '../../../testSupport/simulator/utils/contracts/statoblast'
import { getInfraContractAddresses } from '../../../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveAndDepositRepToVault, setVaultCapacityFixture } from '../../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { addressString } from '../../../testSupport/simulator/utils/bigint'
import { getERC20Balance, getETHBalance } from '../../../testSupport/simulator/utils/utilities'
import { DAY, TEST_ADDRESSES } from '../../../testSupport/simulator/utils/constants'
import { createWriteClient } from '../../../testSupport/simulator/utils/clients'
import { encodeFunctionData } from '@zoltar/core-shared/evm/ethereum'
import { ensureDefined, strictEqualTypeSafe } from '../../../testSupport/simulator/utils/testUtils'
import assert from '../../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { useStatoblastTruthAuctionFixture, type StatoblastTruthAuctionFixture } from '../fixture'
import { getPendingAuctionRefund, withdrawPendingAuctionRefund, getUnassignedPosition, getTruthAuctionStartedEvents } from './helpers'

describe('Statoblast: truth auction', () => {
	const fixture = useStatoblastTruthAuctionFixture()

	const { repDeposit, statoblastSecurityMultiplierBps, triggerExternalForkForSecurityPool, setupStartedTruthAuction, setupTruthAuctionWithMixedBids, getYesChildPool } = fixture

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

	const directAnvilRequest = async (method: string, params: readonly unknown[]) => {
		return await mockWindow.requestRaw({ method, params })
	}

	const queueDirectTransaction = async (from: `0x${string}`, to: `0x${string}`, data: `0x${string}`, value = 0n) => {
		const result = await directAnvilRequest('eth_sendTransaction', [{ from, to, data, gas: '0x17d7840', gasPrice: '0x0', value: `0x${value.toString(16)}` }])
		if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error('Direct Anvil transaction returned an invalid hash')
		return result
	}

	const getDirectReceiptStatus = async (hash: string): Promise<'success' | 'reverted'> => {
		const receipt = await directAnvilRequest('eth_getTransactionReceipt', [hash])
		if (typeof receipt !== 'object' || receipt === null) throw new Error(`Missing direct Anvil receipt for ${hash}`)
		const status = Reflect.get(receipt, 'status')
		if (status === '0x1') return 'success'
		if (status === '0x0') return 'reverted'
		throw new Error(`Invalid direct Anvil receipt status for ${hash}`)
	}

	describe('auction startup and migration isolation', () => {
		test('startTruthAuction waits for the parent migration window instead of the child universe fork time', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, 'parent migration window fork source')
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()

			await assert.rejects(startTruthAuction(client, yesSecurityPool.securityPool), /Active/)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'child pool should keep accepting migration until the parent window closes')
		})

		test('startTruthAuction keeps migration open at the exact parent deadline and starts one second later', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, 'parent migration deadline boundary fork source')
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()
			const migrationDeadline = (await getForkActivationTime(client, securityPoolAddresses.securityPool)) + 8n * 7n * DAY

			await mockWindow.setTime(migrationDeadline - 1n)
			// The transaction mines at the exact deadline. On slower runners the receipt
			// poll can mine another block before replaying the revert, losing its reason.
			await assert.rejects(startTruthAuction(client, yesSecurityPool.securityPool))
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'child pool should still be in migration at the exact parent deadline')

			await mockWindow.setTime(migrationDeadline)
			const startHash = await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'child pool should enter truth auction after the parent migration window closes')
			const startedEvents = await getTruthAuctionStartedEvents(client, startHash)
			strictEqualTypeSafe(startedEvents.length, 1, 'an auction start should be announced exactly once')
			const startedEvent = ensureDefined(startedEvents[0], 'missing TruthAuctionStarted event')
			strictEqualTypeSafe(startedEvent.args.securityPool.toLowerCase(), yesSecurityPool.securityPool.toLowerCase())
			strictEqualTypeSafe(startedEvent.args.auctionableAttoRepAtFork, (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork)
		})

		test('migration and auction-start competitors use exact block timestamps at deadline - 1, deadline, and deadline + 1', async () => {
			const migratingVault = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(migratingVault, repDeposit, questionId)
			await triggerExternalForkForSecurityPool(undefined, 'same-block migration deadline source')
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()
			const migrationDeadline = (await getForkActivationTime(client, securityPoolAddresses.securityPool)) + 8n * 7n * DAY
			let boundarySnapshot = await mockWindow.anvilSnapshot()
			const forkerAddress = getInfraContractAddresses().securityPoolForker

			const mineCompetitors = async (timestamp: bigint, migrateFirst: boolean) => {
				await directAnvilRequest('anvil_setAutomine', [false])
				try {
					await directAnvilRequest('evm_setNextBlockTimestamp', [`0x${timestamp.toString(16)}`])
					const sendMigration = async () =>
						await queueDirectTransaction(
							migratingVault.account.address,
							forkerAddress,
							encodeFunctionData({
								abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
								functionName: 'migrateVault',
								args: [securityPoolAddresses.securityPool, BigInt(QuestionOutcome.Yes)],
							}),
						)
					const sendAuctionStart = async () =>
						await queueDirectTransaction(
							client.account.address,
							forkerAddress,
							encodeFunctionData({
								abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
								functionName: 'startTruthAuction',
								args: [yesSecurityPool.securityPool],
							}),
						)
					const firstHash = migrateFirst ? await sendMigration() : await sendAuctionStart()
					const secondHash = migrateFirst ? await sendAuctionStart() : await sendMigration()
					await directAnvilRequest('evm_mine', [])
					const firstStatus = await getDirectReceiptStatus(firstHash)
					const secondStatus = await getDirectReceiptStatus(secondHash)
					return migrateFirst ? { migrationStatus: firstStatus, auctionStatus: secondStatus } : { migrationStatus: secondStatus, auctionStatus: firstStatus }
				} finally {
					await directAnvilRequest('anvil_setAutomine', [true])
				}
			}

			const beforeDeadline = await mineCompetitors(migrationDeadline - 1n, false)
			strictEqualTypeSafe(beforeDeadline.migrationStatus, 'success', 'migration should win before the inclusive deadline even when auction start is ordered first')
			strictEqualTypeSafe(beforeDeadline.auctionStatus, 'reverted', 'auction start should lose before the migration deadline')

			await mockWindow.anvilRevert(boundarySnapshot)
			boundarySnapshot = await mockWindow.anvilSnapshot()
			const atDeadline = await mineCompetitors(migrationDeadline, true)
			strictEqualTypeSafe(atDeadline.migrationStatus, 'success', 'migration should remain valid at the exact inclusive deadline')
			strictEqualTypeSafe(atDeadline.auctionStatus, 'reverted', 'auction start should remain invalid at the exact migration deadline')

			await mockWindow.anvilRevert(boundarySnapshot)
			const afterDeadline = await mineCompetitors(migrationDeadline + 1n, true)
			strictEqualTypeSafe(afterDeadline.migrationStatus, 'reverted', 'migration should close one second after the deadline')
			strictEqualTypeSafe(afterDeadline.auctionStatus, 'success', 'auction start should become valid one second after the deadline in the same block')
			assert.notStrictEqual(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'the post-deadline auction competitor should advance the child beyond migration, including immediate finalization when no repair is needed')
		})

		test('startTruthAuction splits and sweeps the complete child REP inventory before pricing it', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, repDeposit / 4n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, 'auction inventory funding fork source')
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesUniverse, yesSecurityPool } = getYesChildPool()
			const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)

			await startTruthAuction(client, yesSecurityPool.securityPool)

			const childBalance = await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool)
			const auctionCap = await getMaxRepBeingSoldAttoRep(client, yesSecurityPool.truthAuction)
			strictEqualTypeSafe(childBalance, parentForkData.auctionableAttoRepAtFork, 'truth auction should fund the child with its complete accounting REP baseline')
			assert.ok(auctionCap <= childBalance, 'truth auction cap should not exceed the child REP balance')
		})

		test('finalizeTruthAuction remains closed before the end and finalizes at the exact deadline', async () => {
			const { yesSecurityPool } = await setupStartedTruthAuction('truth auction finalization deadline source')
			const { truthAuctionStarted } = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
			const auctionDeadline = truthAuctionStarted + 7n * DAY

			await mockWindow.setTime(auctionDeadline - 2n)
			await assert.rejects(finalizeTruthAuction(client, yesSecurityPool.securityPool), /Auction open/)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'child pool should remain in truth auction one second before the finalization deadline')

			await mockWindow.setTime(auctionDeadline - 1n)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should become operational at the exact truth auction deadline')
		})

		test('an ended truth auction finalizes and refunds non-qualifying demand without accepting a repair donation', async () => {
			const { repAtFork, yesSecurityPool } = await setupStartedTruthAuction('under-repaired child fork source')
			const migratedCollateral = await getETHBalance(client, yesSecurityPool.securityPool)
			const losingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const losingBid = await getMinBidSizeAttoEth(client, yesSecurityPool.truthAuction)
			const losingTick = await participateAuction(losingBidder, yesSecurityPool.truthAuction, repAtFork, losingBid)
			await mockWindow.advanceTime(7n * DAY + DAY)

			await assert.rejects(finalizeTruthAuction(client, yesSecurityPool.securityPool, 1n), /No repair ETH/)
			strictEqualTypeSafe(await isFinalized(client, yesSecurityPool.truthAuction), false, 'rejected contribution must leave the auction available for value-free finalization')

			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'an ended auction must activate the child without relying on an uncompensated contribution')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), migratedCollateral, 'only migrated collateral and accepted bid ETH may become child collateral')
			strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), 0n, 'non-qualifying demand must not purchase auction REP')
			const unassignedPosition = await getUnassignedPosition(client, yesSecurityPool.securityPool)
			const migratedVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			strictEqualTypeSafe(migratedVault.underwritingLimitAttoEth + unassignedPosition.underwritingLimitAttoEth, await getTotalUnderwritingLimitAttoEth(client, yesSecurityPool.securityPool), 'a zero-purchase auction must retain unmigrated capacity in the explicit unassigned position')
			strictEqualTypeSafe(migratedVault.repBackingUnits + unassignedPosition.repBackingUnits, await getTotalRepBackingUnits(client, yesSecurityPool.securityPool), 'a zero-purchase auction must retain unattributed REP backing in the explicit unassigned position')

			const bidderBalanceBeforeRefund = await getETHBalance(client, losingBidder.account.address)
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
			strictEqualTypeSafe(await getPendingAuctionRefund(client, yesSecurityPool.truthAuction, losingBidder.account.address), losingBid, 'the non-qualifying bidder must receive a withdrawal credit')
			await withdrawPendingAuctionRefund(losingBidder, yesSecurityPool.truthAuction)
			strictEqualTypeSafe((await getETHBalance(client, losingBidder.account.address)) - bidderBalanceBeforeRefund, losingBid, 'the non-qualifying bidder must recover all bid ETH after the deadline')
		})

		test('bid and finalization competitors use exact block timestamps at deadline - 1, deadline, and deadline + 1', async () => {
			const { expectedEthToBuy, repAtFork, yesSecurityPool } = await setupStartedTruthAuction('same-block auction deadline source')
			const initialBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const competingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			const winningTick = await participateAuction(initialBidder, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)
			const minBidSizeAttoEth = await getMinBidSizeAttoEth(client, yesSecurityPool.truthAuction)
			const { truthAuctionStarted } = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
			const auctionDeadline = truthAuctionStarted + 7n * DAY
			const forkerAddress = getInfraContractAddresses().securityPoolForker
			let boundarySnapshot = await mockWindow.anvilSnapshot()

			const mineCompetitors = async (timestamp: bigint, bidFirst: boolean) => {
				await directAnvilRequest('anvil_setAutomine', [false])
				try {
					await directAnvilRequest('evm_setNextBlockTimestamp', [`0x${timestamp.toString(16)}`])
					const sendBid = async () =>
						await queueDirectTransaction(
							competingBidder.account.address,
							yesSecurityPool.truthAuction,
							encodeFunctionData({
								abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
								functionName: 'submitBid',
								args: [winningTick],
							}),
							minBidSizeAttoEth,
						)
					const sendFinalize = async () =>
						await queueDirectTransaction(
							client.account.address,
							forkerAddress,
							encodeFunctionData({
								abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
								functionName: 'finalizeTruthAuction',
								args: [yesSecurityPool.securityPool],
							}),
						)
					const firstHash = bidFirst ? await sendBid() : await sendFinalize()
					const secondHash = bidFirst ? await sendFinalize() : await sendBid()
					await directAnvilRequest('evm_mine', [])
					const firstStatus = await getDirectReceiptStatus(firstHash)
					const secondStatus = await getDirectReceiptStatus(secondHash)
					return bidFirst ? { bidStatus: firstStatus, finalizeStatus: secondStatus } : { bidStatus: secondStatus, finalizeStatus: firstStatus }
				} finally {
					await directAnvilRequest('anvil_setAutomine', [true])
				}
			}

			const beforeDeadline = await mineCompetitors(auctionDeadline - 1n, false)
			strictEqualTypeSafe(beforeDeadline.bidStatus, 'success', 'a bid should remain valid one second before the deadline even when finalization is ordered first')
			strictEqualTypeSafe(beforeDeadline.finalizeStatus, 'reverted', 'finalization should remain closed one second before the deadline')

			await mockWindow.anvilRevert(boundarySnapshot)
			boundarySnapshot = await mockWindow.anvilSnapshot()
			const atDeadline = await mineCompetitors(auctionDeadline, true)
			strictEqualTypeSafe(atDeadline.bidStatus, 'reverted', 'bidding should be closed at the exact auction deadline')
			strictEqualTypeSafe(atDeadline.finalizeStatus, 'success', 'forker finalization should open at the exact auction deadline')
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child should activate through the exact-deadline finalization competitor')

			await mockWindow.anvilRevert(boundarySnapshot)
			const afterDeadline = await mineCompetitors(auctionDeadline + 1n, true)
			strictEqualTypeSafe(afterDeadline.bidStatus, 'reverted', 'bidding should stay closed after the deadline')
			strictEqualTypeSafe(afterDeadline.finalizeStatus, 'success', 'finalization should become valid one second after the deadline in the same block')
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child should also activate through a post-deadline finalization competitor')
		})

		const forcedBalanceCases = [
			{ name: 'capacity ownership', surplusAboveUnderwritingLimitAttoEth: 0n },
			{ name: 'capacity ownership', surplusAboveUnderwritingLimitAttoEth: 1n },
			{ name: 'capacity ownership', surplusAboveUnderwritingLimitAttoEth: 10n ** 30n },
		]

		test.each(forcedBalanceCases)('forced ETH at $name after the deadline cannot contaminate or block finalization', async ({ name, surplusAboveUnderwritingLimitAttoEth }) => {
			const { yesSecurityPool } = await setupStartedTruthAuction(`forced ETH ${name} finalization source`)
			const legitimateCollateral = await getETHBalance(client, yesSecurityPool.securityPool)
			const parentUnderwritingLimitAttoEth = await getTotalUnderwritingLimitAttoEth(client, securityPoolAddresses.securityPool)
			const forcedBalance = parentUnderwritingLimitAttoEth + surplusAboveUnderwritingLimitAttoEth

			await mockWindow.advanceTime(7n * DAY + DAY)
			await mockWindow.setBalance(yesSecurityPool.securityPool, forcedBalance)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'surplus ETH must not keep the child in truth-auction state')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), legitimateCollateral, 'forced ETH must remain outside protocol-accounted collateral')
			strictEqualTypeSafe(await getETHBalance(client, yesSecurityPool.securityPool), forcedBalance, 'forced ETH should remain an unaccounted pool surplus')

			const feesBeforeCheckpoint = await getTotalAccruedFees(client, yesSecurityPool.securityPool)
			await redeemFees(client, yesSecurityPool.securityPool, addressString(TEST_ADDRESSES[6]))
			const checkpointFeeDelta = (await getTotalAccruedFees(client, yesSecurityPool.securityPool)) - feesBeforeCheckpoint
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), legitimateCollateral - checkpointFeeDelta, 'fee checkpointing must not reclassify forced ETH as collateral')
		})

		test('forced ETH during bidding stays outside collateral while auction proceeds remain accounted', async () => {
			const { yesSecurityPool, expectedEthToBuy } = await setupTruthAuctionWithMixedBids(false)
			const legitimateCollateralBeforeAuction = await getETHBalance(client, yesSecurityPool.securityPool)
			const parentUnderwritingLimitAttoEth = await getTotalUnderwritingLimitAttoEth(client, securityPoolAddresses.securityPool)
			const forcedBalance = parentUnderwritingLimitAttoEth + 10n ** 30n

			await mockWindow.setBalance(yesSecurityPool.securityPool, forcedBalance)
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'forced ETH during bidding must not block the auction lifecycle')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), legitimateCollateralBeforeAuction + expectedEthToBuy, 'collateral should include only migrated collateral and filled auction proceeds')
			strictEqualTypeSafe(await getETHBalance(client, yesSecurityPool.securityPool), forcedBalance + expectedEthToBuy, 'the raw balance should preserve both surplus and filled auction ETH')
		})

		test('forced ETH on the forker before auction finalization cannot be routed into child collateral', async () => {
			const { yesSecurityPool, expectedEthToBuy } = await setupTruthAuctionWithMixedBids(false)
			const legitimateCollateralBeforeAuction = await getETHBalance(client, yesSecurityPool.securityPool)
			const securityPoolForker = getInfraContractAddresses().securityPoolForker
			const forcedForkerSurplus = 13n * 10n ** 18n
			const forkerBalanceBeforeForce = await getETHBalance(client, securityPoolForker)
			await mockWindow.setBalance(securityPoolForker, forkerBalanceBeforeForce + forcedForkerSurplus)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), legitimateCollateralBeforeAuction + expectedEthToBuy, 'child collateral should include only migration funding and auction ETH received during finalization')
			strictEqualTypeSafe(await getETHBalance(client, yesSecurityPool.securityPool), legitimateCollateralBeforeAuction + expectedEthToBuy, 'prefinalization forker surplus must not be forwarded to the child')
			strictEqualTypeSafe(await getETHBalance(client, securityPoolForker), forkerBalanceBeforeForce + forcedForkerSurplus, 'forced forker ETH should remain isolated after forwarding auction proceeds')
		})

		test('auction claims move cumulative bad debt with capacity ownership independent of claim order', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[4])
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			await setVaultCapacityFixture(passiveRepHolder, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, passiveRepHolder.account.address, repDeposit / 4n)
			await mockWindow.setTime(endTime + 10000n)
			const parentUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, parentUnderwritingLimitAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, parentUnderwritingLimitAttoEth)

			await triggerExternalForkForSecurityPool(undefined, 'non-divisible fully utilized fork source')
			const parentSettlementCollateralAtForkAttoEth = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const fullyUtilizedUnderwritingLimitAttoEth = (parentSettlementCollateralAtForkAttoEth * statoblastSecurityMultiplierBps) / 10_000n
			const parentVaultSlot = getAddressMappingStorageSlot(client.account.address, 16n)
			await mockWindow.addStateOverrides({
				[securityPoolAddresses.securityPool]: {
					stateDiff: {
						[formatStorageSlot(1n)]: fullyUtilizedUnderwritingLimitAttoEth,
						[formatStorageSlot(parentVaultSlot + 1n)]: fullyUtilizedUnderwritingLimitAttoEth,
					},
				},
			})
			strictEqualTypeSafe(await getTotalUnderwritingLimitAttoEth(client, securityPoolAddresses.securityPool), fullyUtilizedUnderwritingLimitAttoEth, 'the parent must be fully utilized at the fork snapshot')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const { yesSecurityPool } = getYesChildPool()
			const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const migratedAttoRep = await getMigratedAttoRep(client, yesSecurityPool.securityPool)
			assert.ok((parentSettlementCollateralAtForkAttoEth * migratedAttoRep) % parentForkData.auctionableAttoRepAtFork > 0n, 'the migration ratio must require collateral rounding')

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			const auctionEthRaiseCap = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			await submitBid(auctionParticipant, yesSecurityPool.truthAuction, TRUTH_AUCTION_MAX_TICK, auctionEthRaiseCap)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'rounding must not block finalization')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), parentSettlementCollateralAtForkAttoEth, 'capacity ownership')
		})
	})
})
