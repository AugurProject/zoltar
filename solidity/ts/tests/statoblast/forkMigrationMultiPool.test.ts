import { sortBigIntsAscending } from '@zoltar/core-shared/serialization/bigInt'
import { tickToPrice } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'
import { beforeEach, describe, test } from 'bun:test'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import assert from '../../testSupport/simulator/utils/assert'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { createWriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { getTotalRepPurchasedAttoRep, getEthRaiseCapAttoEth } from '../../testSupport/simulator/utils/contracts/auction'
import { getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getScalarOutcomeIndex } from '../../testSupport/simulator/utils/contracts/scalarOutcome'
import {
	backingUnitsToAttoRep,
	createCompleteSet,
	depositRepToVault,
	getRepToken,
	getSecurityVault,
	getSettlementCollateralAttoEth,
	getSystemState,
	getTotalAccruedFees,
	getTotalClaimableVaultFeesAttoEth,
	getTotalRepBackingUnits,
	getTotalUnderwritingLimitAttoEth,
	redeemShares,
} from '../../testSupport/simulator/utils/contracts/securityPool'
import { claimAuctionProceeds, claimForkedEscalationDeposits, createChildUniverse, finalizeTruthAuction, getMigratedAttoRep, getOwnForkRepBuckets, getQuestionOutcome, initiateSecurityPoolFork, migrateRepToZoltar, migrateVault, startTruthAuction } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { balanceOfShares, balanceOfSharesInAttoEth, getLastPrice, getQuestionEndDate, migrateShares, OperationType, participateAuction } from '../../testSupport/simulator/utils/contracts/statoblast'
import { approveAndDepositRepToVault, manipulatePriceOracleAndPerformOperation, setVaultCapacityFixture, triggerOwnGameFork } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { forkUniverse, getRepTokenAddress, getTotalTheoreticalSupply, getZoltarAddress, getZoltarForkThreshold } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { approximatelyEqual, ensureDefined, strictEqual18Decimal, strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { approveToken, contractExists, getChildUniverseId, getERC20Balance, getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { statoblast_tokens_ShareToken_ShareToken } from '../../types/contractArtifact'
import { useStatoblastForkMigrationFixture, type StatoblastForkMigrationFixture } from './fixture'

describe('Statoblast: fork migration', () => {
	const fixture = useStatoblastForkMigrationFixture()

	const { PRICE_PRECISION, repDeposit, genesisUniverse, statoblastSecurityMultiplierBps, getYesChildPool } = fixture

	let mockWindow: StatoblastForkMigrationFixture['mockWindow']

	let client: StatoblastForkMigrationFixture['client']

	let securityPoolAddresses: StatoblastForkMigrationFixture['securityPoolAddresses']

	let questionId: StatoblastForkMigrationFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionId = fixture.questionId
	})

	describe('multi-pool and scalar share migration', () => {
		test('two security pools with disagreement', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const openInterestAmount = 10n * 10n ** 18n + 1n
			const openInterestArray = [openInterestAmount, openInterestAmount, openInterestAmount]
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n

			const zoltarForkThreshold = await getZoltarForkThreshold(client, genesisUniverse)
			const burnAmount = zoltarForkThreshold / 5n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await mockWindow.setTime(endTime + 10000n)
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			await setVaultCapacityFixture(attackerClient, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, attackerClient.account.address, securityPoolUnderwritingLimitAttoEth)

			const repBalanceInGenesisPool = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)
			assert.ok(repBalanceInGenesisPool > 0n, 'genesis pool should contain rep before the fork')
			assert.ok((await getTotalUnderwritingLimitAttoEth(client, securityPoolAddresses.securityPool)) > 0n, 'capacity ownership should be non-zero')
			strictEqual18Decimal(await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool), repBalanceInGenesisPool * PRICE_PRECISION, 'REP backing units denominator should equal `pool balance * PRICE_PRECISION` prior fork')

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
			assert.deepStrictEqual(await balanceOfSharesInAttoEth(client, securityPoolAddresses.securityPool, securityPoolAddresses.shareToken, genesisUniverse, addressString(TEST_ADDRESSES[2])), openInterestArray, 'Did not create enough complete sets')
			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const ownForkParentCollateralAtFork = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
			const { yesUniverse, yesSecurityPool } = getYesChildPool()

			// we migrate to yes
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
			const yesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const yesPoolBalance = await getERC20Balance(client, await getRepToken(client, yesSecurityPool.securityPool), yesSecurityPool.securityPool)
			assert.ok((await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, yesVault.repBackingUnits)) > 0n, 'the yes-side vault should still retain positive pool-held child REP backing')
			const migratedRepInYes = await getMigratedAttoRep(client, yesSecurityPool.securityPool)
			assert.ok(migratedRepInYes > 0n, 'yes pool should track migrated REP')
			assert.ok(migratedRepInYes < yesPoolBalance, 'migrated rep should stay below the full child REP balance when escrow payouts are carved out separately')
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'yes is finalized')
			assert.ok((await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool)) > 0n, 'yes child should retain some child-universe REP after migration')

			assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'yes security pool exist')
			// attacker migrated to No
			const noUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.No)
			const noSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, noUniverse, questionId, statoblastSecurityMultiplierBps)
			await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No)
			strictEqualTypeSafe(await getQuestionOutcome(client, noSecurityPool.securityPool), QuestionOutcome.No, 'finalized as no')
			const migratedRepInNo = await getMigratedAttoRep(client, noSecurityPool.securityPool)
			assert.ok(migratedRepInNo > 0n, 'the no-side child should track some migrated REP')
			assert.ok((await getERC20Balance(client, getRepTokenAddress(noUniverse), noSecurityPool.securityPool)) > 0n, 'no child should retain some child-universe REP after migration')
			const parentEth = await getETHBalance(client, securityPoolAddresses.securityPool)
			const yesEth = await getETHBalance(client, yesSecurityPool.securityPool)
			const noEth = await getETHBalance(client, noSecurityPool.securityPool)
			const parentWideRepDenominatorAttoRep = ownForkRepBuckets.vaultRepAtForkAttoRep
			const yesTargetNumerator = ownForkParentCollateralAtFork * migratedRepInYes
			const parentWideTargetAfterYesAttoEth = (yesTargetNumerator + parentWideRepDenominatorAttoRep - 1n) / parentWideRepDenominatorAttoRep
			const parentWideTargetAfterNoAttoEth = (ownForkParentCollateralAtFork * (migratedRepInYes + migratedRepInNo) + parentWideRepDenominatorAttoRep - 1n) / parentWideRepDenominatorAttoRep
			assert.notEqual(yesTargetNumerator % parentWideRepDenominatorAttoRep, 0n, 'test must exercise indivisible attoETH ceiling allocation')
			strictEqualTypeSafe(yesEth, parentWideTargetAfterYesAttoEth, 'first child should receive the first parent-wide cumulative collateral ceiling')
			strictEqualTypeSafe(noEth, parentWideTargetAfterNoAttoEth - parentWideTargetAfterYesAttoEth, 'interleaved second-child migration should receive only the new parent-wide cumulative collateral delta')
			const parentFees = await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)
			const yesFees = await getTotalClaimableVaultFeesAttoEth(client, yesSecurityPool.securityPool)
			const noFees = await getTotalClaimableVaultFeesAttoEth(client, noSecurityPool.securityPool)
			assert.ok(parentEth + yesEth + noEth >= parentFees + yesFees + noFees, 'forked ETH should stay sufficient to cover the remaining fee liabilities across all pools')

			// invalid, no one migrated here
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid) // no one migrated, we need to create the universe as rep holders did not
			const invalidUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Invalid)
			const invalidSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, invalidUniverse, questionId, statoblastSecurityMultiplierBps)

			const parentSettlementCollateralAttoEthAfterVaultMigrations = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			assert.deepStrictEqual(
				await balanceOfSharesInAttoEth(client, securityPoolAddresses.securityPool, securityPoolAddresses.shareToken, genesisUniverse, addressString(TEST_ADDRESSES[2])),
				openInterestArray.map(() => parentSettlementCollateralAttoEthAfterVaultMigrations),
				'Shares exist after fork',
			)
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Invalid, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)

			const getCurrentOpenInterestArray = async (): Promise<[bigint, bigint, bigint]> => {
				const currentFees = (await getTotalAccruedFees(client, securityPoolAddresses.securityPool)) + (await getTotalAccruedFees(client, yesSecurityPool.securityPool))
				const result = openInterestArray.map(x => x - currentFees) as [bigint, bigint, bigint]
				return result
			}

			// auction yes
			const totalPoolHeldRepAtForkAttoRep = ownForkRepBuckets.vaultRepAtForkAttoRep
			const auctionedEthInYes = ownForkParentCollateralAtFork - (ownForkParentCollateralAtFork * migratedRepInYes) / totalPoolHeldRepAtForkAttoRep
			await startTruthAuction(client, yesSecurityPool.securityPool)
			const yesAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			let yesAuctionTick: bigint | undefined
			let yesAuctionEthRaiseCap = 0n
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				yesAuctionEthRaiseCap = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
				approximatelyEqual(yesAuctionEthRaiseCap, auctionedEthInYes, 10n, 'Need to buy half of open interest on yes')
				yesAuctionTick = await participateAuction(yesAuctionParticipant, yesSecurityPool.truthAuction, totalPoolHeldRepAtForkAttoRep / 4n, auctionedEthInYes)
			} else {
				strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'yes child should either enter the truth auction or finalize immediately')
				strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
			}

			// auction no
			const auctionedEthInNo = ownForkParentCollateralAtFork - (ownForkParentCollateralAtFork * migratedRepInNo) / totalPoolHeldRepAtForkAttoRep
			await startTruthAuction(client, noSecurityPool.securityPool)
			const noAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[4])
			let noAuctionTick: bigint | undefined
			let noAuctionEthRaiseCap = 0n
			if ((await getSystemState(client, noSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				noAuctionEthRaiseCap = await getEthRaiseCapAttoEth(client, noSecurityPool.truthAuction)
				approximatelyEqual(noAuctionEthRaiseCap, auctionedEthInNo, 10n, 'Need to buy half of open interest on no')
				noAuctionTick = await participateAuction(noAuctionParticipant, noSecurityPool.truthAuction, (totalPoolHeldRepAtForkAttoRep * 3n) / 4n, auctionedEthInNo)
			} else {
				strictEqualTypeSafe(await getSystemState(client, noSecurityPool.securityPool), SystemState.Operational, 'no child should either enter the truth auction or finalize immediately')
				strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, noSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
			}

			// auction invalid
			await startTruthAuction(client, invalidSecurityPool.securityPool)
			const invalidAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[5])
			let invalidAuctionTick: bigint | undefined
			if ((await getSystemState(client, invalidSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				approximatelyEqual(await getEthRaiseCapAttoEth(client, invalidSecurityPool.truthAuction), ownForkParentCollateralAtFork, 10n, 'Need to buy all of open interest on invalid')
				invalidAuctionTick = await participateAuction(invalidAuctionParticipant, invalidSecurityPool.truthAuction, totalPoolHeldRepAtForkAttoRep - burnAmount - totalPoolHeldRepAtForkAttoRep / 1_000_000n, ownForkParentCollateralAtFork)
			} else {
				strictEqualTypeSafe(await getSystemState(client, invalidSecurityPool.securityPool), SystemState.Operational, 'invalid child should either enter the truth auction or finalize immediately')
				strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, invalidSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
			}

			await mockWindow.advanceTime(7n * DAY + DAY)

			// yes status: auction fully funds, 1/4 of rep balance is sold for eth
			if (yesAuctionTick !== undefined) {
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			}

			const actualShares = await balanceOfSharesInAttoEth(client, yesSecurityPool.securityPool, yesSecurityPool.shareToken, yesUniverse, addressString(TEST_ADDRESSES[2]))
			assert.strictEqual(actualShares.length, 3, 'should have 3 outcomes')
			const yesChildCollateral = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			actualShares.forEach((value, idx) => approximatelyEqual(value, yesChildCollateral, 1000000000000000n, `share ${idx} should approximately equal the current yes child collateral`))

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'Yes System should be operational again')
			let yesAuctionParticipantRep = 0n
			if (yesAuctionTick !== undefined) {
				await claimAuctionProceeds(client, yesSecurityPool.securityPool, yesAuctionParticipant.account.address, [{ tick: yesAuctionTick, bidIndex: 0n }])
				const yesAuctionParticipantVault = await getSecurityVault(client, yesSecurityPool.securityPool, yesAuctionParticipant.account.address)
				yesAuctionParticipantRep = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, yesAuctionParticipantVault.repBackingUnits)
				const yesClearingPrice = tickToPrice(yesAuctionTick)
				const expectedYesRep = (yesAuctionEthRaiseCap * 1_000_000_000_000_000_000n) / yesClearingPrice
				approximatelyEqual(yesAuctionParticipantRep, expectedYesRep, 1_000n, 'yes auction participant should get expected REP')
			}

			const originalYesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const originalYesVaultRep = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, originalYesVault.repBackingUnits)
			assert.ok(originalYesVaultRep > yesAuctionParticipantRep, 'original yes vault holder should retain the majority of REP backingUnits after the auction')
			strictEqualTypeSafe((await getSecurityVault(client, yesSecurityPool.securityPool, attackerClient.account.address)).repBackingUnits, 0n, 'attacker should have zero as they did not migrate to yes')

			const balancePriorYesRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
			await redeemShares(openInterestHolder, yesSecurityPool.securityPool)
			const currentShares = await getCurrentOpenInterestArray()
			const actualSharesAfterRedeem = await balanceOfSharesInAttoEth(client, yesSecurityPool.securityPool, securityPoolAddresses.shareToken, yesUniverse, addressString(TEST_ADDRESSES[2]))
			assert.strictEqual(actualSharesAfterRedeem[0], 0n, 'non-winning invalid shares should be worthless after the only winning claimant redeems')
			assert.strictEqual(actualSharesAfterRedeem[1], 0n, 'share1 should be zero')
			assert.strictEqual(actualSharesAfterRedeem[2], 0n, 'non-winning no shares should be worthless after the only winning claimant redeems')
			approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorYesRedeemal + yesChildCollateral, 10n ** 15n, 'did not gain eth after redeeming yes shares')

			// no status: auction fully funds, 3/4 of rep balance is sold for eth
			if (noAuctionTick !== undefined) {
				await finalizeTruthAuction(client, noSecurityPool.securityPool)
			}
			const actualNoShares = await balanceOfSharesInAttoEth(client, noSecurityPool.securityPool, noSecurityPool.shareToken, noUniverse, addressString(TEST_ADDRESSES[2]))
			const noChildCollateral = await getSettlementCollateralAttoEth(client, noSecurityPool.securityPool)
			approximatelyEqual(actualNoShares[0], noChildCollateral, noChildCollateral, 'no share0 should be approximately expected')
			approximatelyEqual(actualNoShares[1], noChildCollateral, noChildCollateral, 'no share1 should be approximately expected')
			approximatelyEqual(actualNoShares[2], noChildCollateral, noChildCollateral, 'no share2 should be approximately expected')

			strictEqualTypeSafe(await getSystemState(client, noSecurityPool.securityPool), SystemState.Operational, 'No System should be operational again')

			// Read purchasedRep for no auction participant

			if (noAuctionTick !== undefined) {
				await claimAuctionProceeds(client, noSecurityPool.securityPool, noAuctionParticipant.account.address, [{ tick: noAuctionTick, bidIndex: 0n }])
				const noAuctionParticipantVault = await getSecurityVault(client, noSecurityPool.securityPool, noAuctionParticipant.account.address)
				const noAuctionParticipantRep = await backingUnitsToAttoRep(client, noSecurityPool.securityPool, noAuctionParticipantVault.repBackingUnits)
				const noClearingPrice = tickToPrice(noAuctionTick)
				const expectedNoRep = (noAuctionEthRaiseCap * 1_000_000_000_000_000_000n) / noClearingPrice
				approximatelyEqual(noAuctionParticipantRep, expectedNoRep, 1_000n, 'no auction participant should get expected REP')
			}

			const originalNoVault = await getSecurityVault(client, noSecurityPool.securityPool, attackerClient.account.address)
			const originalNoVaultRep = await backingUnitsToAttoRep(client, noSecurityPool.securityPool, originalNoVault.repBackingUnits)
			approximatelyEqual(originalNoVaultRep, (repBalanceInGenesisPool * 1n) / 4n - burnAmount, repBalanceInGenesisPool, 'original no vault holder should hold rest 1/4 of rep')
			strictEqualTypeSafe((await getSecurityVault(client, noSecurityPool.securityPool, client.account.address)).repBackingUnits, 0n, 'client should have zero as they did not migrate to no')
			const balancePriorNoRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
			await redeemShares(openInterestHolder, noSecurityPool.securityPool)
			const actualNoSharesAfterRedeem = await balanceOfSharesInAttoEth(client, noSecurityPool.securityPool, noSecurityPool.shareToken, noUniverse, addressString(TEST_ADDRESSES[2]))
			assert.strictEqual(actualNoSharesAfterRedeem[0], 0n, 'non-winning invalid shares should be worthless after the only winning claimant redeems')
			assert.strictEqual(actualNoSharesAfterRedeem[1], 0n, 'non-winning yes shares should be worthless after the only winning claimant redeems')
			assert.strictEqual(actualNoSharesAfterRedeem[2], 0n, 'no after redeem share2 should be zero')
			approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorNoRedeemal + noChildCollateral, openInterestAmount, 'did not gain eth after redeeming no shares')

			// invalid status: auction 3/4 funds for all REP (minus 1/100 000). Open interest holders lose 50%
			if (invalidAuctionTick !== undefined) {
				await finalizeTruthAuction(client, invalidSecurityPool.securityPool)
			}
			const actualInvalidShares = await balanceOfSharesInAttoEth(client, invalidSecurityPool.securityPool, invalidSecurityPool.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[2]))
			const invalidChildCollateral = await getSettlementCollateralAttoEth(client, invalidSecurityPool.securityPool)
			approximatelyEqual(actualInvalidShares[0], invalidChildCollateral, invalidChildCollateral, 'invalid share0 should match')
			approximatelyEqual(actualInvalidShares[1], invalidChildCollateral, invalidChildCollateral, 'invalid share1 should match')
			approximatelyEqual(actualInvalidShares[2], invalidChildCollateral, invalidChildCollateral, 'invalid share2 should match')
			strictEqualTypeSafe(await getSystemState(client, invalidSecurityPool.securityPool), SystemState.Operational, 'Invalid System should be operational again')

			// Read purchasedRep for invalid auction participant

			if (invalidAuctionTick !== undefined) {
				await claimAuctionProceeds(client, invalidSecurityPool.securityPool, invalidAuctionParticipant.account.address, [{ tick: invalidAuctionTick, bidIndex: 0n }])
				const invalidAuctionParticipantVault = await getSecurityVault(client, invalidSecurityPool.securityPool, invalidAuctionParticipant.account.address)
				const invalidAuctionParticipantRep = await backingUnitsToAttoRep(client, invalidSecurityPool.securityPool, invalidAuctionParticipantVault.repBackingUnits)
				const invalidClearingPrice = tickToPrice(invalidAuctionTick)
				const expectedInvalidRep = (ownForkParentCollateralAtFork * 1_000_000_000_000_000_000n) / invalidClearingPrice
				approximatelyEqual(invalidAuctionParticipantRep, expectedInvalidRep, 1_000n, 'invalid auction participant should get expected REP')
			}

			// Resolved child pools must not accept new complete sets.
			const openInterestHolder2 = createWriteClient(mockWindow, TEST_ADDRESSES[4])
			const additionalInvalidCompleteSetAmount = ensureDefined(currentShares[0], 'currentShares[0] is undefined')
			if (additionalInvalidCompleteSetAmount > 0n) {
				await assert.rejects(createCompleteSet(openInterestHolder2, invalidSecurityPool.securityPool, additionalInvalidCompleteSetAmount))
			}

			const balancePriorInvalidRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
			await redeemShares(openInterestHolder, invalidSecurityPool.securityPool)
			const actualInvalidSharesAfterRedeem1 = await balanceOfSharesInAttoEth(client, invalidSecurityPool.securityPool, invalidSecurityPool.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[2]))
			assert.strictEqual(actualInvalidSharesAfterRedeem1[0], 0n, 'redeeming invalid shares should consume the winning invalid leg')
			assert.ok(actualInvalidSharesAfterRedeem1[1] >= 0n, 'post-redeem invalid-share accounting should remain readable for the residual non-winning legs')
			assert.ok(actualInvalidSharesAfterRedeem1[2] >= 0n, 'post-redeem invalid-share accounting should remain readable for the residual non-winning legs')
			approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorInvalidRedeemal + invalidChildCollateral, openInterestAmount * 1000n, 'did not gain eth after redeeming invalid shares')
		})

		test('migrates INVALID, YES, and NO entitlements into many outcomes of an unrelated scalar fork', async () => {
			const openInterestAmount = 5n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const scalarForkQuestion = {
				title: 'unrelated scalar fork',
				description: '',
				startTime: 0n,
				endTime: await mockWindow.getTime(),
				numTicks: 10n,
				displayValueMin: 0n,
				displayValueMax: 10n,
				answerUnit: 'km',
			}
			const scalarQuestionId = getQuestionId(scalarForkQuestion, [])
			assert.notEqual(scalarQuestionId, questionId, 'the universe fork question must be unrelated to the SecurityPool binary question')

			await createQuestion(client, scalarForkQuestion, [])
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, repDeposit / 4n)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, scalarQuestionId)

			const middleScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 5n)
			const bulkScalarOutcomes = sortBigIntsAscending([0n, ...[0n, 1n, 2n, 3n, 4n, 6n, 7n, 8n, 9n, 10n].map(tick => getScalarOutcomeIndex(scalarForkQuestion, tick))])
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			for (const outcome of [...bulkScalarOutcomes, middleScalarOutcome]) {
				await createChildUniverse(client, securityPoolAddresses.securityPool, outcome)
			}
			const holderAddress = addressString(TEST_ADDRESSES[2])
			const parentBalancesBeforeMigration = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
			const sourceOutcomes = [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No] as const
			const parentTokenIds = await Promise.all(
				sourceOutcomes.map(
					async outcome =>
						await client.readContract({
							address: securityPoolAddresses.shareToken,
							abi: statoblast_tokens_ShareToken_ShareToken.abi,
							functionName: 'getTokenId',
							args: [genesisUniverse, outcome],
						}),
				),
			)
			for (const sourceOutcome of sourceOutcomes) {
				await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, sourceOutcome, bulkScalarOutcomes)
			}

			const parentBalancesAfterBulkMigration = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
			assert.deepStrictEqual(parentBalancesAfterBulkMigration, parentBalancesBeforeMigration, 'all parent shares should remain as persistent child-claim entitlements')

			for (const scalarOutcome of bulkScalarOutcomes) {
				const childUniverse = getChildUniverseId(genesisUniverse, scalarOutcome)
				const childBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, childUniverse, holderAddress)
				assert.deepStrictEqual(childBalances, parentBalancesBeforeMigration, 'each scalar child should receive the holder’s complete INVALID/YES/NO position')
				for (let sourceIndex = 0; sourceIndex < sourceOutcomes.length; sourceIndex++) {
					const parentTokenId = ensureDefined(parentTokenIds[sourceIndex], 'parent source token id is undefined')
					const parentBalance = ensureDefined(parentBalancesBeforeMigration[sourceIndex], 'parent source balance is undefined')
					strictEqualTypeSafe(
						await client.readContract({
							address: securityPoolAddresses.shareToken,
							abi: statoblast_tokens_ShareToken_ShareToken.abi,
							functionName: 'getMigratedShareAmountAttoShares',
							args: [parentTokenId, childUniverse, holderAddress],
						}),
						parentBalance,
						'each child migration record should preserve the corresponding source share entitlement',
					)
				}
			}

			for (const sourceOutcome of sourceOutcomes) {
				await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, sourceOutcome, [middleScalarOutcome])
			}
			const middleScalarUniverse = getChildUniverseId(genesisUniverse, middleScalarOutcome)
			const middleScalarBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, middleScalarUniverse, holderAddress)
			assert.deepStrictEqual(middleScalarBalances, parentBalancesBeforeMigration, 'a later scalar child selection should independently receive all three source entitlements')
			await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [middleScalarOutcome]), /ShareToken has no new shares to migrate/)

			const parentYesTokenId = ensureDefined(parentTokenIds[1], 'parent yes token id is undefined')
			const parentYesBalance = ensureDefined(parentBalancesBeforeMigration[1], 'parent yes balance is undefined')
			await assert.rejects(
				openInterestHolder.writeContract({
					address: securityPoolAddresses.shareToken,
					abi: statoblast_tokens_ShareToken_ShareToken.abi,
					functionName: 'safeTransferFrom',
					args: [holderAddress, addressString(TEST_ADDRESSES[3]), parentYesTokenId, parentYesBalance],
				}),
				/ShareToken migrated source balance is locked/,
			)
		})

		test('rejects malformed and missing-child bulk targets while lazily creating one migration child', async () => {
			const openInterestAmount = 5n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const scalarForkQuestion = {
				title: 'scalar fork',
				description: '',
				startTime: 0n,
				endTime: await mockWindow.getTime(),
				numTicks: 10n,
				displayValueMin: 0n,
				displayValueMax: 10n,
				answerUnit: 'km',
			}
			const scalarQuestionId = getQuestionId(scalarForkQuestion, [])

			await createQuestion(client, scalarForkQuestion, [])
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, repDeposit / 4n)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, scalarQuestionId)

			const holderAddress = addressString(TEST_ADDRESSES[2])
			const lowScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 3n)
			const validScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 5n)
			const highScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 7n)
			const sortedScalarOutcomes = sortBigIntsAscending([lowScalarOutcome, highScalarOutcome])
			const parentBalancesBeforeFailedMigrations = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
			const parentYesBalance = ensureDefined(parentBalancesBeforeFailedMigrations[1], 'parent yes balance is undefined')

			await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [5n]), /ShareToken target outcome is malformed for the fork question/)
			await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [validScalarOutcome, validScalarOutcome]), /ShareToken target outcomes must be provided in strictly increasing order/)
			await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [...sortedScalarOutcomes].reverse()), /ShareToken target outcomes must be provided in strictly increasing order/)
			await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, sortedScalarOutcomes), /ShareToken bulk migration requires canonical child pools/)
			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.Operational, 'rejected bulk migration should roll back automatic source-pool fork initiation')

			const parentBalancesAfterFailedMigrations = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
			strictEqualTypeSafe(parentBalancesAfterFailedMigrations[1], parentYesBalance, 'failed migrations should preserve the parent yes share balance')

			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [validScalarOutcome])
			const lazilyCreatedUniverse = getChildUniverseId(genesisUniverse, validScalarOutcome)
			const lazilyCreatedBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, lazilyCreatedUniverse, holderAddress)
			strictEqualTypeSafe(lazilyCreatedBalances[1], parentYesBalance, 'a single missing target should create its canonical child and materialize the source balance')
		})

		test('can fork zero rep pools', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, OperationType.WithdrawRep, client.account.address, repDeposit)
			strictEqualTypeSafe(await getLastPrice(client, securityPoolAddresses.openOraclePriceCoordinator), 1n * PRICE_PRECISION, 'Price was not set!')
			approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool), 0n, 100n, 'Did not empty security pool of rep')
			approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), startBalance + repDeposit, 100n, 'Did not get rep back')

			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, questionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'Parent is forked')
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const { yesSecurityPool } = getYesChildPool()

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'Fork Migration needs to start')
			const migratedAttoRep = await getMigratedAttoRep(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(migratedAttoRep, 0n, 'correct amount rep migrated')
			assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'Did not create YES security pool')
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'yes System should be operational right away')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), 0n, 'child contract did not record the amount correctly')
		})
	})
})
