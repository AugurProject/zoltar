import { statoblast_SecurityPoolForker_SecurityPoolForker, statoblast_EscalationGame_EscalationGame, statoblast_SecurityPool_SecurityPool } from '../../../types/contractArtifact'
import { createCompleteSet, depositRepToVault, depositToEscalationGame, getSettlementCollateralAttoEth, getTotalRepBackingUnits, getRepToken, getSecurityVault, getSystemState, backingUnitsToAttoRep, redeemRepFromVault, setUnderwritingLimit } from '../../../testSupport/simulator/utils/contracts/securityPool'
import { getTotalRepPurchasedAttoRep, getEthRaiseCapAttoEth } from '../../../testSupport/simulator/utils/contracts/auction'
import { forkUniverse, getRepTokenAddress, getTotalTheoreticalSupply, getZoltarAddress } from '../../../testSupport/simulator/utils/contracts/zoltar'
import { finalizeTruthAuction, getMigratedAttoRep, getOwnForkRepBuckets, getSecurityPoolForkerForkData, initiateSecurityPoolFork, claimForkedEscalationDeposits, migrateRepToZoltar, migrateVault, startTruthAuction } from '../../../testSupport/simulator/utils/contracts/securityPoolForker'
import { SystemState } from '../../../testSupport/simulator/types/statoblastTypes'
import { QuestionOutcome } from '../../../testSupport/simulator/types/types'
import { tickToPrice } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'
import { getQuestionEndDate, participateAuction } from '../../../testSupport/simulator/utils/contracts/statoblast'
import { createQuestion } from '../../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { getInfraContractAddresses } from '../../../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveAndDepositRepToVault, manipulatePriceOracle, triggerOwnGameFork, setVaultCapacityFixture } from '../../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { addressString } from '../../../testSupport/simulator/utils/bigint'
import { approveToken, getERC20Balance, getETHBalance } from '../../../testSupport/simulator/utils/utilities'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../../testSupport/simulator/utils/constants'
import { createWriteClient } from '../../../testSupport/simulator/utils/clients'
import { decodeEventLog } from '@zoltar/core-shared/evm/ethereum'
import { approximatelyEqual, ensureDefined, strictEqualTypeSafe } from '../../../testSupport/simulator/utils/testUtils'
import assert from '../../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { useStatoblastTruthAuctionFixture, type StatoblastTruthAuctionFixture } from '../fixture'

