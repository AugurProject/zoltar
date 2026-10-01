import {
	statoblast_SecurityPoolForker_SecurityPoolForker,
	statoblast_SecurityPool_SecurityPool,
	statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
	test_statoblast_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver as rejectingEthReceiverArtifact,
} from '../../../types/contractArtifact'
import { formatStorageSlot, getAddressMappingStorageSlot } from '../../../testSupport/storage'
import { createCompleteSet, depositRepToVault, getSettlementCollateralAttoEth, getTotalRepBackingUnits, getRepToken, getSecurityVault, getSystemState, getTotalUnderwritingLimitAttoEth, getVaultCount, backingUnitsToAttoRep } from '../../../testSupport/simulator/utils/contracts/securityPool'
import { getTotalRepPurchasedAttoRep, getEthRaiseCapAttoEth, getMaxRepBeingSoldAttoRep, getMinBidSizeAttoEth } from '../../../testSupport/simulator/utils/contracts/auction'
import { getTotalTheoreticalSupply } from '../../../testSupport/simulator/utils/contracts/zoltar'
import { claimAuctionProceeds, createChildUniverse, finalizeTruthAuction, getMigratedAttoRep, getSecurityPoolForkerForkData, migrateRepToZoltar, migrateVault, startTruthAuction } from '../../../testSupport/simulator/utils/contracts/securityPoolForker'
import { SystemState } from '../../../testSupport/simulator/types/statoblastTypes'
import { QuestionOutcome } from '../../../testSupport/simulator/types/types'
import { tickToPrice } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'
import { getQuestionEndDate, participateAuction } from '../../../testSupport/simulator/utils/contracts/statoblast'
import { getInfraContractAddresses } from '../../../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveAndDepositRepToVault, manipulatePriceOracle, setVaultCapacityFixture } from '../../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { approveToken, getETHBalance } from '../../../testSupport/simulator/utils/utilities'
import { DAY, TEST_ADDRESSES } from '../../../testSupport/simulator/utils/constants'
import { createWriteClient } from '../../../testSupport/simulator/utils/clients'
import { encodeDeployData, encodeFunctionData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { strictEqualTypeSafe } from '../../../testSupport/simulator/utils/testUtils'
import assert from '../../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { useStatoblastTruthAuctionFixture, type StatoblastTruthAuctionFixture } from '../fixture'
import { priceToClosestTick } from '../../../testSupport/truthAuctionTicks'
import { getPendingAuctionRefund, withdrawPendingAuctionRefund } from './helpers'

describe('Statoblast: truth auction', () => {
	const fixture = useStatoblastTruthAuctionFixture()

	const { PRICE_PRECISION, repDeposit, triggerExternalForkForSecurityPool, setupStartedTruthAuction, getYesChildPool } = fixture

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

	const deployRejectingEthReceiver = async (): Promise<Address> => {
		const hash = await client.sendTransaction({
			data: encodeDeployData({
				abi: rejectingEthReceiverArtifact.abi,
				bytecode: `0x${rejectingEthReceiverArtifact.evm.bytecode.object}`,
			}),
		})
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (typeof receipt.contractAddress !== 'string') throw new Error('rejecting ETH receiver deployment address is unavailable')
		return receipt.contractAddress
	}

	const executeThroughReceiver = async (receiver: Address, target: Address, data: Hex, value = 0n) => {
		const hash = await client.writeContract({
			abi: rejectingEthReceiverArtifact.abi,
			address: receiver,
			functionName: 'execute',
			args: [target, data],
			value,
		})
		await client.waitForTransactionReceipt({ hash })
	}

	describe('auction bidding and claim settlement', () => {
		test('claimAuctionProceeds handles a zero-REP finalized refund path when totalAttoRepPurchased is zero', async () => {
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

			await triggerExternalForkForSecurityPool(undefined, 'zero rep refund fork source')
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
			strictEqualTypeSafe(losingEth > 0n, true, 'zero-REP refund test should invest a positive amount')
			const losingTick = await participateAuction(losingBidder, yesSecurityPool.truthAuction, repAtFork, losingEth)
			await participateAuction(winningBidder, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			const packedFinalizationSlot = formatStorageSlot(6n)
			const packedFinalizationState = await mockWindow.request({ method: 'eth_getStorageAt', params: [yesSecurityPool.truthAuction, packedFinalizationSlot, 'latest'] })
			if (typeof packedFinalizationState !== 'string') throw new Error('Auction finalization storage unavailable')
			const totalAttoRepPurchasedMask = ((1n << 88n) - 1n) << 128n
			await mockWindow.addStateOverrides({
				[yesSecurityPool.truthAuction]: {
					stateDiff: {
						[packedFinalizationSlot]: BigInt(packedFinalizationState) & ~totalAttoRepPurchasedMask,
					},
				},
			})

			strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), 0n, 'setup should finalize with zero purchased REP')

			const vaultCountBeforeClaim = await getVaultCount(client, yesSecurityPool.securityPool)
			const losingBidderBalanceBeforeClaim = await getETHBalance(client, losingBidder.account.address)
			const losingVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
			strictEqualTypeSafe(await getPendingAuctionRefund(client, yesSecurityPool.truthAuction, losingBidder.account.address), losingEth, 'zero-REP finalized refund credit')
			await withdrawPendingAuctionRefund(losingBidder, yesSecurityPool.truthAuction)

			const losingBidderBalanceAfterClaim = await getETHBalance(client, losingBidder.account.address)
			const losingVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)
			const vaultCountAfterClaim = await getVaultCount(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(losingBidderBalanceAfterClaim - losingBidderBalanceBeforeClaim, losingEth, 'zero-REP finalized claim should release the full ETH refund')
			strictEqualTypeSafe(losingVaultAfterClaim.repBackingUnits, losingVaultBeforeClaim.repBackingUnits, 'zero-REP finalized claim should not mint REP backing units')
			strictEqualTypeSafe(losingVaultAfterClaim.underwritingLimitAttoEth, losingVaultBeforeClaim.underwritingLimitAttoEth, 'zero-REP finalized claim should not assign capacity ownership')
			strictEqualTypeSafe(losingVaultAfterClaim.feeIndex, losingVaultBeforeClaim.feeIndex, 'zero-REP finalized claim should not alter fee accounting')
			strictEqualTypeSafe(vaultCountAfterClaim, vaultCountBeforeClaim, 'zero-REP finalized claim should not create a new vault')
		})

		test('minimum-bid underfunded winner receives the full auction REP without an uncompensated repair contribution', async () => {
			const unmigratedUnderwritingLimitAttoEthHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			await approveAndDepositRepToVault(unmigratedUnderwritingLimitAttoEthHolder, repDeposit, questionId)
			await setVaultCapacityFixture(unmigratedUnderwritingLimitAttoEthHolder, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, unmigratedUnderwritingLimitAttoEthHolder.account.address, repDeposit / 8n)
			const { yesSecurityPool, expectedEthToBuy } = await setupStartedTruthAuction('minimum bid extraction fork source')
			const auctionCap = await getMaxRepBeingSoldAttoRep(client, yesSecurityPool.truthAuction)
			const minBidSizeAttoEth = await getMinBidSizeAttoEth(client, yesSecurityPool.truthAuction)
			const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const attackerTick = await participateAuction(attacker, yesSecurityPool.truthAuction, 1n, minBidSizeAttoEth)
			assert.ok(minBidSizeAttoEth < expectedEthToBuy / 1_000n, 'test setup should keep the minimum bid economically tiny relative to the target raise')
			const finalizerVaultBefore = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const parentUnderwritingLimitAttoEth = await getTotalUnderwritingLimitAttoEth(client, securityPoolAddresses.securityPool)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'successfully finalizing an underfunded auction should leave the child operational without a retry')

			const expectedAttackerRep = auctionCap
			strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), expectedAttackerRep, 'one qualifying minimum bid should buy the complete auction REP cap at the weak-demand clearing price')
			const forkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
			const unmigratedUnderwritingLimitAttoEth = parentUnderwritingLimitAttoEth - finalizerVaultBefore.underwritingLimitAttoEth
			const expectedAuctionedUnderwritingLimitAttoEth = unmigratedUnderwritingLimitAttoEth
			strictEqualTypeSafe(forkData.auctionedUnderwritingLimitAttoEth, expectedAuctionedUnderwritingLimitAttoEth, 'capacity ownership')
			const finalizerVaultAfter = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			strictEqualTypeSafe(finalizerVaultAfter.repBackingUnits, finalizerVaultBefore.repBackingUnits, 'finalizing an underfunded auction must not issue REP backing units to the finalizer')
			strictEqualTypeSafe(finalizerVaultAfter.underwritingLimitAttoEth, finalizerVaultBefore.underwritingLimitAttoEth, 'finalizing an underfunded auction must not assign capacity ownership to the finalizer')

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, attacker.account.address, [{ tick: attackerTick, bidIndex: 0n }])

			const attackerVault = await getSecurityVault(client, yesSecurityPool.securityPool, attacker.account.address)
			const attackerRepClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, attackerVault.repBackingUnits)
			strictEqualTypeSafe(attackerRepClaim, expectedAttackerRep, 'settling the only qualifying bid should credit the complete auction REP cap')
			strictEqualTypeSafe(attackerVault.underwritingLimitAttoEth, expectedAuctionedUnderwritingLimitAttoEth, 'capacity ownership')
		})

		test('zero-migration full-cap settlement keeps backingUnits conversion while rejecting post-end deposits', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			await createCompleteSet(createWriteClient(mockWindow, TEST_ADDRESSES[1]), securityPoolAddresses.securityPool, 10n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, 'zero-migration backingUnits normalization source')
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getMigratedAttoRep(client, yesSecurityPool.securityPool), 0n, 'test requires a child with no migrated vault REP')
			const auctionCap = await getMaxRepBeingSoldAttoRep(client, yesSecurityPool.truthAuction)
			const minBidSizeAttoEth = await getMinBidSizeAttoEth(client, yesSecurityPool.truthAuction)
			const auctionWinner = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const winningTick = await participateAuction(auctionWinner, yesSecurityPool.truthAuction, 1n, minBidSizeAttoEth)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), auctionCap, 'the qualifying minimum bid should receive the complete zero-migration cap')

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionWinner.account.address, [{ tick: winningTick, bidIndex: 0n }])
			const winnerVault = await getSecurityVault(client, yesSecurityPool.securityPool, auctionWinner.account.address)
			strictEqualTypeSafe(await getTotalRepBackingUnits(client, yesSecurityPool.securityPool), auctionCap * PRICE_PRECISION, 'a zero-migration full sale should normalize backingUnits to the standard REP scale')
			strictEqualTypeSafe(await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, winnerVault.repBackingUnits), auctionCap, 'the complete-cap winner should be able to convert every backingUnits unit back to REP')

			const freshVault = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			const childRepToken = await getRepToken(client, yesSecurityPool.securityPool)
			const supplyBasedMinimumDeposit = (await getTotalTheoreticalSupply(client, childRepToken)) / 100_000n
			const freshDeposit = supplyBasedMinimumDeposit > 10n * 10n ** 18n ? supplyBasedMinimumDeposit : 10n * 10n ** 18n
			const freshVaultBalanceSlot = formatStorageSlot(getAddressMappingStorageSlot(freshVault.account.address, 0n))
			await mockWindow.addStateOverrides({
				[childRepToken]: {
					stateDiff: {
						[freshVaultBalanceSlot]: freshDeposit,
					},
				},
			})
			await approveToken(freshVault, childRepToken, yesSecurityPool.securityPool)
			await assert.rejects(depositRepToVault(freshVault, yesSecurityPool.securityPool, freshDeposit))

			const freshVaultState = await getSecurityVault(client, yesSecurityPool.securityPool, freshVault.account.address)
			strictEqualTypeSafe(freshVaultState.repBackingUnits, 0n, 'an unrelated-fork child must not admit a fresh depositor after the question end')
			strictEqualTypeSafe(await getTotalRepBackingUnits(client, yesSecurityPool.securityPool), auctionCap * PRICE_PRECISION, 'a rejected late deposit must not dilute the auction winner')
		})

		test('permissionless winner settlement assigns capacity once when an ETH refund is credited', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)

			const unmigratedVault = createWriteClient(mockWindow, TEST_ADDRESSES[4])
			await approveAndDepositRepToVault(unmigratedVault, 2n * forkThresholdAttoRep, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			await mockWindow.advanceTime(10n * 60n)
			await setVaultCapacityFixture(unmigratedVault, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, unmigratedVault.account.address, securityPoolUnderwritingLimitAttoEth)
			await createCompleteSet(createWriteClient(mockWindow, TEST_ADDRESSES[2]), securityPoolAddresses.securityPool, 10n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, 'rejecting auction winner capacity source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const rejectingWinner = await deployRejectingEthReceiver()
			const auctionAbi = statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi
			const reservePrice = await client.readContract({
				abi: auctionAbi,
				address: yesSecurityPool.truthAuction,
				functionName: 'underfundedThreshold',
				args: [],
			})
			const closestTick = priceToClosestTick(reservePrice)
			const winningTick = tickToPrice(closestTick) < reservePrice ? closestTick + 1n : closestTick
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			const bidAmount = expectedEthToBuy * 2n
			await executeThroughReceiver(rejectingWinner, yesSecurityPool.truthAuction, encodeFunctionData({ abi: auctionAbi, functionName: 'submitBid', args: [winningTick] }), bidAmount)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			const forkDataBeforeClaim = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
			assert.ok(forkDataBeforeClaim.auctionedUnderwritingLimitAttoEth > 0n, 'capacity ownership')
			await client.writeContract({
				abi: rejectingEthReceiverArtifact.abi,
				address: rejectingWinner,
				functionName: 'setConsumeAllGas',
				args: [true],
			})

			const snapshotBeforeClaim = await client.readContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: yesSecurityPool.securityPool,
				functionName: 'getPoolAccountingSnapshot',
				args: [],
			})
			strictEqualTypeSafe(snapshotBeforeClaim.feeEligibleUnderwritingLimitAttoEth, snapshotBeforeClaim.totalUnderwritingLimitAttoEth, 'sold auction capacity should already be fee-eligible before its winner claims')
			const childRepToken = await getRepToken(client, yesSecurityPool.securityPool)
			const reporterBalanceSlot = formatStorageSlot(getAddressMappingStorageSlot(client.account.address, 0n))
			await mockWindow.addStateOverrides({
				[childRepToken]: {
					stateDiff: {
						[reporterBalanceSlot]: repDeposit,
					},
				},
			})
			await manipulatePriceOracle(client, mockWindow, yesSecurityPool.openOraclePriceCoordinator)
			const mintingCapacityBeforeClaim = await client.readContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: yesSecurityPool.securityPool,
				functionName: 'getCurrentMintingCapacityAttoEth',
				args: [],
			})
			assert.ok(mintingCapacityBeforeClaim > snapshotBeforeClaim.settlementCollateralAttoEth, 'aggregate capacity ownership should provide minting headroom before its auction winner claims')
			const capacityProbe = mintingCapacityBeforeClaim - snapshotBeforeClaim.settlementCollateralAttoEth
			const retentionRateBeforeClaim = await client.readContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: yesSecurityPool.securityPool,
				functionName: 'currentRetentionRate',
				args: [],
			})
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3])

			const claimHash = await client.writeContract({
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				address: getInfraContractAddresses().securityPoolForker,
				functionName: 'claimAuctionProceeds',
				args: [yesSecurityPool.securityPool, rejectingWinner, [{ tick: winningTick, bidIndex: 0n }]],
				gas: 2_000_000n,
			})
			await client.waitForTransactionReceipt({ hash: claimHash })
			const winnerVault = await getSecurityVault(client, yesSecurityPool.securityPool, rejectingWinner)
			assert.ok(winnerVault.repBackingUnits > 0n, 'permissionless settlement should assign the winner REP backingUnits')
			strictEqualTypeSafe(winnerVault.underwritingLimitAttoEth, forkDataBeforeClaim.auctionedUnderwritingLimitAttoEth, 'capacity ownership')
			const pendingRefund = await client.readContract({
				abi: auctionAbi,
				address: yesSecurityPool.truthAuction,
				functionName: 'pendingEthRefundsAttoEth',
				args: [rejectingWinner],
			})
			assert.ok(pendingRefund > 0n, 'the rejected partial-fill refund should remain in pull escrow')

			const snapshotAfterClaim = await client.readContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: yesSecurityPool.securityPool,
				functionName: 'getPoolAccountingSnapshot',
				args: [],
			})
			strictEqualTypeSafe(snapshotAfterClaim.feeEligibleUnderwritingLimitAttoEth, snapshotBeforeClaim.feeEligibleUnderwritingLimitAttoEth, 'claiming sold capacity should not add it to the fee denominator a second time')
			strictEqualTypeSafe(
				await client.readContract({
					abi: statoblast_SecurityPool_SecurityPool.abi,
					address: yesSecurityPool.securityPool,
					functionName: 'currentRetentionRate',
					args: [],
				}),
				retentionRateBeforeClaim,
				'assigning already-counted aggregate capacity should not change pool utilization',
			)
			await createCompleteSet(openInterestHolder, yesSecurityPool.securityPool, capacityProbe)
			assert.ok((await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)) <= mintingCapacityBeforeClaim, 'minted collateral must stay within aggregate backing even when an individual winner is underbacked')

			await client.writeContract({
				abi: rejectingEthReceiverArtifact.abi,
				address: rejectingWinner,
				functionName: 'setConsumeAllGas',
				args: [false],
			})
			await client.writeContract({
				abi: rejectingEthReceiverArtifact.abi,
				address: rejectingWinner,
				functionName: 'setRejectETH',
				args: [false],
			})
			const winnerEthBeforePull = await getETHBalance(client, rejectingWinner)
			await executeThroughReceiver(rejectingWinner, yesSecurityPool.truthAuction, encodeFunctionData({ abi: auctionAbi, functionName: 'withdrawPendingEthRefund', args: [] }))
			strictEqualTypeSafe((await getETHBalance(client, rejectingWinner)) - winnerEthBeforePull, pendingRefund, 'the winner should receive the complete credited refund after accepting ETH')
			strictEqualTypeSafe(
				await client.readContract({
					abi: auctionAbi,
					address: yesSecurityPool.truthAuction,
					functionName: 'pendingEthRefundsAttoEth',
					args: [rejectingWinner],
				}),
				0n,
				'the successful pull should clear the auction refund escrow',
			)
		})
	})
})
