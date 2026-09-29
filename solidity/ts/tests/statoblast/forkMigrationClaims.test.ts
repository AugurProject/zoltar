import { decodeEventLog } from '@zoltar/core-shared/evm/ethereum'
import { beforeEach, describe, test } from 'bun:test'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import assert from '../../testSupport/simulator/utils/assert'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { createWriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { getInfraContractAddresses, getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { depositRepToVault, depositToEscalationGame, getRepToken, getSecurityPoolsEscalationGame, getSecurityVault, getSettlementCollateralAttoEth, getSystemState, withdrawFromEscalationGame } from '../../testSupport/simulator/utils/contracts/securityPool'
import { claimForkedEscalationDeposits, createChildUniverse, forkZoltarWithOwnEscalationGame, getMigratedAttoRep, getSecurityPoolForkerForkData, initiateSecurityPoolFork, migrateRepToZoltar, migrateVault, startTruthAuction } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { getQuestionEndDate } from '../../testSupport/simulator/utils/contracts/statoblast'
import { approveAndDepositRepToVault, manipulatePriceOracle, setVaultCapacityFixture, triggerOwnGameFork } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { forkUniverse, getRepTokenAddress, getTotalTheoreticalSupply, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { approveToken, getChildUniverseId, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { statoblast_EscalationGame_EscalationGame, statoblast_SecurityPoolForker_SecurityPoolForker } from '../../types/contractArtifact'
import { useStatoblastForkMigrationFixture, type StatoblastForkMigrationFixture } from './fixture'

describe('Statoblast: fork migration', () => {
	const fixture = useStatoblastForkMigrationFixture()

	const { formatStorageSlot, getMappingStorageSlot, reportBond, repDeposit, genesisUniverse, statoblastSecurityMultiplierBps, outcomes } = fixture

	let mockWindow: StatoblastForkMigrationFixture['mockWindow']

	let client: StatoblastForkMigrationFixture['client']

	let securityPoolAddresses: StatoblastForkMigrationFixture['securityPoolAddresses']

	let questionData: StatoblastForkMigrationFixture['questionData']

	let questionId: StatoblastForkMigrationFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionData = fixture.questionData
		questionId = fixture.questionId
	})

	describe('own-fork escalation claims', () => {
		test('own-fork closes parent escalation withdrawals and preserves escrowed REP', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 4n * forkThresholdAttoRep)
			await mockWindow.setTime(endTime + 10000n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			const originalWinningDeposit = reportBond + 1n
			const originalLosingDeposit = reportBond
			const triggerWinningDeposit = forkThresholdAttoRep - originalWinningDeposit
			const triggerLosingDeposit = forkThresholdAttoRep - originalLosingDeposit

			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, originalWinningDeposit)
			await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, originalLosingDeposit)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, triggerWinningDeposit)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, triggerLosingDeposit)

			const clientVaultBeforeFork = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const attackerVaultBeforeFork = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)

			await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
			const clientVaultAfterFork = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const attackerVaultAfterFork = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)

			await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n]), /Pool inactive/)
			await assert.rejects(withdrawFromEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, [0n]), /Pool inactive/)

			const clientVaultAfterFailedWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const attackerVaultAfterFailedWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)

			strictEqualTypeSafe(clientVaultAfterFork.disputeStakedAttoRep, clientVaultBeforeFork.disputeStakedAttoRep, 'the own-fork transition should preserve the fully locked winning-side parent REP before any claim or migration succeeds')
			strictEqualTypeSafe(attackerVaultAfterFork.disputeStakedAttoRep, attackerVaultBeforeFork.disputeStakedAttoRep, 'the losing-side vault lock should stay in the parent through the own-fork transition')
			strictEqualTypeSafe(clientVaultAfterFailedWithdrawal.disputeStakedAttoRep, clientVaultAfterFork.disputeStakedAttoRep, 'a blocked parent withdrawal should not release any winning-side REP after the own-fork closes the pool')
			strictEqualTypeSafe(attackerVaultAfterFailedWithdrawal.disputeStakedAttoRep, attackerVaultAfterFork.disputeStakedAttoRep, 'a blocked parent withdrawal should not release any losing-side REP after the own-fork closes the pool')
		})

		test('claimForkedEscalationDeposits rejects unresolved deposits after an unrelated external fork', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, repDeposit / 10n)

			const forkSourceQuestionData = {
				...questionData,
				title: 'external fork source question for unresolved escalation migration',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
			await createQuestion(client, forkSourceQuestionData, outcomes)
			await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, forkSourceQuestionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

			await assert.rejects(claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]))
		})

		test('claimForkedEscalationDeposits pays own-fork child REP to the wallet without REP backing units', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const winningDeposit = repDeposit / 2n
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(attackerClient, repDeposit * 2n, questionId)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, client.account.address, securityPoolUnderwritingLimitAttoEth)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, winningDeposit)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const migratedBeforeEscalation = await getMigratedAttoRep(client, yesSecurityPool.securityPool)
			const parentVaultBeforeMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const yesChildRepToken = getRepTokenAddress(yesUniverse)
			const walletRepBeforeEscalation = await getERC20Balance(client, yesChildRepToken, client.account.address)
			const childCollateralBeforeEscalation = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const parentEscalationGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)

			const claimHash = await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n, 1n])

			const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const childVaultAfterMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const walletRepAfterEscalation = await getERC20Balance(client, yesChildRepToken, client.account.address)
			const migratedAfterEscalation = await getMigratedAttoRep(client, yesSecurityPool.securityPool)
			const childCollateralAfterEscalation = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const claimReceipt = await client.getTransactionReceipt({ hash: claimHash })
			const claimLog = claimReceipt.logs
				.filter(log => log.address.toLowerCase() === getInfraContractAddresses().securityPoolForker.toLowerCase())
				.map(log =>
					decodeEventLog({
						abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
						data: log.data,
						topics: log.topics,
					}),
				)
				.find(log => log.eventName === 'ClaimForkedEscalationDepositsToWallet')
			if (claimLog === undefined) throw new Error('ClaimForkedEscalationDepositsToWallet log missing')
			const parentGameClaimLogs = claimReceipt.logs
				.filter(log => log.address.toLowerCase() === parentEscalationGame.toLowerCase())
				.map(log =>
					decodeEventLog({
						abi: statoblast_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					}),
				)
				.filter(log => log.eventName === 'ClaimDeposit')
			const sourceRepClaimedFromGame = parentGameClaimLogs.reduce((total, log) => total + log.args.amountToWithdrawAttoRep, 0n)

			strictEqualTypeSafe(migratedAfterEscalation, migratedBeforeEscalation, 'own-fork escalation claim should not increase child pool migrated REP accounting')
			strictEqualTypeSafe(parentVaultBeforeMigration.disputeStakedAttoRep - parentVaultAfterMigration.disputeStakedAttoRep, 2n * winningDeposit, 'migration should clear exactly the winning deposits principal from the parent escalation escrow')
			strictEqualTypeSafe(childCollateralAfterEscalation, childCollateralBeforeEscalation, 'own-fork escalation claim should not transfer pool collateral')
			strictEqualTypeSafe(childVaultAfterMigration.repBackingUnits, 0n, 'own-fork escalation claim should not mint child REP backing units')
			assert.ok(walletRepAfterEscalation > walletRepBeforeEscalation, 'own-fork escalation claim should pay child REP directly to the wallet')
			strictEqualTypeSafe(parentGameClaimLogs.length, 2, 'own-fork wallet claim should emit one parent-game claim log per source deposit')
			assert.deepStrictEqual(
				parentGameClaimLogs.map(log => log.args.depositor.toLowerCase()),
				[client.account.address.toLowerCase(), client.account.address.toLowerCase()],
				'parent-game claim logs should identify the source vault',
			)
			assert.deepStrictEqual(
				parentGameClaimLogs.map(log => log.args.outcome),
				[BigInt(QuestionOutcome.Yes), BigInt(QuestionOutcome.Yes)],
				'parent-game claim logs should identify the claimed outcome',
			)
			assert.deepStrictEqual(
				parentGameClaimLogs.map(log => log.args.parentDepositIndex),
				[0n, 1n],
				'parent-game claim logs should identify each source deposit index',
			)
			assert.deepStrictEqual(
				parentGameClaimLogs.map(log => log.args.originalDepositAmountAttoRep),
				[winningDeposit, winningDeposit],
				'parent-game claim logs should include each source principal',
			)
			assert.ok(
				parentGameClaimLogs.every(log => log.args.transferredRep === false),
				'own-fork source claims should leave parent REP in the game',
			)
			strictEqualTypeSafe(claimLog.args.parent.toLowerCase(), securityPoolAddresses.securityPool.toLowerCase(), 'claim log should identify the parent pool')
			strictEqualTypeSafe(claimLog.args.vault.toLowerCase(), client.account.address.toLowerCase(), 'claim log should identify the paid vault')
			strictEqualTypeSafe(claimLog.args.outcomeIndex, BigInt(QuestionOutcome.Yes), 'claim log should identify the winning outcome')
			assert.deepStrictEqual([...claimLog.args.depositIndexes], [0n, 1n], 'claim log should identify the claimed deposit indexes')
			strictEqualTypeSafe(claimLog.args.sourceRepClaimedAttoRep, sourceRepClaimedFromGame, 'claim log should report the source REP claimed from the parent game')
			strictEqualTypeSafe(claimLog.args.walletRepPaidAttoRep, walletRepAfterEscalation - walletRepBeforeEscalation, 'claim log should report the child REP paid to the wallet')
			strictEqualTypeSafe(claimLog.args.ownFork, true, 'claim log should mark own-fork wallet payouts')
		})

		test('claimForkedEscalationDeposits uses the claim outcome when paying own-fork wallet REP', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const winningDeposit = repDeposit * 5n
			await approveAndDepositRepToVault(client, repDeposit * 10n, questionId)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await mockWindow.setTime(endTime + 10000n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const parentForkDataSlot = getMappingStorageSlot(securityPoolAddresses.securityPool, 0n)
			const parentOutcomeIndexSlot = formatStorageSlot(parentForkDataSlot + 15n)
			await mockWindow.addStateOverrides({
				[getInfraContractAddresses().securityPoolForker]: {
					stateDiff: {
						[parentOutcomeIndexSlot]: BigInt(QuestionOutcome.No),
					},
				},
			})

			const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			strictEqualTypeSafe(parentForkData.outcomeIndex, BigInt(QuestionOutcome.No), 'storage override should poison the parent fork outcome bucket for the regression')

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const walletRepBeforeClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n, 1n])

			const walletRepAfterClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
			assert.ok(walletRepAfterClaim > walletRepBeforeClaim, 'own-fork wallet payout should follow the claim outcome even when the parent bucket is poisoned')
		})

		test('claimForkedEscalationDeposits rejects after the own-fork migration window closes', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const winningDeposit = repDeposit / 8n
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await mockWindow.setTime(endTime + 10000n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, winningDeposit)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const claimDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(claimDeadline + 1n)

			await assert.rejects(claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]), /execution reverted|Reverted without a reason/i)
		})

		test('claimForkedEscalationDeposits allows the exact own-fork migration deadline', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const winningDeposit = repDeposit / 8n
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await mockWindow.setTime(endTime + 10000n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, winningDeposit)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			const claimDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(claimDeadline - 1n)
			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const walletRepBeforeClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)

			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

			const walletRepAfterClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
			assert.ok(walletRepAfterClaim > walletRepBeforeClaim, 'claiming at the inclusive deadline should still pay child REP')
		})

		test('claimForkedEscalationDeposits rejects once the child branch is already priced', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const winningDeposit = repDeposit / 8n
			const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(attackerClient, repDeposit, questionId)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await mockWindow.setTime(endTime + 10000n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)

			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child pool should be operational before late claim settlement')

			await assert.rejects(claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]))
		})
	})
})
