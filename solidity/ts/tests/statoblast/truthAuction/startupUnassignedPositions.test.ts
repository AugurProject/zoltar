import { statoblast_SecurityPoolForker_SecurityPoolForker, Zoltar_Zoltar, statoblast_EscalationGame_EscalationGame, statoblast_SecurityPool_SecurityPool } from '../../../types/contractArtifact'
import { formatStorageSlot, getAddressMappingStorageSlot } from '../../../testSupport/storage'
import {
	createCompleteSet,
	redeemCompleteSet,
	depositRepToVault,
	depositToEscalationGame,
	withdrawFromEscalationGame,
	getSettlementCollateralAttoEth,
	getTotalRepBackingUnits,
	getRepToken,
	getSecurityVault,
	getSystemState,
	getTotalAccruedFees,
	getTotalClaimableVaultFeesAttoEth,
	getTotalUnderwritingLimitAttoEth,
	getShareTokenSupplyAttoShares,
	backingUnitsToAttoRep,
	redeemFees,
	updateVaultFees,
} from '../../../testSupport/simulator/utils/contracts/securityPool'
import { isIgnorableLogDecodeError } from '../../logDecodeErrors'
import { getTotalRepPurchasedAttoRep, getEthRaiseCapAttoEth, getMaxRepBeingSoldAttoRep } from '../../../testSupport/simulator/utils/contracts/auction'
import { getRepTokenAddress, getTotalTheoreticalSupply, getZoltarAddress } from '../../../testSupport/simulator/utils/contracts/zoltar'
import { claimAuctionProceeds, finalizeTruthAuction, getMigratedAttoRep, getOwnForkRepBuckets, getSecurityPoolForkerForkData, migrateRepToZoltar, migrateVault, startTruthAuction } from '../../../testSupport/simulator/utils/contracts/securityPoolForker'
import { SystemState } from '../../../testSupport/simulator/types/statoblastTypes'
import { QuestionOutcome } from '../../../testSupport/simulator/types/types'
import { getQuestionEndDate, participateAuction, migrateShares } from '../../../testSupport/simulator/utils/contracts/statoblast'
import { getInfraContractAddresses } from '../../../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveAndDepositRepToVault, manipulatePriceOracle, setVaultCapacityFixture } from '../../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { addressString, rpow } from '../../../testSupport/simulator/utils/bigint'
import { approveToken, getERC20Balance } from '../../../testSupport/simulator/utils/utilities'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../../testSupport/simulator/utils/constants'
import { createWriteClient, writeContractAndWait } from '../../../testSupport/simulator/utils/clients'
import { decodeEventLog } from '@zoltar/core-shared/evm/ethereum'
import { approximatelyEqual, ensureDefined, strictEqualTypeSafe } from '../../../testSupport/simulator/utils/testUtils'
import assert from '../../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { useStatoblastTruthAuctionFixture, type StatoblastTruthAuctionFixture } from '../fixture'
import { getUnassignedPosition } from './helpers'