describe('Statoblast: truth auction', () => {
	const fixture = useStatoblastTruthAuctionFixture()

	const { repDeposit, genesisUniverse, statoblastSecurityMultiplierBps, outcomes, getYesChildPool } = fixture

	let mockWindow: StatoblastTruthAuctionFixture['mockWindow']

	let client: StatoblastTruthAuctionFixture['client']

	let securityPoolAddresses: StatoblastTruthAuctionFixture['securityPoolAddresses']

	let questionData: StatoblastTruthAuctionFixture['questionData']

	let questionId: StatoblastTruthAuctionFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionData = fixture.questionData
		questionId = fixture.questionId
	})

	describe('auction startup and migration isolation', () => {
		test('startTruthAuction skips auction startup when all REP is already migrated', async () => {
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
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

			const { yesSecurityPool } = getYesChildPool()
			const denominatorBeforeStart = await getTotalRepBackingUnits(client, yesSecurityPool.securityPool)
			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const forkSnapshotLog = initiateForkReceipt.logs
				.filter(log => log.address.toLowerCase() === getInfraContractAddresses().securityPoolForker.toLowerCase())
				.map(log =>
					decodeEventLog({
						abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
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
			const securityPoolUnderwritingLimitAttoEth = 2n * 10n ** 18n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)
			const endTime = await getQuestionEndDate(client, questionId)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			let vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			let vaultAttoRep = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, vault.repBackingUnits)
			const requiredVaultAttoRep = 4n * forkThresholdAttoRep
			if (vaultAttoRep < requiredVaultAttoRep) {
				await approveAndDepositRepToVault(client, requiredVaultAttoRep - vaultAttoRep, questionId)
				vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
				vaultAttoRep = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, vault.repBackingUnits)
			}
			assert.ok(vaultAttoRep >= requiredVaultAttoRep, 'test setup needs pool-held vault REP backing plus dispute-staked REP')
			await mockWindow.setTime(endTime + 10000n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)
			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

			const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			assert.ok(parentForkData.auctionableAttoRepAtFork > ownForkRepBuckets.vaultRepAtForkAttoRep, 'own fork should include dispute-staked REP outside the pool auction basis')
			assert.ok(ownForkRepBuckets.vaultRepAtForkAttoRep > 0n, 'test setup should leave vault REP available to migrate')

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const { yesSecurityPool } = getYesChildPool()
			strictEqualTypeSafe(await getMigratedAttoRep(client, yesSecurityPool.securityPool), ownForkRepBuckets.vaultRepAtForkAttoRep, 'all vault REP should be migrated into the child pool')

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'all migrated vault REP should skip the pool truth auction even when dispute-staked REP forked separately')
			strictEqualTypeSafe(await getTotalRepPurchasedAttoRep(client, yesSecurityPool.truthAuction), 0n, 'the pool auction should not sell escalation-game REP')
		})

		test('forced ETH before child deployment cannot block the no-auction finalization path', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			const { yesUniverse, yesSecurityPool } = getYesChildPool()
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
			await setUnderwritingLimit(client, yesSecurityPool.securityPool, 0n)
			await redeemRepFromVault(client, yesSecurityPool.securityPool, client.account.address)
			approximatelyEqual(await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool), childBalanceBeforeRedeem - clientClaimBeforeFinalize, 10n, 'redeeming after immediate finalization should reduce the child balance only by the redeemed migrated claim')
		})

		test('escalation migration remains redeemable after truth auction finalization', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const winningDeposit = repDeposit / 2n
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6])
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			await setVaultCapacityFixture(passiveRepHolder, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, passiveRepHolder.account.address, repDeposit / 4n)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * 10n ** 18n)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [1n])

			const { yesUniverse, yesSecurityPool } = getYesChildPool()
			const childRepToken = getRepTokenAddress(yesUniverse)
			const childEscalationGame = await client.readContract({ address: yesSecurityPool.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'escalationGame' })
			const bindingCapitalBeforeFinalize = await client.readContract({ address: childEscalationGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'getBindingCapitalAttoRep' })
			const curveElapsedBeforeFinalize = await client.readContract({
				address: childEscalationGame,
				abi: statoblast_EscalationGame_EscalationGame.abi,
				functionName: 'computeTimeSinceStartFromAttritionCostAttoRep',
				args: [bindingCapitalBeforeFinalize],
			})
			assert.ok(curveElapsedBeforeFinalize > 3n * DAY, 'the deadline regression requires more than one minimum response period of pre-haircut curve time')
			const outcomeBalancesBeforeFinalize = await client.readContract({ address: childEscalationGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'getOutcomeBalancesAttoRep' })
			const originalVaultBeforeFinalize = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const escalationClaimBeforeFinalize = originalVaultBeforeFinalize.disputeStakedAttoRep
			const childBalanceBeforeFinalize = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
			const originalClaimBeforeFinalize = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, originalVaultBeforeFinalize.repBackingUnits)
			assert.ok(originalClaimBeforeFinalize > 0n, 'the migrated vault should retain positive pool-held child REP backing before finalization')
			assert.ok(originalClaimBeforeFinalize <= childBalanceBeforeFinalize, "before finalization the migrated owner's REP claim should stay bounded by the child pool's pool-held REP balance")

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const totalPoolHeldRepAtForkAttoRep = ownForkRepBuckets.vaultRepAtForkAttoRep
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2])
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
			assert.ok(originalClaimAfterFinalize <= childBalanceAfterFinalize, "the migrated owner's REP claim should stay bounded by the child pool's remaining REP balance")
			const disputeStakedRepBeforeAuctionAttoRep = await client.readContract({ address: childEscalationGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'truthAuctionRepBeforeAttoRep' })
			const disputeStakedRepRemainingAfterAuctionAttoRep = await client.readContract({ address: childEscalationGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'truthAuctionRepRemainingAttoRep' })
			assert.ok(disputeStakedRepBeforeAuctionAttoRep > 0n, 'the test auction should sell inherited escalation backing')
			assert.ok(disputeStakedRepRemainingAfterAuctionAttoRep < disputeStakedRepBeforeAuctionAttoRep, 'the test auction should apply a nonzero escalation haircut')
			const expectedEscalationClaim = (escalationClaimBeforeFinalize * disputeStakedRepRemainingAfterAuctionAttoRep) / disputeStakedRepBeforeAuctionAttoRep
			strictEqualTypeSafe(originalVaultAfterFinalize.disputeStakedAttoRep, expectedEscalationClaim, 'the truth auction should apply the same proportional REP retention to the escalation claim')
			if (disputeStakedRepBeforeAuctionAttoRep > 0n) {
				const outcomeBalancesAfterFinalize = await client.readContract({ address: childEscalationGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'getOutcomeBalancesAttoRep' })
				for (let outcomeIndex = 0; outcomeIndex < outcomeBalancesAfterFinalize.length; outcomeIndex += 1) {
					strictEqualTypeSafe(
						outcomeBalancesAfterFinalize[outcomeIndex],
						(ensureDefined(outcomeBalancesBeforeFinalize[outcomeIndex], 'missing outcome balance before finalize') * disputeStakedRepRemainingAfterAuctionAttoRep) / disputeStakedRepBeforeAuctionAttoRep,
						'the effective outcome balance should move backward by the auction retention ratio',
					)
				}
				const forkResumedAt = await client.readContract({ address: childEscalationGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'forkResumedAt' })
				const forkElapsedAfterFinalize = await client.readContract({ address: childEscalationGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'forkElapsedAtStart' })
				const bindingCapitalAfterFinalize = await client.readContract({ address: childEscalationGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'getBindingCapitalAttoRep' })
				const requiredElapsedAfterFinalize = await client.readContract({
					address: childEscalationGame,
					abi: statoblast_EscalationGame_EscalationGame.abi,
					functionName: 'computeTimeSinceStartFromAttritionCostAttoRep',
					args: [bindingCapitalAfterFinalize],
				})
				const gameEndDate = await client.readContract({ address: childEscalationGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'getEscalationGameEndDate' })
				assert.ok(forkElapsedAfterFinalize < curveElapsedBeforeFinalize, 'the haircut should move the elapsed curve coordinate backward')
				strictEqualTypeSafe(forkElapsedAfterFinalize, requiredElapsedAfterFinalize, 'the haircut should rebase elapsed time to the weakened binding capital')
				strictEqualTypeSafe(gameEndDate, forkResumedAt + 3n * DAY, 'immediate resume should clamp the recomputed deadline to exactly one fresh minimum response period')
			}

			const childBalanceBeforeRedeem = childBalanceAfterFinalize
			await setUnderwritingLimit(client, yesSecurityPool.securityPool, 0n)
			await redeemRepFromVault(client, yesSecurityPool.securityPool, client.account.address)
			approximatelyEqual(await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool), childBalanceBeforeRedeem - originalClaimAfterFinalize, 10n, 'redeeming the migrated vault should reduce the child balance by the redeemed migrated claim')
		})

		test('multiple migrated holders remain redeemable after truth auction finalization', async () => {
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)

			const endTime = await getQuestionEndDate(client, questionId)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6])
			await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
			await setVaultCapacityFixture(passiveRepHolder, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, passiveRepHolder.account.address, repDeposit / 4n)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)

			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * 10n ** 18n)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

			const { yesUniverse, yesSecurityPool } = getYesChildPool()
			const childRepToken = getRepTokenAddress(yesUniverse)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			const totalPoolHeldRepAtForkAttoRep = ownForkRepBuckets.vaultRepAtForkAttoRep
			const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
			if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
				const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3])
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

			await setUnderwritingLimit(attackerClient, yesSecurityPool.securityPool, 0n)
			await redeemRepFromVault(attackerClient, yesSecurityPool.securityPool, attackerClient.account.address)
			const clientClaimAfterFirstRedeem = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, clientVaultBeforeRedeem.repBackingUnits)
			approximatelyEqual(clientClaimAfterFirstRedeem, clientClaimBeforeRedeem, 10n, 'redeeming one migrated holder should not brick the remaining migrated holder')

			const childBalanceBeforeFinalRedeem = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
			await setUnderwritingLimit(client, yesSecurityPool.securityPool, 0n)
			await redeemRepFromVault(client, yesSecurityPool.securityPool, client.account.address)
			assert.ok((await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)) <= childBalanceBeforeFinalRedeem, 'redeeming the remaining migrated holder should not increase the child REP balance')
			assert.ok(totalAttoRepPurchased >= 0n, 'auction accounting should remain readable after both migrated holders redeem')
		})
	})
})
