import { decodeEventLog } from '@zoltar/core-shared/evm/ethereum'
import { getEthRaiseCapAttoEth } from '../../testSupport/simulator/utils/contracts/auction'
import { formatStorageSlot, getAddressMappingStorageSlot } from '../../testSupport/storage'
import { beforeEach, describe, test } from 'bun:test'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import assert from '../../testSupport/simulator/utils/assert'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { getInfraContractAddresses, getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getQuestionResolution } from '../../testSupport/simulator/utils/contracts/escalationGame'
import {
	backingUnitsToAttoRep,
	createCompleteSet,
	depositRepToVault,
	depositToEscalationGame,
	getAwaitingForkContinuation,
	getRepToken,
	getSecurityPoolsEscalationGame,
	getSecurityVault,
	getSettlementCollateralAttoEth,
	getShareTokenSupplyAttoShares,
	getSystemState,
	getTotalAccruedFees,
	getTotalClaimableVaultFeesAttoEth,
	getTotalRepBackingUnits,
	getTotalUnderwritingLimitAttoEth,
	redeemCompleteSet,
	redeemFees,
	redeemShares,
	updateSettlementCollateral,
	updateVaultFees,
} from '../../testSupport/simulator/utils/contracts/securityPool'
import {
	claimAuctionProceeds,
	claimForkedEscalationDeposits,
	createChildUniverse,
	finalizeTruthAuction,
	forkZoltarWithOwnEscalationGame,
	getForkActivationTime,
	getMigratedAttoRep,
	getOwnForkRepBuckets,
	getQuestionOutcome,
	getSecurityPoolForkerForkData,
	initiateSecurityPoolFork,
	migrateRepToZoltar,
	migrateVault,
	migrateVaultWithUnresolvedEscalation,
	startTruthAuction,
} from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { balanceOfShares, getLastPrice, getQuestionEndDate, migrateShares, participateAuction } from '../../testSupport/simulator/utils/contracts/statoblast'
import { approveAndDepositRepToVault, manipulatePriceOracle, setVaultCapacityFixture, triggerOwnGameFork } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { addRepToMigrationBalance, forkUniverse, getMigrationRepBalanceAttoRep, getRepTokenAddress, getTotalTheoreticalSupply, getUniverseData, getZoltarAddress, getZoltarForkThreshold, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { approximatelyEqual, ensureDefined, strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { approveToken, contractExists, getChildUniverseId, getERC20Balance, getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { ReputationToken_ReputationToken, statoblast_EscalationGame_EscalationGame, statoblast_SecurityPool_SecurityPool, statoblast_SecurityPoolForker_SecurityPoolForker } from '../../types/contractArtifact'
import { createCarryProof, SparseNullifierTree } from '../carryProofHelpers'
import { useStatoblastForkMigrationFixture, type StatoblastForkMigrationFixture } from './fixture'

describe('Statoblast: fork migration', () => {
	const fixture = useStatoblastForkMigrationFixture()

	const { reportBond, PRICE_PRECISION, repDeposit, genesisUniverse, statoblastSecurityMultiplierBps, outcomes, transferRepToAddress, triggerExternalForkForSecurityPool, getYesChildPool, forkOwnGameAfterQuestionEnd } = fixture

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

	const getMigrationProxyAddress = async () =>
		await client.readContract({
			abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getMigrationProxyAddress',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddresses.securityPool],
		})

	const assertVaultMigrationPreservesParentFees = async (vaultClient: StatoblastForkMigrationFixture['client'], migrate: () => Promise<void>) => {
		const beforeMigrationSnapshot = await mockWindow.anvilSnapshot()
		await updateVaultFees(vaultClient, securityPoolAddresses.securityPool, vaultClient.account.address)
		const expectedParentFees = (await getSecurityVault(vaultClient, securityPoolAddresses.securityPool, vaultClient.account.address)).claimableFeesAttoEth
		assert.ok(expectedParentFees > 0n, 'test setup should leave whole-attoETH parent fees ready to assign at migration')
		await mockWindow.anvilRevert(beforeMigrationSnapshot)

		await migrate()

		const parentVaultAfterMigration = await getSecurityVault(vaultClient, securityPoolAddresses.securityPool, vaultClient.account.address)
		strictEqualTypeSafe(parentVaultAfterMigration.underwritingLimitAttoEth, 0n, 'capacity ownership')
		strictEqualTypeSafe(parentVaultAfterMigration.claimableFeesAttoEth, expectedParentFees, 'capacity ownership')
		assert.ok((await getTotalClaimableVaultFeesAttoEth(client, securityPoolAddresses.securityPool)) >= expectedParentFees, 'parent aggregate claimable fees should include the migrated vaults redeemable fees alongside other capacity owners')
		const parentBalanceAfterMigration = await getETHBalance(vaultClient, securityPoolAddresses.securityPool)
		assert.ok(parentBalanceAfterMigration >= expectedParentFees, `parent must retain enough ETH for checkpointed fees: balance ${parentBalanceAfterMigration}, fees ${expectedParentFees}`)

		const balanceBeforeRedemption = await getETHBalance(vaultClient, vaultClient.account.address)
		await redeemFees(vaultClient, securityPoolAddresses.securityPool, vaultClient.account.address)
		strictEqualTypeSafe((await getETHBalance(vaultClient, vaultClient.account.address)) - balanceBeforeRedemption, expectedParentFees, 'migrated vault should redeem its checkpointed parent fees')
	}

	describe('vault and REP migration', () => {
		test.each([
			{
				fork: 'own-fork',
				forkPool: async () => {
					const endTime = await getQuestionEndDate(client, questionId)
					const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
					await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
					if ((await mockWindow.getTime()) <= endTime) await mockWindow.setTime(endTime + 1n)
					await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)
					await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
					await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
				},
			},
			{ fork: 'external-fork', forkPool: async () => await triggerExternalForkForSecurityPool(undefined, 'external parent fee checkpoint source') },
		])('$fork vault migration preserves checkpointed parent fees', async ({ forkPool }) => {
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			const migratingVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(migratingVaultClient, repDeposit, questionId)
			await setVaultCapacityFixture(migratingVaultClient, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, migratingVaultClient.account.address, securityPoolUnderwritingLimitAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 10n * 10n ** 18n)
			await mockWindow.advanceTime(30n * DAY)
			await forkPool()

			await assertVaultMigrationPreservesParentFees(migratingVaultClient, async () => {
				await migrateVault(migratingVaultClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			})
		})

		test('createChildUniverse allows the exact external-fork migration deadline and rejects one second later', async () => {
			await triggerExternalForkForSecurityPool(undefined, 'external child creation deadline source')
			const migrationDeadline = (await getForkActivationTime(client, securityPoolAddresses.securityPool)) + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesUniverse, yesSecurityPool } = getYesChildPool()
			strictEqualTypeSafe(await getRepToken(client, yesSecurityPool.securityPool), getRepTokenAddress(yesUniverse), 'createChildUniverse should still deploy the requested child branch at the inclusive external-fork deadline')

			await mockWindow.setTime(migrationDeadline + 1n)
			await assert.rejects(createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.No), /Migration closed/)
		})

		test('createChildUniverse allows the exact own-fork migration deadline and rejects one second later', async () => {
			await forkOwnGameAfterQuestionEnd()
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			const migrationDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesUniverse, yesSecurityPool } = getYesChildPool()
			strictEqualTypeSafe(await getRepToken(client, yesSecurityPool.securityPool), getRepTokenAddress(yesUniverse), 'createChildUniverse should still deploy the requested own-fork child branch at the inclusive migration deadline')

			// Child creation mines at the inclusive deadline; the next transaction is one second later.
			await assert.rejects(createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.No), /Migration closed/)
		})

		test('migrateShares remains available for an existing child after the migration deadline', async () => {
			const openInterestAmount = 5n * 10n ** 18n
			const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, repDeposit / 4n)
			await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
			await triggerExternalForkForSecurityPool(undefined, 'share migration deadline source')
			const migrationDeadline = (await getForkActivationTime(client, securityPoolAddresses.securityPool)) + 8n * 7n * DAY

			await mockWindow.setTime(migrationDeadline - 1n)
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])

			const migratedYesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const migratedYesBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, migratedYesUniverse, openInterestHolder.account.address)
			assert.ok(ensureDefined(migratedYesBalances[1], 'migrated yes balance missing') > 0n, 'share migration should still succeed at the inclusive deadline')

			await mockWindow.setTime(migrationDeadline + 1n)

			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [QuestionOutcome.Yes])
			const lateMigratedBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, migratedYesUniverse, openInterestHolder.account.address)
			strictEqualTypeSafe(ensureDefined(lateMigratedBalances[2], 'late migrated no balance missing'), openInterestAmount, 'unredeemed source shares should materialize in an existing child after the fork deadline')
		})

		test('migrateRepToZoltar should fund an already-created child pool with pool-held vault REP backing in own-fork mode', async () => {
			await forkOwnGameAfterQuestionEnd()
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesUniverse, yesSecurityPool } = getYesChildPool()
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			const poolHeldVaultRepBackingAtForkAttoRep = ownForkRepBuckets.vaultRepAtForkAttoRep

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const childRepToken = getRepTokenAddress(yesUniverse)
			const forkerBalance = await getERC20Balance(client, childRepToken, getInfraContractAddresses().securityPoolForker)
			const childPoolBalance = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)

			strictEqualTypeSafe(forkerBalance, 0n, 'forker should not retain child REP after migrating to an already-created child pool')
			strictEqualTypeSafe(childPoolBalance, poolHeldVaultRepBackingAtForkAttoRep, 'child pool should receive only the pool-held vault REP backing in own-fork mode')
		})

		test('migrateRepToZoltar rejects after the migration window closes', async () => {
			await forkOwnGameAfterQuestionEnd()
			const migrationDeadline = (await mockWindow.getTime()) + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline + 1n)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps).securityPool
			const migrationProxy = await getMigrationProxyAddress()
			const readClosedMigrationState = async () => ({
				childExists: await contractExists(client, yesChildPool),
				migrationBalance: await getMigrationRepBalanceAttoRep(client, genesisUniverse, migrationProxy),
				parentForkData: await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool),
				parentRep: await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool),
			})
			const stateBefore = await readClosedMigrationState()

			await assert.rejects(migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes]), /Closed/)
			assert.deepStrictEqual(await readClosedMigrationState(), stateBefore, 'closed migration must preserve the parent fork, proxy migration balance, REP, and child nondeployment')
		})

		test('migrateRepToZoltar allows the exact own-fork migration deadline', async () => {
			await forkOwnGameAfterQuestionEnd()
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			const migrationDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const { yesUniverse, yesSecurityPool } = getYesChildPool()
			const childRepToken = getRepTokenAddress(yesUniverse)
			const poolBalance = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
			assert.ok(poolBalance > 0n, 'migrateRepToZoltar should still split child REP at the inclusive migration deadline')
		})

		test('migrateRepToZoltar rejects once the child branch is already priced', async () => {
			await forkOwnGameAfterQuestionEnd()
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const { yesSecurityPool } = getYesChildPool()
			await mockWindow.setTime((await mockWindow.getTime()) + 60n * DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)

			await assert.rejects(migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes]), /Child closed/)
		})

		test('migrateVault preserves parent escalation claim state', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			const winningDeposit = repDeposit / 2n
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
			const parentCapacityOwnershipBeforeFork = (await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).underwritingLimitAttoEth

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const { yesSecurityPool } = getYesChildPool()

			await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n, 1n])
			const vaultAfterEscalationClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			strictEqualTypeSafe(vaultAfterEscalationClaim.repBackingUnits, 0n, 'own-fork escalation claims should not mint child backingUnits')
			strictEqualTypeSafe(vaultAfterEscalationClaim.underwritingLimitAttoEth, 0n, 'claiming own-fork escalation should not migrate the parent capacity ownership')

			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const vaultAfterVaultMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

			assert.ok(vaultAfterVaultMigration.repBackingUnits > 0n, 'migrateVault should populate child backingUnits from the unlocked parent vault state')
			strictEqualTypeSafe(vaultAfterVaultMigration.underwritingLimitAttoEth, parentCapacityOwnershipBeforeFork, 'migrateVault should preserve the complete parent capacity ownership')
		})

		test('migrateVault allows the exact own-fork migration deadline', async () => {
			await forkOwnGameAfterQuestionEnd()
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			const migrationDeadline = forkTime + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()
			const childVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

			assert.ok(childVault.repBackingUnits > 0n, 'migrateVault should still migrate backingUnits at the inclusive deadline')
		})

		test('migrateVault allows the exact external-fork migration deadline and rejects one second later', async () => {
			const parentVaultBeforeFork = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			assert.ok(parentVaultBeforeFork.repBackingUnits > 0n, 'test setup should leave parent-vault REP backing units before the external fork')
			await triggerExternalForkForSecurityPool(undefined, 'external vault migration deadline source')

			const migrationDeadline = (await getForkActivationTime(client, securityPoolAddresses.securityPool)) + 8n * 7n * DAY
			await mockWindow.setTime(migrationDeadline - 1n)
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()
			const childVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			assert.ok(childVault.repBackingUnits > 0n, 'migrateVault should still move non-escrowed vault REP backing units at the inclusive external-fork deadline')

			await mockWindow.setTime(migrationDeadline + 1n)
			await assert.rejects(migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes), /migration window closed/i)
		})

		test('migrateVault cumulatively transfers external-fork collateral for multiple vaults', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const migratingVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(migratingVaultClient, repDeposit, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			await setVaultCapacityFixture(migratingVaultClient, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, migratingVaultClient.account.address, securityPoolUnderwritingLimitAttoEth)
			const settlementCollateralAttoEth = 1n * 10n ** 18n
			await createCompleteSet(client, securityPoolAddresses.securityPool, settlementCollateralAttoEth)

			const forkSourceData = {
				...questionData,
				title: 'non-own fork collateral source',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceData, outcomes)
			await createQuestion(migratingVaultClient, forkSourceData, outcomes)
			await mockWindow.setTime(forkSourceData.endTime + 1n)
			await approveToken(migratingVaultClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(migratingVaultClient, genesisUniverse, forkSourceQuestionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			assert.strictEqual(forkData.ownFork, false, 'this should be a non-own fork')

			const parentSettlementCollateralAtForkAttoEth = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const { yesSecurityPool } = getYesChildPool()
			const migrationSnapshot = await mockWindow.anvilSnapshot()
			const runMigrationOrder = async (firstVaultClient: typeof client, secondVaultClient: typeof client) => {
				const parentEthBefore = await getETHBalance(client, securityPoolAddresses.securityPool)
				const childEthBefore = await getETHBalance(client, yesSecurityPool.securityPool)
				await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
				await migrateVault(firstVaultClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
				const firstTransfer = (await getETHBalance(client, yesSecurityPool.securityPool)) - childEthBefore
				assert.ok(firstTransfer > 0n && firstTransfer < parentSettlementCollateralAtForkAttoEth, 'first of two external-fork vaults should transfer a strict collateral fraction')
				const secondMigrationHash = await migrateVault(secondVaultClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
				const secondMigrationReceipt = await client.getTransactionReceipt({ hash: secondMigrationHash })
				const migrationCheckpointLog = secondMigrationReceipt.logs
					.filter(log => log.address.toLowerCase() === getInfraContractAddresses().securityPoolForker.toLowerCase())
					.map(log =>
						decodeEventLog({
							abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
							data: log.data,
							topics: log.topics,
						}),
					)
					.find(log => log.eventName === 'VaultMigrationCheckpoint')
				if (migrationCheckpointLog === undefined) throw new Error('external VaultMigrationCheckpoint log missing')
				return {
					childTransfer: (await getETHBalance(client, yesSecurityPool.securityPool)) - childEthBefore,
					eventCollateralTransferred: migrationCheckpointLog.args.cumulativeSettlementCollateralTransferredAttoEth,
					parentSettlementCollateralAttoEth: await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool),
					parentTransfer: parentEthBefore - (await getETHBalance(client, securityPoolAddresses.securityPool)),
				}
			}

			const forwardOrder = await runMigrationOrder(client, migratingVaultClient)
			await mockWindow.anvilRevert(migrationSnapshot)
			const reverseOrder = await runMigrationOrder(migratingVaultClient, client)
			for (const result of [forwardOrder, reverseOrder]) {
				strictEqualTypeSafe(result.parentTransfer, parentSettlementCollateralAtForkAttoEth, 'migrating all external-fork vault REP should transfer the complete fork collateral snapshot')
				strictEqualTypeSafe(result.childTransfer, parentSettlementCollateralAtForkAttoEth, 'cumulative external-fork transfers should fund the child with the complete snapshot in either order')
				strictEqualTypeSafe(result.eventCollateralTransferred, parentSettlementCollateralAtForkAttoEth, 'the fork-neutral transfer event should report the complete external-fork cumulative collateral')
				strictEqualTypeSafe(result.parentSettlementCollateralAttoEth, 0n, 'complete external-fork migration should leave no parent collateral')
			}
		})

		test('external-fork truth auction repairs the snapshot collateral missing after partial vault migration', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const unmigratedVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(unmigratedVaultClient, repDeposit, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
			await mockWindow.advanceTime(10n * 60n)
			await setVaultCapacityFixture(unmigratedVaultClient, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, unmigratedVaultClient.account.address, securityPoolUnderwritingLimitAttoEth)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)

			const forkSourceData = {
				...questionData,
				title: 'external partial migration auction source',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceData, outcomes)
			await createQuestion(unmigratedVaultClient, forkSourceData, outcomes)
			await mockWindow.setTime(forkSourceData.endTime + 1n)
			await approveToken(unmigratedVaultClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(unmigratedVaultClient, genesisUniverse, forkSourceQuestionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

			const parentSettlementCollateralAtForkAttoEth = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const { yesSecurityPool } = getYesChildPool()
			const migratedCollateral = await getETHBalance(client, yesSecurityPool.securityPool)
			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const expectedAuctionCollateral = parentSettlementCollateralAtForkAttoEth - migratedCollateral

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'partial external migration should require a truth auction')
			strictEqualTypeSafe(await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction), expectedAuctionCollateral, 'truth auction should price the missing share from the fixed fork collateral snapshot')
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, forkData.auctionableAttoRepAtFork / 2n, expectedAuctionCollateral)
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)

			const repairedCollateral = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
			const tickRoundingTolerance = expectedAuctionCollateral / 10_000n
			approximatelyEqual(repairedCollateral, migratedCollateral + expectedAuctionCollateral, tickRoundingTolerance, 'auction proceeds should add the missing snapshot collateral up to bounded tick-price rounding')
			approximatelyEqual(repairedCollateral, parentSettlementCollateralAtForkAttoEth, tickRoundingTolerance, 'partial migration plus truth auction should reconstruct the fork collateral snapshot up to bounded tick-price rounding')
		})

		test('inherited financial installation rejects unfunded collateral and preserves accrued fees', async () => {
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, repDeposit / 4n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, PRICE_PRECISION)
			await mockWindow.advanceTime(DAY)
			await updateSettlementCollateral(client, securityPoolAddresses.securityPool)
			const collateral = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const fees = await getTotalAccruedFees(client, securityPoolAddresses.securityPool)
			const balance = await getETHBalance(client, securityPoolAddresses.securityPool)
			const capacity = await getTotalUnderwritingLimitAttoEth(client, securityPoolAddresses.securityPool)
			assert.ok(fees > 0n, 'the fixture must reserve accrued fee liabilities')
			const install = (sender: typeof client, amount: bigint) => writeContractAndWait(sender, () => sender.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddresses.securityPool, functionName: 'setPoolFinancials', args: [amount, capacity, capacity, 0n] }))
			await assert.rejects(install(client, collateral), /Only forker/)
			const forkerAddress = getInfraContractAddresses().securityPoolForker
			await mockWindow.impersonateAccount(forkerAddress)
			await mockWindow.setBalance(forkerAddress, PRICE_PRECISION)
			const forkerClient = createWriteClient(mockWindow, BigInt(forkerAddress))
			await assert.rejects(install(forkerClient, balance + 1n), /Collateral unfunded/)
			await assert.rejects(install(forkerClient, balance), /Collateral unfunded/, 'accrued fees cannot fund inherited collateral')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), collateral)
			strictEqualTypeSafe(await getTotalAccruedFees(client, securityPoolAddresses.securityPool), fees)
			strictEqualTypeSafe(await getTotalUnderwritingLimitAttoEth(client, securityPoolAddresses.securityPool), capacity)
		})

		for (const scenario of ['full', 'partial-purchased', 'partial-empty', 'fixed'] as const) {
			test(`an inactive child finalizes over-capacity collateral and permits exit: ${scenario}`, async () => {
				const otherVault = createWriteClient(mockWindow, TEST_ADDRESSES[1])
				await approveAndDepositRepToVault(otherVault, repDeposit, questionId)
				await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, repDeposit / 4n)
				await setVaultCapacityFixture(otherVault, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, otherVault.account.address, repDeposit / 4n)
				await createCompleteSet(client, securityPoolAddresses.securityPool, PRICE_PRECISION)
				const shares = await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool)
				const capacity = await getTotalUnderwritingLimitAttoEth(client, securityPoolAddresses.securityPool)
				if (scenario === 'fixed') {
					await mockWindow.setTime((await getQuestionEndDate(client, questionId)) + 1n)
					await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
					await forkUniverse(client, genesisUniverse, questionId)
					await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
				} else {
					await triggerExternalForkForSecurityPool(undefined, `over-capacity finalization ${scenario}`)
				}
				await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
				if (scenario === 'full' || scenario === 'fixed') await migrateVault(otherVault, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
				const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
				const child = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
				const migratedCollateral = await getETHBalance(client, child.securityPool)
				await mockWindow.advanceTime(8n * 7n * DAY + DAY)
				if (scenario === 'partial-purchased' || scenario === 'partial-empty') {
					await startTruthAuction(client, child.securityPool)
					strictEqualTypeSafe(await getSystemState(client, child.securityPool), SystemState.ForkTruthAuction)
					if (scenario === 'partial-purchased') {
						const parentData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
						await participateAuction(otherVault, child.truthAuction, parentData.auctionableAttoRepAtFork / 2n, await getEthRaiseCapAttoEth(client, child.truthAuction))
					}
					await mockWindow.advanceTime(7n * DAY + DAY)
				}
				// Use an accepted OpenOracle report on the inactive child, funded with
				// normally split REP. No oracle storage or callback impersonation.
				await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
				await addRepToMigrationBalance(client, genesisUniverse, repDeposit * 3n)
				await splitMigrationRep(client, genesisUniverse, repDeposit * 3n, [QuestionOutcome.Yes])
				await manipulatePriceOracle(client, mockWindow, child.openOraclePriceCoordinator, repDeposit * 2n)
				const acceptedPrice = await getLastPrice(client, child.openOraclePriceCoordinator)
				assert.ok((capacity * PRICE_PRECISION) / (acceptedPrice * 2n) < migratedCollateral, 'the live price must put inherited collateral over capacity')
				await assert.rejects(redeemCompleteSet(client, child.securityPool, shares), /Pool inactive/)
				if (scenario === 'full' || scenario === 'fixed') await startTruthAuction(client, child.securityPool)
				else await finalizeTruthAuction(client, child.securityPool)
				strictEqualTypeSafe(await getSystemState(client, child.securityPool), SystemState.Operational)
				strictEqualTypeSafe(await getTotalUnderwritingLimitAttoEth(client, child.securityPool), capacity, 'finalization must not fabricate capacity')
				strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, child.securityPool), shares, 'all inherited share entitlements must remain reserved')
				const collateral = await getSettlementCollateralAttoEth(client, child.securityPool)
				strictEqualTypeSafe(collateral + (await getTotalAccruedFees(client, child.securityPool)), await getETHBalance(client, child.securityPool), 'installed collateral and fees must match actual funding')
				if (scenario === 'partial-empty') strictEqualTypeSafe(collateral, migratedCollateral, 'an empty auction must preserve all received ETH')
				let mintRejection = /Pool backing insufficient/
				if (scenario === 'fixed') mintRejection = /Settlement unavailable/
				await assert.rejects(createCompleteSet(client, child.securityPool, 1n), mintRejection)
				for (const outcome of [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]) await migrateShares(client, securityPoolAddresses.shareToken, genesisUniverse, outcome, [QuestionOutcome.Yes])
				if (scenario === 'fixed') await redeemShares(client, child.securityPool)
				else await redeemCompleteSet(client, child.securityPool, shares)
				strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, child.securityPool), 0n)
				strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, child.securityPool), 0n, 'holders must exit without waiting for market-price recovery')
				strictEqualTypeSafe(await getLastPrice(client, child.openOraclePriceCoordinator), acceptedPrice)
			})
		}

		test('directly forking the pool question preserves child branch semantics', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, questionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			assert.strictEqual(forkData.ownFork, false, 'direct Zoltar fork should not use own-fork accounting')

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const { yesSecurityPool } = getYesChildPool()

			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'matching-question child should resolve to its branch outcome')
		})

		test('nested universe fork rejects a child pool that is still in fork migration with Inactive', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			const firstForkQuestion = {
				...questionData,
				title: 'outer fork while child remains in migration',
			}
			const firstForkQuestionId = getQuestionId(firstForkQuestion, outcomes)
			await createQuestion(client, firstForkQuestion, outcomes)
			const migrationAmount = (await getZoltarForkThreshold(client, genesisUniverse)) * 2n
			const repDonor = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await transferRepToAddress(repDonor, client.account.address, migrationAmount)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, firstForkQuestionId)

			await addRepToMigrationBalance(client, genesisUniverse, migrationAmount)
			await splitMigrationRep(client, genesisUniverse, migrationAmount, [QuestionOutcome.Yes])
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
			strictEqualTypeSafe(await getSystemState(client, yesChildPool.securityPool), SystemState.ForkMigration, 'nested-fork target child must remain in ForkMigration')
			const childRepToken = getRepTokenAddress(yesUniverse)
			const secondForkQuestion = {
				...questionData,
				title: 'inner fork against inactive child pool',
				endTime: await mockWindow.getTime(),
			}
			const secondForkQuestionId = getQuestionId(secondForkQuestion, outcomes)
			await createQuestion(client, secondForkQuestion, outcomes)
			await approveToken(client, childRepToken, getZoltarAddress())
			await forkUniverse(client, yesUniverse, secondForkQuestionId)

			const readInactiveForkState = async () => ({
				childPoolRep: await getERC20Balance(client, childRepToken, yesChildPool.securityPool),
				childState: await getSystemState(client, yesChildPool.securityPool),
				childUniverse: await getUniverseData(client, yesUniverse),
				childVault: await getSecurityVault(client, yesChildPool.securityPool, client.account.address),
				forkData: await getSecurityPoolForkerForkData(client, yesChildPool.securityPool),
				walletChildRep: await getERC20Balance(client, childRepToken, client.account.address),
			})
			const stateBefore = await readInactiveForkState()

			await assert.rejects(initiateSecurityPoolFork(client, yesChildPool.securityPool), /Inactive/)
			assert.deepStrictEqual(await readInactiveForkState(), stateBefore, 'inactive nested-fork rejection must preserve child state, fork data, REP balances, and vault accounting')
		})

		test('a fixed-outcome child rejects new complete sets and a recursive matching fork', async () => {
			const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[2])
			const victim = createWriteClient(mockWindow, TEST_ADDRESSES[3])
			const victimClaimAmount = 5n * 10n ** 18n
			const attackerMintAmount = 4n * 10n ** 18n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, repDeposit / 4n)
			await createCompleteSet(victim, securityPoolAddresses.securityPool, victimClaimAmount)

			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, questionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			await migrateShares(victim, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])
			await migrateShares(victim, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [QuestionOutcome.Yes])

			const firstChildUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const firstChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, firstChildUniverse, questionId, statoblastSecurityMultiplierBps)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, firstChildPool.securityPool)
			if ((await getSystemState(client, firstChildPool.securityPool)) === SystemState.ForkTruthAuction) {
				const repairTarget = await getEthRaiseCapAttoEth(client, firstChildPool.truthAuction)
				const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
				const winningTick = await participateAuction(client, firstChildPool.truthAuction, parentForkData.auctionableAttoRepAtFork / 4n, repairTarget)
				await mockWindow.advanceTime(7n * DAY + DAY)
				await finalizeTruthAuction(client, firstChildPool.securityPool)
				// The recursive-share scenario needs the auction allocation assigned to a real
				// vault before that vault's accounting is carried into the next fork.
				await claimAuctionProceeds(client, firstChildPool.securityPool, client.account.address, [{ tick: winningTick, bidIndex: 0n }])
			}

			strictEqualTypeSafe(await getQuestionOutcome(client, firstChildPool.securityPool), QuestionOutcome.Yes, 'first matching fork should resolve the first child as yes')
			const victimFirstChildShares = await balanceOfShares(victim, firstChildPool.shareToken, firstChildUniverse, victim.account.address)
			const victimEconomicClaim = ensureDefined(victimFirstChildShares[1], 'victim yes shares missing from first child')
			const attackerBalanceBeforeMint = await getETHBalance(client, attacker.account.address)
			await assert.rejects(createCompleteSet(attacker, firstChildPool.securityPool, attackerMintAmount))
			strictEqualTypeSafe(await getETHBalance(client, attacker.account.address), attackerBalanceBeforeMint, 'the rejected mint must return all attacker ETH')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, firstChildPool.securityPool), victimEconomicClaim, 'the rejected mint must preserve the victim economic claim')
			const victimCollateral = await getSettlementCollateralAttoEth(client, firstChildPool.securityPool)
			const accruedFeesBeforeRecursiveFork = await getTotalAccruedFees(client, firstChildPool.securityPool)
			assert.ok(victimCollateral > 0n, 'the first child should retain collateral for the victim')

			const firstChildRepToken = await getRepToken(client, firstChildPool.securityPool)
			const firstChildForkThreshold = await getZoltarForkThreshold(client, firstChildUniverse)
			const initialForkMigrationBalance = await getMigrationRepBalanceAttoRep(client, genesisUniverse, client.account.address)
			if (initialForkMigrationBalance < firstChildForkThreshold) {
				await addRepToMigrationBalance(client, genesisUniverse, firstChildForkThreshold - initialForkMigrationBalance)
			}
			await splitMigrationRep(client, genesisUniverse, firstChildForkThreshold, [QuestionOutcome.Yes])
			assert.ok((await getERC20Balance(client, firstChildRepToken, client.account.address)) >= firstChildForkThreshold, 'the fork initiator should hold a normally migrated child REP threshold')
			const firstChildRepTotalSupply = await client.readContract({
				abi: ReputationToken_ReputationToken.abi,
				address: firstChildRepToken,
				functionName: 'totalSupply',
			})
			assert.ok(firstChildRepTotalSupply >= firstChildForkThreshold, 'the normally migrated child REP supply should cover the recursive fork threshold')
			await approveToken(client, firstChildRepToken, getZoltarAddress())
			await forkUniverse(client, firstChildUniverse, questionId)
			await assert.rejects(initiateSecurityPoolFork(client, firstChildPool.securityPool))
			strictEqualTypeSafe(await getSystemState(client, firstChildPool.securityPool), SystemState.Operational, 'the rejected recursive fork should leave the fixed child operational')
			strictEqualTypeSafe(await getQuestionOutcome(client, firstChildPool.securityPool), QuestionOutcome.Yes, 'the rejected recursive fork should preserve the fixed outcome')

			const victimBalanceBeforeRedemption = await getETHBalance(client, victim.account.address)
			await redeemShares(victim, firstChildPool.securityPool)
			const victimRedemption = (await getETHBalance(client, victim.account.address)) - victimBalanceBeforeRedemption
			const feesAccruedBeforeVictimRedemption = (await getTotalAccruedFees(client, firstChildPool.securityPool)) - accruedFeesBeforeRecursiveFork
			approximatelyEqual(victimRedemption + feesAccruedBeforeVictimRedemption, victimCollateral, 10n, 'the rejected recursive fork must preserve the victim reserve apart from ordinary retention fees')
			strictEqualTypeSafe(await getShareTokenSupplyAttoShares(client, firstChildPool.securityPool), 0n, 'the victim redemption should consume the remaining economic claims')
			strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, firstChildPool.securityPool), 0n, 'the victim redemption should consume the remaining collateral')
		})

		test('an unrelated fork followed by a matching fork installs the second branch outcome across a recursive continuation', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const opposingClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(opposingClient, repDeposit, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)
			const recursiveDeposit = 2n * reportBond
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, recursiveDeposit)
			await depositToEscalationGame(opposingClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes, recursiveDeposit)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())

			const firstForkQuestionData = {
				...questionData,
				title: 'first unrelated recursive fixed-outcome source',
			}
			const firstForkQuestionId = getQuestionId(firstForkQuestionData, outcomes)
			await createQuestion(client, firstForkQuestionData, outcomes)
			await forkUniverse(client, genesisUniverse, firstForkQuestionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

			const firstChildUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const firstChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, firstChildUniverse, questionId, statoblastSecurityMultiplierBps)
			const firstChildGame = await getSecurityPoolsEscalationGame(client, firstChildPool.securityPool)
			strictEqualTypeSafe(
				await client.readContract({
					abi: statoblast_EscalationGame_EscalationGame.abi,
					address: firstChildGame,
					functionName: 'fixedQuestionOutcome',
				}),
				BigInt(QuestionOutcome.None),
				'an unrelated first fork should leave the first continuation without a fixed outcome',
			)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, firstChildPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, firstChildPool.securityPool), SystemState.Operational, 'first recursive child should become operational before its own fork')

			const firstChildRepToken = await getRepToken(client, firstChildPool.securityPool)
			const firstChildForkThreshold = await getZoltarForkThreshold(client, firstChildUniverse)
			const firstChildBalanceSlot = formatStorageSlot(getAddressMappingStorageSlot(client.account.address, 0n))
			await mockWindow.addStateOverrides({
				[firstChildRepToken]: {
					stateDiff: {
						[firstChildBalanceSlot]: firstChildForkThreshold * 2n,
					},
				},
			})

			await forkUniverse(client, firstChildUniverse, questionId)
			await initiateSecurityPoolFork(client, firstChildPool.securityPool)
			await migrateRepToZoltar(client, firstChildPool.securityPool, [QuestionOutcome.No])
			await migrateVaultWithUnresolvedEscalation(client, firstChildPool.securityPool, client.account.address, QuestionOutcome.No)

			const secondChildUniverse = getChildUniverseId(firstChildUniverse, QuestionOutcome.No)
			const secondChildPool = getSecurityPoolAddresses(firstChildPool.securityPool, secondChildUniverse, questionId, statoblastSecurityMultiplierBps)
			const secondChildGame = await getSecurityPoolsEscalationGame(client, secondChildPool.securityPool)
			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, secondChildPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, secondChildPool.securityPool), SystemState.Operational, 'second recursive child should become operational before final resolution')
			const secondChildGameEndDate = await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: secondChildGame,
				functionName: 'getEscalationGameEndDate',
			})
			await mockWindow.setTime(secondChildGameEndDate + 1n)

			strictEqualTypeSafe(await getQuestionOutcome(client, secondChildPool.securityPool), QuestionOutcome.No, 'recursive child pool should retain the canonical matching-question outcome')
			strictEqualTypeSafe(await getQuestionResolution(client, secondChildGame), QuestionOutcome.No, 'recursive continuation game should settle against the same canonical outcome')
		})

		test('a direct same-question fork rejects carried deposits that lose in the selected child branch', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime + 10000n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond)

			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, questionId)
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			assert.strictEqual(forkData.ownFork, false, 'a direct same-question Zoltar fork should leave ownFork false')

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
			const { yesUniverse, yesSecurityPool } = getYesChildPool()
			const yesEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)

			await mockWindow.advanceTime(8n * 7n * DAY + DAY)
			await startTruthAuction(client, yesSecurityPool.securityPool)
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the zero-collateral child should auto-finalize without entering a live auction')
			for (let progressCall = 0; progressCall < 16 && (await getAwaitingForkContinuation(client, yesSecurityPool.securityPool)); progressCall++) {
				await writeContractAndWait(client, () =>
					client.writeContract({
						abi: statoblast_SecurityPool_SecurityPool.abi,
						address: yesSecurityPool.securityPool,
						functionName: 'resumeForkedEscalationGame',
						args: [],
					}),
				)
			}
			strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), false, 'bounded continuation progress should complete before child settlement')
			const escalationEndDate = await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: yesEscalationGame,
				functionName: 'getEscalationGameEndDate',
			})
			await mockWindow.setTime(escalationEndDate + 1n)

			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'the child pool should use the selected yes branch')
			strictEqualTypeSafe(await getQuestionResolution(client, yesEscalationGame), QuestionOutcome.Yes, 'the child game should use the same selected branch for settlement')

			const noProof = await createCarryProof(client, securityPoolAddresses.escalationGame, {
				expectedOutcome: QuestionOutcome.No,
				parentDepositIndex: 0n,
				leafIndex: 0n,
				merkleMountainRangePeakIndex: 0n,
				merkleMountainRangeSiblings: [],
				nullifierSiblings: new SparseNullifierTree().getProof(0n),
			})
			const canonicalSettlementSnapshot = await mockWindow.anvilSnapshot()
			const packedClaimState = await mockWindow.request({ method: 'eth_getStorageAt', params: [yesEscalationGame, formatStorageSlot(447n), 'latest'] })
			if (typeof packedClaimState !== 'string') throw new Error('Missing packed claim state')
			const divergentClaimState = (BigInt(packedClaimState) & ~(255n << 160n)) | (BigInt(QuestionOutcome.No) << 160n)
			await mockWindow.addStateOverrides({
				[yesEscalationGame]: {
					stateDiff: {
						[formatStorageSlot(447n)]: divergentClaimState,
					},
				},
			})
			strictEqualTypeSafe(await getQuestionResolution(client, yesEscalationGame), QuestionOutcome.No, 'storage override should create a divergent game-local payout result')
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'storage override must leave the canonical child branch unchanged')
			await assert.rejects(
				client.writeContract({
					abi: statoblast_SecurityPool_SecurityPool.abi,
					address: yesSecurityPool.securityPool,
					functionName: 'withdrawForkedEscalationDeposits',
					args: [QuestionOutcome.No, [noProof]],
				}),
				/Pool\/game outcome mismatch/,
			)
			await mockWindow.anvilRevert(canonicalSettlementSnapshot)
			strictEqualTypeSafe(await getQuestionResolution(client, yesEscalationGame), QuestionOutcome.Yes, 'reverting the mismatch override should restore the canonical game result')

			const childRepToken = getRepTokenAddress(yesUniverse)
			const walletRepBeforeClaim = await getERC20Balance(client, childRepToken, client.account.address)
			await assert.rejects(
				client.writeContract({
					abi: statoblast_SecurityPool_SecurityPool.abi,
					address: yesSecurityPool.securityPool,
					functionName: 'withdrawForkedEscalationDeposits',
					args: [QuestionOutcome.No, [noProof]],
				}),
				/Not winning outcome/,
			)
			strictEqualTypeSafe(await getERC20Balance(client, childRepToken, client.account.address), walletRepBeforeClaim, 'a carried no deposit must not win from a yes child')
		})

		test('migrateVault transfers pool-held vault REP backing for own forks', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, 20n * 10n ** 18n)
			await mockWindow.setTime(endTime - 1n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, 2n * 10n ** 18n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const { yesSecurityPool } = getYesChildPool()
			const parentEthBeforeMigration = await getETHBalance(client, securityPoolAddresses.securityPool)
			const childEthBeforeMigration = await getETHBalance(client, yesSecurityPool.securityPool)
			const parentAccruedFeesBeforeMigration = await getTotalAccruedFees(client, securityPoolAddresses.securityPool)
			const parentSettlementCollateralAttoEthBeforeMigration = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			assert.ok(
				parentEthBeforeMigration >= parentAccruedFeesBeforeMigration + parentSettlementCollateralAttoEthBeforeMigration,
				`parent accounting must be solvent before migration: balance ${parentEthBeforeMigration}, fees ${parentAccruedFeesBeforeMigration}, collateral ${parentSettlementCollateralAttoEthBeforeMigration}`,
			)

			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const parentEthAfterMigration = await getETHBalance(client, securityPoolAddresses.securityPool)
			const childEthAfterMigration = await getETHBalance(client, yesSecurityPool.securityPool)
			assert.ok(parentEthAfterMigration < parentEthBeforeMigration, `own-fork unlocked migration should transfer collateral out of the parent: balance ${parentEthBeforeMigration}, collateral ${parentSettlementCollateralAttoEthBeforeMigration}, fees ${parentAccruedFeesBeforeMigration}`)
			strictEqualTypeSafe(parentEthBeforeMigration - parentEthAfterMigration, childEthAfterMigration - childEthBeforeMigration, 'own-fork unlocked migration should move matching collateral into the child')
		})

		test('own-fork non-escrowed vault migration values child REP backing units against the vault REP bucket', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 4n * forkThresholdAttoRep)
			await mockWindow.setTime(endTime + 1n)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThresholdAttoRep)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThresholdAttoRep)

			const parentVaultBeforeFork = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			const parentDenominatorBeforeFork = await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool)
			await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			assert.ok(ownForkRepBuckets.vaultRepAtForkAttoRep > 0n, 'test setup should leave pool-held vault REP backing at fork')
			assert.ok(ownForkRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep > 0n, 'test setup should include separate dispute-staked REP at fork')
			const expectedChildRepClaim = (parentVaultBeforeFork.repBackingUnits * ownForkRepBuckets.vaultRepAtForkAttoRep) / parentDenominatorBeforeFork

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()
			const childVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
			const childRepClaim = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, childVault.repBackingUnits)
			strictEqualTypeSafe(childRepClaim, expectedChildRepClaim, 'child vault backingUnits should redeem the full migrated vault REP bucket')
		})

		test('own-fork unlocked migration transfers all pool collateral when all vault REP migrates', async () => {
			const settlementCollateralAttoEth = 2n * 10n ** 18n
			const secondVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(secondVaultClient, repDeposit, questionId)
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, settlementCollateralAttoEth)
			const forkThresholdAttoRep = (((await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
			await depositRepToVault(client, securityPoolAddresses.securityPool, 4n * forkThresholdAttoRep)
			const endTime = await getQuestionEndDate(client, questionId)
			await mockWindow.setTime(endTime - 1n)
			await createCompleteSet(client, securityPoolAddresses.securityPool, settlementCollateralAttoEth)
			await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThresholdAttoRep)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThresholdAttoRep)
			await transferRepToAddress(client, securityPoolAddresses.securityPool, 5n)
			await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
			const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
			assert.ok(ownForkRepBuckets.vaultRepAtForkAttoRep > 0n, 'test setup should leave pool-held vault REP backing at fork')
			assert.ok(ownForkRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep > 0n, 'test setup should include separate dispute-staked REP at fork')

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			const { yesSecurityPool } = getYesChildPool()
			const parentSettlementCollateralAttoEthBeforeMigration = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const childEthBeforeMigration = await getETHBalance(client, yesSecurityPool.securityPool)

			await migrateVault(secondVaultClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const migrationHash = await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const migrationReceipt = await client.getTransactionReceipt({ hash: migrationHash })
			const migrationCheckpointLog = migrationReceipt.logs
				.filter(log => log.address.toLowerCase() === getInfraContractAddresses().securityPoolForker.toLowerCase())
				.map(log =>
					decodeEventLog({
						abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
						data: log.data,
						topics: log.topics,
					}),
				)
				.find(log => log.eventName === 'VaultMigrationCheckpoint')
			if (migrationCheckpointLog === undefined) throw new Error('own-fork VaultMigrationCheckpoint log missing')

			const parentSettlementCollateralAttoEthAfterMigration = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
			const childEthAfterMigration = await getETHBalance(client, yesSecurityPool.securityPool)
			assert.ok(parentSettlementCollateralAttoEthBeforeMigration > 0n, `test setup should leave collateral available before migration: ${parentSettlementCollateralAttoEthBeforeMigration}`)
			strictEqualTypeSafe(parentSettlementCollateralAttoEthAfterMigration, 0n, 'all remaining pool collateral should leave the parent when all vault REP migrates')
			strictEqualTypeSafe(childEthAfterMigration - childEthBeforeMigration, parentSettlementCollateralAttoEthBeforeMigration, 'the child should receive the full remaining migrated pool collateral')
			strictEqualTypeSafe(migrationCheckpointLog.args.cumulativeSettlementCollateralTransferredAttoEth, parentSettlementCollateralAttoEthBeforeMigration, 'the migration checkpoint should report the complete own-fork cumulative collateral')
			strictEqualTypeSafe(await getMigratedAttoRep(client, yesSecurityPool.securityPool), ownForkRepBuckets.vaultRepAtForkAttoRep, 'complete own-fork backingUnits migration should reconcile donated REP rounding residue')
		})
	})
})
