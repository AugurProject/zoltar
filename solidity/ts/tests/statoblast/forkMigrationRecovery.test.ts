import { beforeEach, describe, test } from 'bun:test'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import assert from '../../testSupport/simulator/utils/assert'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { createWriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import {
	backingUnitsToAttoRep,
	createCompleteSet,
	depositRepToVault,
	depositToEscalationGame,
	getRepToken,
	getSecurityVault,
	getSettlementCollateralAttoEth,
	getShareTokenSupplyAttoShares,
	getSystemState,
	getTotalAccruedFees,
	getTotalRepBackingUnits,
	getTotalUnderwritingLimitAttoEth,
	redeemCompleteSet,
	redeemRepFromVault,
	redeemShares,
	setUnderwritingLimit,
	updateVaultFees,
} from '../../testSupport/simulator/utils/contracts/securityPool'
import { claimForkedEscalationDeposits, createChildUniverse, finalizeTruthAuction, getMigratedAttoRep, getQuestionOutcome, getSecurityPoolForkerForkData, migrateRepToZoltar, migrateVault, startTruthAuction } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { balanceOfShares, getEthRaiseCapAttoEth, getQuestionEndDate, migrateShares, participateAuction } from '../../testSupport/simulator/utils/contracts/statoblast'
import { approveAndDepositRepToVault, manipulatePriceOracle, setVaultCapacityFixture, triggerOwnGameFork } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { addRepToMigrationBalance, getRepTokenAddress, getTotalTheoreticalSupply, getZoltarAddress, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approximatelyEqual, ensureDefined, strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { approveToken, getChildUniverseId, getERC20Balance, getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { statoblast_SecurityPool_SecurityPool, statoblast_tokens_ShareToken_ShareToken } from '../../types/contractArtifact'
import { useStatoblastForkMigrationFixture, type StatoblastForkMigrationFixture } from './fixture'

describe('Statoblast: fork migration', () => {
	const fixture = useStatoblastForkMigrationFixture()

	const { reportBond, repDeposit, genesisUniverse, statoblastSecurityMultiplierBps, triggerExternalForkForSecurityPool, getYesChildPool, forkOwnGameAfterQuestionEnd } = fixture

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

	const getOutcomeShareSupplies = async (shareToken: `0x${string}`, universeId: bigint) =>
		await Promise.all(
			[QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No].map(
				async outcome =>
					await client.readContract({
						abi: statoblast_tokens_ShareToken_ShareToken.abi,
						functionName: 'totalSupplyForOutcome',
						address: shareToken,
						args: [universeId, outcome],
					}),
			),
		)

	describe('child pool recovery', () => {
		test('redeemRepFromVault removes redeemed backingUnits from the child pool denominator once the child pool is operational', async () => {
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			await forkOwnGameAfterQuestionEnd()
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			const attackerVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, attackerClient.account.address)
			const attackerClaimBeforeRedeem = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, attackerVaultBeforeRedeem.repBackingUnits)
			const denominatorBeforeRedeem = await getTotalRepBackingUnits(client, yesSecurityPool.securityPool)

			await setUnderwritingLimit(client, yesSecurityPool.securityPool, 0n)
			await redeemRepFromVault(client, yesSecurityPool.securityPool, client.account.address)

			const clientVaultAfterRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const denominatorAfterRedeem = await getTotalRepBackingUnits(client, yesSecurityPool.securityPool)
			const attackerClaimAfterRedeem = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, attackerVaultBeforeRedeem.repBackingUnits)

			strictEqualTypeSafe(clientVaultAfterRedeem.repBackingUnits, 0n, 'redeeming a vault should zero out its child-REP backing units')
			assert.ok(denominatorAfterRedeem <= denominatorBeforeRedeem, 'redeeming a vault should not increase the child pool denominator')
			approximatelyEqual(attackerClaimAfterRedeem, attackerClaimBeforeRedeem, 10n, 'redeeming another vault should preserve the remaining vault claim up to rounding')
			await assert.rejects(redeemRepFromVault(client, yesSecurityPool.securityPool, client.account.address), /No redeemable REP/)
		})

		test('parent pool halts on fork while a migrated child can resume operational flows', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6])
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, securityPoolUnderwritingLimitAttoEth)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

			strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'parent pool should enter PoolForked after the universe fork is activated')
			await assert.rejects(depositRepToVault(client, securityPoolAddresses.securityPool, 1n), /Universe forked|Forked/)

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2])
				await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			} else {
				strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should either run a truth auction or finalize immediately')
			}

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should become operational once migration and truth-auction processing finish')

			const childVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			assert.ok(childVaultBeforeRedeem.repBackingUnits > 0n, 'child migration should create redeemable vault backingUnits')
			await setUnderwritingLimit(client, yesSecurityPool.securityPool, 0n)
			await redeemRepFromVault(client, yesSecurityPool.securityPool, client.account.address)
			const childVaultAfterRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			strictEqualTypeSafe(childVaultAfterRedeem.repBackingUnits, 0n, 'operational child pool should allow redeemed backingUnits to clear')
		})

		test('child pool prices complete sets against all fork-time claims after balanced partial migration', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - 2n * DAY)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6])
			const newMinter = createWriteClient(mockWindow, TEST_ADDRESSES[4])
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			await approveAndDepositRepToVault(newMinter, repDeposit, questionId)
			// This accounting scenario starts with a backed vault whose capacity has been removed.
			await setVaultCapacityFixture(newMinter, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, newMinter.account.address, 0n)
			const parentUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, parentUnderwritingLimitAttoEth)
			const parentTotalUnderwritingLimitAttoEth = await getTotalUnderwritingLimitAttoEth(client, securityPoolAddresses.securityPool)
			const migratedParentMintAmount = 5n * 10n ** 18n
			const unmigratedHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			await createCompleteSet(client, securityPoolAddresses.securityPool, migratedParentMintAmount)
			await createCompleteSet(unmigratedHolder, securityPoolAddresses.securityPool, 5n * 10n ** 18n)
			const parentForkTimeShareSupply = await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool)

			await triggerExternalForkForSecurityPool(undefined, 'complete-set child mint fork source')
			await approveToken(newMinter, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await addRepToMigrationBalance(newMinter, genesisUniverse, repDeposit)
			await splitMigrationRep(newMinter, genesisUniverse, repDeposit, [QuestionOutcome.Yes])
			await migrateShares(client, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Invalid, [QuestionOutcome.Yes])
			await migrateShares(client, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])
			await migrateShares(client, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [QuestionOutcome.Yes])
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(newMinter, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesUniverse, yesSecurityPool } = getYesChildPool()

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'child pool should wait in migration state before accounting is settled')
			await assert.rejects(createCompleteSet(client, yesSecurityPool.securityPool, 1n), /Pool not operational|Pool inactive/)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'partially migrated child pool should price unsettled accounting through a truth auction')
			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			strictEqualTypeSafe(expectedEthToBuy > 0n, true, 'partial migration should leave ETH for the truth auction to buy')
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should become operational after truth-auction accounting settles')
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.None, 'unrelated fork should leave the child pool question unresolved')
			strictEqualTypeSafe(await getTotalUnderwritingLimitAttoEth(client, yesSecurityPool.securityPool), parentTotalUnderwritingLimitAttoEth, 'child pool should inherit all parent capacity ownership before minting new sets')

			const childMintAmount = 1n * 10n ** 18n
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			const childCollateralBeforeMint = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const childShareSupplyBeforeMint = await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(childShareSupplyBeforeMint, parentForkTimeShareSupply, 'child exchange-rate supply should reserve every fork-time parent claim')
			const outcomeSuppliesBeforeMint = await getOutcomeShareSupplies(yesSecurityPool.shareToken, yesUniverse)
			const migratedCompleteSetSupply = migratedParentMintAmount
			assert.deepStrictEqual(outcomeSuppliesBeforeMint, [migratedCompleteSetSupply, migratedCompleteSetSupply, migratedCompleteSetSupply], 'partial migration should materialize only the migrated ERC-1155 claims')

			await createCompleteSet(newMinter, yesSecurityPool.securityPool, childMintAmount)

			const childCollateralAfterMint = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			assert.ok(childCollateralAfterMint > childCollateralBeforeMint, 'child complete-set mint should increase collateral after fork accounting is settled')
			assert.ok(childCollateralAfterMint <= childCollateralBeforeMint + childMintAmount, 'child complete-set mint should accrue fees before adding new collateral')
			const updatedCollateralBeforeMint = childCollateralAfterMint - childMintAmount
			const expectedMintedShares = updatedCollateralBeforeMint === 0n ? childMintAmount : (childMintAmount * childShareSupplyBeforeMint) / updatedCollateralBeforeMint
			const childShareSupplyAfterMint = await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(childShareSupplyAfterMint, childShareSupplyBeforeMint + expectedMintedShares, 'child complete-set mint should add shares at the settled exchange rate')
			const materializedSupplyAfterMint = migratedCompleteSetSupply + expectedMintedShares
			assert.deepStrictEqual(await getOutcomeShareSupplies(yesSecurityPool.shareToken, yesUniverse), [materializedSupplyAfterMint, materializedSupplyAfterMint, materializedSupplyAfterMint], 'successful child minting should add balanced materialized claims without erasing the late-migration reserve')

			await manipulatePriceOracle(newMinter, mockWindow, yesSecurityPool.priceOracleManagerAndOperatorQueuer)
			await depositToEscalationGame(newMinter, yesSecurityPool.securityPool, QuestionOutcome.Yes, reportBond)
			await mockWindow.advanceTime(10n * DAY)
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'child question should resolve as yes')

			const newMinterBalanceBeforeRedemption = await getETHBalance(client, newMinter.account.address)
			await redeemShares(newMinter, yesSecurityPool.securityPool)
			const newMinterPayout = (await getETHBalance(client, newMinter.account.address)) - newMinterBalanceBeforeRedemption
			assert.ok(newMinterPayout <= childMintAmount, `post-fork complete-set minter must not capture preexisting collateral: deposited ${childMintAmount}, redeemed ${newMinterPayout}`)
		})

		test('an uneven child mints and redeems complete sets against fork-time economic claims', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - 2n * DAY)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6])
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			const parentUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, parentUnderwritingLimitAttoEth)

			const parentMintAmount = 10n * 10n ** 18n
			const imbalancingMintAmount = 1n
			const imbalancer = createWriteClient(mockWindow, TEST_ADDRESSES[4])
			await createCompleteSet(client, securityPoolAddresses.securityPool, parentMintAmount)
			await createCompleteSet(imbalancer, securityPoolAddresses.securityPool, imbalancingMintAmount)
			const parentForkTimeShareSupply = await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool)
			await triggerExternalForkForSecurityPool(undefined, 'uneven-share child mint fork source')
			await migrateShares(client, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Invalid, [QuestionOutcome.Yes])
			await migrateShares(client, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])
			await migrateShares(client, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [QuestionOutcome.Yes])
			await migrateShares(imbalancer, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesUniverse, yesSecurityPool } = getYesChildPool()
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			}

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should be operational after fork accounting settles')
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.None, 'unrelated fork should leave the child question unresolved')
			assert.ok((await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)) > 0n, 'test setup requires preexisting child collateral')
			const migratedBalances = await balanceOfShares(client, yesSecurityPool.shareToken, yesUniverse, client.account.address)
			strictEqualTypeSafe(ensureDefined(migratedBalances[0], 'invalid child balance missing'), parentMintAmount, 'balanced holder should migrate invalid shares')
			strictEqualTypeSafe(ensureDefined(migratedBalances[1], 'yes child balance missing'), parentMintAmount, 'yes supply should migrate unevenly')
			strictEqualTypeSafe(ensureDefined(migratedBalances[2], 'no child balance missing'), parentMintAmount, 'balanced holder should migrate no shares')
			const economicSupplyBeforeMint = await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool)
			const migratedBalancedSupply = parentMintAmount
			const migratedOutcomeSupplies = await getOutcomeShareSupplies(yesSecurityPool.shareToken, yesUniverse)
			const migratedMaximumSupply = ensureDefined(migratedOutcomeSupplies[1], 'yes child supply missing')
			strictEqualTypeSafe(migratedOutcomeSupplies[0], migratedBalancedSupply, 'invalid supply should belong to the balanced holder')
			assert.ok(migratedMaximumSupply > migratedBalancedSupply, 'one-sided migration should make yes the maximum outcome supply')
			strictEqualTypeSafe(migratedOutcomeSupplies[2], migratedBalancedSupply, 'no supply should belong to the balanced holder')
			strictEqualTypeSafe(economicSupplyBeforeMint, parentForkTimeShareSupply, 'child accounting should use all fork-time parent claims as its solvency denominator')

			const newMinter = createWriteClient(mockWindow, TEST_ADDRESSES[4])
			await createCompleteSet(newMinter, yesSecurityPool.securityPool, 1n * 10n ** 18n)
			const collateralBeforeRedemption = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const feesBeforeRedemption = await getTotalAccruedFees(client, yesSecurityPool.securityPool)
			const supplyBeforeRedemption = await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool)
			assert.ok(supplyBeforeRedemption > economicSupplyBeforeMint, 'new complete sets should add economic claims even when migrated outcome supplies are uneven')
			const balanceBeforeRedemption = await getETHBalance(client, client.account.address)
			await redeemCompleteSet(client, yesSecurityPool.securityPool, migratedBalancedSupply)
			const redemptionFeeDelta = (await getTotalAccruedFees(client, yesSecurityPool.securityPool)) - feesBeforeRedemption
			const collateralAfterCurrentFees = collateralBeforeRedemption - redemptionFeeDelta
			const expectedRedemption = (collateralAfterCurrentFees * migratedBalancedSupply) / supplyBeforeRedemption
			strictEqualTypeSafe((await getETHBalance(client, client.account.address)) - balanceBeforeRedemption, expectedRedemption, 'balanced holder should redeem proportionally against all economic claims')

			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), collateralAfterCurrentFees - expectedRedemption, 'redemption should debit current fees and only the proportional collateral payout')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool), supplyBeforeRedemption - migratedBalancedSupply, 'redemption should reduce the economic claim denominator by the burned complete sets')
			const balancesAfterRedemption = await balanceOfShares(client, yesSecurityPool.shareToken, yesUniverse, client.account.address)
			strictEqualTypeSafe(balancesAfterRedemption[0], 0n, 'redemption should burn the holder invalid balance')
			strictEqualTypeSafe(balancesAfterRedemption[1], 0n, 'redemption should burn the holder yes balance')
			strictEqualTypeSafe(balancesAfterRedemption[2], 0n, 'redemption should burn the holder no balance')
		})

		test('child pool prices new complete sets from fork-time claims when no shares migrated', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - 2n * DAY)
			const parentUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, parentUnderwritingLimitAttoEth)

			await createCompleteSet(client, securityPoolAddresses.securityPool, 10n * 10n ** 18n)
			await triggerExternalForkForSecurityPool(undefined, 'orphan-collateral child mint fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesUniverse, yesSecurityPool } = getYesChildPool()
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			}

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should be operational after fork accounting settles')
			assert.ok((await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)) > 0n, 'test setup requires collateral without migrated shares')
			const forkTimeShareSupply = 10n * 10n ** 18n
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool), forkTimeShareSupply, 'zero migration should preserve the parent fork-time economic claims')
			assert.deepStrictEqual(await getOutcomeShareSupplies(yesSecurityPool.shareToken, yesUniverse), [0n, 0n, 0n], 'economic claims should not require materialized child ERC-1155 balances')

			const newMinter = createWriteClient(mockWindow, TEST_ADDRESSES[4])
			const collateralBeforeMint = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const feesBeforeMint = await getTotalAccruedFees(client, yesSecurityPool.securityPool)
			await createCompleteSet(newMinter, yesSecurityPool.securityPool, 1n * 10n ** 18n)
			const mintFeeDelta = (await getTotalAccruedFees(client, yesSecurityPool.securityPool)) - feesBeforeMint
			const mintedOutcomeSupplies = await getOutcomeShareSupplies(yesSecurityPool.shareToken, yesUniverse)
			const mintedCompleteSets = ensureDefined(mintedOutcomeSupplies[0], 'new invalid child shares missing')
			assert.ok(mintedCompleteSets > 0n, 'fork-time economic claims should define a nonzero child exchange rate')
			assert.deepStrictEqual(mintedOutcomeSupplies, [mintedCompleteSets, mintedCompleteSets, mintedCompleteSets], 'post-fork complete-set minting should materialize balanced new claims')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool), forkTimeShareSupply + mintedCompleteSets, 'new complete sets should add to the reserved economic claim supply')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), collateralBeforeMint - mintFeeDelta + 1n * 10n ** 18n, 'successful minting should charge current fees and add its collateral without exposing the preexisting reserve')
		})

		test('child pool with migrated shares but no collateral activates after settlement while still rejecting complete-set minting', async () => {
			const parentUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, parentUnderwritingLimitAttoEth)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const parentMintAmount = 10n * 10n ** 18n
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, parentMintAmount)

			await triggerExternalForkForSecurityPool(undefined, 'zero-collateral child complete-set fork source')
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Invalid, [QuestionOutcome.Yes])
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [QuestionOutcome.Yes])
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const { yesUniverse, yesSecurityPool } = getYesChildPool()

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'an uncollateralized child must remain in its repair phase')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), 0n, 'test setup requires a zero-collateral child')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool), parentMintAmount, 'test setup requires migrated child complete-set shares')
			assert.deepStrictEqual(await getOutcomeShareSupplies(yesSecurityPool.shareToken, yesUniverse), [parentMintAmount, parentMintAmount, parentMintAmount], 'balanced migrated shares should match nominal supply even when collateral is still zero')
			strictEqualTypeSafe(await getTotalUnderwritingLimitAttoEth(client, yesSecurityPool.securityPool), 0n, 'inactive child financials must not expose parent mint capacity before repair')
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'ended settlement must release the child from truth-auction state even with no accepted bid ETH')

			const newMinter = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			const childCollateralBeforeFailedMint = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const childShareSupplyBeforeFailedMint = await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool)
			const childMintRejected = await newMinter
				.simulateContract({
					abi: statoblast_SecurityPool_SecurityPool.abi,
					functionName: 'createCompleteSet',
					address: yesSecurityPool.securityPool,
					args: [],
					account: newMinter.account,
					value: 1n * 10n ** 18n,
				})
				.then(
					() => false,
					error => {
						if (!(error instanceof Error)) throw error
						return true
					},
				)
			strictEqualTypeSafe(childMintRejected, true, 'zero-collateral child should reject new complete-set minting')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), childCollateralBeforeFailedMint, 'failed child mint should not add collateral')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, yesSecurityPool.securityPool), childShareSupplyBeforeFailedMint, 'failed child mint should not mint shares')
		})

		test('can claim parent escalation deposits before migrateVault', async () => {
			await forkOwnGameAfterQuestionEnd()
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			const parentVaultBeforeEscalationClaim = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesChildRepToken = getRepTokenAddress(yesUniverse)
			const walletRepBeforeEscalationClaim = await getERC20Balance(client, yesChildRepToken, client.account.address)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const migratedRepBeforeEscalation = await getMigratedAttoRep(client, yesSecurityPool.securityPool)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const yesVaultRepAfterEscalationClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, yesVault.repBackingUnits)
			const migratedAttoRep = await getMigratedAttoRep(client, yesSecurityPool.securityPool)
			const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const walletRepAfterEscalationClaim = await getERC20Balance(client, yesChildRepToken, client.account.address)

			assert.ok(migratedAttoRep > 0n, 'some REP should be tracked as migrated')
			assert.ok(migratedAttoRep >= migratedRepBeforeEscalation, 'later vault migration should not reduce child migrated REP accounting')
			assert.ok(walletRepAfterEscalationClaim > walletRepBeforeEscalationClaim, 'claiming an own-fork escalation deposit should pay child REP directly to the wallet')
			assert.ok(parentVaultAfterMigration.disputeStakedAttoRep < parentVaultBeforeEscalationClaim.disputeStakedAttoRep, 'claiming a winning parent escalation deposit should reduce the parent escalation escrow')
			assert.ok(yesVault.repBackingUnits > 0n, 'vault migration should still create child REP backing units for pool-held REP')
			assert.ok(yesVaultRepAfterEscalationClaim > 0n, 'vault migration should create pool-held child-vault REP backing')
			strictEqualTypeSafe((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).repBackingUnits, 0n, 'parent vault should be emptied after migration')
		})
	})
})
