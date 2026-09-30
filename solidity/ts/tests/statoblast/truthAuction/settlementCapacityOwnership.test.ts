import { statoblast_SecurityPool_SecurityPool, test_statoblast_SecurityPoolForkerAuctionSettlementHarness_AuctionSettlementPoolHarness, test_statoblast_SecurityPoolForkerAuctionSettlementHarness_SecurityPoolForkerAuctionSettlementHarness } from '../../../types/contractArtifact'
import { formatStorageSlot } from '../../../testSupport/storage'
import { createCompleteSet, depositRepToVault, getTotalRepBackingUnits, getRepToken, getSecurityVault, getTotalAccruedFees, getTotalClaimableVaultFeesAttoEth, getTotalUnderwritingLimitAttoEth, backingUnitsToAttoRep, updateVaultFees } from '../../../testSupport/simulator/utils/contracts/securityPool'
import { getTotalRepPurchasedAttoRep, getEthRaiseCapAttoEth } from '../../../testSupport/simulator/utils/contracts/auction'
import { getTotalTheoreticalSupply, getZoltarAddress } from '../../../testSupport/simulator/utils/contracts/zoltar'
import { claimAuctionProceeds, finalizeTruthAuction, getSecurityPoolForkerForkData, migrateRepToZoltar, migrateVault, startTruthAuction } from '../../../testSupport/simulator/utils/contracts/securityPoolForker'
import { QuestionOutcome } from '../../../testSupport/simulator/types/types'
import { getQuestionEndDate, participateAuction } from '../../../testSupport/simulator/utils/contracts/statoblast'
import { applyLibraries } from '../../../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveAndDepositRepToVault, setVaultCapacityFixture } from '../../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { addressString } from '../../../testSupport/simulator/utils/bigint'
import { DAY, TEST_ADDRESSES } from '../../../testSupport/simulator/utils/constants'
import { createWriteClient, writeContractAndWait } from '../../../testSupport/simulator/utils/clients'
import { encodeDeployData } from '@zoltar/core-shared/evm/ethereum'
import { approximatelyEqual, strictEqualTypeSafe } from '../../../testSupport/simulator/utils/testUtils'
import assert from '../../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { useStatoblastTruthAuctionFixture, type StatoblastTruthAuctionFixture } from '../fixture'
import { getFeeEpochEndTimeStorageSlot, setupFinalizedAuctionWithUnclaimedUnderwritingLimitAttoEth } from './helpers'