describe('Statoblast: truth auction', () => {
	const fixture = useStatoblastTruthAuctionFixture()

	const { PRICE_PRECISION, reportBond, repDeposit, genesisUniverse, triggerExternalForkForSecurityPool, getYesChildPool } = fixture

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

	const setupLongDatedChildAuction = async (titlePrefix: string, forcedSurplusAboveUnderwritingLimitAttoEth?: bigint, purchaseAuctionRep = true, forcedAuctionedBadDebtAttoEth?: bigint) => {
		const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
		await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
		const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6])
		await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
		await setVaultCapacityFixture(passiveRepHolder, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, passiveRepHolder.account.address, repDeposit / 4n)
		await createCompleteSet(createWriteClient(mockWindow, TEST_ADDRESSES[1]), securityPoolAddresses.securityPool, 10n * 10n ** 18n)

		await triggerExternalForkForSecurityPool(undefined, titlePrefix)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const { yesSecurityPool } = getYesChildPool()
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
		const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
		const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3])
		const auctionTick = purchaseAuctionRep ? await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy) : 0n
		if (forcedSurplusAboveUnderwritingLimitAttoEth !== undefined) {
			await mockWindow.setBalance(yesSecurityPool.securityPool, securityPoolUnderwritingLimitAttoEth + forcedSurplusAboveUnderwritingLimitAttoEth)
		}
		if (forcedAuctionedBadDebtAttoEth !== undefined) {
			await mockWindow.addStateOverrides({
				[getInfraContractAddresses().securityPoolForker]: {
					stateDiff: {
						[formatStorageSlot(getAddressMappingStorageSlot(securityPoolAddresses.securityPool, 13n))]: forcedAuctionedBadDebtAttoEth,
					},
				},
			})
		}
		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		return { auctionParticipant, auctionTick, yesSecurityPool }
	}

	describe('auction startup and migration isolation', () => {
		test('late auction claims cannot assign debt from an exhausted collateral generation', async () => {
			const auctionedBadDebtAttoEth = 1n * 10n ** 18n
			const { auctionParticipant, auctionTick, yesSecurityPool } = await setupLongDatedChildAuction('late auction debt generation source', undefined, true, auctionedBadDebtAttoEth)
			const completeSetHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			for (const outcome of [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]) {
				await migrateShares(completeSetHolder, securityPoolAddresses.shareToken, genesisUniverse, outcome, [QuestionOutcome.Yes])
			}
			const originalClaimSupplyAttoShares = await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool)
			assert.ok(originalClaimSupplyAttoShares > 0n, 'the auctioned bad debt must belong to a funded collateral generation')
			await redeemCompleteSet(completeSetHolder, yesSecurityPool.securityPool, originalClaimSupplyAttoShares)
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), 0n, 'the original collateral generation should be exhausted before the delayed claim')
			strictEqualTypeSafe(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: yesSecurityPool.securityPool, functionName: 'totalBadDebtAttoEth' }), 0n, 'the exhausted generation should clear its aggregate auctioned debt')

			await createCompleteSet(client, yesSecurityPool.securityPool, 10n ** 15n)
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), 10n ** 15n, 'healthy aggregate backing permits a new collateral generation before a delayed auction claim')
			const nextGenerationBadDebtAttoEth = 1n
			await mockWindow.addStateOverrides({
				[yesSecurityPool.securityPool]: {
					stateDiff: {
						[formatStorageSlot(21n)]: nextGenerationBadDebtAttoEth,
					},
				},
			})
			const claimHash = await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])
			const claimReceipt = await client.waitForTransactionReceipt({ hash: claimHash })
			const claimEvent = claimReceipt.logs
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
				.find(log => log?.eventName === 'ClaimAuctionProceeds')
			if (claimEvent === undefined || claimEvent.eventName !== 'ClaimAuctionProceeds') throw new Error('late auction claim event missing')

			strictEqualTypeSafe(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: yesSecurityPool.securityPool, functionName: 'totalBadDebtAttoEth' }), nextGenerationBadDebtAttoEth, 'claiming an old auction must preserve unrelated current-generation aggregate debt')
			strictEqualTypeSafe(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: yesSecurityPool.securityPool, functionName: 'vaultBadDebtAttoEth', args: [auctionParticipant.account.address] }), 0n, 'the delayed auction winner must not inherit old-generation debt')
			strictEqualTypeSafe((await getUnassignedPosition(client, yesSecurityPool.securityPool)).badDebtAttoEth, 0n, 'the expired auction debt must not remain in the current unassigned position')
			strictEqualTypeSafe(claimEvent.args.claimedAuctionedBadDebtAttoEth, auctionedBadDebtAttoEth, 'late settlement must still advance the raw cumulative claimed-auction debt counter')
			strictEqualTypeSafe(claimEvent.args.auctionedBadDebtAttoEth, auctionedBadDebtAttoEth, 'late settlement must preserve the raw total auctioned debt counter')
		})

		for (const inheritedTie of [false, true]) {
			test(inheritedTie ? 'auction reopens an inherited threshold tie whose backing cannot pay the fork burn' : 'external-fork escalation backing is auctionable before the child game resumes', async () => {
				const endTime = await getQuestionEndDate(client, questionId)
				const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
				await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
				const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6])
				await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
				await setVaultCapacityFixture(passiveRepHolder, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, passiveRepHolder.account.address, repDeposit / 4n)
				const losingReporter = createWriteClient(mockWindow, TEST_ADDRESSES[2])
				await approveAndDepositRepToVault(losingReporter, inheritedTie ? 2n * forkThresholdAttoRep : repDeposit, questionId)
				await mockWindow.setTime(endTime + 10000n)
				const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
				await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
				await createCompleteSet(createWriteClient(mockWindow, TEST_ADDRESSES[1]), securityPoolAddresses.securityPool, 10n * 10n ** 18n)
				await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, inheritedTie ? forkThresholdAttoRep : 2n * reportBond)
				await depositToEscalationGame(losingReporter, securityPoolAddresses.securityPool, QuestionOutcome.No, inheritedTie ? forkThresholdAttoRep : reportBond)

				await triggerExternalForkForSecurityPool(undefined, 'external escalation auction accounting source')
				const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
				const parentRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
				assert.ok(parentRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep > 0n, 'the external fork should preserve unresolved escalation backing')
				await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
				const unresolvedMigrationHash = await client.writeContract({
					address: getInfraContractAddresses().securityPoolForker,
					abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
					functionName: 'migrateVaultWithUnresolvedEscalation',
					args: [securityPoolAddresses.securityPool, client.account.address, BigInt(QuestionOutcome.Yes)],
				})
				await client.waitForTransactionReceipt({ hash: unresolvedMigrationHash })

				const { yesUniverse, yesSecurityPool } = getYesChildPool()
				const childEscalationGame = await client.readContract({
					address: yesSecurityPool.securityPool,
					abi: statoblast_SecurityPool_SecurityPool.abi,
					functionName: 'escalationGame',
				})
				const childEscalationBalance = await getERC20Balance(client, getRepTokenAddress(yesUniverse), childEscalationGame)
				const recordedEscalationBacking = await client.readContract({
					address: childEscalationGame,
					abi: statoblast_EscalationGame_EscalationGame.abi,
					functionName: 'totalDisputeStakedAttoRep',
				})
				strictEqualTypeSafe(childEscalationBalance, parentRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep, 'the child game should physically hold the external-fork escalation bucket before resume')
				strictEqualTypeSafe(recordedEscalationBacking, childEscalationBalance, 'pre-resume escrow accounting must expose all physically backed dispute-staked REP to the truth auction')
				const outcomeBalancesBeforeAuction = await client.readContract({
					address: childEscalationGame,
					abi: statoblast_EscalationGame_EscalationGame.abi,
					functionName: 'getOutcomeBalancesAttoRep',
				})
				const vaultBeforeAuction = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

				await mockWindow.advanceTime(8n * 7n * DAY + DAY)
				await startTruthAuction(client, yesSecurityPool.securityPool)
				strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'the OI shortfall should require a truth auction')
				const migratedAttoRep = await getMigratedAttoRep(client, yesSecurityPool.securityPool)
				const combinedAuctionableRep = parentForkData.auctionableAttoRepAtFork + childEscalationBalance
				const migratedPoolRepRetention = (migratedAttoRep + 1_000_000n - 1n) / 1_000_000n
				const combinedRepRetention = (migratedPoolRepRetention * combinedAuctionableRep + parentForkData.auctionableAttoRepAtFork - 1n) / parentForkData.auctionableAttoRepAtFork
				const expectedAuctionCap = combinedAuctionableRep - combinedRepRetention
				strictEqualTypeSafe(await getMaxRepBeingSoldAttoRep(client, yesSecurityPool.truthAuction), expectedAuctionCap, 'the auction cap should include external-fork escalation backing before resume')
				const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3])
				await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, (expectedAuctionCap * (inheritedTie ? 99n : 50n)) / 100n, await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction))
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)

				const purchasedAttoRep = await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction)
				assert.ok(purchasedAttoRep > 0n, 'the regression requires a nonzero repair purchase')
				const poolIncumbentRepAfterAuction = (parentForkData.auctionableAttoRepAtFork * (combinedAuctionableRep - purchasedAttoRep)) / combinedAuctionableRep
				assert.ok(poolIncumbentRepAfterAuction >= migratedPoolRepRetention, 'combined pool-and-escalation retention must leave the complete migrated pool residue')
				const repBeforeHaircut = await client.readContract({
					address: childEscalationGame,
					abi: statoblast_EscalationGame_EscalationGame.abi,
					functionName: 'truthAuctionRepBeforeAttoRep',
				})
				const repRemainingAfterHaircut = await client.readContract({
					address: childEscalationGame,
					abi: statoblast_EscalationGame_EscalationGame.abi,
					functionName: 'truthAuctionRepRemainingAttoRep',
				})
				strictEqualTypeSafe(repBeforeHaircut, childEscalationBalance, 'the external-fork haircut denominator should include all child-game backing')
				assert.ok(repRemainingAfterHaircut < repBeforeHaircut, 'the external-fork truth auction should remove escalation backing')
				const outcomeBalancesAfterAuction = await client.readContract({
					address: childEscalationGame,
					abi: statoblast_EscalationGame_EscalationGame.abi,
					functionName: 'getOutcomeBalancesAttoRep',
				})
				for (let outcomeIndex = 0; outcomeIndex < outcomeBalancesAfterAuction.length; outcomeIndex += 1) {
					strictEqualTypeSafe(outcomeBalancesAfterAuction[outcomeIndex], (ensureDefined(outcomeBalancesBeforeAuction[outcomeIndex], 'missing outcome balance before auction') * repRemainingAfterHaircut) / repBeforeHaircut, 'external-fork outcome balances should rebase by the auction retention ratio')
				}
				const vaultAfterAuction = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
				strictEqualTypeSafe(vaultAfterAuction.disputeStakedAttoRep, (vaultBeforeAuction.disputeStakedAttoRep * repRemainingAfterHaircut) / repBeforeHaircut, 'the carried escalation claim should retain the same auction fraction as its backing')
				approximatelyEqual(await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, vaultAfterAuction.repBackingUnits), (vaultAfterAuction.repBackingUnits * poolIncumbentRepAfterAuction) / parentForkData.auctionableAttoRepAtFork, 1n, 'escrow sales must preserve the proportional pool-held incumbent claim')
				const forkResumedAt = await client.readContract({
					address: childEscalationGame,
					abi: statoblast_EscalationGame_EscalationGame.abi,
					functionName: 'forkResumedAt',
				})
				const gameEndDate = await client.readContract({
					address: childEscalationGame,
					abi: statoblast_EscalationGame_EscalationGame.abi,
					functionName: 'getEscalationGameEndDate',
				})
				assert.ok(forkResumedAt > 0n, 'truth-auction finalization should resume the external-fork continuation')
				assert.ok(gameEndDate >= forkResumedAt + 3n * DAY, 'the resumed continuation should receive a fresh minimum response period')
				if (!inheritedTie) return
				const currentForkThreshold = await client.readContract({ abi: Zoltar_Zoltar.abi, address: getZoltarAddress(), functionName: 'getForkThresholdAttoRep', args: [yesUniverse] })
				const burnDivisor = await client.readContract({ abi: Zoltar_Zoltar.abi, address: getZoltarAddress(), functionName: 'forkBurnDivisor' })
				assert.ok(repRemainingAfterHaircut < currentForkThreshold / burnDivisor, 'the real auction must leave less game REP than the required fork burn')
				assert.ok((await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool)) + repRemainingAfterHaircut >= currentForkThreshold, 'combined inventory must meet the universe threshold despite insufficient game backing')
				strictEqualTypeSafe(outcomeBalancesAfterAuction[1], outcomeBalancesAfterAuction[2], 'proportional auction sale must retain the inherited tie')
				assert.ok(outcomeBalancesAfterAuction[1] > 0n, 'this regression must not use the zero-balance fallback')
				strictEqualTypeSafe(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: childEscalationGame, functionName: 'nonDecisionState' }), 0n, 'a weakened inherited tie must reopen reporting')
				strictEqualTypeSafe(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: childEscalationGame, functionName: 'canTriggerOwnFork' }), false, 'the unfunded inherited commitment must no longer authorize a fork')
				const startBond = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: childEscalationGame, functionName: 'startBondAttoRep' })
				const preview = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: childEscalationGame, functionName: 'previewDepositOnOutcome', args: [QuestionOutcome.Yes, startBond] })
				strictEqualTypeSafe(preview[0], startBond, 'ordinary funded reporting must be available without a donation')
				// Migrate wallet REP for the ordinary oracle report bond; no tokens are donated
				// to the game or added to the reporting vault after the auction.
				await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
				await writeContractAndWait(client, () => client.writeContract({ abi: Zoltar_Zoltar.abi, address: getZoltarAddress(), functionName: 'prepareAndSplitMigrationRep', args: [genesisUniverse, 100n * 10n ** 18n, [BigInt(QuestionOutcome.Yes)], 100n * 10n ** 18n] }))
				await approveToken(client, getRepTokenAddress(yesUniverse), getInfraContractAddresses().openOracle)
				await manipulatePriceOracle(client, mockWindow, yesSecurityPool.openOraclePriceCoordinator)
				await depositToEscalationGame(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, startBond)
				const admittedBalances = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: childEscalationGame, functionName: 'getOutcomeBalancesAttoRep' })
				strictEqualTypeSafe(admittedBalances[1], preview[1], 'the real pool must execute the previewed report from existing vault backing')
				const endDate = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: childEscalationGame, functionName: 'getEscalationGameEndDate' })
				await mockWindow.setTime(endDate + 1n)
				strictEqualTypeSafe(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: childEscalationGame, functionName: 'getFinalQuestionResolution' }), BigInt(QuestionOutcome.Yes), 'ordinary reporting must produce a final result')
				await withdrawFromEscalationGame(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, [0n])
			})
		}

		test('truth-auction finalization starts long-dated child fee accrual at activation', async () => {
			const { yesSecurityPool } = await setupLongDatedChildAuction('long-dated child fee activation source')
			const collateralAtActivation = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)

			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)

			const oneBlockFeeTolerance = 100_000_000_000n
			approximatelyEqual(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), collateralAtActivation, oneBlockFeeTolerance, 'activating a child must not retroactively charge newly installed collateral for migration and auction time')
			assert.ok((await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)).claimableFeesAttoEth < oneBlockFeeTolerance, 'the first child fee update should charge at most the post-activation block interval')
		})

		test('unclaimed auction commitments retain exposure and earn fees from finalization', async () => {
			const { auctionParticipant, auctionTick, yesSecurityPool } = await setupLongDatedChildAuction('capacity ownership')
			const unassignedPositionBeforeClaim = await getUnassignedPosition(client, yesSecurityPool.securityPool)
			assert.ok(unassignedPositionBeforeClaim.repBackingUnits > 0n, 'the finalized auction must expose its unassigned REP backing')
			assert.ok(unassignedPositionBeforeClaim.underwritingLimitAttoEth > 0n, 'the finalized auction must expose its unassigned capacity')
			strictEqualTypeSafe(unassignedPositionBeforeClaim.claimableFeesAttoEth, 0n, 'the unassigned position should start at its finalization fee-index baseline')
			await mockWindow.advanceTime(DAY)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			const accruedUnassignedPositionBeforeClaim = await getUnassignedPosition(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(accruedUnassignedPositionBeforeClaim.feeIndex, unassignedPositionBeforeClaim.feeIndex, 'the pending position must retain its finalization fee-index baseline')
			assert.ok(accruedUnassignedPositionBeforeClaim.claimableFeesAttoEth > 0n, 'the pending position must expose fees earned since finalization')

			const migratedVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const poolSnapshotBeforeClaim = await client.readContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: yesSecurityPool.securityPool,
				functionName: 'getPoolAccountingSnapshot',
				args: [],
			})
			strictEqualTypeSafe(poolSnapshotBeforeClaim.feeEligibleUnderwritingLimitAttoEth, poolSnapshotBeforeClaim.totalUnderwritingLimitAttoEth, 'sold auction ownership should enter the fee denominator at finalization')
			assert.ok(poolSnapshotBeforeClaim.feeIndexRemainder > 0n, 'delayed auction claim regression requires aggregate fee-index carry')
			const migratedOpenInterestBeforeClaim = await client.readContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: yesSecurityPool.securityPool,
				functionName: 'getVaultOpenInterestAttoEth',
				args: [client.account.address],
			})
			const expectedMigratedOpenInterest = (poolSnapshotBeforeClaim.settlementCollateralAttoEth * migratedVault.underwritingLimitAttoEth + poolSnapshotBeforeClaim.totalUnderwritingLimitAttoEth - 1n) / poolSnapshotBeforeClaim.totalUnderwritingLimitAttoEth
			strictEqualTypeSafe(migratedOpenInterestBeforeClaim, expectedMigratedOpenInterest, 'unclaimed auction capacity must retain its proportional share of child open interest')
			strictEqualTypeSafe(migratedVault.underwritingLimitAttoEth + unassignedPositionBeforeClaim.underwritingLimitAttoEth, poolSnapshotBeforeClaim.totalUnderwritingLimitAttoEth, 'all live capacity must belong to either the migrated vault or the unassigned position before claim')
			strictEqualTypeSafe(migratedVault.repBackingUnits + unassignedPositionBeforeClaim.repBackingUnits, await getTotalRepBackingUnits(client, yesSecurityPool.securityPool), 'all backing units must belong to either the migrated vault or the unassigned position before claim')
			strictEqualTypeSafe(await getTotalClaimableVaultFeesAttoEth(client, yesSecurityPool.securityPool), migratedVault.claimableFeesAttoEth, 'capacity ownership')

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])
			const unassignedPositionAfterClaim = await getUnassignedPosition(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(unassignedPositionAfterClaim.underwritingLimitAttoEth, 0n, 'the final claim must transfer all claimable unassigned capacity')
			strictEqualTypeSafe(unassignedPositionAfterClaim.badDebtAttoEth, 0n, 'the final claim must transfer all unassigned bad debt')
			strictEqualTypeSafe(unassignedPositionAfterClaim.claimableFeesAttoEth, 0n, 'the final claim must transfer all accrued unassigned fees')
			const auctionVaultAtClaim = await getSecurityVault(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
			assert.ok(auctionVaultAtClaim.claimableFeesAttoEth > 0n, 'auctioned ownership should earn fees from truth-auction finalization even when claimed later')
			strictEqualTypeSafe(await getTotalClaimableVaultFeesAttoEth(client, yesSecurityPool.securityPool), migratedVault.claimableFeesAttoEth + auctionVaultAtClaim.claimableFeesAttoEth, 'auction claims should assign the already-accrued fee share without changing total accrued fees')
			const poolSnapshotAfterClaim = await client.readContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: yesSecurityPool.securityPool,
				functionName: 'getPoolAccountingSnapshot',
				args: [],
			})
			const claimBlock = await client.getBlock()
			const claimAccrualTime = claimBlock.timestamp - poolSnapshotBeforeClaim.lastUpdatedFeeAccumulator
			const retainedCollateralAtClaim = (poolSnapshotBeforeClaim.settlementCollateralAttoEth * rpow(poolSnapshotBeforeClaim.currentRetentionRate, claimAccrualTime, PRICE_PRECISION)) / PRICE_PRECISION
			const expectedFeeIndexRemainderAtClaim = ((poolSnapshotBeforeClaim.settlementCollateralAttoEth - retainedCollateralAtClaim) * PRICE_PRECISION + poolSnapshotBeforeClaim.feeIndexRemainder) % poolSnapshotBeforeClaim.feeEligibleUnderwritingLimitAttoEth
			strictEqualTypeSafe(poolSnapshotAfterClaim.feeIndexRemainder, expectedFeeIndexRemainderAtClaim, 'claiming already-eligible auction ownership must preserve denominator-scoped aggregate carry through claim-time accrual')
			strictEqualTypeSafe(
				await client.readContract({
					abi: statoblast_SecurityPool_SecurityPool.abi,
					address: yesSecurityPool.securityPool,
					functionName: 'getVaultOpenInterestAttoEth',
					args: [client.account.address],
				}),
				(poolSnapshotAfterClaim.settlementCollateralAttoEth * migratedVault.underwritingLimitAttoEth + poolSnapshotAfterClaim.totalUnderwritingLimitAttoEth - 1n) / poolSnapshotAfterClaim.totalUnderwritingLimitAttoEth,
				'claiming already-counted auction capacity must preserve proportional migrated vault open interest',
			)
			const accountedCollateralBeforeSubsequentAccrual = poolSnapshotAfterClaim.settlementCollateralAttoEth + (await getTotalAccruedFees(client, yesSecurityPool.securityPool))
			await mockWindow.advanceTime(DAY)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			await updateVaultFees(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
			strictEqualTypeSafe(
				(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)) + (await getTotalAccruedFees(client, yesSecurityPool.securityPool)),
				accountedCollateralBeforeSubsequentAccrual,
				'preserved aggregate carry should reconcile settlement collateral and accrued fees exactly after subsequent accrual',
			)
		})

		for (const purchased of [false, true]) {
			test(purchased ? 'takeover cannot consume reserved purchased auction entitlements' : 'takeover requires a fresh price before accepting orphaned exposure', async () => {
				const { yesSecurityPool } = await setupLongDatedChildAuction('takeover admission', undefined, purchased)
				await mockWindow.advanceTime(DAY)
				const before = await getUnassignedPosition(client, yesSecurityPool.securityPool)
				await assert.rejects(
					client.writeContract({ abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'takeOverUnassignedCommitment', args: [yesSecurityPool.securityPool, before.underwritingLimitAttoEth] }),
					purchased ? /Auction claims reserved/ : /Stale price/,
				)
				const after = await getUnassignedPosition(client, yesSecurityPool.securityPool)
				strictEqualTypeSafe(after.underwritingLimitAttoEth, before.underwritingLimitAttoEth)
				strictEqualTypeSafe(after.repBackingUnits, before.repBackingUnits)
			})
		}

		test('authorized takeover conserves no-purchase commitments and starts fees at recovery', async () => {
			const { yesSecurityPool } = await setupLongDatedChildAuction('no-purchase recovery', undefined, false)
			await mockWindow.advanceTime(DAY)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			const childRep = await getRepToken(client, yesSecurityPool.securityPool)
			await mockWindow.addStateOverrides({ [childRep]: { stateDiff: { [formatStorageSlot(getAddressMappingStorageSlot(client.account.address, 0n))]: repDeposit } } })
			await approveToken(client, childRep, getInfraContractAddresses().openOracle)
			await manipulatePriceOracle(client, mockWindow, yesSecurityPool.openOraclePriceCoordinator)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			const before = await getUnassignedPosition(client, yesSecurityPool.securityPool)
			const vaultBefore = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const remainderBefore = await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: yesSecurityPool.securityPool, functionName: 'getVaultFeeRemainder', args: [client.account.address] })
			const totalBefore = await getTotalUnderwritingLimitAttoEth(client, yesSecurityPool.securityPool)
			const recover = (maximum: bigint) => client.writeContract({ abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'takeOverUnassignedCommitment', args: [yesSecurityPool.securityPool, maximum] })
			await assert.rejects(recover(before.underwritingLimitAttoEth - 1n), /Commitment exceeds authorization/)
			const poolRepBefore = await getERC20Balance(client, childRep, yesSecurityPool.securityPool)
			const poolBalanceSlot = formatStorageSlot(getAddressMappingStorageSlot(yesSecurityPool.securityPool, 0n))
			await mockWindow.addStateOverrides({ [childRep]: { stateDiff: { [poolBalanceSlot]: 0n } } })
			await assert.rejects(recover(before.underwritingLimitAttoEth), /Vault backing insufficient/)
			strictEqualTypeSafe((await getUnassignedPosition(client, yesSecurityPool.securityPool)).underwritingLimitAttoEth, before.underwritingLimitAttoEth, 'failed health check preserves the entire residual commitment')
			await mockWindow.addStateOverrides({ [childRep]: { stateDiff: { [poolBalanceSlot]: poolRepBefore } } })
			await recover(before.underwritingLimitAttoEth)
			const after = await getUnassignedPosition(client, yesSecurityPool.securityPool)
			const vaultAfter = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			strictEqualTypeSafe(after.underwritingLimitAttoEth, 0n)
			strictEqualTypeSafe(after.repBackingUnits, 0n)
			strictEqualTypeSafe(await getTotalUnderwritingLimitAttoEth(client, yesSecurityPool.securityPool), totalBefore)
			strictEqualTypeSafe(vaultAfter.underwritingLimitAttoEth, vaultBefore.underwritingLimitAttoEth + before.underwritingLimitAttoEth)
			strictEqualTypeSafe(vaultAfter.repBackingUnits, vaultBefore.repBackingUnits + before.repBackingUnits)
			strictEqualTypeSafe(vaultAfter.claimableFeesAttoEth, vaultBefore.claimableFeesAttoEth + (vaultBefore.underwritingLimitAttoEth * (vaultAfter.feeIndex - vaultBefore.feeIndex) + remainderBefore) / PRICE_PRECISION, 'only the pre-existing commitment earns fees before takeover')
			await assert.rejects(recover(before.underwritingLimitAttoEth), /No commitment/)
			await mockWindow.advanceTime(DAY)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			assert.ok((await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)).claimableFeesAttoEth > vaultAfter.claimableFeesAttoEth, 'recovered commitment earns fees from takeover onward')
		})

		test('zero-purchase unassigned capacity does not expose phantom fee ownership', async () => {
			const { yesSecurityPool } = await setupLongDatedChildAuction('zero-purchase fee accounting source', undefined, false)
			const unassignedAtFinalization = await getUnassignedPosition(client, yesSecurityPool.securityPool)
			assert.ok(unassignedAtFinalization.underwritingLimitAttoEth > 0n, 'zero-purchase auctions should retain explicit unassigned capacity')

			await mockWindow.advanceTime(DAY)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			const unassignedAfterAccrual = await getUnassignedPosition(client, yesSecurityPool.securityPool)
			const poolSnapshot = await client.readContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: yesSecurityPool.securityPool,
				functionName: 'getPoolAccountingSnapshot',
				args: [],
			})
			assert.ok(poolSnapshot.feeIndex > unassignedAfterAccrual.feeIndex, 'migrated fee-eligible capacity should advance the pool fee index')
			strictEqualTypeSafe(unassignedAfterAccrual.claimableFeesAttoEth, 0n, 'zero-purchase unassigned capacity must remain outside fee ownership')
		})

		test('unhealthy unassigned auction ownership blocks new minting until a claim assigns it', async () => {
			const { auctionParticipant, auctionTick, yesSecurityPool } = await setupLongDatedChildAuction('unassigned health guard')
			const unassignedPosition = await getUnassignedPosition(client, yesSecurityPool.securityPool)
			assert.ok(unassignedPosition.underwritingLimitAttoEth > 0n, 'the health-guard regression requires unassigned capacity')

			const forkDataStorageBase = getAddressMappingStorageSlot(yesSecurityPool.securityPool, 0n)
			await mockWindow.addStateOverrides({
				[getInfraContractAddresses().securityPoolForker]: {
					stateDiff: {
						[formatStorageSlot(forkDataStorageBase + 28n)]: 0n,
					},
				},
			})

			const mintAmountAttoEth = 10n ** 15n
			await assert.rejects(createCompleteSet(client, yesSecurityPool.securityPool, mintAmountAttoEth), /Unassigned position unhealthy/)
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])
			const auctionVault = await getSecurityVault(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
			await mockWindow.addStateOverrides({
				[getInfraContractAddresses().securityPoolForker]: {
					stateDiff: {
						[formatStorageSlot(forkDataStorageBase + 28n)]: auctionVault.repBackingUnits,
					},
				},
			})
			await createCompleteSet(client, yesSecurityPool.securityPool, mintAmountAttoEth)
		})

		test('nonzero fee redemption cannot reclassify forced child ETH as collateral', async () => {
			const { yesSecurityPool } = await setupLongDatedChildAuction('forced ETH fee redemption source', 10n ** 30n)
			await mockWindow.advanceTime(DAY)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			assert.ok((await getTotalClaimableVaultFeesAttoEth(client, yesSecurityPool.securityPool)) > 0n, 'the migrated vault should accrue fees before redemption')
			const collateralBeforeFeeRedemption = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)

			await redeemFees(client, yesSecurityPool.securityPool, client.account.address)

			assert.ok((await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)) <= collateralBeforeFeeRedemption, 'nonzero fee redemption may accrue another block of fees but must not promote forced ETH into collateral')
		})
	})
})
