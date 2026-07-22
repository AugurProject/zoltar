import { beforeEach, describe, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData } from '@zoltar/shared/ethereum'
import {
	peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
	test_peripherals_SecurityPoolForkerAuctionSettlementHarness_AuctionSettlementPoolHarness,
	test_peripherals_SecurityPoolForkerAuctionSettlementHarness_SecurityPoolForkerAuctionSettlementHarness,
} from '../../types/contractArtifact'
import { usePeripheralsTruthAuctionFixture, type PeripheralsTruthAuctionFixture } from './fixture'
import { getExpectedLiquidationRepMove } from './liquidationTestHelpers'
import { getMaxRepBeingSold, getMinBidSize, isFinalized, submitBid } from '../../testSupport/simulator/utils/contracts/auction'
import { getLastPrice, queueLiquidationAtForcedPrice } from '../../testSupport/simulator/utils/contracts/peripherals'
import { applyLibraries } from '../../testSupport/simulator/utils/contracts/deployPeripherals'
import { getForkActivationTime } from '../../testSupport/simulator/utils/contracts/securityPoolForker'

describe('Peripherals: truth auction', () => {
	const fixture = usePeripheralsTruthAuctionFixture()

	const assert: PeripheralsTruthAuctionFixture['assert'] = fixture.assert

	const approximatelyEqual: PeripheralsTruthAuctionFixture['approximatelyEqual'] = fixture.approximatelyEqual

	const strictEqualTypeSafe: PeripheralsTruthAuctionFixture['strictEqualTypeSafe'] = fixture.strictEqualTypeSafe

	const {
		decodeEventLog,
		createWriteClient,
		DAY,
		GENESIS_REPUTATION_TOKEN,
		TEST_ADDRESSES,
		formatStorageSlot,
		getMappingStorageSlot,
		approveToken,
		contractExists,
		getChildUniverseId,
		getERC20Balance,
		getETHBalance,
		addressString,
		approveAndDepositRep,
		handleOracleReporting,
		manipulatePriceOracle,
		manipulatePriceOracleAndPerformOperation,
		triggerOwnGameFork,
		deployOriginSecurityPool,
		getInfraContractAddresses,
		getSecurityPoolAddresses,
		createQuestion,
		getQuestionId,
		getEthRaiseCap,
		getQuestionEndDate,
		OperationType,
		participateAuction,
		tickToPrice,
		QuestionOutcome,
		SystemState,
		claimAuctionProceeds,
		createChildUniverse,
		finalizeTruthAuction,
		getMigratedRep,
		getOwnForkRepBuckets,
		getQuestionOutcome,
		getSecurityPoolForkerForkData,
		initiateSecurityPoolFork,
		claimForkedEscalationDeposits,
		migrateRepToZoltar,
		migrateVault,
		settleAuctionBids,
		startTruthAuction,
		forkUniverse,
		getMigrationRepBalance,
		getRepTokenAddress,
		getTotalTheoreticalSupply,
		getZoltarAddress,
		getTotalRepPurchased,
		isIgnorableLogDecodeError,
		createCompleteSet,
		depositRep,
		depositToEscalationGame,
		getCompleteSetCollateralAmount,
		getPoolOwnershipDenominator,
		getRepToken,
		getSecurityVault,
		getSystemState,
		getTotalAccruedFees,
		getTotalFeesOwedToVaults,
		getTotalSecurityBondAllowance,
		getVaultCount,
		poolOwnershipToRep,
		redeemFees,
		redeemRep,
		updateVaultFees,
		peripherals_SecurityPoolForker_SecurityPoolForker,
		getMigrationProxyAddressAbi,
		PRICE_PRECISION,
		reportBond,
		repDeposit,
		genesisUniverse,
		securityMultiplier,
		outcomes,
		triggerExternalForkForSecurityPool,
		setupStartedTruthAuction,
		setupTruthAuctionWithMixedBids,
		setupTruthAuctionWithTwoWinningBids,
		setupFinalizedTruthAuctionWithMixedBids,
	} = fixture

	let mockWindow: PeripheralsTruthAuctionFixture['mockWindow']

	let client: PeripheralsTruthAuctionFixture['client']

	let securityPoolAddresses: PeripheralsTruthAuctionFixture['securityPoolAddresses']

	let questionData: PeripheralsTruthAuctionFixture['questionData']

	let questionId: PeripheralsTruthAuctionFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionData = fixture.questionData
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

	const finalizeChildQuestionAsYes = async (childSecurityPool: typeof securityPoolAddresses) => {
		const childRepToken = await getRepToken(client, childSecurityPool.securityPool)
		const reporterBalanceSlot = formatStorageSlot(getMappingStorageSlot(client.account.address, 0n))
		await mockWindow.addStateOverrides({
			[childRepToken]: {
				stateDiff: {
					[reporterBalanceSlot]: repDeposit,
				},
			},
		})
		await approveToken(client, childRepToken, getInfraContractAddresses().openOracle)
		await manipulatePriceOracle(client, mockWindow, childSecurityPool.priceOracleManagerAndOperatorQueuer)
		await depositToEscalationGame(client, childSecurityPool.securityPool, QuestionOutcome.Yes, reportBond)
		await mockWindow.advanceTime(10n * DAY)
	}

	const setupLongDatedChildAuction = async (titlePrefix: string, forcedSurplusAboveAllowance?: bigint) => {
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
		await createCompleteSet(createWriteClient(mockWindow, TEST_ADDRESSES[1], 0), securityPoolAddresses.securityPool, 10n * 10n ** 18n)

		await triggerExternalForkForSecurityPool(undefined, titlePrefix)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
		const expectedEthToBuy = await getEthRaiseCap(client, yesSecurityPool.truthAuction)
		const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const auctionTick = await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)
		if (forcedSurplusAboveAllowance !== undefined) {
			await mockWindow.setBalance(yesSecurityPool.securityPool, securityPoolAllowance + forcedSurplusAboveAllowance)
		}
		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		return { auctionParticipant, auctionTick, yesSecurityPool }
	}

	describe('auction startup and migration isolation', () => {
		test('truth-auction finalization starts long-dated child fee accrual at activation', async () => {
			const { yesSecurityPool } = await setupLongDatedChildAuction('long-dated child fee activation source')
			const collateralAtActivation = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)

			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)

			const oneBlockFeeTolerance = 100_000_000_000n
			approximatelyEqual(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), collateralAtActivation, oneBlockFeeTolerance, 'activating a child must not retroactively charge newly installed collateral for migration and auction time')
			assert.ok((await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)).unpaidEthFees < oneBlockFeeTolerance, 'the first child fee update should charge at most the post-activation block interval')
		})

		test('unclaimed auction allowance does not create fees without a vault beneficiary', async () => {
			const { auctionParticipant, auctionTick, yesSecurityPool } = await setupLongDatedChildAuction('pending auction allowance fee source')
			await mockWindow.advanceTime(DAY)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)

			const migratedVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			strictEqualTypeSafe(await getTotalFeesOwedToVaults(client, yesSecurityPool.securityPool), migratedVault.unpaidEthFees, 'only assigned migrated allowance should accrue claimable fees before auction settlement')

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])
			const auctionVaultAtClaim = await getSecurityVault(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
			strictEqualTypeSafe(auctionVaultAtClaim.unpaidEthFees, 0n, 'auction allowance should begin earning at claim rather than receiving historical fees')
			strictEqualTypeSafe(await getTotalFeesOwedToVaults(client, yesSecurityPool.securityPool), migratedVault.unpaidEthFees, 'claiming auction allowance must not leave or create phantom aggregate fee debt')
		})

		test('nonzero fee redemption cannot reclassify forced child ETH as collateral', async () => {
			const { yesSecurityPool } = await setupLongDatedChildAuction('forced ETH fee redemption source', 10n ** 30n)
			await mockWindow.advanceTime(DAY)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			assert.ok((await getTotalFeesOwedToVaults(client, yesSecurityPool.securityPool)) > 0n, 'the migrated vault should accrue fees before redemption')
			const collateralBeforeFeeRedemption = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)

			await redeemFees(client, yesSecurityPool.securityPool, client.account.address)

			assert.ok((await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)) <= collateralBeforeFeeRedemption, 'nonzero fee redemption may accrue another block of fees but must not promote forced ETH into collateral')
		})

		test('startTruthAuction waits for the parent migration window instead of the child universe fork time', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, 'parent migration window fork source')
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

			await assert.rejects(startTruthAuction(client, yesSecurityPool.securityPool), /Active/)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'child pool should keep accepting migration until the parent window closes')
		})

		test('startTruthAuction keeps migration open at the exact parent deadline and starts one second later', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, 'parent migration deadline boundary fork source')
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			const migrationDeadline = (await getForkActivationTime(client, securityPoolAddresses.securityPool)) + 8n * 7n * DAY

			await mockWindow.setTime(migrationDeadline - 1n)
			// The transaction mines at the exact deadline. On slower runners the receipt
			// poll can mine another block before replaying the revert, losing its reason.
			await assert.rejects(startTruthAuction(client, yesSecurityPool.securityPool))
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'child pool should still be in migration at the exact parent deadline')

			await mockWindow.setTime(migrationDeadline)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'child pool should enter truth auction after the parent migration window closes')
		})

		test('migration and auction-start competitors use exact block timestamps at deadline - 1, deadline, and deadline + 1', async () => {
			const migratingVault = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(migratingVault, repDeposit, questionId)
			await triggerExternalForkForSecurityPool(undefined, 'same-block migration deadline source')
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
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
								abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
								functionName: 'migrateVault',
								args: [securityPoolAddresses.securityPool, BigInt(QuestionOutcome.Yes)],
							}),
						)
					const sendAuctionStart = async () =>
						await queueDirectTransaction(
							client.account.address,
							forkerAddress,
							encodeFunctionData({
								abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
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
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, repDeposit / 4n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, 'auction inventory funding fork source')
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)

			await startTruthAuction(client, yesSecurityPool.securityPool)

			const childBalance = await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool)
			const auctionCap = await getMaxRepBeingSold(client, yesSecurityPool.truthAuction)
			strictEqualTypeSafe(childBalance, parentForkData.auctionableRepAtFork, 'truth auction should fund the child with its complete accounting REP baseline')
			assert.ok(auctionCap <= childBalance, 'truth auction cap should not exceed the child REP balance')
		})

		test('finalizeTruthAuction keeps the auction active at the exact end and finalizes one second later', async () => {
			const { yesSecurityPool } = await setupStartedTruthAuction('truth auction finalization deadline source')
			const { truthAuctionStarted } = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
			const auctionDeadline = truthAuctionStarted + 7n * DAY

			await mockWindow.setTime(auctionDeadline - 1n)
			await assert.rejects(finalizeTruthAuction(client, yesSecurityPool.securityPool), /Auction open/)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'child pool should remain in truth auction at the exact finalization deadline')

			await mockWindow.setTime(auctionDeadline)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should become operational after the truth auction end boundary passes')
		})

		test('an ended truth auction finalizes and refunds non-qualifying demand without accepting a repair donation', async () => {
			const { repAtFork, yesSecurityPool } = await setupStartedTruthAuction('under-repaired child fork source')
			const migratedCollateral = await getETHBalance(client, yesSecurityPool.securityPool)
			const losingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const losingBid = await getMinBidSize(client, yesSecurityPool.truthAuction)
			const losingTick = await participateAuction(losingBidder, yesSecurityPool.truthAuction, repAtFork, losingBid)
			await mockWindow.advanceTime(7n * DAY + DAY)

			await assert.rejects(finalizeTruthAuction(client, yesSecurityPool.securityPool, 1n), /does not accept repair contributions/)
			strictEqualTypeSafe(await isFinalized(client, yesSecurityPool.truthAuction), false, 'rejected contribution must leave the auction available for value-free finalization')

			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'an ended auction must activate the child without relying on an uncompensated contribution')
			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), migratedCollateral, 'only migrated collateral and accepted bid ETH may become child collateral')
			strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), 0n, 'non-qualifying demand must not purchase auction REP')

			const bidderBalanceBeforeRefund = await getETHBalance(client, losingBidder.account.address)
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
			strictEqualTypeSafe((await getETHBalance(client, losingBidder.account.address)) - bidderBalanceBeforeRefund, losingBid, 'the non-qualifying bidder must recover all bid ETH after the deadline')
		})

		test('bid and finalization competitors use exact block timestamps at deadline - 1, deadline, and deadline + 1', async () => {
			const { expectedEthToBuy, repAtFork, yesSecurityPool } = await setupStartedTruthAuction('same-block auction deadline source')
			const initialBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const competingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			const winningTick = await participateAuction(initialBidder, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)
			const minBidSize = await getMinBidSize(client, yesSecurityPool.truthAuction)
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
								abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
								functionName: 'submitBid',
								args: [winningTick],
							}),
							minBidSize,
						)
					const sendFinalize = async () =>
						await queueDirectTransaction(
							client.account.address,
							forkerAddress,
							encodeFunctionData({
								abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
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
			strictEqualTypeSafe(atDeadline.finalizeStatus, 'reverted', 'forker finalization should remain closed at the exact auction deadline')

			await mockWindow.anvilRevert(boundarySnapshot)
			const afterDeadline = await mineCompetitors(auctionDeadline + 1n, true)
			strictEqualTypeSafe(afterDeadline.bidStatus, 'reverted', 'bidding should stay closed after the deadline')
			strictEqualTypeSafe(afterDeadline.finalizeStatus, 'success', 'finalization should become valid one second after the deadline in the same block')
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the repaired child should activate only through the post-deadline finalization competitor')
		})

		const forcedBalanceCases = [
			{ name: 'exactly the parent allowance', surplusAboveAllowance: 0n },
			{ name: 'one wei above the parent allowance', surplusAboveAllowance: 1n },
			{ name: 'a large surplus above the parent allowance', surplusAboveAllowance: 10n ** 30n },
		]

		test.each(forcedBalanceCases)('forced ETH at $name after the deadline cannot contaminate or block finalization', async ({ name, surplusAboveAllowance }) => {
			const { yesSecurityPool } = await setupStartedTruthAuction(`forced ETH ${name} finalization source`)
			const legitimateCollateral = await getETHBalance(client, yesSecurityPool.securityPool)
			const parentAllowance = await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool)
			const forcedBalance = parentAllowance + surplusAboveAllowance

			await mockWindow.advanceTime(7n * DAY + DAY)
			await mockWindow.setBalance(yesSecurityPool.securityPool, forcedBalance)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'surplus ETH must not keep the child in truth-auction state')
			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), legitimateCollateral, 'forced ETH must remain outside protocol-accounted collateral')
			strictEqualTypeSafe(await getETHBalance(client, yesSecurityPool.securityPool), forcedBalance, 'forced ETH should remain an unaccounted pool surplus')

			await redeemFees(client, yesSecurityPool.securityPool, addressString(TEST_ADDRESSES[6]))
			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), legitimateCollateral, 'zero-fee redemption must not reclassify forced ETH as collateral')
		})

		test('forced ETH during bidding stays outside collateral while auction proceeds remain accounted', async () => {
			const { yesSecurityPool, expectedEthToBuy } = await setupTruthAuctionWithMixedBids(false)
			const legitimateCollateralBeforeAuction = await getETHBalance(client, yesSecurityPool.securityPool)
			const parentAllowance = await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool)
			const forcedBalance = parentAllowance + 10n ** 30n

			await mockWindow.setBalance(yesSecurityPool.securityPool, forcedBalance)
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'forced ETH during bidding must not block the auction lifecycle')
			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), legitimateCollateralBeforeAuction + expectedEthToBuy, 'collateral should include only migrated collateral and filled auction proceeds')
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

			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), legitimateCollateralBeforeAuction + expectedEthToBuy, 'child collateral should include only migration funding and auction ETH received during finalization')
			strictEqualTypeSafe(await getETHBalance(client, yesSecurityPool.securityPool), legitimateCollateralBeforeAuction + expectedEthToBuy, 'prefinalization forker surplus must not be forwarded to the child')
			strictEqualTypeSafe(await getETHBalance(client, securityPoolForker), forkerBalanceBeforeForce + forcedForkerSurplus, 'forced forker ETH should remain isolated after forwarding auction proceeds')
		})

		test('fully utilized non-divisible migration cannot round final collateral above the parent allowance', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
			await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
			const parentAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, parentAllowance)
			await createCompleteSet(client, securityPoolAddresses.securityPool, parentAllowance)

			await triggerExternalForkForSecurityPool(undefined, 'non-divisible fully utilized fork source')
			const parentCollateralAtFork = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
			const parentVaultSlot = getMappingStorageSlot(client.account.address, 16n)
			await mockWindow.addStateOverrides({
				[securityPoolAddresses.securityPool]: {
					stateDiff: {
						[formatStorageSlot(1n)]: parentCollateralAtFork,
						[formatStorageSlot(parentVaultSlot + 1n)]: parentCollateralAtFork,
					},
				},
			})
			strictEqualTypeSafe(await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool), parentCollateralAtFork, 'the parent must be fully utilized at the fork snapshot')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
			assert.ok((parentCollateralAtFork * migratedRep) % parentForkData.auctionableRepAtFork > 0n, 'the migration ratio must require collateral rounding')

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			const auctionEthRaiseCap = await getEthRaiseCap(client, yesSecurityPool.truthAuction)
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await submitBid(auctionParticipant, yesSecurityPool.truthAuction, 524288n, auctionEthRaiseCap)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'rounding must not block finalization')
			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), parentCollateralAtFork, 'final collateral must stay within the fully utilized parent allowance')
		})

		test('startTruthAuction skips auction startup when all REP is already migrated', async () => {
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(attackerClient, repDeposit, questionId)
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 1n * 10n ** 18n)

			const forkSourceQuestionData = {
				...questionData,
				title: 'full migration external fork source',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
			await createQuestion(client, forkSourceQuestionData, outcomes)
			await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, forkSourceQuestionId)
			const initiateForkHash = await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			const initiateForkReceipt = await client.waitForTransactionReceipt({ hash: initiateForkHash })
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			const denominatorBeforeStart = await getPoolOwnershipDenominator(client, yesSecurityPool.securityPool)
			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const forkSnapshotLog = initiateForkReceipt.logs
				.filter(log => log.address.toLowerCase() === getInfraContractAddresses().securityPoolForker.toLowerCase())
				.map(log =>
					decodeEventLog({
						abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
						data: log.data,
						topics: log.topics,
					}),
				)
				.find(log => log.eventName === 'SecurityPoolForkSnapshot')
			if (forkSnapshotLog === undefined) throw new Error('missing SecurityPoolForkSnapshot log')
			assert.strictEqual(forkSnapshotLog.args.parentPool, securityPoolAddresses.securityPool, 'fork snapshot should identify the parent pool')
			assert.strictEqual(forkSnapshotLog.args.auctionableRepAtFork, forkData.auctionableRepAtFork, 'fork snapshot should expose the updated auctionable REP')
			assert.strictEqual(forkSnapshotLog.args.ownFork, false, 'fork snapshot should identify external fork mode')
			strictEqualTypeSafe(await getMigratedRep(client, yesSecurityPool.securityPool), forkData.auctionableRepAtFork, 'all parent REP should already be represented by migrated vault ownership in this fast path')

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child pool should finalize immediately when no auction is needed')
			strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), 0n, 'no REP should be sold when the auction is skipped')
			strictEqualTypeSafe(await getPoolOwnershipDenominator(client, yesSecurityPool.securityPool), denominatorBeforeStart, 'skipping the auction should preserve the existing child ownership denominator when no REP is sold')
		})

		test('own-fork truth auction uses only vault REP as the pool auction basis', async () => {
			const securityPoolAllowance = 1n * 10n ** 18n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
			let vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			let vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
			const requiredVaultRep = 4n * forkThreshold
			if (vaultRep < requiredVaultRep) {
				await approveAndDepositRep(client, requiredVaultRep - vaultRep, questionId)
				vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
				vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
			}
			assert.ok(vaultRep >= requiredVaultRep, 'test setup needs unlocked REP plus escalation REP')
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

			const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			assert.ok(parentForkData.auctionableRepAtFork > ownForkRepBuckets.vaultRepAtFork, 'own fork should include escalation REP outside the pool auction basis')
			assert.ok(ownForkRepBuckets.vaultRepAtFork > 0n, 'test setup should leave vault REP available to migrate')

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			strictEqualTypeSafe(await getMigratedRep(client, yesSecurityPool.securityPool), ownForkRepBuckets.vaultRepAtFork, 'all vault REP should be migrated into the child pool')

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'all migrated vault REP should skip the pool truth auction even when escalation REP forked separately')
			strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), 0n, 'the pool auction should not sell escalation-game REP')
		})

		test('forced ETH before child deployment cannot block the no-auction finalization path', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			await mockWindow.setBalance(yesSecurityPool.securityPool, 1n)
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

			const childRepToken = getRepTokenAddress(yesUniverse)
			const clientVaultBeforeFinalize = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const clientClaimBeforeFinalize = await poolOwnershipToRep(client, yesSecurityPool.securityPool, clientVaultBeforeFinalize.repDepositShare)

			assert.ok(clientClaimBeforeFinalize > 0n, 'the migrated vault should retain a positive child-pool REP claim before immediate finalization')
			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), 0n, 'the no-collateral fast path requires zero remaining parent collateral')

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child pool should finalize immediately when only forced ETH is present')
			strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), 0n, 'no REP should be sold when there is no collateral to buy')
			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), 0n, 'predeployment forced ETH must remain outside child collateral accounting')
			strictEqualTypeSafe(await getETHBalance(client, yesSecurityPool.securityPool), 1n, 'predeployment forced ETH should remain as unaccounted surplus')
			const childBalanceBeforeRedeem = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
			await redeemRep(client, yesSecurityPool.securityPool, client.account.address)
			approximatelyEqual(await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool), childBalanceBeforeRedeem - clientClaimBeforeFinalize, 10n, 'redeeming after immediate finalization should reduce the child balance only by the redeemed migrated claim')
		})

		test('escalation migration remains redeemable after truth auction finalization', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const winningDeposit = repDeposit / 2n
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * 10n ** 18n)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [1n])

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			const childRepToken = getRepTokenAddress(yesUniverse)
			const originalVaultBeforeFinalize = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const childBalanceBeforeFinalize = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
			const originalClaimBeforeFinalize = await poolOwnershipToRep(client, yesSecurityPool.securityPool, originalVaultBeforeFinalize.repDepositShare)
			assert.ok(originalClaimBeforeFinalize > 0n, 'the migrated vault should retain a positive unlocked child REP claim before finalization')
			assert.ok(originalClaimBeforeFinalize <= childBalanceBeforeFinalize, 'before finalization the migrated vault claim should stay bounded by the child pools unlocked REP balance')

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const poolRepAtFork = ownForkRepBuckets.vaultRepAtFork
			const expectedEthToBuy = await getEthRaiseCap(client, yesSecurityPool.truthAuction)
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
				const auctionTick = await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, poolRepAtFork / 2n, expectedEthToBuy)
				assert.ok(tickToPrice(auctionTick) > 0n, 'auction participation should produce a valid clearing price when a truth auction is needed')
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			} else {
				strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should either run a truth auction or finalize immediately')
				strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
			}

			const originalVaultAfterFinalize = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const childBalanceAfterFinalize = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
			const originalClaimAfterFinalize = await poolOwnershipToRep(client, yesSecurityPool.securityPool, originalVaultAfterFinalize.repDepositShare)
			assert.ok(originalClaimAfterFinalize > 0n, 'the migrated vault should remain redeemable after finalization')
			assert.ok(originalClaimAfterFinalize <= childBalanceAfterFinalize, 'the migrated vault claim should stay bounded by the child pools remaining REP balance')

			const childBalanceBeforeRedeem = childBalanceAfterFinalize
			await redeemRep(client, yesSecurityPool.securityPool, client.account.address)
			approximatelyEqual(await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool), childBalanceBeforeRedeem - originalClaimAfterFinalize, 10n, 'redeeming the migrated vault should reduce the child balance by the redeemed migrated claim')
		})

		test('multiple migrated holders remain redeemable after truth auction finalization', async () => {
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(attackerClient, repDeposit, questionId)

			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * 10n ** 18n)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			const childRepToken = getRepTokenAddress(yesUniverse)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const poolRepAtFork = ownForkRepBuckets.vaultRepAtFork
			const expectedEthToBuy = await getEthRaiseCap(client, yesSecurityPool.truthAuction)
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
				await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, poolRepAtFork, expectedEthToBuy)
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			} else {
				strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should either run a truth auction or finalize immediately')
			}
			const totalRepPurchased = await getTotalRepPurchased(client, yesSecurityPool.truthAuction)

			const clientVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const attackerVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, attackerClient.account.address)
			const clientClaimBeforeRedeem = await poolOwnershipToRep(client, yesSecurityPool.securityPool, clientVaultBeforeRedeem.repDepositShare)
			const attackerClaimBeforeRedeem = await poolOwnershipToRep(client, yesSecurityPool.securityPool, attackerVaultBeforeRedeem.repDepositShare)
			assert.ok(clientClaimBeforeRedeem > 0n, 'the first migrated holder should retain a positive redeemable claim after finalization')
			assert.ok(attackerClaimBeforeRedeem > 0n, 'the second migrated holder should retain a positive redeemable claim after finalization')

			await redeemRep(attackerClient, yesSecurityPool.securityPool, attackerClient.account.address)
			const clientClaimAfterFirstRedeem = await poolOwnershipToRep(client, yesSecurityPool.securityPool, clientVaultBeforeRedeem.repDepositShare)
			approximatelyEqual(clientClaimAfterFirstRedeem, clientClaimBeforeRedeem, 10n, 'redeeming one migrated holder should not brick the remaining migrated holder')

			const childBalanceBeforeFinalRedeem = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
			await redeemRep(client, yesSecurityPool.securityPool, client.account.address)
			assert.ok((await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)) <= childBalanceBeforeFinalRedeem, 'redeeming the remaining migrated holder should not increase the child REP balance')
			assert.ok(totalRepPurchased >= 0n, 'auction accounting should remain readable after both migrated holders redeem')
		})

		test('repro: migrateRepToZoltar shares migration balance across parent pools before child creation', async () => {
			const secondQuestionData = {
				...questionData,
				title: 'second security pool question',
			}
			const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
			await createQuestion(client, secondQuestionData, outcomes)
			await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, securityMultiplier)

			const secondPoolOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(secondPoolOwner, repDeposit, secondQuestionId)

			const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, securityMultiplier)
			const forkSourceQuestionData = {
				...questionData,
				title: 'fork source question',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
			await createQuestion(secondPoolOwner, forkSourceQuestionData, outcomes)
			await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
			await approveToken(secondPoolOwner, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(secondPoolOwner, genesisUniverse, forkSourceQuestionId)

			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			await initiateSecurityPoolFork(secondPoolOwner, secondSecurityPoolAddresses.securityPool)

			const firstPoolForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const secondPoolForkData = await getSecurityPoolForkerForkData(client, secondSecurityPoolAddresses.securityPool)

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateRepToZoltar(secondPoolOwner, secondSecurityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await createChildUniverse(secondPoolOwner, secondSecurityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesChildUniverseId = getChildUniverseId(genesisUniverse, BigInt(QuestionOutcome.Yes))
			const firstYesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesChildUniverseId, questionId, securityMultiplier).securityPool
			const secondYesChildPool = getSecurityPoolAddresses(secondSecurityPoolAddresses.securityPool, yesChildUniverseId, secondQuestionId, securityMultiplier).securityPool
			const childRepToken = await getRepToken(client, firstYesChildPool)
			const firstChildRepBalance = await getERC20Balance(client, childRepToken, firstYesChildPool)
			const secondChildRepBalance = await getERC20Balance(client, childRepToken, secondYesChildPool)

			strictEqualTypeSafe(firstChildRepBalance, firstPoolForkData.auctionableRepAtFork, 'the first child pool should receive only the REP migrated from the first parent pool')
			strictEqualTypeSafe(secondChildRepBalance, secondPoolForkData.auctionableRepAtFork, 'the second child pool should receive only the REP migrated from the second parent pool')
		})

		test('migration proxies deploy lazily at their predicted CREATE2 addresses', async () => {
			const secondQuestionData = {
				...questionData,
				title: 'second security pool question for proxy deployment checks',
			}
			const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
			await createQuestion(client, secondQuestionData, outcomes)
			await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, securityMultiplier)

			const secondPoolOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(secondPoolOwner, repDeposit, secondQuestionId)

			const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, securityMultiplier)
			const forkSourceQuestionData = {
				...questionData,
				title: 'fork source question for proxy deployment checks',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
			await createQuestion(secondPoolOwner, forkSourceQuestionData, outcomes)
			await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
			await approveToken(secondPoolOwner, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(secondPoolOwner, genesisUniverse, forkSourceQuestionId)

			const securityPoolForkerAddress = getInfraContractAddresses().securityPoolForker
			const firstProxyAddress = await client.readContract({
				abi: getMigrationProxyAddressAbi,
				functionName: 'getMigrationProxyAddress',
				address: securityPoolForkerAddress,
				args: [securityPoolAddresses.securityPool],
			})
			const secondProxyAddress = await client.readContract({
				abi: getMigrationProxyAddressAbi,
				functionName: 'getMigrationProxyAddress',
				address: securityPoolForkerAddress,
				args: [secondSecurityPoolAddresses.securityPool],
			})

			assert.ok(!(await contractExists(client, firstProxyAddress)), 'first proxy should not exist before the first parent pool initiates its fork')
			assert.ok(!(await contractExists(client, secondProxyAddress)), 'second proxy should not exist before the second parent pool initiates its fork')

			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			assert.ok(await contractExists(client, firstProxyAddress), 'first proxy should deploy when the first parent pool initiates its fork')
			assert.ok(!(await contractExists(client, secondProxyAddress)), 'second proxy should still be absent until its own pool initiates a fork')

			await initiateSecurityPoolFork(secondPoolOwner, secondSecurityPoolAddresses.securityPool)
			assert.ok(await contractExists(client, secondProxyAddress), 'second proxy should deploy when the second parent pool initiates its fork')
			strictEqualTypeSafe(
				await client.readContract({
					abi: getMigrationProxyAddressAbi,
					functionName: 'getMigrationProxyAddress',
					address: securityPoolForkerAddress,
					args: [securityPoolAddresses.securityPool],
				}),
				firstProxyAddress,
				'first proxy address should stay stable after deployment',
			)
			strictEqualTypeSafe(
				await client.readContract({
					abi: getMigrationProxyAddressAbi,
					functionName: 'getMigrationProxyAddress',
					address: securityPoolForkerAddress,
					args: [secondSecurityPoolAddresses.securityPool],
				}),
				secondProxyAddress,
				'second proxy address should stay stable after deployment',
			)
		})

		test('migration proxy balances match the expected lock and sweep flow', async () => {
			const forkSourceQuestionData = {
				...questionData,
				title: 'fork source question for proxy balance checks',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
			await createQuestion(client, forkSourceQuestionData, outcomes)
			await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, forkSourceQuestionId)
			const securityPoolForkerAddress = getInfraContractAddresses().securityPoolForker
			const migrationProxyAddress = await client.readContract({
				abi: getMigrationProxyAddressAbi,
				functionName: 'getMigrationProxyAddress',
				address: securityPoolForkerAddress,
				args: [securityPoolAddresses.securityPool],
			})

			assert.ok(!(await contractExists(client, migrationProxyAddress)), 'proxy should not exist before fork initiation')
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const yesUniverseId = getChildUniverseId(genesisUniverse, BigInt(QuestionOutcome.Yes))
			const yesChildRepToken = getRepTokenAddress(yesUniverseId)

			assert.ok(await contractExists(client, migrationProxyAddress), 'proxy should exist after fork initiation')
			strictEqualTypeSafe(await getERC20Balance(client, getRepTokenAddress(genesisUniverse), migrationProxyAddress), 0n, 'proxy should not keep parent REP after locking it into Zoltar')
			strictEqualTypeSafe(await getMigrationRepBalance(client, genesisUniverse, migrationProxyAddress), forkData.auctionableRepAtFork, 'proxy migration ledger should equal the parent pool REP tracked at fork time')
			assert.ok(!(await contractExists(client, yesChildRepToken)), 'child REP token should not exist before migration splitting deploys it')

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			assert.ok(await contractExists(client, yesChildRepToken), 'migration splitting should deploy the child REP token')
			strictEqualTypeSafe(await getERC20Balance(client, yesChildRepToken, migrationProxyAddress), forkData.auctionableRepAtFork, 'proxy should temporarily hold the split child REP before the child pool exists')

			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverseId, questionId, securityMultiplier).securityPool
			strictEqualTypeSafe(await getERC20Balance(client, yesChildRepToken, migrationProxyAddress), 0n, 'proxy should sweep child REP away once the child pool exists')
			strictEqualTypeSafe(await getERC20Balance(client, yesChildRepToken, yesSecurityPool), forkData.auctionableRepAtFork, 'child pool should receive the full split REP after the proxy sweep')
		})

		test('migrateRepToZoltar keeps child-universe REP isolated when both parent pools pre-create the same child outcome', async () => {
			const secondQuestionData = {
				...questionData,
				title: 'second security pool question with precreated child',
			}
			const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
			await createQuestion(client, secondQuestionData, outcomes)
			await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, securityMultiplier)

			const secondPoolOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(secondPoolOwner, repDeposit, secondQuestionId)

			const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, securityMultiplier)
			const forkSourceQuestionData = {
				...questionData,
				title: 'fork source question with precreated child',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
			await createQuestion(secondPoolOwner, forkSourceQuestionData, outcomes)
			await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
			await approveToken(secondPoolOwner, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(secondPoolOwner, genesisUniverse, forkSourceQuestionId)

			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			await initiateSecurityPoolFork(secondPoolOwner, secondSecurityPoolAddresses.securityPool)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await createChildUniverse(secondPoolOwner, secondSecurityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const firstPoolForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const secondPoolForkData = await getSecurityPoolForkerForkData(client, secondSecurityPoolAddresses.securityPool)

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateRepToZoltar(secondPoolOwner, secondSecurityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const yesChildUniverseId = getChildUniverseId(genesisUniverse, BigInt(QuestionOutcome.Yes))
			const firstYesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesChildUniverseId, questionId, securityMultiplier).securityPool
			const secondYesChildPool = getSecurityPoolAddresses(secondSecurityPoolAddresses.securityPool, yesChildUniverseId, secondQuestionId, securityMultiplier).securityPool
			const childRepToken = await getRepToken(client, firstYesChildPool)
			const firstChildRepBalance = await getERC20Balance(client, childRepToken, firstYesChildPool)
			const secondChildRepBalance = await getERC20Balance(client, childRepToken, secondYesChildPool)

			strictEqualTypeSafe(firstChildRepBalance, firstPoolForkData.auctionableRepAtFork, 'the first pre-created child pool should receive only the first parent pool REP')
			strictEqualTypeSafe(secondChildRepBalance, secondPoolForkData.auctionableRepAtFork, 'the second pre-created child pool should receive only the second parent pool REP')
			strictEqualTypeSafe(await getERC20Balance(client, childRepToken, getInfraContractAddresses().securityPoolForker), 0n, 'forker should not retain child REP after both pre-created child pools are funded')
		})

		test('migrateRepToZoltar keeps later parent pools isolated after an earlier parent already migrated and deployed its child pool', async () => {
			const secondQuestionData = {
				...questionData,
				title: 'second security pool question after first migration',
			}
			const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
			await createQuestion(client, secondQuestionData, outcomes)
			await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, securityMultiplier)

			const secondPoolOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(secondPoolOwner, repDeposit, secondQuestionId)

			const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, securityMultiplier)
			const forkSourceQuestionData = {
				...questionData,
				title: 'fork source question after first migration',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
			await createQuestion(secondPoolOwner, forkSourceQuestionData, outcomes)
			await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
			await approveToken(secondPoolOwner, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(secondPoolOwner, genesisUniverse, forkSourceQuestionId)

			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			const firstPoolForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			await initiateSecurityPoolFork(secondPoolOwner, secondSecurityPoolAddresses.securityPool)
			const secondPoolForkData = await getSecurityPoolForkerForkData(client, secondSecurityPoolAddresses.securityPool)
			await migrateRepToZoltar(secondPoolOwner, secondSecurityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(secondPoolOwner, secondSecurityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesChildUniverseId = getChildUniverseId(genesisUniverse, BigInt(QuestionOutcome.Yes))
			const firstYesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesChildUniverseId, questionId, securityMultiplier).securityPool
			const secondYesChildPool = getSecurityPoolAddresses(secondSecurityPoolAddresses.securityPool, yesChildUniverseId, secondQuestionId, securityMultiplier).securityPool
			const childRepToken = await getRepToken(client, firstYesChildPool)
			const firstChildRepBalance = await getERC20Balance(client, childRepToken, firstYesChildPool)
			const secondChildRepBalance = await getERC20Balance(client, childRepToken, secondYesChildPool)

			strictEqualTypeSafe(firstChildRepBalance, firstPoolForkData.auctionableRepAtFork, 'the first child pool balance should remain unchanged after the second pool migrates later')
			strictEqualTypeSafe(secondChildRepBalance, secondPoolForkData.auctionableRepAtFork, 'the second child pool should still receive only its own migrated REP even after the first pool already migrated')
		})

		test('redeemRep should stay blocked until the own-fork child pool becomes operational', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'child pool should still be in fork migration before the truth-auction window ends')
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'own-fork child currently reports a finalized outcome before the pool is operational')
			await assert.rejects(redeemRep(client, yesSecurityPool.securityPool, client.account.address), /Pool not operational|Pool inactive/)
		})
	})

	describe('auction bidding and claim settlement', () => {
		const setupFinalizedAuctionWithUnclaimedAllowance = async (forkSource: string) => {
			const unmigratedAllowanceHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await approveAndDepositRep(unmigratedAllowanceHolder, repDeposit, questionId)

			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const securityPoolAllowance = repDeposit / 8n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			await manipulatePriceOracleAndPerformOperation(unmigratedAllowanceHolder, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, unmigratedAllowanceHolder.account.address, securityPoolAllowance)

			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, forkSource)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
			const expectedEthToBuy = await getEthRaiseCap(client, yesSecurityPool.truthAuction)
			const auctionTick = await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			const forkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
			const childRepToken = await getRepToken(client, yesSecurityPool.securityPool)
			const clientChildRepBalanceSlot = formatStorageSlot(getMappingStorageSlot(client.account.address, 0n))
			await mockWindow.addStateOverrides({
				[childRepToken]: {
					stateDiff: {
						[clientChildRepBalanceSlot]: repDeposit * 100n,
					},
				},
			})
			await approveToken(client, childRepToken, getInfraContractAddresses().openOracle)

			return {
				auctionParticipant,
				auctionTick,
				auctionedAllowance: forkData.auctionedSecurityBondAllowance,
				migratedAllowance: securityPoolAllowance,
				yesSecurityPool,
			}
		}

		test('simple truth auction: participant buys rep and can claim proceeds', async () => {
			// Setup: create open interest, trigger fork, migrate
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			// Set security bond allowance and deposit extra REP for capacity
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRep(passiveRepHolder, repDeposit, questionId)
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			// Fork the security pool
			await triggerExternalForkForSecurityPool(undefined, 'simple truth auction fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

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
			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
			const expectedEthToBuy = await getEthRaiseCap(client, yesSecurityPool.truthAuction)

			// Participant bids: buy 1/4 of repAtFork for the full ethToBuy
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const repToBuy = repAtFork / 4n
			const auctionTick = await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repToBuy, expectedEthToBuy)

			// Finalize auction
			const childEthBalanceBeforeFinalize = await getETHBalance(client, yesSecurityPool.securityPool)
			const forkerEthBalanceBeforeFinalize = await getETHBalance(client, getInfraContractAddresses().securityPoolForker)
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getETHBalance(client, yesSecurityPool.securityPool), childEthBalanceBeforeFinalize + expectedEthToBuy, 'child pool should receive truth-auction ETH on finalization')
			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), childEthBalanceBeforeFinalize + expectedEthToBuy, 'child pool collateral accounting should include truth-auction ETH')
			strictEqualTypeSafe(await getETHBalance(client, getInfraContractAddresses().securityPoolForker), forkerEthBalanceBeforeFinalize, 'forker should not retain truth-auction ETH')

			// Verify participant got REP allocation

			// Claim proceeds
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])

			// Verify they got ownership shares matching purchasedRep (with tolerance for rounding)
			const vault = await getSecurityVault(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
			const repFromOwnership = await poolOwnershipToRep(client, yesSecurityPool.securityPool, vault.repDepositShare)
			assert.ok(repFromOwnership > 0n, 'auction participant should have some rep')
		})

		test('claimAuctionProceeds releases ETH for a finalized losing bid without mutating vault accounting', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'refund-only claim fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
			const expectedEthToBuy = await getEthRaiseCap(client, yesSecurityPool.truthAuction)
			const losingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const winningBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			const losingEth = expectedEthToBuy / 10n
			strictEqualTypeSafe(losingEth > 0n, true, 'losing bid should invest a positive amount')
			const losingTick = await participateAuction(losingBidder, yesSecurityPool.truthAuction, repAtFork, losingEth)
			await participateAuction(winningBidder, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			const totalRepPurchased = await getTotalRepPurchased(client, yesSecurityPool.truthAuction)
			strictEqualTypeSafe(totalRepPurchased > 0n, true, 'setup should leave a finalized auction with purchased REP')

			const vaultCountBeforeClaim = await getVaultCount(client, yesSecurityPool.securityPool)
			const losingBidderBalanceBeforeClaim = await getETHBalance(client, losingBidder.account.address)
			const losingVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])

			const losingBidderBalanceAfterClaim = await getETHBalance(client, losingBidder.account.address)
			const losingVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)
			const vaultCountAfterClaim = await getVaultCount(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(losingBidderBalanceAfterClaim - losingBidderBalanceBeforeClaim, losingEth, 'finalized losing bidder should receive their full ETH refund')
			strictEqualTypeSafe(losingVaultAfterClaim.repDepositShare, losingVaultBeforeClaim.repDepositShare, 'refund-only finalized claim should not mint pool ownership')
			strictEqualTypeSafe(losingVaultAfterClaim.securityBondAllowance, losingVaultBeforeClaim.securityBondAllowance, 'refund-only finalized claim should not assign security bond allowance')
			strictEqualTypeSafe(losingVaultAfterClaim.feeIndex, losingVaultBeforeClaim.feeIndex, 'refund-only finalized claim should not alter fee accounting')
			strictEqualTypeSafe(vaultCountAfterClaim, vaultCountBeforeClaim, 'refund-only finalized claim should not create a new vault')
		})

		test('auction participants receive settled vault REP or direct ETH refunds and can redeem purchased REP', async () => {
			const { yesSecurityPool, expectedEthToBuy, losingBidder, losingEth, losingTick, winningBidder, winningTick } = await setupTruthAuctionWithMixedBids(false)
			const childRepToken = getRepTokenAddress(getChildUniverseId(genesisUniverse, QuestionOutcome.Yes))
			const childEthBeforeFinalize = await getETHBalance(client, yesSecurityPool.securityPool)
			const childCollateralBeforeFinalize = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			const childEthAfterFinalize = await getETHBalance(client, yesSecurityPool.securityPool)
			const childCollateralAfterFinalize = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(childEthAfterFinalize - childEthBeforeFinalize, expectedEthToBuy, 'child pool should receive the ETH filled by the truth auction')
			assert.ok(childCollateralAfterFinalize >= childCollateralBeforeFinalize + expectedEthToBuy, 'child pool collateral accounting should include the auction ETH backing open interest')
			strictEqualTypeSafe(childCollateralAfterFinalize, childEthAfterFinalize, 'child pool collateral accounting should match the final ETH backing')

			const winningVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidder.account.address)
			const losingVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)
			const winningEthBeforeClaim = await getETHBalance(client, winningBidder.account.address)
			const losingEthBeforeClaim = await getETHBalance(client, losingBidder.account.address)

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, winningBidder.account.address, [{ tick: winningTick, bidIndex: 0n }])

			const winningVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidder.account.address)
			const losingVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)
			const winningRepClaim = await poolOwnershipToRep(client, yesSecurityPool.securityPool, winningVaultAfterClaim.repDepositShare)
			const losingRepClaim = await poolOwnershipToRep(client, yesSecurityPool.securityPool, losingVaultAfterClaim.repDepositShare)
			const winningLimitPrice = tickToPrice(winningTick)
			const minimumWinningRepAtLimit = (expectedEthToBuy * PRICE_PRECISION) / winningLimitPrice

			strictEqualTypeSafe((await getETHBalance(client, losingBidder.account.address)) - losingEthBeforeClaim, losingEth, 'losing auction participant should receive their ETH back')
			strictEqualTypeSafe(await getETHBalance(client, winningBidder.account.address), winningEthBeforeClaim, 'winning auction participant should not receive an ETH refund for a filled bid')
			strictEqualTypeSafe(losingVaultAfterClaim.repDepositShare, losingVaultBeforeClaim.repDepositShare, 'losing auction participant should not receive vault ownership')
			strictEqualTypeSafe(losingRepClaim, 0n, 'losing auction participant should not receive a REP vault claim')
			strictEqualTypeSafe(winningVaultBeforeClaim.repDepositShare, 0n, 'winning auction participant should start without child-pool vault ownership')
			assert.ok(winningRepClaim >= minimumWinningRepAtLimit, 'winning auction participant should receive a vault REP claim at least as good as their limit order')

			await finalizeChildQuestionAsYes(yesSecurityPool)
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'child question should eventually finalize before auction REP redemption')

			const winningRepBalanceBeforeRedeem = await getERC20Balance(client, childRepToken, winningBidder.account.address)
			await redeemRep(winningBidder, yesSecurityPool.securityPool, winningBidder.account.address)
			const winningRepBalanceAfterRedeem = await getERC20Balance(client, childRepToken, winningBidder.account.address)
			const winningVaultAfterRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidder.account.address)

			strictEqualTypeSafe(winningRepBalanceAfterRedeem - winningRepBalanceBeforeRedeem, winningRepClaim, 'winning auction participant should eventually redeem the purchased vault REP to their wallet')
			strictEqualTypeSafe(winningVaultAfterRedeem.repDepositShare, 0n, 'redeeming purchased auction REP should empty the participants vault ownership')
		})

		test('multiple filled auction participants can all redeem purchased vault REP', async () => {
			const { yesSecurityPool, expectedEthToBuy, losingBidder, losingEth, losingTick, winningBidderA, winningBidderB, winningEthA, winningEthB, winningTickA, winningTickB, winningBidIndexB } = await setupTruthAuctionWithTwoWinningBids(false)
			const childRepToken = getRepTokenAddress(getChildUniverseId(genesisUniverse, QuestionOutcome.Yes))
			const childEthBeforeFinalize = await getETHBalance(client, yesSecurityPool.securityPool)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe((await getETHBalance(client, yesSecurityPool.securityPool)) - childEthBeforeFinalize, expectedEthToBuy, 'child pool should receive all ETH filled by multiple winning auction bids')

			const winningAEthBeforeClaim = await getETHBalance(client, winningBidderA.account.address)
			const winningBEthBeforeClaim = await getETHBalance(client, winningBidderB.account.address)
			const losingEthBeforeClaim = await getETHBalance(client, losingBidder.account.address)
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, winningBidderA.account.address, [{ tick: winningTickA, bidIndex: 0n }])
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, winningBidderB.account.address, [{ tick: winningTickB, bidIndex: winningBidIndexB }])

			strictEqualTypeSafe((await getETHBalance(client, losingBidder.account.address)) - losingEthBeforeClaim, losingEth, 'losing auction participant should receive their ETH back')
			strictEqualTypeSafe(await getETHBalance(client, winningBidderA.account.address), winningAEthBeforeClaim, 'first filled auction participant should not receive an ETH refund')
			strictEqualTypeSafe(await getETHBalance(client, winningBidderB.account.address), winningBEthBeforeClaim, 'second filled auction participant should not receive an ETH refund')

			const winningVaultAAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidderA.account.address)
			const winningVaultBAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidderB.account.address)
			const winningARepClaim = await poolOwnershipToRep(client, yesSecurityPool.securityPool, winningVaultAAfterClaim.repDepositShare)
			const winningBRepClaim = await poolOwnershipToRep(client, yesSecurityPool.securityPool, winningVaultBAfterClaim.repDepositShare)
			const minimumWinningARepAtLimit = (winningEthA * PRICE_PRECISION) / tickToPrice(winningTickA)
			const minimumWinningBRepAtLimit = (winningEthB * PRICE_PRECISION) / tickToPrice(winningTickB)
			assert.ok(winningARepClaim >= minimumWinningARepAtLimit, 'first filled auction participant should receive vault REP at least as good as their limit order')
			assert.ok(winningBRepClaim >= minimumWinningBRepAtLimit, 'second filled auction participant should receive vault REP at least as good as their limit order')

			await finalizeChildQuestionAsYes(yesSecurityPool)
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'child question should eventually finalize before multi-winner auction REP redemption')

			const winningARepBeforeRedeem = await getERC20Balance(client, childRepToken, winningBidderA.account.address)
			const winningBRepBeforeRedeem = await getERC20Balance(client, childRepToken, winningBidderB.account.address)
			const childRepBeforeRedeem = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
			const winningARedeemClaim = await poolOwnershipToRep(client, yesSecurityPool.securityPool, winningVaultAAfterClaim.repDepositShare)
			const winningBRedeemClaim = await poolOwnershipToRep(client, yesSecurityPool.securityPool, winningVaultBAfterClaim.repDepositShare)

			await redeemRep(winningBidderA, yesSecurityPool.securityPool, winningBidderA.account.address)
			await redeemRep(winningBidderB, yesSecurityPool.securityPool, winningBidderB.account.address)

			const winningVaultAAfterRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidderA.account.address)
			const winningVaultBAfterRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidderB.account.address)
			const totalRedeemedRep = winningARedeemClaim + winningBRedeemClaim
			strictEqualTypeSafe((await getERC20Balance(client, childRepToken, winningBidderA.account.address)) - winningARepBeforeRedeem, winningARedeemClaim, 'first filled auction participant should redeem their purchased vault REP')
			strictEqualTypeSafe((await getERC20Balance(client, childRepToken, winningBidderB.account.address)) - winningBRepBeforeRedeem, winningBRedeemClaim, 'second filled auction participant should redeem their purchased vault REP')
			strictEqualTypeSafe(childRepBeforeRedeem - (await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)), totalRedeemedRep, 'multi-winner redemptions should debit only the REP paid to auction participants')
			strictEqualTypeSafe(winningVaultAAfterRedeem.repDepositShare, 0n, 'redeeming purchased auction REP should empty the first participants vault ownership')
			strictEqualTypeSafe(winningVaultBAfterRedeem.repDepositShare, 0n, 'redeeming purchased auction REP should empty the second participants vault ownership')
		})

		test('claimAuctionProceeds handles a zero-REP finalized refund path when totalRepPurchased is zero', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'zero rep refund fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
			const expectedEthToBuy = await getEthRaiseCap(client, yesSecurityPool.truthAuction)
			const losingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const winningBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			const losingEth = expectedEthToBuy / 10n
			strictEqualTypeSafe(losingEth > 0n, true, 'zero-REP refund test should invest a positive amount')
			const losingTick = await participateAuction(losingBidder, yesSecurityPool.truthAuction, repAtFork, losingEth)
			await participateAuction(winningBidder, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			await mockWindow.addStateOverrides({
				[yesSecurityPool.truthAuction]: {
					stateDiff: {
						[`0x${11n.toString(16)}`]: 0n,
					},
				},
			})

			strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), 0n, 'setup should finalize with zero purchased REP')

			const vaultCountBeforeClaim = await getVaultCount(client, yesSecurityPool.securityPool)
			const losingBidderBalanceBeforeClaim = await getETHBalance(client, losingBidder.account.address)
			const losingVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])

			const losingBidderBalanceAfterClaim = await getETHBalance(client, losingBidder.account.address)
			const losingVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)
			const vaultCountAfterClaim = await getVaultCount(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(losingBidderBalanceAfterClaim - losingBidderBalanceBeforeClaim, losingEth, 'zero-REP finalized claim should release the full ETH refund')
			strictEqualTypeSafe(losingVaultAfterClaim.repDepositShare, losingVaultBeforeClaim.repDepositShare, 'zero-REP finalized claim should not mint pool ownership')
			strictEqualTypeSafe(losingVaultAfterClaim.securityBondAllowance, losingVaultBeforeClaim.securityBondAllowance, 'zero-REP finalized claim should not assign security bond allowance')
			strictEqualTypeSafe(losingVaultAfterClaim.feeIndex, losingVaultBeforeClaim.feeIndex, 'zero-REP finalized claim should not alter fee accounting')
			strictEqualTypeSafe(vaultCountAfterClaim, vaultCountBeforeClaim, 'zero-REP finalized claim should not create a new vault')
		})

		test('minimum-bid underfunded winner receives the full auction REP without an uncompensated repair contribution', async () => {
			const unmigratedAllowanceHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await approveAndDepositRep(unmigratedAllowanceHolder, repDeposit, questionId)
			await manipulatePriceOracleAndPerformOperation(unmigratedAllowanceHolder, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, unmigratedAllowanceHolder.account.address, repDeposit / 8n)
			const { yesSecurityPool, expectedEthToBuy } = await setupStartedTruthAuction('minimum bid extraction fork source')
			const auctionCap = await getMaxRepBeingSold(client, yesSecurityPool.truthAuction)
			const minBidSize = await getMinBidSize(client, yesSecurityPool.truthAuction)
			const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const attackerTick = await participateAuction(attacker, yesSecurityPool.truthAuction, 1n, minBidSize)
			assert.ok(minBidSize < expectedEthToBuy / 1_000n, 'test setup should keep the minimum bid economically tiny relative to the target raise')
			const finalizerVaultBefore = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const parentAllowance = await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			const expectedAttackerRep = auctionCap
			strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), expectedAttackerRep, 'one qualifying minimum bid should buy the complete auction REP cap at the weak-demand clearing price')
			const forkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
			const unmigratedAllowance = parentAllowance - finalizerVaultBefore.securityBondAllowance
			const expectedAuctionedAllowance = unmigratedAllowance
			strictEqualTypeSafe(forkData.auctionedSecurityBondAllowance, expectedAuctionedAllowance, 'selling the complete auction REP cap should assign the complete unmigrated allowance to auction winners')
			const finalizerVaultAfter = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			strictEqualTypeSafe(finalizerVaultAfter.repDepositShare, finalizerVaultBefore.repDepositShare, 'finalizing an underfunded auction must not issue pool ownership to the finalizer')
			strictEqualTypeSafe(finalizerVaultAfter.securityBondAllowance, finalizerVaultBefore.securityBondAllowance, 'finalizing an underfunded auction must not assign security bond allowance to the finalizer')

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, attacker.account.address, [{ tick: attackerTick, bidIndex: 0n }])

			const attackerVault = await getSecurityVault(client, yesSecurityPool.securityPool, attacker.account.address)
			const attackerRepClaim = await poolOwnershipToRep(client, yesSecurityPool.securityPool, attackerVault.repDepositShare)
			strictEqualTypeSafe(attackerRepClaim, expectedAttackerRep, 'settling the only qualifying bid should credit the complete auction REP cap')
			strictEqualTypeSafe(attackerVault.securityBondAllowance, expectedAuctionedAllowance, 'settling the only qualifying bid should credit the complete auction allowance')
		})

		test('settleAuctionBids can refund a losing bid before truth auction finalization', async () => {
			const { yesSecurityPool, losingBidder, losingEth, losingTick } = await setupTruthAuctionWithMixedBids(false)
			const thirdParty = createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
			const thirdPartyBalanceBeforeSettlement = await getETHBalance(client, thirdParty.account.address)
			const losingBidderBalanceBeforeSettlement = await getETHBalance(client, losingBidder.account.address)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'setup should leave the child pool in an active truth auction')
			await settleAuctionBids(thirdParty, yesSecurityPool.securityPool, losingBidder.account.address, [], [{ tick: losingTick, bidIndex: 0n }])

			const thirdPartyBalanceAfterSettlement = await getETHBalance(client, thirdParty.account.address)
			const losingBidderBalanceAfterSettlement = await getETHBalance(client, losingBidder.account.address)

			strictEqualTypeSafe(losingBidderBalanceAfterSettlement - losingBidderBalanceBeforeSettlement, losingEth, 'pre-finalization settlement should refund losing-bid ETH to the bidder')
			strictEqualTypeSafe(thirdPartyBalanceAfterSettlement, thirdPartyBalanceBeforeSettlement, 'pre-finalization settlement should not redirect refunded ETH to the caller')
		})

		test('settleAuctionBids can settle mixed finalized winning and losing bids for the same bidder in one call', async () => {
			const { yesSecurityPool, expectedEthToBuy, repAtFork } = await setupStartedTruthAuction('mixed claim and refund settlement source')
			const mixedBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const competingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			const losingEth = expectedEthToBuy / 10n
			const competingWinningEth = expectedEthToBuy / 100n
			const winningEth = expectedEthToBuy - competingWinningEth
			strictEqualTypeSafe(losingEth > 0n, true, 'mixed settlement losing bid should invest a positive amount')
			strictEqualTypeSafe(winningEth > 0n, true, 'mixed settlement winning bid should invest a positive amount')
			strictEqualTypeSafe(competingWinningEth > 0n, true, 'mixed settlement competing bid should invest a positive amount')

			const losingTick = await participateAuction(mixedBidder, yesSecurityPool.truthAuction, repAtFork, losingEth)
			const winningTick = await participateAuction(mixedBidder, yesSecurityPool.truthAuction, repAtFork / 4n, winningEth)
			await participateAuction(competingBidder, yesSecurityPool.truthAuction, repAtFork / 400n, competingWinningEth)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			const mixedBidderBalanceBeforeSettlement = await getETHBalance(client, mixedBidder.account.address)
			const mixedVaultBeforeSettlement = await getSecurityVault(client, yesSecurityPool.securityPool, mixedBidder.account.address)
			const expectedWinningRep = (winningEth * PRICE_PRECISION) / tickToPrice(winningTick)

			await settleAuctionBids(client, yesSecurityPool.securityPool, mixedBidder.account.address, [{ tick: winningTick, bidIndex: 0n }], [{ tick: losingTick, bidIndex: 0n }])

			const mixedBidderBalanceAfterSettlement = await getETHBalance(client, mixedBidder.account.address)
			const mixedVaultAfterSettlement = await getSecurityVault(client, yesSecurityPool.securityPool, mixedBidder.account.address)
			const settledWinningRep = await poolOwnershipToRep(client, yesSecurityPool.securityPool, mixedVaultAfterSettlement.repDepositShare)

			strictEqualTypeSafe(mixedBidderBalanceAfterSettlement - mixedBidderBalanceBeforeSettlement, losingEth, 'mixed finalized settlement should return the losing-bid ETH in the same call')
			approximatelyEqual(settledWinningRep, expectedWinningRep, 1_000n, 'mixed finalized settlement should still mint the expected winning REP')
			assert.ok(mixedVaultAfterSettlement.repDepositShare > mixedVaultBeforeSettlement.repDepositShare, 'mixed finalized settlement should increase pool ownership for the winning bid')
		})

		test('claimAuctionProceeds preserves winner accounting when a finalized losing refund is settled first', async () => {
			const { yesSecurityPool, expectedEthToBuy, losingBidder, losingTick, winningBidder, winningTick } = await setupFinalizedTruthAuctionWithMixedBids()
			const forkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, winningBidder.account.address, [{ tick: winningTick, bidIndex: 0n }])

			const winningVault = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidder.account.address)
			const winningRep = await poolOwnershipToRep(client, yesSecurityPool.securityPool, winningVault.repDepositShare)
			const expectedWinningRep = (expectedEthToBuy * PRICE_PRECISION) / tickToPrice(winningTick)

			approximatelyEqual(winningRep, expectedWinningRep, 1_000n, 'winning claims should still receive the expected REP after a losing refund settles first')
			strictEqualTypeSafe(winningVault.securityBondAllowance, forkData.auctionedSecurityBondAllowance, 'refund-only claims must not consume any auctioned allowance before the winner claims')
		})

		test('claimAuctionProceeds allows a third party to settle a finalized losing refund for the bidder', async () => {
			const { yesSecurityPool, losingBidder, losingEth, losingTick } = await setupFinalizedTruthAuctionWithMixedBids()
			const thirdParty = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
			const thirdPartyBalanceBeforeClaim = await getETHBalance(client, thirdParty.account.address)
			const losingBidderBalanceBeforeClaim = await getETHBalance(client, losingBidder.account.address)

			await claimAuctionProceeds(thirdParty, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])

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
							abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
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
			const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			const settlementCaller = createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRep(liquidatorClient, repDeposit * 50n, questionId)
			await approveAndDepositRep(passiveRepHolder, repDeposit * 50n, questionId)

			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			await mockWindow.advanceTime(10n * 60n)
			await manipulatePriceOracleAndPerformOperation(passiveRepHolder, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, passiveRepHolder.account.address, securityPoolAllowance / 2n)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, 'liquidated unclaimed auction proceeds fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(liquidatorClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
			const expectedEthToBuy = await getEthRaiseCap(client, yesSecurityPool.truthAuction)
			const winningTick = await participateAuction(client, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)
			const childRepToken = await getRepToken(client, yesSecurityPool.securityPool)
			const liquidatorChildRepBalanceSlot = formatStorageSlot(getMappingStorageSlot(liquidatorClient.account.address, 0n))
			const liquidateClaimableChildVault = async (amount: bigint) => {
				await mockWindow.addStateOverrides({
					[childRepToken]: {
						stateDiff: {
							[liquidatorChildRepBalanceSlot]: repDeposit * 1_000_000n,
						},
					},
				})
				await approveToken(liquidatorClient, childRepToken, getInfraContractAddresses().openOracle)
				await queueLiquidationAtForcedPrice(liquidatorClient, yesSecurityPool.priceOracleManagerAndOperatorQueuer, client.account.address, amount, forcedPrice)
				await handleOracleReporting(liquidatorClient, mockWindow, yesSecurityPool.priceOracleManagerAndOperatorQueuer, forcedPrice)
			}

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			await mockWindow.advanceTime(10n * 60n)

			const targetVaultBeforeLiquidation = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const liquidatorVaultBeforeLiquidation = await getSecurityVault(client, yesSecurityPool.securityPool, liquidatorClient.account.address)
			const targetRepBeforeLiquidation = await poolOwnershipToRep(client, yesSecurityPool.securityPool, targetVaultBeforeLiquidation.repDepositShare)
			const liquidationThresholdPrice = (targetRepBeforeLiquidation * PRICE_PRECISION) / (targetVaultBeforeLiquidation.securityBondAllowance * securityMultiplier)
			const forcedPrice = (liquidationThresholdPrice + 1n) * 2n
			const liquidationChunk = targetVaultBeforeLiquidation.securityBondAllowance / 10n

			strictEqualTypeSafe(targetVaultBeforeLiquidation.securityBondAllowance > 0n, true, 'migrated bidder vault should carry liquidatable allowance before the auction claim')
			assert.ok(targetRepBeforeLiquidation > 0n, 'migrated bidder vault should carry REP before liquidation')
			strictEqualTypeSafe(liquidationChunk > 0n, true, 'test setup needs a positive liquidation chunk')

			const liquidationAttemptStartBlock = await client.getBlockNumber()
			await liquidateClaimableChildVault(liquidationChunk)
			const settledLiquidationPrice = await getLastPrice(client, yesSecurityPool.priceOracleManagerAndOperatorQueuer)

			const targetVaultAfterLiquidation = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const liquidatorVaultAfterLiquidation = await getSecurityVault(client, yesSecurityPool.securityPool, liquidatorClient.account.address)
			const targetRepAfterLiquidation = await poolOwnershipToRep(client, yesSecurityPool.securityPool, targetVaultAfterLiquidation.repDepositShare)

			if (targetVaultAfterLiquidation.securityBondAllowance >= targetVaultBeforeLiquidation.securityBondAllowance) {
				const coordinatorLogs = await client.getLogs({
					address: yesSecurityPool.priceOracleManagerAndOperatorQueuer,
					fromBlock: liquidationAttemptStartBlock,
				})
				const executionReasons = coordinatorLogs
					.map(log => {
						try {
							return decodeEventLog({
								abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
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
				throw new Error(`pre-claim liquidation did not reduce allowance; coordinator results=${executionReasons.join('|')}`)
			}

			const actualDebtMoved = targetVaultBeforeLiquidation.securityBondAllowance - targetVaultAfterLiquidation.securityBondAllowance

			const expectedRepMove = getExpectedLiquidationRepMove(actualDebtMoved, settledLiquidationPrice)
			strictEqualTypeSafe(actualDebtMoved > 0n, true, 'partial liquidation before claim should reduce the migrated vault allowance')
			approximatelyEqual(targetRepAfterLiquidation, targetRepBeforeLiquidation - expectedRepMove, 2n, 'liquidation should seize migrated vault REP before claim')
			approximatelyEqual(
				await poolOwnershipToRep(client, yesSecurityPool.securityPool, liquidatorVaultAfterLiquidation.repDepositShare),
				(await poolOwnershipToRep(client, yesSecurityPool.securityPool, liquidatorVaultBeforeLiquidation.repDepositShare)) + expectedRepMove,
				2n,
				'liquidation should transfer the seized migrated REP into the liquidator vault',
			)
			strictEqualTypeSafe(liquidatorVaultAfterLiquidation.securityBondAllowance, liquidatorVaultBeforeLiquidation.securityBondAllowance + actualDebtMoved, 'the liquidator should absorb the executed allowance reduction')

			const childCollateralAfterLiquidation = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
			const childAllowanceAfterLiquidation = await getTotalSecurityBondAllowance(client, yesSecurityPool.securityPool)
			const totalRepPurchased = await getTotalRepPurchased(client, yesSecurityPool.truthAuction)
			const forkDataBeforeClaim = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(forkDataBeforeClaim.auctionedSecurityBondAllowance > 0n, true, 'test setup should leave auctioned allowance to assign on claim')
			strictEqualTypeSafe(totalRepPurchased > 0n, true, 'test setup should leave finalized auction REP for the bidder to claim')

			await claimAuctionProceeds(settlementCaller, yesSecurityPool.securityPool, client.account.address, [{ tick: winningTick, bidIndex: 0n }])

			const targetVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const liquidatorVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, liquidatorClient.account.address)
			const targetRepAfterClaim = await poolOwnershipToRep(client, yesSecurityPool.securityPool, targetVaultAfterClaim.repDepositShare)

			strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), childCollateralAfterLiquidation, 'claim timing should not change child collateral totals after liquidation')
			strictEqualTypeSafe(await getTotalSecurityBondAllowance(client, yesSecurityPool.securityPool), childAllowanceAfterLiquidation, 'claim timing should not change child allowance totals after liquidation')
			strictEqualTypeSafe(targetRepAfterClaim - targetRepAfterLiquidation, totalRepPurchased, 'the original bidder should still receive the full finalized auction REP after their migrated vault was liquidated')
			strictEqualTypeSafe(targetVaultAfterClaim.securityBondAllowance - targetVaultAfterLiquidation.securityBondAllowance, forkDataBeforeClaim.auctionedSecurityBondAllowance, 'the original bidder should still receive the full auctioned allowance after liquidation')
			strictEqualTypeSafe(liquidatorVaultAfterClaim.repDepositShare, liquidatorVaultAfterLiquidation.repDepositShare, 'unclaimed finalized auction proceeds should not be swept into the liquidator vault')
			strictEqualTypeSafe(liquidatorVaultAfterClaim.securityBondAllowance, liquidatorVaultAfterLiquidation.securityBondAllowance, 'unclaimed finalized auction allowance should not be swept into the liquidator vault')

			await mockWindow.advanceTime(DAY)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			await updateVaultFees(client, yesSecurityPool.securityPool, liquidatorClient.account.address)
			approximatelyEqual(await getTotalAccruedFees(client, yesSecurityPool.securityPool), await getTotalFeesOwedToVaults(client, yesSecurityPool.securityPool), 1n, 'a delayed claim after liquidation should keep fee eligibility equal to assigned vault allowances')
		})

		test('settleAuctionBids does not emit ClaimAuctionProceeds for finalized refund-only settlements', async () => {
			const { yesSecurityPool, losingBidder, losingEth, losingTick } = await setupFinalizedTruthAuctionWithMixedBids()
			const losingBidderBalanceBeforeSettlement = await getETHBalance(client, losingBidder.account.address)
			const settlementHash = await settleAuctionBids(client, yesSecurityPool.securityPool, losingBidder.account.address, [], [{ tick: losingTick, bidIndex: 0n }])
			const receipt = await client.waitForTransactionReceipt({ hash: settlementHash })
			const settlementLogs = receipt.logs
				.map(log => {
					try {
						return decodeEventLog({
							abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
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
			await assert.rejects(async () => await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }]), /already been claimed/)
		})

		test('claimAuctionProceeds should add auctioned allowance on top of an existing migrated allowance', async () => {
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRep(attackerClient, repDeposit, questionId)
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
			await mockWindow.advanceTime(10n * 60n)
			await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, attackerClient.account.address, securityPoolAllowance)

			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'allowance-on-top fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
			const migratedVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
			const parentAllowanceAtFork = await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool)
			const expectedEthToBuy = await getEthRaiseCap(client, yesSecurityPool.truthAuction)
			const auctionTick = await participateAuction(client, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			const forkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
			const totalRepPurchased = await getTotalRepPurchased(client, yesSecurityPool.truthAuction)
			const expectedAuctionedAllowance = parentAllowanceAtFork - migratedVaultBeforeClaim.securityBondAllowance
			strictEqualTypeSafe(forkData.auctionedSecurityBondAllowance, expectedAuctionedAllowance, 'truth-auction allowance should exclude bond allowance that already migrated with the child vault')
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, client.account.address, [{ tick: auctionTick, bidIndex: 0n }])

			const migratedVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const expectedAllowanceAfterClaim = migratedVaultBeforeClaim.securityBondAllowance + (forkData.auctionedSecurityBondAllowance * totalRepPurchased) / totalRepPurchased

			strictEqualTypeSafe(forkData.auctionedSecurityBondAllowance > 0n, true, 'test setup should leave some allowance to be assigned by the truth auction')
			strictEqualTypeSafe(migratedVaultAfterClaim.securityBondAllowance, expectedAllowanceAfterClaim, 'claimAuctionProceeds should preserve migrated allowance and add the auction-acquired allowance on top')
		})

		test('delayed auction claims add eligibility to the live total after migrated allowance decreases', async () => {
			const { auctionParticipant, auctionTick, auctionedAllowance, yesSecurityPool } = await setupFinalizedAuctionWithUnclaimedAllowance('delayed claim after allowance decrease fork source')

			await manipulatePriceOracleAndPerformOperation(client, mockWindow, yesSecurityPool.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, 0n)
			strictEqualTypeSafe(await getTotalSecurityBondAllowance(client, yesSecurityPool.securityPool), auctionedAllowance, 'decreasing the migrated allowance should leave only unclaimed auction allowance in the pool total')

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])

			const participantVault = await getSecurityVault(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
			strictEqualTypeSafe(participantVault.securityBondAllowance, auctionedAllowance, 'the delayed claim should assign only its auction allowance')
			strictEqualTypeSafe(await getTotalSecurityBondAllowance(client, yesSecurityPool.securityPool), auctionedAllowance, 'claiming should not resurrect the historical migrated allowance')
		})

		test('delayed auction claims preserve live eligibility after migrated allowance increases', async () => {
			const { auctionParticipant, auctionTick, migratedAllowance, yesSecurityPool } = await setupFinalizedAuctionWithUnclaimedAllowance('delayed claim after allowance increase fork source')
			const increasedMigratedAllowance = migratedAllowance * 2n

			await manipulatePriceOracleAndPerformOperation(client, mockWindow, yesSecurityPool.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, increasedMigratedAllowance)
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])

			await mockWindow.advanceTime(DAY)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			await updateVaultFees(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
			approximatelyEqual(await getTotalAccruedFees(client, yesSecurityPool.securityPool), await getTotalFeesOwedToVaults(client, yesSecurityPool.securityPool), 1n, 'delayed claims should accrue fees against every currently assigned allowance')
		})

		test('claimAuctionProceeds initializes fee accounting for a newly auction-funded vault at the current pool fee index', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'fee-index fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
			const expectedEthToBuy = await getEthRaiseCap(client, yesSecurityPool.truthAuction)
			const auctionTick = await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			await mockWindow.advanceTime(DAY)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			const migratedVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])

			const participantVault = await getSecurityVault(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
			strictEqualTypeSafe(participantVault.feeIndex, migratedVaultBeforeClaim.feeIndex, 'newly auction-funded vaults should inherit the current child-pool fee index')
		})

		test('claimAuctionProceeds allows a vault to claim winning bids across multiple calls', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const securityPoolAllowance = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'multi-claim fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
			const expectedEthToBuy = await getEthRaiseCap(client, yesSecurityPool.truthAuction)
			const firstBidEth = expectedEthToBuy / 2n
			const secondBidEth = expectedEthToBuy - firstBidEth
			const firstAuctionTick = await participateAuction(client, yesSecurityPool.truthAuction, repAtFork / 8n, firstBidEth)
			const secondAuctionTick = await participateAuction(client, yesSecurityPool.truthAuction, repAtFork / 8n, secondBidEth)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, client.account.address, [{ tick: firstAuctionTick, bidIndex: 0n }])
			const vaultAfterFirstClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const repAfterFirstClaim = await poolOwnershipToRep(client, yesSecurityPool.securityPool, vaultAfterFirstClaim.repDepositShare)

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, client.account.address, [{ tick: secondAuctionTick, bidIndex: 1n }])
			const vaultAfterSecondClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const repAfterSecondClaim = await poolOwnershipToRep(client, yesSecurityPool.securityPool, vaultAfterSecondClaim.repDepositShare)

			assert.ok(repAfterFirstClaim > 0n, 'first claim should credit some REP-backed ownership')
			assert.ok(repAfterSecondClaim > repAfterFirstClaim, 'second claim should be able to add the remaining winning bid')
		})

		test('claimAuctionProceeds assigns auctioned allowance by fixed bid position independent of claim order', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const baseSecurityPoolAllowance = repDeposit / 4n
			const securityPoolAllowance = baseSecurityPoolAllowance - (baseSecurityPoolAllowance % 3n) + 1n

			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
			await manipulatePriceOracleAndPerformOperation(passiveRepHolder, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, passiveRepHolder.account.address, securityPoolAllowance)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const firstBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			const secondBidder = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'split-allowance fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
			const expectedEthToBuy = await getEthRaiseCap(client, yesSecurityPool.truthAuction)
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
			const firstOrderAllowanceTotal = firstVaultFirstOrder.securityBondAllowance + secondVaultFirstOrder.securityBondAllowance

			await mockWindow.anvilRevert(claimsSnapshot)
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, secondBidder.account.address, [{ tick: secondAuctionTick, bidIndex: secondBidIndex }])
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, firstBidder.account.address, [{ tick: firstAuctionTick, bidIndex: 0n }])

			const firstVaultReverseOrder = await getSecurityVault(client, yesSecurityPool.securityPool, firstBidder.account.address)
			const secondVaultReverseOrder = await getSecurityVault(client, yesSecurityPool.securityPool, secondBidder.account.address)
			const reverseOrderAllowanceTotal = firstVaultReverseOrder.securityBondAllowance + secondVaultReverseOrder.securityBondAllowance

			strictEqualTypeSafe(firstOrderAllowanceTotal, forkDataBeforeClaims.auctionedSecurityBondAllowance, 'split auction claims should assign the full auctioned allowance without losing rounding residue')
			strictEqualTypeSafe(reverseOrderAllowanceTotal, forkDataBeforeClaims.auctionedSecurityBondAllowance, 'reverse-order auction claims should assign the full auctioned allowance without losing rounding residue')
			strictEqualTypeSafe(firstVaultReverseOrder.securityBondAllowance, firstVaultFirstOrder.securityBondAllowance, 'the first bidder allowance should not depend on chronological claim order')
			strictEqualTypeSafe(secondVaultReverseOrder.securityBondAllowance, secondVaultFirstOrder.securityBondAllowance, 'the second bidder allowance should not depend on chronological claim order')
		})

		test('allowance-only auction proceeds credit vault state independently of claim order', async () => {
			const poolDeploymentHash = await client.sendTransaction({
				data: `0x${test_peripherals_SecurityPoolForkerAuctionSettlementHarness_AuctionSettlementPoolHarness.evm.bytecode.object}`,
			})
			const poolReceipt = await client.waitForTransactionReceipt({ hash: poolDeploymentHash })
			const poolAddress = poolReceipt.contractAddress
			if (poolAddress === undefined || poolAddress === null) throw new Error('auction settlement pool harness deployment address missing')

			const forkerDeploymentHash = await client.sendTransaction({
				data: encodeDeployData({
					abi: test_peripherals_SecurityPoolForkerAuctionSettlementHarness_SecurityPoolForkerAuctionSettlementHarness.abi,
					bytecode: applyLibraries(test_peripherals_SecurityPoolForkerAuctionSettlementHarness_SecurityPoolForkerAuctionSettlementHarness.evm.bytecode.object),
					args: [getZoltarAddress()],
				}),
			})
			const forkerReceipt = await client.waitForTransactionReceipt({ hash: forkerDeploymentHash })
			const forkerAddress = forkerReceipt.contractAddress
			if (forkerAddress === undefined || forkerAddress === null) throw new Error('auction settlement forker harness deployment address missing')

			const zeroRepVault = addressString(TEST_ADDRESSES[1])
			const positiveRepVault = addressString(TEST_ADDRESSES[2])
			const credit = async (vault: typeof zeroRepVault, repAmount: bigint, allowanceAmount: bigint) => {
				const hash = await client.writeContract({
					address: forkerAddress,
					abi: test_peripherals_SecurityPoolForkerAuctionSettlementHarness_SecurityPoolForkerAuctionSettlementHarness.abi,
					functionName: 'creditAuctionProceeds',
					args: [poolAddress, vault, repAmount, allowanceAmount, 10n, 1n, 3n],
				})
				await client.waitForTransactionReceipt({ hash })
			}
			const readVault = async (vault: typeof zeroRepVault) =>
				await client.readContract({
					address: poolAddress,
					abi: test_peripherals_SecurityPoolForkerAuctionSettlementHarness_AuctionSettlementPoolHarness.abi,
					functionName: 'securityVaults',
					args: [vault],
				})

			const settlementSnapshot = await mockWindow.anvilSnapshot()
			await credit(zeroRepVault, 0n, 1n)
			await credit(positiveRepVault, 1n, 2n)
			const zeroRepForward = await readVault(zeroRepVault)
			const positiveRepForward = await readVault(positiveRepVault)
			strictEqualTypeSafe(zeroRepForward[0], 0n, 'allowance-only settlement must not create pool ownership')
			strictEqualTypeSafe(zeroRepForward[1], 1n, 'a separately settled zero-REP winner must retain its positional allowance')
			strictEqualTypeSafe(positiveRepForward[0], 10n, 'positive REP settlement should create ownership at the configured rate')
			strictEqualTypeSafe(positiveRepForward[1], 2n, 'positive REP settlement should receive its remaining positional allowance')

			await mockWindow.anvilRevert(settlementSnapshot)
			await credit(positiveRepVault, 1n, 2n)
			await credit(zeroRepVault, 0n, 1n)
			const zeroRepReverse = await readVault(zeroRepVault)
			const positiveRepReverse = await readVault(positiveRepVault)
			strictEqualTypeSafe(zeroRepReverse[1], zeroRepForward[1], 'allowance-only vault credit must not depend on claim order')
			strictEqualTypeSafe(positiveRepReverse[1], positiveRepForward[1], 'positive-REP vault allowance must not depend on claim order')

			const totalEligibleAllowance = await client.readContract({
				address: poolAddress,
				abi: test_peripherals_SecurityPoolForkerAuctionSettlementHarness_AuctionSettlementPoolHarness.abi,
				functionName: 'feeEligibleSecurityBondAllowance',
				args: [],
			})
			strictEqualTypeSafe(totalEligibleAllowance, 3n, 'separate claims should credit the complete auctioned allowance')
		})
	})
})
