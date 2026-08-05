import { beforeEach, describe, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, type Address, type Hex } from '@zoltar/shared/ethereum'
import { getLiquidationVaultRepBackingToTransfer } from '@zoltar/shared/liquidation'
import {
	peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	peripherals_EscalationGame_EscalationGame,
	peripherals_SecurityPool_SecurityPool,
	peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
	test_peripherals_SecurityPoolForkerAuctionSettlementHarness_AuctionSettlementPoolHarness,
	test_peripherals_SecurityPoolForkerAuctionSettlementHarness_SecurityPoolForkerAuctionSettlementHarness,
	test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver as rejectingEthReceiverArtifact,
} from '../../types/contractArtifact'
import { usePeripheralsTruthAuctionFixture, type PeripheralsTruthAuctionFixture } from './fixture'
import { getMaxRepBeingSoldAttoRep, getMinBidSizeAttoEth, isFinalized, submitBid } from '../../testSupport/simulator/utils/contracts/auction'
import { getLastPrice, queueLiquidationAtForcedPrice } from '../../testSupport/simulator/utils/contracts/peripherals'
import { applyLibraries } from '../../testSupport/simulator/utils/contracts/deployPeripherals'
import { getForkActivationTime } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { priceToClosestTick } from '../../testSupport/simulator/utils/tickMath'

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
		approveAndDepositRepToVault,
		handleOracleReporting,
		manipulatePriceOracle,
		manipulatePriceOracleAndPerformOperation,
		triggerOwnGameFork,
		deployOriginSecurityPool,
		getInfraContractAddresses,
		getSecurityPoolAddresses,
		createQuestion,
		getQuestionId,
		getEthRaiseCapAttoEth,
		getQuestionEndDate,
		OperationType,
		participateAuction,
		tickToPrice,
		QuestionOutcome,
		SystemState,
		claimAuctionProceeds,
		createChildUniverse,
		finalizeTruthAuction,
		getMigratedAttoRep,
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
		getMigrationRepBalanceAttoRep,
		getRepTokenAddress,
		getTotalTheoreticalSupplyAttoRep,
		getZoltarAddress,
		getTotalRepPurchasedAttoRep,
		isIgnorableLogDecodeError,
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
		getTotalCoverageCommitmentAttoEth,
		getVaultCount,
		backingUnitsToAttoRep,
		redeemFees,
		redeemRepFromVault,
		updateVaultFees,
		peripherals_SecurityPoolForker_SecurityPoolForker,
		getMigrationProxyAddressAbi,
		PRICE_PRECISION,
		reportBond,
		repDeposit,
		genesisUniverse,
		statoblastSecurityMultiplierBps,
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

	const setupLongDatedChildAuction = async (titlePrefix: string, forcedSurplusAboveCoverageCommitmentAttoEth?: bigint) => {
		const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
		const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
		await createCompleteSet(createWriteClient(mockWindow, TEST_ADDRESSES[1], 0), securityPoolAddresses.securityPool, 10n * 10n ** 18n)

		await triggerExternalForkForSecurityPool(undefined, titlePrefix)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
		const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
		const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const auctionTick = await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)
		if (forcedSurplusAboveCoverageCommitmentAttoEth !== undefined) {
			await mockWindow.setBalance(yesSecurityPool.securityPool, securityPoolCoverageCommitmentAttoEth + forcedSurplusAboveCoverageCommitmentAttoEth)
		}
		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		return { auctionParticipant, auctionTick, yesSecurityPool }
	}

	test('forker public entry points expose exact wrong-state and empty-action guards', async () => {
		const parentPool = securityPoolAddresses.securityPool
		const forkerAddress = getInfraContractAddresses().securityPoolForker
		const forkerAbi = peripherals_SecurityPoolForker_SecurityPoolForker.abi

		await assert.rejects(startTruthAuction(client, parentPool), /Not mig/)
		await assert.rejects(finalizeTruthAuction(client, parentPool, 1n), /Auction finalization does not accept repair contributions/)
		await mockWindow.advanceTime(8n * DAY)
		await assert.rejects(finalizeTruthAuction(client, parentPool), /Not auction/)
		await assert.rejects(
			client.writeContract({
				abi: forkerAbi,
				address: forkerAddress,
				functionName: 'forkZoltarWithOwnEscalationGame',
				args: [parentPool],
			}),
			/Need game/,
		)
		await assert.rejects(migrateRepToZoltar(client, parentPool, [QuestionOutcome.Yes]), /execution reverted/)
		await assert.rejects(initiateSecurityPoolFork(client, parentPool), /Unforked/)
		await assert.rejects(
			client.writeContract({
				abi: forkerAbi,
				address: forkerAddress,
				functionName: 'settleAuctionBids',
				args: [parentPool, client.account.address, [], []],
			}),
			/Need action/,
		)
		await assert.rejects(
			client.writeContract({
				abi: forkerAbi,
				address: forkerAddress,
				functionName: 'initializeChildForkedEscalationGameIfNeeded',
				args: [parentPool, parentPool, addressString(0n)],
			}),
			/execution reverted/,
		)
		await assert.rejects(
			client.writeContract({
				abi: forkerAbi,
				address: forkerAddress,
				functionName: 'claimForkedEscalationDeposits',
				args: [parentPool, addressString(TEST_ADDRESSES[1]), QuestionOutcome.Yes, []],
			}),
			/Vault/,
		)
	})

	test('auction claims reject unfinalized truth auctions through both public settlement selectors', async () => {
		const { yesSecurityPool } = await setupStartedTruthAuction('unfinalized public settlement guard source')
		await assert.rejects(claimAuctionProceeds(client, yesSecurityPool.securityPool, client.account.address, []), /Not final/)
		await assert.rejects(
			client.writeContract({
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				address: getInfraContractAddresses().securityPoolForker,
				functionName: 'settleAuctionBids',
				args: [yesSecurityPool.securityPool, client.account.address, [{ tick: 0n, bidIndex: 0n }], []],
			}),
			/Not final/,
		)
	})

	describe('auction startup and migration isolation', () => {
		test('external-fork escalation backing is auctionable before the child game resumes', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			await createCompleteSet(createWriteClient(mockWindow, TEST_ADDRESSES[1], 0), securityPoolAddresses.securityPool, 10n * 10n ** 18n)
			const losingReporter = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await approveAndDepositRepToVault(losingReporter, repDeposit, questionId)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, 2n * reportBond)
			await depositToEscalationGame(losingReporter, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond)

			await triggerExternalForkForSecurityPool(undefined, 'external escalation auction accounting source')
			const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const parentRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			assert.ok(parentRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep > 0n, 'the external fork should preserve unresolved escalation backing')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			const unresolvedMigrationHash = await client.writeContract({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'migrateVaultWithUnresolvedEscalation',
				args: [securityPoolAddresses.securityPool, client.account.address, BigInt(QuestionOutcome.Yes)],
			})
			await client.waitForTransactionReceipt({ hash: unresolvedMigrationHash })

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const childEscalationGame = await client.readContract({
				address: yesSecurityPool.securityPool,
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'escalationGame',
			})
			const childEscalationBalance = await getERC20Balance(client, getRepTokenAddress(yesUniverse), childEscalationGame)
			const recordedEscalationBacking = await client.readContract({
				address: childEscalationGame,
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'totalDisputeStakedAttoRep',
			})
			strictEqualTypeSafe(childEscalationBalance, parentRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep, 'the child game should physically hold the external-fork escalation bucket before resume')
			strictEqualTypeSafe(recordedEscalationBacking, childEscalationBalance, 'pre-resume escrow accounting must expose all physically backed dispute-staked REP to the truth auction')
			const outcomeBalancesBeforeAuction = await client.readContract({
				address: childEscalationGame,
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'getOutcomeBalancesAttoRep',
			})
			const vaultBeforeAuction = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'the OI shortfall should require a truth auction')
			const migratedAttoRep = await getMigratedAttoRep(client, yesSecurityPool.securityPool)
			const combinedAuctionableRep = parentForkData.auctionableAttoRepAtFork + childEscalationBalance
			const expectedAuctionCap = combinedAuctionableRep - migratedAttoRep / 1_000_000n
			strictEqualTypeSafe(await getMaxRepBeingSoldAttoRep(client, yesSecurityPool.truthAuction), expectedAuctionCap, 'the auction cap should include external-fork escalation backing before resume')
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, expectedAuctionCap / 2n, await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction))
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			assert.ok((await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction)) > 0n, 'the regression requires a nonzero repair purchase')
			const repBeforeHaircut = await client.readContract({
				address: childEscalationGame,
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'truthAuctionRepBeforeAttoRep',
			})
			const repRemainingAfterHaircut = await client.readContract({
				address: childEscalationGame,
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'truthAuctionRepRemainingAttoRep',
			})
			strictEqualTypeSafe(repBeforeHaircut, childEscalationBalance, 'the external-fork haircut denominator should include all child-game backing')
			assert.ok(repRemainingAfterHaircut < repBeforeHaircut, 'the external-fork truth auction should remove escalation backing')
			const outcomeBalancesAfterAuction = await client.readContract({
				address: childEscalationGame,
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'getOutcomeBalancesAttoRep',
			})
			for (let outcomeIndex = 0; outcomeIndex < outcomeBalancesAfterAuction.length; outcomeIndex += 1) {
				strictEqualTypeSafe(outcomeBalancesAfterAuction[outcomeIndex], (outcomeBalancesBeforeAuction[outcomeIndex] * repRemainingAfterHaircut) / repBeforeHaircut, 'external-fork outcome balances should rebase by the auction retention ratio')
			}
			const vaultAfterAuction = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			strictEqualTypeSafe(vaultAfterAuction.disputeStakedAttoRep, (vaultBeforeAuction.disputeStakedAttoRep * repRemainingAfterHaircut) / repBeforeHaircut, 'the carried escalation claim should retain the same auction fraction as its backing')
			const forkResumedAt = await client.readContract({
				address: childEscalationGame,
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'forkResumedAt',
			})
			const gameEndDate = await client.readContract({
				address: childEscalationGame,
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'getEscalationGameEndDate',
			})
			assert.ok(forkResumedAt > 0n, 'truth-auction finalization should resume the external-fork continuation')
			assert.ok(gameEndDate >= forkResumedAt + 3n * DAY, 'the resumed continuation should receive a fresh minimum response period')
		})

		test('truth-auction finalization starts long-dated child fee accrual at activation', async () => {
			const { yesSecurityPool } = await setupLongDatedChildAuction('long-dated child fee activation source')
			const collateralAtActivation = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)

			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)

			const oneBlockFeeTolerance = 100_000_000_000n
			approximatelyEqual(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), collateralAtActivation, oneBlockFeeTolerance, 'activating a child must not retroactively charge newly installed collateral for migration and auction time')
			assert.ok((await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)).claimableFeesAttoEth < oneBlockFeeTolerance, 'the first child fee update should charge at most the post-activation block interval')
		})

		test('coverage commitment', async () => {
			const { auctionParticipant, auctionTick, yesSecurityPool } = await setupLongDatedChildAuction('coverage commitment')
			await mockWindow.advanceTime(DAY)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)

			const migratedVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			strictEqualTypeSafe(await getTotalClaimableVaultFeesAttoEth(client, yesSecurityPool.securityPool), migratedVault.claimableFeesAttoEth, 'coverage commitment')

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])
			const auctionVaultAtClaim = await getSecurityVault(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
			strictEqualTypeSafe(auctionVaultAtClaim.claimableFeesAttoEth, 0n, 'coverage commitment')
			strictEqualTypeSafe(await getTotalClaimableVaultFeesAttoEth(client, yesSecurityPool.securityPool), migratedVault.claimableFeesAttoEth, 'coverage commitment')
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

		test('startTruthAuction waits for the parent migration window instead of the child universe fork time', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, 'parent migration window fork source')
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

			await assert.rejects(startTruthAuction(client, yesSecurityPool.securityPool), /Active/)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'child pool should keep accepting migration until the parent window closes')
		})

		test('startTruthAuction keeps migration open at the exact parent deadline and starts one second later', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, 'parent migration deadline boundary fork source')
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
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
			await approveAndDepositRepToVault(migratingVault, repDeposit, questionId)
			await triggerExternalForkForSecurityPool(undefined, 'same-block migration deadline source')
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
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
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, repDeposit / 4n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, 'auction inventory funding fork source')
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)

			await startTruthAuction(client, yesSecurityPool.securityPool)

			const childBalance = await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool)
			const auctionCap = await getMaxRepBeingSoldAttoRep(client, yesSecurityPool.truthAuction)
			strictEqualTypeSafe(childBalance, parentForkData.auctionableAttoRepAtFork, 'truth auction should fund the child with its complete accounting REP baseline')
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
			const losingBid = await getMinBidSizeAttoEth(client, yesSecurityPool.truthAuction)
			const losingTick = await participateAuction(losingBidder, yesSecurityPool.truthAuction, repAtFork, losingBid)
			await mockWindow.advanceTime(7n * DAY + DAY)

			await assert.rejects(finalizeTruthAuction(client, yesSecurityPool.securityPool, 1n), /Auction finalization does not accept repair contributions/)
			strictEqualTypeSafe(await isFinalized(client, yesSecurityPool.truthAuction), false, 'rejected contribution must leave the auction available for value-free finalization')

			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'an ended auction must activate the child without relying on an uncompensated contribution')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), migratedCollateral, 'only migrated collateral and accepted bid ETH may become child collateral')
			strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), 0n, 'non-qualifying demand must not purchase auction REP')

			const bidderBalanceBeforeRefund = await getETHBalance(client, losingBidder.account.address)
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
			strictEqualTypeSafe((await getETHBalance(client, losingBidder.account.address)) - bidderBalanceBeforeRefund, losingBid, 'the non-qualifying bidder must recover all bid ETH after the deadline')
		})

		test('bid and finalization competitors use exact block timestamps at deadline - 1, deadline, and deadline + 1', async () => {
			const { expectedEthToBuy, repAtFork, yesSecurityPool } = await setupStartedTruthAuction('same-block auction deadline source')
			const initialBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const competingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
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
								abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
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
			{ name: 'coverage commitment', surplusAboveCoverageCommitmentAttoEth: 0n },
			{ name: 'coverage commitment', surplusAboveCoverageCommitmentAttoEth: 1n },
			{ name: 'coverage commitment', surplusAboveCoverageCommitmentAttoEth: 10n ** 30n },
		]

		test.each(forcedBalanceCases)('forced ETH at $name after the deadline cannot contaminate or block finalization', async ({ name, surplusAboveCoverageCommitmentAttoEth }) => {
			const { yesSecurityPool } = await setupStartedTruthAuction(`forced ETH ${name} finalization source`)
			const legitimateCollateral = await getETHBalance(client, yesSecurityPool.securityPool)
			const parentCoverageCommitmentAttoEth = await getTotalCoverageCommitmentAttoEth(client, securityPoolAddresses.securityPool)
			const forcedBalance = parentCoverageCommitmentAttoEth + surplusAboveCoverageCommitmentAttoEth

			await mockWindow.advanceTime(7n * DAY + DAY)
			await mockWindow.setBalance(yesSecurityPool.securityPool, forcedBalance)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'surplus ETH must not keep the child in truth-auction state')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), legitimateCollateral, 'forced ETH must remain outside protocol-accounted collateral')
			strictEqualTypeSafe(await getETHBalance(client, yesSecurityPool.securityPool), forcedBalance, 'forced ETH should remain an unaccounted pool surplus')

			await redeemFees(client, yesSecurityPool.securityPool, addressString(TEST_ADDRESSES[6]))
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), legitimateCollateral, 'zero-fee redemption must not reclassify forced ETH as collateral')
		})

		test('forced ETH during bidding stays outside collateral while auction proceeds remain accounted', async () => {
			const { yesSecurityPool, expectedEthToBuy } = await setupTruthAuctionWithMixedBids(false)
			const legitimateCollateralBeforeAuction = await getETHBalance(client, yesSecurityPool.securityPool)
			const parentCoverageCommitmentAttoEth = await getTotalCoverageCommitmentAttoEth(client, securityPoolAddresses.securityPool)
			const forcedBalance = parentCoverageCommitmentAttoEth + 10n ** 30n

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

		test('coverage commitment', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			const parentCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, parentCoverageCommitmentAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, parentCoverageCommitmentAttoEth)

			await triggerExternalForkForSecurityPool(undefined, 'non-divisible fully utilized fork source')
			const parentSettlementCollateralAtForkAttoEth = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const parentVaultSlot = getMappingStorageSlot(client.account.address, 16n)
			await mockWindow.addStateOverrides({
				[securityPoolAddresses.securityPool]: {
					stateDiff: {
						[formatStorageSlot(1n)]: parentSettlementCollateralAtForkAttoEth,
						[formatStorageSlot(parentVaultSlot + 1n)]: parentSettlementCollateralAtForkAttoEth,
					},
				},
			})
			strictEqualTypeSafe(await getTotalCoverageCommitmentAttoEth(client, securityPoolAddresses.securityPool), parentSettlementCollateralAtForkAttoEth, 'the parent must be fully utilized at the fork snapshot')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const migratedAttoRep = await getMigratedAttoRep(client, yesSecurityPool.securityPool)
			assert.ok((parentSettlementCollateralAtForkAttoEth * migratedAttoRep) % parentForkData.auctionableAttoRepAtFork > 0n, 'the migration ratio must require collateral rounding')

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			const auctionEthRaiseCap = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await submitBid(auctionParticipant, yesSecurityPool.truthAuction, 524288n, auctionEthRaiseCap)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'rounding must not block finalization')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), parentSettlementCollateralAtForkAttoEth, 'coverage commitment')
		})

		test('startTruthAuction skips auction startup when all REP is already migrated', async () => {
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

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
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const denominatorBeforeStart = await getTotalRepBackingUnits(client, yesSecurityPool.securityPool)
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
			assert.strictEqual(forkSnapshotLog.args.auctionableAttoRepAtFork, forkData.auctionableAttoRepAtFork, 'fork snapshot should expose the updated auctionable REP')
			assert.strictEqual(forkSnapshotLog.args.ownFork, false, 'fork snapshot should identify external fork mode')
			strictEqualTypeSafe(await getMigratedAttoRep(client, yesSecurityPool.securityPool), forkData.auctionableAttoRepAtFork, 'all parent REP should already be represented by migrated vault backingUnits in this fast path')

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child pool should finalize immediately when no auction is needed')
			strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), 0n, 'no REP should be sold when the auction is skipped')
			strictEqualTypeSafe(await getTotalRepBackingUnits(client, yesSecurityPool.securityPool), denominatorBeforeStart, 'skipping the auction should preserve the existing child backingUnits denominator when no REP is sold')
		})

		test('own-fork truth auction uses only vault REP as the pool auction basis', async () => {
			const securityPoolCoverageCommitmentAttoEth = 1n * 10n ** 18n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			let vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			let vaultAttoRep = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, vault.repBackingUnits)
			const requiredVaultAttoRep = 4n * forkThresholdAttoRep
			if (vaultAttoRep < requiredVaultAttoRep) {
				await approveAndDepositRepToVault(client, requiredVaultAttoRep - vaultAttoRep, questionId)
				vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
				vaultAttoRep = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, vault.repBackingUnits)
			}
			assert.ok(vaultAttoRep >= requiredVaultAttoRep, 'test setup needs pool-held vault REP backing plus dispute-staked REP')
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

			const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			assert.ok(parentForkData.auctionableAttoRepAtFork > ownForkRepBuckets.vaultRepAtForkAttoRep, 'own fork should include dispute-staked REP outside the pool auction basis')
			assert.ok(ownForkRepBuckets.vaultRepAtForkAttoRep > 0n, 'test setup should leave vault REP available to migrate')

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			strictEqualTypeSafe(await getMigratedAttoRep(client, yesSecurityPool.securityPool), ownForkRepBuckets.vaultRepAtForkAttoRep, 'all vault REP should be migrated into the child pool')

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'all migrated vault REP should skip the pool truth auction even when dispute-staked REP forked separately')
			strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), 0n, 'the pool auction should not sell escalation-game REP')
		})

		test('forced ETH before child deployment cannot block the no-auction finalization path', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			await mockWindow.setBalance(yesSecurityPool.securityPool, 1n)
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

			const childRepToken = getRepTokenAddress(yesUniverse)
			const clientVaultBeforeFinalize = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const clientClaimBeforeFinalize = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, clientVaultBeforeFinalize.repBackingUnits)

			assert.ok(clientClaimBeforeFinalize > 0n, 'the migrated vault should retain a positive child-pool REP claim before immediate finalization')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 0n, 'the no-collateral fast path requires zero remaining parent collateral')

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child pool should finalize immediately when only forced ETH is present')
			strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), 0n, 'no REP should be sold when there is no collateral to buy')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), 0n, 'predeployment forced ETH must remain outside child collateral accounting')
			strictEqualTypeSafe(await getETHBalance(client, yesSecurityPool.securityPool), 1n, 'predeployment forced ETH should remain as unaccounted surplus')
			const childBalanceBeforeRedeem = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
			await redeemRepFromVault(client, yesSecurityPool.securityPool, client.account.address)
			approximatelyEqual(await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool), childBalanceBeforeRedeem - clientClaimBeforeFinalize, 10n, 'redeeming after immediate finalization should reduce the child balance only by the redeemed migrated claim')
		})

		test('escalation migration remains redeemable after truth auction finalization', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const winningDeposit = repDeposit / 2n
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * 10n ** 18n)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [1n])

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const childRepToken = getRepTokenAddress(yesUniverse)
			const childEscalationGame = await client.readContract({ address: yesSecurityPool.securityPool, abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'escalationGame' })
			const bindingCapitalBeforeFinalize = await client.readContract({ address: childEscalationGame, abi: peripherals_EscalationGame_EscalationGame.abi, functionName: 'getBindingCapitalAttoRep' })
			const curveElapsedBeforeFinalize = await client.readContract({
				address: childEscalationGame,
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'computeTimeSinceStartFromAttritionCostAttoRep',
				args: [bindingCapitalBeforeFinalize],
			})
			assert.ok(curveElapsedBeforeFinalize > 3n * DAY, 'the deadline regression requires more than one minimum response period of pre-haircut curve time')
			const outcomeBalancesBeforeFinalize = await client.readContract({ address: childEscalationGame, abi: peripherals_EscalationGame_EscalationGame.abi, functionName: 'getOutcomeBalancesAttoRep' })
			const originalVaultBeforeFinalize = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const escalationClaimBeforeFinalize = originalVaultBeforeFinalize.disputeStakedAttoRep
			const childBalanceBeforeFinalize = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
			const originalClaimBeforeFinalize = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, originalVaultBeforeFinalize.repBackingUnits)
			assert.ok(originalClaimBeforeFinalize > 0n, 'the migrated vault should retain positive pool-held child REP backing before finalization')
			assert.ok(originalClaimBeforeFinalize <= childBalanceBeforeFinalize, "before finalization the migrated vault claim should stay bounded by the child pool's pool-held REP balance")

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const totalPoolHeldRepAtForkAttoRep = ownForkRepBuckets.vaultRepAtForkAttoRep
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
				const auctionTick = await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, totalPoolHeldRepAtForkAttoRep / 2n, expectedEthToBuy)
				assert.ok(tickToPrice(auctionTick) > 0n, 'auction participation should produce a valid clearing price when a truth auction is needed')
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			} else {
				strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should either run a truth auction or finalize immediately')
				strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
			}

			const originalVaultAfterFinalize = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const childBalanceAfterFinalize = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
			const originalClaimAfterFinalize = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, originalVaultAfterFinalize.repBackingUnits)
			assert.ok(originalClaimAfterFinalize > 0n, 'the migrated vault should remain redeemable after finalization')
			assert.ok(originalClaimAfterFinalize <= childBalanceAfterFinalize, 'the migrated vault claim should stay bounded by the child pools remaining REP balance')
			const disputeStakedRepBeforeAuctionAttoRep = await client.readContract({ address: childEscalationGame, abi: peripherals_EscalationGame_EscalationGame.abi, functionName: 'truthAuctionRepBeforeAttoRep' })
			const disputeStakedRepRemainingAfterAuctionAttoRep = await client.readContract({ address: childEscalationGame, abi: peripherals_EscalationGame_EscalationGame.abi, functionName: 'truthAuctionRepRemainingAttoRep' })
			assert.ok(disputeStakedRepBeforeAuctionAttoRep > 0n, 'the test auction should sell inherited escalation backing')
			assert.ok(disputeStakedRepRemainingAfterAuctionAttoRep < disputeStakedRepBeforeAuctionAttoRep, 'the test auction should apply a nonzero escalation haircut')
			const expectedEscalationClaim = (escalationClaimBeforeFinalize * disputeStakedRepRemainingAfterAuctionAttoRep) / disputeStakedRepBeforeAuctionAttoRep
			strictEqualTypeSafe(originalVaultAfterFinalize.disputeStakedAttoRep, expectedEscalationClaim, 'the truth auction should apply the same proportional REP retention to the escalation claim')
			if (disputeStakedRepBeforeAuctionAttoRep > 0n) {
				const outcomeBalancesAfterFinalize = await client.readContract({ address: childEscalationGame, abi: peripherals_EscalationGame_EscalationGame.abi, functionName: 'getOutcomeBalancesAttoRep' })
				for (let outcomeIndex = 0; outcomeIndex < outcomeBalancesAfterFinalize.length; outcomeIndex += 1) {
					strictEqualTypeSafe(outcomeBalancesAfterFinalize[outcomeIndex], (outcomeBalancesBeforeFinalize[outcomeIndex] * disputeStakedRepRemainingAfterAuctionAttoRep) / disputeStakedRepBeforeAuctionAttoRep, 'the effective outcome balance should move backward by the auction retention ratio')
				}
				const forkResumedAt = await client.readContract({ address: childEscalationGame, abi: peripherals_EscalationGame_EscalationGame.abi, functionName: 'forkResumedAt' })
				const forkElapsedAfterFinalize = await client.readContract({ address: childEscalationGame, abi: peripherals_EscalationGame_EscalationGame.abi, functionName: 'forkElapsedAtStart' })
				const bindingCapitalAfterFinalize = await client.readContract({ address: childEscalationGame, abi: peripherals_EscalationGame_EscalationGame.abi, functionName: 'getBindingCapitalAttoRep' })
				const requiredElapsedAfterFinalize = await client.readContract({
					address: childEscalationGame,
					abi: peripherals_EscalationGame_EscalationGame.abi,
					functionName: 'computeTimeSinceStartFromAttritionCostAttoRep',
					args: [bindingCapitalAfterFinalize],
				})
				const gameEndDate = await client.readContract({ address: childEscalationGame, abi: peripherals_EscalationGame_EscalationGame.abi, functionName: 'getEscalationGameEndDate' })
				assert.ok(forkElapsedAfterFinalize < curveElapsedBeforeFinalize, 'the haircut should move the elapsed curve coordinate backward')
				strictEqualTypeSafe(forkElapsedAfterFinalize, requiredElapsedAfterFinalize, 'the haircut should rebase elapsed time to the weakened binding capital')
				strictEqualTypeSafe(gameEndDate, forkResumedAt + 3n * DAY, 'immediate resume should clamp the recomputed deadline to exactly one fresh minimum response period')
			}

			const childBalanceBeforeRedeem = childBalanceAfterFinalize
			await redeemRepFromVault(client, yesSecurityPool.securityPool, client.account.address)
			approximatelyEqual(await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool), childBalanceBeforeRedeem - originalClaimAfterFinalize, 10n, 'redeeming the migrated vault should reduce the child balance by the redeemed migrated claim')
		})

		test('multiple migrated holders remain redeemable after truth auction finalization', async () => {
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)

			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * 10n ** 18n)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const childRepToken = getRepTokenAddress(yesUniverse)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const totalPoolHeldRepAtForkAttoRep = ownForkRepBuckets.vaultRepAtForkAttoRep
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
				await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, totalPoolHeldRepAtForkAttoRep, expectedEthToBuy)
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			} else {
				strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should either run a truth auction or finalize immediately')
			}
			const totalAttoRepPurchased = await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction)

			const clientVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const attackerVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, attackerClient.account.address)
			const clientClaimBeforeRedeem = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, clientVaultBeforeRedeem.repBackingUnits)
			const attackerClaimBeforeRedeem = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, attackerVaultBeforeRedeem.repBackingUnits)
			assert.ok(clientClaimBeforeRedeem > 0n, 'the first migrated holder should retain a positive redeemable claim after finalization')
			assert.ok(attackerClaimBeforeRedeem > 0n, 'the second migrated holder should retain a positive redeemable claim after finalization')

			await redeemRepFromVault(attackerClient, yesSecurityPool.securityPool, attackerClient.account.address)
			const clientClaimAfterFirstRedeem = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, clientVaultBeforeRedeem.repBackingUnits)
			approximatelyEqual(clientClaimAfterFirstRedeem, clientClaimBeforeRedeem, 10n, 'redeeming one migrated holder should not brick the remaining migrated holder')

			const childBalanceBeforeFinalRedeem = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
			await redeemRepFromVault(client, yesSecurityPool.securityPool, client.account.address)
			assert.ok((await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)) <= childBalanceBeforeFinalRedeem, 'redeeming the remaining migrated holder should not increase the child REP balance')
			assert.ok(totalAttoRepPurchased >= 0n, 'auction accounting should remain readable after both migrated holders redeem')
		})

		test('repro: migrateRepToZoltar shares migration balance across parent pools before child creation', async () => {
			const secondQuestionData = {
				...questionData,
				title: 'second security pool question',
			}
			const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
			await createQuestion(client, secondQuestionData, outcomes)
			await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)

			const secondPoolOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(secondPoolOwner, repDeposit, secondQuestionId)

			const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)
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
			const firstYesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesChildUniverseId, questionId, statoblastSecurityMultiplierBps).securityPool
			const secondYesChildPool = getSecurityPoolAddresses(secondSecurityPoolAddresses.securityPool, yesChildUniverseId, secondQuestionId, statoblastSecurityMultiplierBps).securityPool
			const childRepToken = await getRepToken(client, firstYesChildPool)
			const firstChildRepBalance = await getERC20Balance(client, childRepToken, firstYesChildPool)
			const secondChildRepBalance = await getERC20Balance(client, childRepToken, secondYesChildPool)

			strictEqualTypeSafe(firstChildRepBalance, firstPoolForkData.auctionableAttoRepAtFork, 'the first child pool should receive only the REP migrated from the first parent pool')
			strictEqualTypeSafe(secondChildRepBalance, secondPoolForkData.auctionableAttoRepAtFork, 'the second child pool should receive only the REP migrated from the second parent pool')
		})

		test('migration proxies deploy lazily at their predicted CREATE2 addresses', async () => {
			const secondQuestionData = {
				...questionData,
				title: 'second security pool question for proxy deployment checks',
			}
			const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
			await createQuestion(client, secondQuestionData, outcomes)
			await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)

			const secondPoolOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(secondPoolOwner, repDeposit, secondQuestionId)

			const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)
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
			strictEqualTypeSafe(await getMigrationRepBalanceAttoRep(client, genesisUniverse, migrationProxyAddress), forkData.auctionableAttoRepAtFork, 'proxy migration ledger should equal the parent pool-held REP tracked at fork time')
			assert.ok(!(await contractExists(client, yesChildRepToken)), 'child REP token should not exist before migration splitting deploys it')

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			assert.ok(await contractExists(client, yesChildRepToken), 'migration splitting should deploy the child REP token')
			strictEqualTypeSafe(await getERC20Balance(client, yesChildRepToken, migrationProxyAddress), forkData.auctionableAttoRepAtFork, 'proxy should temporarily hold the split child REP before the child pool exists')

			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverseId, questionId, statoblastSecurityMultiplierBps).securityPool
			strictEqualTypeSafe(await getERC20Balance(client, yesChildRepToken, migrationProxyAddress), 0n, 'proxy should sweep child REP away once the child pool exists')
			strictEqualTypeSafe(await getERC20Balance(client, yesChildRepToken, yesSecurityPool), forkData.auctionableAttoRepAtFork, 'child pool should receive the full split REP after the proxy sweep')
		})

		test('migrateRepToZoltar keeps child-universe REP isolated when both parent pools pre-create the same child outcome', async () => {
			const secondQuestionData = {
				...questionData,
				title: 'second security pool question with precreated child',
			}
			const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
			await createQuestion(client, secondQuestionData, outcomes)
			await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)

			const secondPoolOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(secondPoolOwner, repDeposit, secondQuestionId)

			const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)
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
			const firstYesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesChildUniverseId, questionId, statoblastSecurityMultiplierBps).securityPool
			const secondYesChildPool = getSecurityPoolAddresses(secondSecurityPoolAddresses.securityPool, yesChildUniverseId, secondQuestionId, statoblastSecurityMultiplierBps).securityPool
			const childRepToken = await getRepToken(client, firstYesChildPool)
			const firstChildRepBalance = await getERC20Balance(client, childRepToken, firstYesChildPool)
			const secondChildRepBalance = await getERC20Balance(client, childRepToken, secondYesChildPool)

			strictEqualTypeSafe(firstChildRepBalance, firstPoolForkData.auctionableAttoRepAtFork, 'the first pre-created child pool should receive only the first parent pool-held REP')
			strictEqualTypeSafe(secondChildRepBalance, secondPoolForkData.auctionableAttoRepAtFork, 'the second pre-created child pool should receive only the second parent pool-held REP')
			strictEqualTypeSafe(await getERC20Balance(client, childRepToken, getInfraContractAddresses().securityPoolForker), 0n, 'forker should not retain child REP after both pre-created child pools are funded')
		})

		test('migrateRepToZoltar keeps later parent pools isolated after an earlier parent already migrated and deployed its child pool', async () => {
			const secondQuestionData = {
				...questionData,
				title: 'second security pool question after first migration',
			}
			const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
			await createQuestion(client, secondQuestionData, outcomes)
			await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)

			const secondPoolOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(secondPoolOwner, repDeposit, secondQuestionId)

			const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)
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
			const firstYesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesChildUniverseId, questionId, statoblastSecurityMultiplierBps).securityPool
			const secondYesChildPool = getSecurityPoolAddresses(secondSecurityPoolAddresses.securityPool, yesChildUniverseId, secondQuestionId, statoblastSecurityMultiplierBps).securityPool
			const childRepToken = await getRepToken(client, firstYesChildPool)
			const firstChildRepBalance = await getERC20Balance(client, childRepToken, firstYesChildPool)
			const secondChildRepBalance = await getERC20Balance(client, childRepToken, secondYesChildPool)

			strictEqualTypeSafe(firstChildRepBalance, firstPoolForkData.auctionableAttoRepAtFork, 'the first child pool balance should remain unchanged after the second pool migrates later')
			strictEqualTypeSafe(secondChildRepBalance, secondPoolForkData.auctionableAttoRepAtFork, 'the second child pool should still receive only its own migrated REP even after the first pool already migrated')
		})

		test('redeemRepFromVault should stay blocked until the own-fork child pool becomes operational', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'child pool should still be in fork migration before the truth-auction window ends')
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'own-fork child currently reports a finalized outcome before the pool is operational')
			await assert.rejects(redeemRepFromVault(client, yesSecurityPool.securityPool, client.account.address), /Pool not operational|Pool inactive/)
		})
	})

	describe('auction bidding and claim settlement', () => {
		const setupFinalizedAuctionWithUnclaimedCoverageCommitmentAttoEth = async (forkSource: string) => {
			const unmigratedCoverageCommitmentAttoEthHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await approveAndDepositRepToVault(unmigratedCoverageCommitmentAttoEthHolder, repDeposit, questionId)

			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const securityPoolCoverageCommitmentAttoEth = repDeposit / 8n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			await manipulatePriceOracleAndPerformOperation(unmigratedCoverageCommitmentAttoEthHolder, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, unmigratedCoverageCommitmentAttoEthHolder.account.address, securityPoolCoverageCommitmentAttoEth)

			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, forkSource)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			const auctionTick = await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			const forkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
			const childRepToken = await getRepToken(client, yesSecurityPool.securityPool)
			const clientChildRepBalanceSlot = formatStorageSlot(getMappingStorageSlot(client.account.address, 0n))
			await mockWindow.addStateOverrides({
				[childRepToken]: {
					stateDiff: {
						[clientChildRepBalanceSlot]: repDeposit,
					},
				},
			})
			await approveToken(client, childRepToken, getInfraContractAddresses().openOracle)

			return {
				auctionParticipant,
				auctionTick,
				auctionedCoverageCommitmentAttoEth: forkData.auctionedCoverageCommitmentAttoEth,
				migratedCoverageCommitmentAttoEth: securityPoolCoverageCommitmentAttoEth,
				yesSecurityPool,
			}
		}

		test('simple truth auction: participant buys rep and can claim proceeds', async () => {
			// Setup: create open interest, trigger fork, migrate
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			// Set coverage commitment and deposit extra REP for capacity
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRepToVault(passiveRepHolder, repDeposit, questionId)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			// Fork the security pool
			await triggerExternalForkForSecurityPool(undefined, 'simple truth auction fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

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
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
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

			// Verify participant got REP allocation

			// Claim proceeds
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])

			// Verify they got backingUnits shares matching purchasedRep (with tolerance for rounding)
			const vault = await getSecurityVault(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
			const repFromBackingUnits = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, vault.repBackingUnits)
			assert.ok(repFromBackingUnits > 0n, 'auction participant should have some rep')
		})

		test('claimAuctionProceeds releases ETH for a finalized losing bid without mutating vault accounting', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'refund-only claim fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			const losingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const winningBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
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

			const losingBidderBalanceAfterClaim = await getETHBalance(client, losingBidder.account.address)
			const losingVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)
			const vaultCountAfterClaim = await getVaultCount(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(losingBidderBalanceAfterClaim - losingBidderBalanceBeforeClaim, losingEth, 'finalized losing bidder should receive their full ETH refund')
			strictEqualTypeSafe(losingVaultAfterClaim.repBackingUnits, losingVaultBeforeClaim.repBackingUnits, 'refund-only finalized claim should not mint REP backing units')
			strictEqualTypeSafe(losingVaultAfterClaim.coverageCommitmentAttoEth, losingVaultBeforeClaim.coverageCommitmentAttoEth, 'refund-only finalized claim should not assign coverage commitment')
			strictEqualTypeSafe(losingVaultAfterClaim.feeIndex, losingVaultBeforeClaim.feeIndex, 'refund-only finalized claim should not alter fee accounting')
			strictEqualTypeSafe(vaultCountAfterClaim, vaultCountBeforeClaim, 'refund-only finalized claim should not create a new vault')
		})

		test('auction participants receive settled vault REP or direct ETH refunds and can redeem purchased REP', async () => {
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

			const winningVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidder.account.address)
			const losingVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)
			const winningRepClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, winningVaultAfterClaim.repBackingUnits)
			const losingRepClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, losingVaultAfterClaim.repBackingUnits)
			const winningLimitPrice = tickToPrice(winningTick)
			const minimumWinningRepAtLimit = (expectedEthToBuy * PRICE_PRECISION) / winningLimitPrice

			strictEqualTypeSafe((await getETHBalance(client, losingBidder.account.address)) - losingEthBeforeClaim, losingEth, 'losing auction participant should receive their ETH back')
			strictEqualTypeSafe(await getETHBalance(client, winningBidder.account.address), winningEthBeforeClaim, 'winning auction participant should not receive an ETH refund for a filled bid')
			strictEqualTypeSafe(losingVaultAfterClaim.repBackingUnits, losingVaultBeforeClaim.repBackingUnits, 'losing auction participant should not receive vault backingUnits')
			strictEqualTypeSafe(losingRepClaim, 0n, 'losing auction participant should not receive a REP vault claim')
			strictEqualTypeSafe(winningVaultBeforeClaim.repBackingUnits, 0n, 'winning auction participant should start without child-pool vault backingUnits')
			assert.ok(winningRepClaim >= minimumWinningRepAtLimit, 'winning auction participant should receive a vault REP claim at least as good as their limit order')

			await finalizeChildQuestionAsYes(yesSecurityPool)
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'child question should eventually finalize before auction REP redemption')

			const winningRepBalanceBeforeRedeem = await getERC20Balance(client, childRepToken, winningBidder.account.address)
			await redeemRepFromVault(winningBidder, yesSecurityPool.securityPool, winningBidder.account.address)
			const winningRepBalanceAfterRedeem = await getERC20Balance(client, childRepToken, winningBidder.account.address)
			const winningVaultAfterRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidder.account.address)

			strictEqualTypeSafe(winningRepBalanceAfterRedeem - winningRepBalanceBeforeRedeem, winningRepClaim, 'winning auction participant should eventually redeem the purchased vault REP to their wallet')
			strictEqualTypeSafe(winningVaultAfterRedeem.repBackingUnits, 0n, 'redeeming purchased auction REP should empty the participants vault backingUnits')
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
			const winningARepClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, winningVaultAAfterClaim.repBackingUnits)
			const winningBRepClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, winningVaultBAfterClaim.repBackingUnits)
			const minimumWinningARepAtLimit = (winningEthA * PRICE_PRECISION) / tickToPrice(winningTickA)
			const minimumWinningBRepAtLimit = (winningEthB * PRICE_PRECISION) / tickToPrice(winningTickB)
			assert.ok(winningARepClaim >= minimumWinningARepAtLimit, 'first filled auction participant should receive vault REP at least as good as their limit order')
			assert.ok(winningBRepClaim >= minimumWinningBRepAtLimit, 'second filled auction participant should receive vault REP at least as good as their limit order')

			await finalizeChildQuestionAsYes(yesSecurityPool)
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'child question should eventually finalize before multi-winner auction REP redemption')

			const winningARepBeforeRedeem = await getERC20Balance(client, childRepToken, winningBidderA.account.address)
			const winningBRepBeforeRedeem = await getERC20Balance(client, childRepToken, winningBidderB.account.address)
			const childRepBeforeRedeem = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
			const winningARedeemClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, winningVaultAAfterClaim.repBackingUnits)
			const winningBRedeemClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, winningVaultBAfterClaim.repBackingUnits)

			await redeemRepFromVault(winningBidderA, yesSecurityPool.securityPool, winningBidderA.account.address)
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

		test('claimAuctionProceeds handles a zero-REP finalized refund path when totalAttoRepPurchased is zero', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'zero rep refund fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
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

			strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), 0n, 'setup should finalize with zero purchased REP')

			const vaultCountBeforeClaim = await getVaultCount(client, yesSecurityPool.securityPool)
			const losingBidderBalanceBeforeClaim = await getETHBalance(client, losingBidder.account.address)
			const losingVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])

			const losingBidderBalanceAfterClaim = await getETHBalance(client, losingBidder.account.address)
			const losingVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)
			const vaultCountAfterClaim = await getVaultCount(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(losingBidderBalanceAfterClaim - losingBidderBalanceBeforeClaim, losingEth, 'zero-REP finalized claim should release the full ETH refund')
			strictEqualTypeSafe(losingVaultAfterClaim.repBackingUnits, losingVaultBeforeClaim.repBackingUnits, 'zero-REP finalized claim should not mint REP backing units')
			strictEqualTypeSafe(losingVaultAfterClaim.coverageCommitmentAttoEth, losingVaultBeforeClaim.coverageCommitmentAttoEth, 'zero-REP finalized claim should not assign coverage commitment')
			strictEqualTypeSafe(losingVaultAfterClaim.feeIndex, losingVaultBeforeClaim.feeIndex, 'zero-REP finalized claim should not alter fee accounting')
			strictEqualTypeSafe(vaultCountAfterClaim, vaultCountBeforeClaim, 'zero-REP finalized claim should not create a new vault')
		})

		test('minimum-bid underfunded winner receives the full auction REP without an uncompensated repair contribution', async () => {
			const unmigratedCoverageCommitmentAttoEthHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await approveAndDepositRepToVault(unmigratedCoverageCommitmentAttoEthHolder, repDeposit, questionId)
			await manipulatePriceOracleAndPerformOperation(unmigratedCoverageCommitmentAttoEthHolder, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, unmigratedCoverageCommitmentAttoEthHolder.account.address, repDeposit / 8n)
			const { yesSecurityPool, expectedEthToBuy } = await setupStartedTruthAuction('minimum bid extraction fork source')
			const auctionCap = await getMaxRepBeingSoldAttoRep(client, yesSecurityPool.truthAuction)
			const minBidSizeAttoEth = await getMinBidSizeAttoEth(client, yesSecurityPool.truthAuction)
			const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const attackerTick = await participateAuction(attacker, yesSecurityPool.truthAuction, 1n, minBidSizeAttoEth)
			assert.ok(minBidSizeAttoEth < expectedEthToBuy / 1_000n, 'test setup should keep the minimum bid economically tiny relative to the target raise')
			const finalizerVaultBefore = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const parentCoverageCommitmentAttoEth = await getTotalCoverageCommitmentAttoEth(client, securityPoolAddresses.securityPool)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'successfully finalizing an underfunded auction should leave the child operational without a retry')

			const expectedAttackerRep = auctionCap
			strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), expectedAttackerRep, 'one qualifying minimum bid should buy the complete auction REP cap at the weak-demand clearing price')
			const forkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
			const unmigratedCoverageCommitmentAttoEth = parentCoverageCommitmentAttoEth - finalizerVaultBefore.coverageCommitmentAttoEth
			const expectedAuctionedCoverageCommitmentAttoEth = unmigratedCoverageCommitmentAttoEth
			strictEqualTypeSafe(forkData.auctionedCoverageCommitmentAttoEth, expectedAuctionedCoverageCommitmentAttoEth, 'coverage commitment')
			const finalizerVaultAfter = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			strictEqualTypeSafe(finalizerVaultAfter.repBackingUnits, finalizerVaultBefore.repBackingUnits, 'finalizing an underfunded auction must not issue REP backing units to the finalizer')
			strictEqualTypeSafe(finalizerVaultAfter.coverageCommitmentAttoEth, finalizerVaultBefore.coverageCommitmentAttoEth, 'finalizing an underfunded auction must not assign coverage commitment to the finalizer')

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, attacker.account.address, [{ tick: attackerTick, bidIndex: 0n }])

			const attackerVault = await getSecurityVault(client, yesSecurityPool.securityPool, attacker.account.address)
			const attackerRepClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, attackerVault.repBackingUnits)
			strictEqualTypeSafe(attackerRepClaim, expectedAttackerRep, 'settling the only qualifying bid should credit the complete auction REP cap')
			strictEqualTypeSafe(attackerVault.coverageCommitmentAttoEth, expectedAuctionedCoverageCommitmentAttoEth, 'coverage commitment')
		})

		test('zero-migration full-cap settlement keeps backingUnits conversion and fresh deposits usable', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			await createCompleteSet(createWriteClient(mockWindow, TEST_ADDRESSES[1], 0), securityPoolAddresses.securityPool, 10n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, 'zero-migration backingUnits normalization source')
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getMigratedAttoRep(client, yesSecurityPool.securityPool), 0n, 'test requires a child with no migrated vault REP')
			const auctionCap = await getMaxRepBeingSoldAttoRep(client, yesSecurityPool.truthAuction)
			const minBidSizeAttoEth = await getMinBidSizeAttoEth(client, yesSecurityPool.truthAuction)
			const auctionWinner = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const winningTick = await participateAuction(auctionWinner, yesSecurityPool.truthAuction, 1n, minBidSizeAttoEth)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), auctionCap, 'the qualifying minimum bid should receive the complete zero-migration cap')

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionWinner.account.address, [{ tick: winningTick, bidIndex: 0n }])
			const winnerVault = await getSecurityVault(client, yesSecurityPool.securityPool, auctionWinner.account.address)
			strictEqualTypeSafe(await getTotalRepBackingUnits(client, yesSecurityPool.securityPool), auctionCap * PRICE_PRECISION, 'a zero-migration full sale should normalize backingUnits to the standard REP scale')
			strictEqualTypeSafe(await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, winnerVault.repBackingUnits), auctionCap, 'the complete-cap winner should be able to convert every backingUnits unit back to REP')

			const freshVault = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			const freshDeposit = 10n * 10n ** 18n
			const childRepToken = await getRepToken(client, yesSecurityPool.securityPool)
			const freshVaultBalanceSlot = formatStorageSlot(getMappingStorageSlot(freshVault.account.address, 0n))
			await mockWindow.addStateOverrides({
				[childRepToken]: {
					stateDiff: {
						[freshVaultBalanceSlot]: freshDeposit,
					},
				},
			})
			await approveToken(freshVault, childRepToken, yesSecurityPool.securityPool)
			await depositRepToVault(freshVault, yesSecurityPool.securityPool, freshDeposit)

			const freshVaultState = await getSecurityVault(client, yesSecurityPool.securityPool, freshVault.account.address)
			strictEqualTypeSafe(await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, freshVaultState.repBackingUnits), freshDeposit, 'a minimum fresh deposit should remain exactly convertible after zero-migration auction settlement')
		})

		test('coverage commitment', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)

			const unmigratedVault = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
			await approveAndDepositRepToVault(unmigratedVault, 2n * forkThresholdAttoRep, questionId)
			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			await mockWindow.advanceTime(10n * 60n)
			await manipulatePriceOracleAndPerformOperation(unmigratedVault, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, unmigratedVault.account.address, securityPoolCoverageCommitmentAttoEth)
			await createCompleteSet(createWriteClient(mockWindow, TEST_ADDRESSES[2], 0), securityPoolAddresses.securityPool, 10n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, 'rejecting auction winner capacity source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const rejectingWinner = await deployRejectingEthReceiver()
			const auctionAbi = peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi
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
			assert.ok(forkDataBeforeClaim.auctionedCoverageCommitmentAttoEth > 0n, 'coverage commitment')
			await client.writeContract({
				abi: rejectingEthReceiverArtifact.abi,
				address: rejectingWinner,
				functionName: 'setConsumeAllGas',
				args: [true],
			})

			const snapshotBeforeClaim = await client.readContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: yesSecurityPool.securityPool,
				functionName: 'getPoolAccountingSnapshot',
				args: [],
			})
			strictEqualTypeSafe(snapshotBeforeClaim.totalCoverageCommitmentAttoEth - snapshotBeforeClaim.feeEligibleCoverageCommitmentAttoEth, forkDataBeforeClaim.auctionedCoverageCommitmentAttoEth, 'coverage commitment')
			const assignedHeadroom = snapshotBeforeClaim.feeEligibleCoverageCommitmentAttoEth > snapshotBeforeClaim.settlementCollateralAttoEth ? snapshotBeforeClaim.feeEligibleCoverageCommitmentAttoEth - snapshotBeforeClaim.settlementCollateralAttoEth : 0n
			const capacityProbe = assignedHeadroom + 1n
			const retentionRateBeforeClaim = await client.readContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: yesSecurityPool.securityPool,
				functionName: 'currentRetentionRate',
				args: [],
			})
			const childRepToken = await getRepToken(client, yesSecurityPool.securityPool)
			const reporterBalanceSlot = formatStorageSlot(getMappingStorageSlot(client.account.address, 0n))
			await mockWindow.addStateOverrides({
				[childRepToken]: {
					stateDiff: {
						[reporterBalanceSlot]: repDeposit,
					},
				},
			})
			await manipulatePriceOracle(client, mockWindow, yesSecurityPool.priceOracleManagerAndOperatorQueuer)
			const assignedVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			assert.ok(snapshotBeforeClaim.totalCoverageCommitmentAttoEth - assignedVaultBeforeClaim.coverageCommitmentAttoEth >= snapshotBeforeClaim.settlementCollateralAttoEth, 'coverage commitment')
			await assert.rejects(
				client.call({
					account: yesSecurityPool.priceOracleManagerAndOperatorQueuer,
					data: encodeFunctionData({
						abi: peripherals_SecurityPool_SecurityPool.abi,
						functionName: 'executeCoverageCommitmentUpdate',
						args: [client.account.address, 0n],
					}),
					to: yesSecurityPool.securityPool,
				}),
				/Over capacity/,
			)
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await assert.rejects(createCompleteSet(openInterestHolder, yesSecurityPool.securityPool, capacityProbe), /Over capacity/)

			const claimHash = await client.writeContract({
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				address: getInfraContractAddresses().securityPoolForker,
				functionName: 'claimAuctionProceeds',
				args: [yesSecurityPool.securityPool, rejectingWinner, [{ tick: winningTick, bidIndex: 0n }]],
				gas: 2_000_000n,
			})
			await client.waitForTransactionReceipt({ hash: claimHash })
			const winnerVault = await getSecurityVault(client, yesSecurityPool.securityPool, rejectingWinner)
			assert.ok(winnerVault.repBackingUnits > 0n, 'permissionless settlement should assign the winner REP backingUnits')
			strictEqualTypeSafe(winnerVault.coverageCommitmentAttoEth, forkDataBeforeClaim.auctionedCoverageCommitmentAttoEth, 'coverage commitment')
			const pendingRefund = await client.readContract({
				abi: auctionAbi,
				address: yesSecurityPool.truthAuction,
				functionName: 'pendingEthRefundsAttoEth',
				args: [rejectingWinner],
			})
			assert.ok(pendingRefund > 0n, 'the rejected partial-fill refund should remain in pull escrow')

			const snapshotAfterClaim = await client.readContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: yesSecurityPool.securityPool,
				functionName: 'getPoolAccountingSnapshot',
				args: [],
			})
			strictEqualTypeSafe(snapshotAfterClaim.feeEligibleCoverageCommitmentAttoEth - snapshotBeforeClaim.feeEligibleCoverageCommitmentAttoEth, forkDataBeforeClaim.auctionedCoverageCommitmentAttoEth, 'coverage commitment')
			assert.ok(
				(await client.readContract({
					abi: peripherals_SecurityPool_SecurityPool.abi,
					address: yesSecurityPool.securityPool,
					functionName: 'currentRetentionRate',
					args: [],
				})) > retentionRateBeforeClaim,
				'coverage commitment',
			)
			await createCompleteSet(openInterestHolder, yesSecurityPool.securityPool, capacityProbe)

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
			strictEqualTypeSafe((await getETHBalance(client, rejectingWinner)) - winnerEthBeforePull, pendingRefund, 'the winner should receive the complete deferred refund after accepting ETH')
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
			strictEqualTypeSafe(winningVault.coverageCommitmentAttoEth, forkData.auctionedCoverageCommitmentAttoEth, 'coverage commitment')
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
			await approveAndDepositRepToVault(liquidatorClient, repDeposit * 50n, questionId)
			await approveAndDepositRepToVault(passiveRepHolder, repDeposit * 50n, questionId)

			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			await mockWindow.advanceTime(10n * 60n)
			await manipulatePriceOracleAndPerformOperation(passiveRepHolder, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, passiveRepHolder.account.address, securityPoolCoverageCommitmentAttoEth / 2n)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * 10n ** 18n)

			await triggerExternalForkForSecurityPool(undefined, 'liquidated unclaimed auction proceeds fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(liquidatorClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			const winningTick = await participateAuction(client, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)
			const childRepToken = await getRepToken(client, yesSecurityPool.securityPool)
			const liquidatorChildRepBalanceSlot = formatStorageSlot(getMappingStorageSlot(liquidatorClient.account.address, 0n))
			const liquidateClaimableChildVault = async (amount: bigint) => {
				await mockWindow.addStateOverrides({
					[childRepToken]: {
						stateDiff: {
							[liquidatorChildRepBalanceSlot]: repDeposit,
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
			const targetRepBeforeLiquidation = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, targetVaultBeforeLiquidation.repBackingUnits)
			const totalRepBeforeLiquidation = await client.readContract({ address: yesSecurityPool.securityPool, abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'getTotalPoolHeldAttoRep', args: [] })
			const denominatorBeforeLiquidation = await getTotalRepBackingUnits(client, yesSecurityPool.securityPool)
			const liquidationThresholdPrice = (targetRepBeforeLiquidation * PRICE_PRECISION * 10_000n) / (targetVaultBeforeLiquidation.coverageCommitmentAttoEth * statoblastSecurityMultiplierBps)
			const forcedPrice = (liquidationThresholdPrice + 1n) * 2n
			const liquidationChunk = targetVaultBeforeLiquidation.coverageCommitmentAttoEth / 10n

			strictEqualTypeSafe(targetVaultBeforeLiquidation.coverageCommitmentAttoEth > 0n, true, 'coverage commitment')
			assert.ok(targetRepBeforeLiquidation > 0n, 'migrated bidder vault should carry REP before liquidation')
			strictEqualTypeSafe(liquidationChunk > 0n, true, 'test setup needs a positive liquidation chunk')

			const liquidationAttemptStartBlock = await client.getBlockNumber()
			await liquidateClaimableChildVault(liquidationChunk)

			const targetVaultAfterLiquidation = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const liquidatorVaultAfterLiquidation = await getSecurityVault(client, yesSecurityPool.securityPool, liquidatorClient.account.address)
			const targetRepAfterLiquidation = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, targetVaultAfterLiquidation.repBackingUnits)

			if (targetVaultAfterLiquidation.coverageCommitmentAttoEth >= targetVaultBeforeLiquidation.coverageCommitmentAttoEth) {
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
				throw new Error(`pre-claim liquidation did not reduce coverageCommitmentAttoEth; coordinator results=${executionReasons.join('|')}`)
			}

			const coverageCommitmentTransferredAttoEth = targetVaultBeforeLiquidation.coverageCommitmentAttoEth - targetVaultAfterLiquidation.coverageCommitmentAttoEth

			const settledLiquidationPrice = await getLastPrice(client, yesSecurityPool.priceOracleManagerAndOperatorQueuer)
			const quotedRepMove = getLiquidationVaultRepBackingToTransfer(coverageCommitmentTransferredAttoEth, settledLiquidationPrice)
			const expectedBackingUnitsMove = (quotedRepMove * denominatorBeforeLiquidation) / totalRepBeforeLiquidation
			const expectedRepMove = (expectedBackingUnitsMove * totalRepBeforeLiquidation) / denominatorBeforeLiquidation
			strictEqualTypeSafe(coverageCommitmentTransferredAttoEth > 0n, true, 'coverage commitment')
			approximatelyEqual(targetRepAfterLiquidation, targetRepBeforeLiquidation - expectedRepMove, 2n, 'liquidation should transfer migrated vault REP backing before claim')
			approximatelyEqual(
				await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, liquidatorVaultAfterLiquidation.repBackingUnits),
				(await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, liquidatorVaultBeforeLiquidation.repBackingUnits)) + expectedRepMove,
				2n,
				'liquidation should transfer migrated vault REP backing into the liquidator vault',
			)
			strictEqualTypeSafe(liquidatorVaultAfterLiquidation.coverageCommitmentAttoEth, liquidatorVaultBeforeLiquidation.coverageCommitmentAttoEth + coverageCommitmentTransferredAttoEth, 'coverage commitment')

			const childCollateralAfterLiquidation = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const childCoverageCommitmentAttoEthAfterLiquidation = await getTotalCoverageCommitmentAttoEth(client, yesSecurityPool.securityPool)
			const totalAttoRepPurchased = await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction)
			const forkDataBeforeClaim = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(forkDataBeforeClaim.auctionedCoverageCommitmentAttoEth > 0n, true, 'coverage commitment')
			strictEqualTypeSafe(totalAttoRepPurchased > 0n, true, 'test setup should leave finalized auction REP for the bidder to claim')

			await claimAuctionProceeds(settlementCaller, yesSecurityPool.securityPool, client.account.address, [{ tick: winningTick, bidIndex: 0n }])

			const targetVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const liquidatorVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, liquidatorClient.account.address)
			const targetRepAfterClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, targetVaultAfterClaim.repBackingUnits)

			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), childCollateralAfterLiquidation, 'claim timing should not change child collateral totals after liquidation')
			strictEqualTypeSafe(await getTotalCoverageCommitmentAttoEth(client, yesSecurityPool.securityPool), childCoverageCommitmentAttoEthAfterLiquidation, 'coverage commitment')
			strictEqualTypeSafe(targetRepAfterClaim - targetRepAfterLiquidation, totalAttoRepPurchased, 'the original bidder should still receive the full finalized auction REP after their migrated vault was liquidated')
			strictEqualTypeSafe(targetVaultAfterClaim.coverageCommitmentAttoEth - targetVaultAfterLiquidation.coverageCommitmentAttoEth, forkDataBeforeClaim.auctionedCoverageCommitmentAttoEth, 'coverage commitment')
			strictEqualTypeSafe(liquidatorVaultAfterClaim.repBackingUnits, liquidatorVaultAfterLiquidation.repBackingUnits, 'unclaimed finalized auction proceeds should not be swept into the liquidator vault')
			strictEqualTypeSafe(liquidatorVaultAfterClaim.coverageCommitmentAttoEth, liquidatorVaultAfterLiquidation.coverageCommitmentAttoEth, 'coverage commitment')

			await mockWindow.advanceTime(DAY)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			await updateVaultFees(client, yesSecurityPool.securityPool, liquidatorClient.account.address)
			approximatelyEqual(await getTotalAccruedFees(client, yesSecurityPool.securityPool), await getTotalClaimableVaultFeesAttoEth(client, yesSecurityPool.securityPool), 1n, 'coverage commitments')
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
			await assert.rejects(async () => await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }]), /Bid has already been claimed or does not exist/)
		})

		test('coverage commitment', async () => {
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)
			await mockWindow.advanceTime(10n * 60n)
			await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, attackerClient.account.address, securityPoolCoverageCommitmentAttoEth)

			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'coverage commitment')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			const migratedVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
			const parentCoverageCommitmentAttoEthAtFork = await getTotalCoverageCommitmentAttoEth(client, securityPoolAddresses.securityPool)
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			const auctionTick = await participateAuction(client, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			const forkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
			const totalAttoRepPurchased = await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction)
			const expectedAuctionedCoverageCommitmentAttoEth = parentCoverageCommitmentAttoEthAtFork - migratedVaultBeforeClaim.coverageCommitmentAttoEth
			strictEqualTypeSafe(forkData.auctionedCoverageCommitmentAttoEth, expectedAuctionedCoverageCommitmentAttoEth, 'coverage commitment')
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, client.account.address, [{ tick: auctionTick, bidIndex: 0n }])

			const migratedVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const expectedCoverageCommitmentAttoEthAfterClaim = migratedVaultBeforeClaim.coverageCommitmentAttoEth + (forkData.auctionedCoverageCommitmentAttoEth * totalAttoRepPurchased) / totalAttoRepPurchased

			strictEqualTypeSafe(forkData.auctionedCoverageCommitmentAttoEth > 0n, true, 'coverage commitment')
			strictEqualTypeSafe(migratedVaultAfterClaim.coverageCommitmentAttoEth, expectedCoverageCommitmentAttoEthAfterClaim, 'coverage commitment')
		})

		test('coverage commitment', async () => {
			const { auctionParticipant, auctionTick, auctionedCoverageCommitmentAttoEth, migratedCoverageCommitmentAttoEth, yesSecurityPool } = await setupFinalizedAuctionWithUnclaimedCoverageCommitmentAttoEth('coverage commitment')
			const decreasedMigratedCoverageCommitmentAttoEth = migratedCoverageCommitmentAttoEth / 2n

			await manipulatePriceOracleAndPerformOperation(client, mockWindow, yesSecurityPool.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, decreasedMigratedCoverageCommitmentAttoEth)
			strictEqualTypeSafe(await getTotalCoverageCommitmentAttoEth(client, yesSecurityPool.securityPool), auctionedCoverageCommitmentAttoEth + decreasedMigratedCoverageCommitmentAttoEth, 'coverage commitment')

			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])

			const participantVault = await getSecurityVault(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
			strictEqualTypeSafe(participantVault.coverageCommitmentAttoEth, auctionedCoverageCommitmentAttoEth, 'coverage commitment')
			strictEqualTypeSafe(await getTotalCoverageCommitmentAttoEth(client, yesSecurityPool.securityPool), auctionedCoverageCommitmentAttoEth + decreasedMigratedCoverageCommitmentAttoEth, 'coverage commitment')
		})

		test('coverage commitment', async () => {
			const { auctionParticipant, auctionTick, migratedCoverageCommitmentAttoEth, yesSecurityPool } = await setupFinalizedAuctionWithUnclaimedCoverageCommitmentAttoEth('coverage commitment')
			const increasedMigratedCoverageCommitmentAttoEth = migratedCoverageCommitmentAttoEth * 2n

			await manipulatePriceOracleAndPerformOperation(client, mockWindow, yesSecurityPool.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, increasedMigratedCoverageCommitmentAttoEth)
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])

			await mockWindow.advanceTime(DAY)
			await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
			await updateVaultFees(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
			approximatelyEqual(await getTotalAccruedFees(client, yesSecurityPool.securityPool), await getTotalClaimableVaultFeesAttoEth(client, yesSecurityPool.securityPool), 1n, 'coverage commitment')
		})

		test('claimAuctionProceeds initializes fee accounting for a newly auction-funded vault at the current pool fee index', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'fee-index fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

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
			strictEqualTypeSafe(participantVault.feeIndex, migratedVaultBeforeClaim.feeIndex, 'newly auction-funded vaults should inherit the current child-pool fee index')
		})

		test('claimAuctionProceeds allows a vault to claim winning bids across multiple calls', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const securityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, client.account.address, securityPoolCoverageCommitmentAttoEth)

			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'multi-claim fork source')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

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

		test('coverage commitment', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)

			const baseSecurityPoolCoverageCommitmentAttoEth = repDeposit / 4n
			const securityPoolCoverageCommitmentAttoEth = baseSecurityPoolCoverageCommitmentAttoEth - (baseSecurityPoolCoverageCommitmentAttoEth % 3n) + 1n

			const forkThresholdAttoRep = (await getTotalTheoreticalSupplyAttoRep(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			await manipulatePriceOracleAndPerformOperation(passiveRepHolder, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, passiveRepHolder.account.address, securityPoolCoverageCommitmentAttoEth)

			const openInterestAmount = 10n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const firstBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			const secondBidder = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

			await triggerExternalForkForSecurityPool(undefined, 'coverage commitment')
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)

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
			const firstOrderCoverageCommitmentAttoEthTotal = firstVaultFirstOrder.coverageCommitmentAttoEth + secondVaultFirstOrder.coverageCommitmentAttoEth

			await mockWindow.anvilRevert(claimsSnapshot)
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, secondBidder.account.address, [{ tick: secondAuctionTick, bidIndex: secondBidIndex }])
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, firstBidder.account.address, [{ tick: firstAuctionTick, bidIndex: 0n }])

			const firstVaultReverseOrder = await getSecurityVault(client, yesSecurityPool.securityPool, firstBidder.account.address)
			const secondVaultReverseOrder = await getSecurityVault(client, yesSecurityPool.securityPool, secondBidder.account.address)
			const reverseOrderCoverageCommitmentAttoEthTotal = firstVaultReverseOrder.coverageCommitmentAttoEth + secondVaultReverseOrder.coverageCommitmentAttoEth

			strictEqualTypeSafe(firstOrderCoverageCommitmentAttoEthTotal, forkDataBeforeClaims.auctionedCoverageCommitmentAttoEth, 'coverage commitment')
			strictEqualTypeSafe(reverseOrderCoverageCommitmentAttoEthTotal, forkDataBeforeClaims.auctionedCoverageCommitmentAttoEth, 'coverage commitment')
			strictEqualTypeSafe(firstVaultReverseOrder.coverageCommitmentAttoEth, firstVaultFirstOrder.coverageCommitmentAttoEth, 'coverage commitment')
			strictEqualTypeSafe(secondVaultReverseOrder.coverageCommitmentAttoEth, secondVaultFirstOrder.coverageCommitmentAttoEth, 'coverage commitment')
		})

		test('coverage commitment', async () => {
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
			const credit = async (vault: typeof zeroRepVault, attoRepAmount: bigint, coverageCommitmentAttoEthAmount: bigint) => {
				const hash = await client.writeContract({
					address: forkerAddress,
					abi: test_peripherals_SecurityPoolForkerAuctionSettlementHarness_SecurityPoolForkerAuctionSettlementHarness.abi,
					functionName: 'creditAuctionProceeds',
					args: [poolAddress, vault, attoRepAmount, coverageCommitmentAttoEthAmount],
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
			strictEqualTypeSafe(zeroRepForward[0], 0n, 'coverage commitment')
			strictEqualTypeSafe(zeroRepForward[1], 1n, 'coverage commitment')
			strictEqualTypeSafe(positiveRepForward[0], 10n, 'positive REP settlement should create backingUnits at the configured rate')
			strictEqualTypeSafe(positiveRepForward[1], 2n, 'coverage commitment')

			await mockWindow.anvilRevert(settlementSnapshot)
			await credit(positiveRepVault, 1n, 2n)
			await credit(zeroRepVault, 0n, 1n)
			const zeroRepReverse = await readVault(zeroRepVault)
			const positiveRepReverse = await readVault(positiveRepVault)
			strictEqualTypeSafe(zeroRepReverse[1], zeroRepForward[1], 'coverage commitment')
			strictEqualTypeSafe(positiveRepReverse[1], positiveRepForward[1], 'coverage commitment')

			const totalEligibleCoverageCommitmentAttoEth = await client.readContract({
				address: poolAddress,
				abi: test_peripherals_SecurityPoolForkerAuctionSettlementHarness_AuctionSettlementPoolHarness.abi,
				functionName: 'feeEligibleCoverageCommitmentAttoEth',
				args: [],
			})
			strictEqualTypeSafe(totalEligibleCoverageCommitmentAttoEth, 3n, 'coverage commitment')
		})
	})
})