describe('Statoblast: truth auction', () => {
	const fixture = useStatoblastTruthAuctionFixture()
	const feeEpochEndTimeStorageSlot = getFeeEpochEndTimeStorageSlot()

	const { repDeposit, triggerExternalForkForSecurityPool, getYesChildPool } = fixture

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
		test('a winner claim adds auctioned capacity ownership to an existing migrated vault', async () => {
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			const endTime = await getQuestionEndDate(client, questionId)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await mockWindow.setTime(endTime + 10000n)

			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			await mockWindow.advanceTime(10n * 60n)
			await setVaultCapacityFixture(attackerClient, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, attackerClient.account.address, securityPoolUnderwritingLimitAttoEth)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'capacity ownership')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()
			const migratedVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
			const parentUnderwritingLimitAttoEthAtFork = await getTotalUnderwritingLimitAttoEth(client, securityPoolAddresses.securityPool)
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			const auctionTick = await participateAuction(client, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			const forkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
			const totalAttoRepPurchased = await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction)
			const expectedAuctionedUnderwritingLimitAttoEth = parentUnderwritingLimitAttoEthAtFork - migratedVaultBeforeClaim.underwritingLimitAttoEth
			strictEqualTypeSafe(forkData.auctionedUnderwritingLimitAttoEth, expectedAuctionedUnderwritingLimitAttoEth, 'capacity ownership')
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, client.account.address, [{ tick: auctionTick, bidIndex: 0n }])

			const migratedVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const expectedUnderwritingLimitAttoEthAfterClaim = migratedVaultBeforeClaim.underwritingLimitAttoEth + (forkData.auctionedUnderwritingLimitAttoEth * totalAttoRepPurchased) / totalAttoRepPurchased

			strictEqualTypeSafe(forkData.auctionedUnderwritingLimitAttoEth > 0n, true, 'capacity ownership')
			strictEqualTypeSafe(migratedVaultAfterClaim.underwritingLimitAttoEth, expectedUnderwritingLimitAttoEthAfterClaim, 'capacity ownership')
		})

		test('winner claims preserve pool totals after migrated capacity ownership decreases', async () => {
			const { auctionParticipant, auctionTick, auctionedUnderwritingLimitAttoEth, migratedUnderwritingLimitAttoEth, yesSecurityPool } = await setupFinalizedAuctionWithUnclaimedUnderwritingLimitAttoEth(fixture, 'capacity ownership')
			const decreasedMigratedUnderwritingLimitAttoEth = migratedUnderwritingLimitAttoEth / 2n

			await setVaultCapacityFixture(client, mockWindow, yesSecurityPool.openOraclePriceCoordinator, client.account.address, decreasedMigratedUnderwritingLimitAttoEth)
			strictEqualTypeSafe(await getTotalUnderwritingLimitAttoEth(client, yesSecurityPool.securityPool), auctionedUnderwritingLimitAttoEth + decreasedMigratedUnderwritingLimitAttoEth, 'capacity ownership')

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])

			const participantVault = await getSecurityVault(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
			strictEqualTypeSafe(participantVault.underwritingLimitAttoEth, auctionedUnderwritingLimitAttoEth, 'capacity ownership')
			strictEqualTypeSafe(await getTotalUnderwritingLimitAttoEth(client, yesSecurityPool.securityPool), auctionedUnderwritingLimitAttoEth + decreasedMigratedUnderwritingLimitAttoEth, 'capacity ownership')
		})

		test('fee accounting reconciles after migrated capacity ownership increases before a winner claim', async () => {
			const { auctionParticipant, auctionTick, migratedUnderwritingLimitAttoEth, yesSecurityPool } = await setupFinalizedAuctionWithUnclaimedUnderwritingLimitAttoEth(fixture, 'capacity ownership')
			const increasedMigratedUnderwritingLimitAttoEth = migratedUnderwritingLimitAttoEth * 2n

			await setVaultCapacityFixture(client, mockWindow, yesSecurityPool.openOraclePriceCoordinator, client.account.address, increasedMigratedUnderwritingLimitAttoEth)
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])

			await mockWindow.advanceTime(DAY)
			const feeEpochEndTime = (await client.getBlock()).timestamp
			await mockWindow.addStateOverrides({
				[yesSecurityPool.securityPool]: { stateDiff: { [formatStorageSlot(feeEpochEndTimeStorageSlot)]: feeEpochEndTime } },
			})
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			await updateVaultFees(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
			approximatelyEqual(await getTotalAccruedFees(client, yesSecurityPool.securityPool), await getTotalClaimableVaultFeesAttoEth(client, yesSecurityPool.securityPool), 1n, 'capacity ownership')
		})

		test('claimAuctionProceeds initializes fee accounting for a newly auction-funded vault at the current pool fee index', async () => {
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
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'fee-index fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			const auctionTick = await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			await mockWindow.advanceTime(DAY)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			const migratedVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])

			const participantVault = await getSecurityVault(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
			const feeIndexAfterClaim = (await client.readContract({ address: yesSecurityPool.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'getPoolAccountingSnapshot', args: [] })).feeIndex
			assert.ok(feeIndexAfterClaim >= migratedVaultBeforeClaim.feeIndex, 'the child fee index must not move backward while the claim is mined')
			strictEqualTypeSafe(participantVault.feeIndex, feeIndexAfterClaim, 'newly auction-funded vaults should inherit the current child-pool fee index')
			const [associatedRepPerCapacityBps, poolHeldRepPerCapacityBps] = await client.readContract({
				address: yesSecurityPool.securityPool,
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'getVaultCapacityBackingFactorsBps',
				args: [auctionParticipant.account.address],
			})
			assert.ok(associatedRepPerCapacityBps > 0n, 'auction-funded backing should produce a derived associated REP-per-capacity ratio')
			strictEqualTypeSafe(poolHeldRepPerCapacityBps, associatedRepPerCapacityBps, 'a new auction-funded vault with no escalation stake should have equal derived backing ratios')
		})

		test('claimAuctionProceeds allows a vault to claim winning bids across multiple calls', async () => {
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
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'multi-claim fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			const firstBidEth = expectedEthToBuy / 2n
			const secondBidEth = expectedEthToBuy - firstBidEth
			const firstAuctionTick = await participateAuction(client, yesSecurityPool.truthAuction, repAtFork / 8n, firstBidEth)
			const secondAuctionTick = await participateAuction(client, yesSecurityPool.truthAuction, repAtFork / 8n, secondBidEth)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, client.account.address, [{ tick: firstAuctionTick, bidIndex: 0n }])
			const vaultAfterFirstClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const repAfterFirstClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, vaultAfterFirstClaim.repBackingUnits)

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, client.account.address, [{ tick: secondAuctionTick, bidIndex: 1n }])
			const vaultAfterSecondClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const repAfterSecondClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, vaultAfterSecondClaim.repBackingUnits)

			assert.ok(repAfterFirstClaim > 0n, 'first claim should credit some REP-backed backingUnits')
			assert.ok(repAfterSecondClaim > repAfterFirstClaim, 'second claim should be able to add the remaining winning bid')
		})

		test('auctioned capacity ownership allocation is independent of winner claim order', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const baseSecurityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			const securityPoolUnderwritingLimitAttoEth = baseSecurityPoolUnderwritingLimitAttoEth - (baseSecurityPoolUnderwritingLimitAttoEth % 3n) + 1n

			const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6])
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await setVaultCapacityFixture(passiveRepHolder, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, passiveRepHolder.account.address, securityPoolUnderwritingLimitAttoEth)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const firstBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			const secondBidder = createWriteClient(mockWindow, TEST_ADDRESSES[4])
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'capacity ownership')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			const firstAuctionTick = await participateAuction(firstBidder, yesSecurityPool.truthAuction, repAtFork / 6n, expectedEthToBuy / 3n)
			const secondAuctionTick = await participateAuction(secondBidder, yesSecurityPool.truthAuction, repAtFork / 3n, expectedEthToBuy - expectedEthToBuy / 3n)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			const forkDataBeforeClaims = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
			const claimsSnapshot = await mockWindow.anvilSnapshot()
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, firstBidder.account.address, [{ tick: firstAuctionTick, bidIndex: 0n }])
			const secondBidIndex = secondAuctionTick === firstAuctionTick ? 1n : 0n
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, secondBidder.account.address, [{ tick: secondAuctionTick, bidIndex: secondBidIndex }])

			const firstVaultFirstOrder = await getSecurityVault(client, yesSecurityPool.securityPool, firstBidder.account.address)
			const secondVaultFirstOrder = await getSecurityVault(client, yesSecurityPool.securityPool, secondBidder.account.address)
			const firstOrderUnderwritingLimitAttoEthTotal = firstVaultFirstOrder.underwritingLimitAttoEth + secondVaultFirstOrder.underwritingLimitAttoEth

			await mockWindow.anvilRevert(claimsSnapshot)
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, secondBidder.account.address, [{ tick: secondAuctionTick, bidIndex: secondBidIndex }])
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, firstBidder.account.address, [{ tick: firstAuctionTick, bidIndex: 0n }])

			const firstVaultReverseOrder = await getSecurityVault(client, yesSecurityPool.securityPool, firstBidder.account.address)
			const secondVaultReverseOrder = await getSecurityVault(client, yesSecurityPool.securityPool, secondBidder.account.address)
			const reverseOrderUnderwritingLimitAttoEthTotal = firstVaultReverseOrder.underwritingLimitAttoEth + secondVaultReverseOrder.underwritingLimitAttoEth

			const auctionBackingBudget = (await getTotalRepBackingUnits(client, yesSecurityPool.securityPool)) - repAtFork
			strictEqualTypeSafe(firstVaultFirstOrder.repBackingUnits + secondVaultFirstOrder.repBackingUnits, auctionBackingBudget, 'all auction backing units must be assigned without dust')
			strictEqualTypeSafe(firstVaultReverseOrder.repBackingUnits, firstVaultFirstOrder.repBackingUnits, 'REP backing allocation must not depend on claim order')
			strictEqualTypeSafe(secondVaultReverseOrder.repBackingUnits, secondVaultFirstOrder.repBackingUnits, 'REP backing allocation must not depend on claim order')
			strictEqualTypeSafe(firstOrderUnderwritingLimitAttoEthTotal, forkDataBeforeClaims.auctionedUnderwritingLimitAttoEth, 'capacity ownership')
			strictEqualTypeSafe(reverseOrderUnderwritingLimitAttoEthTotal, forkDataBeforeClaims.auctionedUnderwritingLimitAttoEth, 'capacity ownership')
			strictEqualTypeSafe(firstVaultReverseOrder.underwritingLimitAttoEth, firstVaultFirstOrder.underwritingLimitAttoEth, 'capacity ownership')
			strictEqualTypeSafe(secondVaultReverseOrder.underwritingLimitAttoEth, secondVaultFirstOrder.underwritingLimitAttoEth, 'capacity ownership')
		})

		test('auction settlement assigns deterministic bad-debt dust independent of claim order', async () => {
			const poolDeploymentHash = await client.sendTransaction({
				data: `0x${test_statoblast_SecurityPoolForkerAuctionSettlementHarness_AuctionSettlementPoolHarness.evm.bytecode.object}`,
			})
			const poolReceipt = await client.waitForTransactionReceipt({ hash: poolDeploymentHash })
			const poolAddress = poolReceipt.contractAddress
			if (poolAddress === undefined || poolAddress === null) throw new Error('auction settlement pool harness deployment address missing')

			const forkerDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_statoblast_SecurityPoolForkerAuctionSettlementHarness_SecurityPoolForkerAuctionSettlementHarness.abi,
					bytecode: applyLibraries(test_statoblast_SecurityPoolForkerAuctionSettlementHarness_SecurityPoolForkerAuctionSettlementHarness.evm.bytecode.object),
					args: [getZoltarAddress()],
				}),
			})
			const forkerReceipt = await client.waitForTransactionReceipt({ hash: forkerDeploymentHash })
			const forkerAddress = forkerReceipt.contractAddress
			if (forkerAddress === undefined || forkerAddress === null) throw new Error('auction settlement forker harness deployment address missing')

			const zeroRepVault = addressString(TEST_ADDRESSES[1])
			const positiveRepVault = addressString(TEST_ADDRESSES[2])
			const credit = async (vault: typeof zeroRepVault, attoRepAmount: bigint, underwritingLimitAttoEthAmount: bigint, badDebtAttoEth: bigint) => {
				const hash = await client.writeContract({
					address: forkerAddress,
					abi: test_statoblast_SecurityPoolForkerAuctionSettlementHarness_SecurityPoolForkerAuctionSettlementHarness.abi,
					functionName: 'creditAuctionProceeds',
					args: [poolAddress, vault, attoRepAmount, underwritingLimitAttoEthAmount, badDebtAttoEth],
				})
				await client.waitForTransactionReceipt({ hash })
			}
			const readVault = async (vault: typeof zeroRepVault) =>
				await client.readContract({
					address: poolAddress,
					abi: test_statoblast_SecurityPoolForkerAuctionSettlementHarness_AuctionSettlementPoolHarness.abi,
					functionName: 'securityVaults',
					args: [vault],
				})
			const auctionedBadDebtAttoEth = 2n
			await writeContractAndWait(client, () =>
				client.writeContract({
					address: poolAddress,
					abi: test_statoblast_SecurityPoolForkerAuctionSettlementHarness_AuctionSettlementPoolHarness.abi,
					functionName: 'setTotalBadDebtAttoEth',
					args: [auctionedBadDebtAttoEth],
				}),
			)
			await writeContractAndWait(client, () =>
				client.writeContract({
					address: forkerAddress,
					abi: test_statoblast_SecurityPoolForkerAuctionSettlementHarness_SecurityPoolForkerAuctionSettlementHarness.abi,
					functionName: 'configureAuctionBadDebt',
					args: [poolAddress, auctionedBadDebtAttoEth],
				}),
			)

			const settlementSnapshot = await mockWindow.anvilSnapshot()
			await credit(zeroRepVault, 0n, 0n, 1n)
			await credit(positiveRepVault, 1n, 3n, 1n)
			const zeroRepForward = await readVault(zeroRepVault)
			const positiveRepForward = await readVault(positiveRepVault)
			strictEqualTypeSafe(zeroRepForward[0], 0n, 'capacity ownership')
			strictEqualTypeSafe(zeroRepForward[1], 0n, 'capacity ownership')
			strictEqualTypeSafe(positiveRepForward[0], 10n, 'positive REP settlement should receive its assigned backing-unit allocation')
			strictEqualTypeSafe(positiveRepForward[1], 3n, 'capacity ownership')
			strictEqualTypeSafe(await client.readContract({ address: poolAddress, abi: test_statoblast_SecurityPoolForkerAuctionSettlementHarness_AuctionSettlementPoolHarness.abi, functionName: 'vaultBadDebtAttoEth', args: [zeroRepVault] }), 1n, 'a debt-only auction position should still assign its bad-debt slice')
			strictEqualTypeSafe(
				await client.readContract({ address: poolAddress, abi: test_statoblast_SecurityPoolForkerAuctionSettlementHarness_AuctionSettlementPoolHarness.abi, functionName: 'vaultBadDebtAttoEth', args: [positiveRepVault] }),
				1n,
				'the later auction position should receive the indivisible bad-debt residue',
			)

			await mockWindow.anvilRevert(settlementSnapshot)
			await credit(positiveRepVault, 1n, 3n, 1n)
			await credit(zeroRepVault, 0n, 0n, 1n)
			const zeroRepReverse = await readVault(zeroRepVault)
			const positiveRepReverse = await readVault(positiveRepVault)
			strictEqualTypeSafe(zeroRepReverse[1], zeroRepForward[1], 'capacity ownership')
			strictEqualTypeSafe(positiveRepReverse[1], positiveRepForward[1], 'capacity ownership')
			strictEqualTypeSafe(await client.readContract({ address: poolAddress, abi: test_statoblast_SecurityPoolForkerAuctionSettlementHarness_AuctionSettlementPoolHarness.abi, functionName: 'vaultBadDebtAttoEth', args: [zeroRepVault] }), 1n, 'auctioned bad-debt allocation should be independent of claim order')
			strictEqualTypeSafe(
				await client.readContract({ address: poolAddress, abi: test_statoblast_SecurityPoolForkerAuctionSettlementHarness_AuctionSettlementPoolHarness.abi, functionName: 'vaultBadDebtAttoEth', args: [positiveRepVault] }),
				1n,
				'the deterministic later auction position should consume the indivisible residue',
			)

			const totalEligibleUnderwritingLimitAttoEth = await client.readContract({
				address: poolAddress,
				abi: test_statoblast_SecurityPoolForkerAuctionSettlementHarness_AuctionSettlementPoolHarness.abi,
				functionName: 'feeEligibleUnderwritingLimitAttoEth',
				args: [],
			})
			strictEqualTypeSafe(totalEligibleUnderwritingLimitAttoEth, 0n, 'claim settlement should not add already-eligible auction capacity to the denominator')
		})
	})
})
