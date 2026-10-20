import { describe, test } from 'bun:test'
import { getQuestionId as buildQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { getEthRaiseCapAttoEth } from '../../testSupport/simulator/utils/contracts/auction'
import { createCompleteSet, depositRepToVault, depositToEscalationGame, getRepToken, getSecurityVault, getSettlementCollateralAttoEth, getSystemState, setUnderwritingLimit } from '../../testSupport/simulator/utils/contracts/securityPool'
import { claimForkedEscalationDeposits, finalizeTruthAuction, getOwnForkRepBuckets, initiateSecurityPoolFork, migrateRepToZoltar, migrateVault, startTruthAuction } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { getQuestionEndDate, participateAuction } from '../../testSupport/simulator/utils/contracts/statoblast'
import { approveAndDepositRepToVault, setVaultCapacityFixture, triggerOwnGameFork } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { forkUniverse, getTotalTheoreticalSupply, getZoltarForkThreshold } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { createWriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { formatStorageSlot, getAddressMappingStorageSlot } from '../../testSupport/storage'
import assert from '../../testSupport/simulator/utils/assert'
import { statoblast_SecurityPool_SecurityPool } from '../../types/contractArtifact'
import { useStatoblastTruthAuctionFixture } from './fixture'

describe('Audit: commitment floor in a fork-fixed child pool', () => {
	const fixture = useStatoblastTruthAuctionFixture()
	const { repDeposit, statoblastSecurityMultiplierBps, getYesChildPool } = fixture

	test('a fork-fixed child cannot fork again, so its last committed vault can exit below collateral', async () => {
		const { client, mockWindow, outcomes, questionData, questionId, securityPoolAddresses } = fixture
		const readChildPool = { abi: statoblast_SecurityPool_SecurityPool.abi, args: [] } as const

		// Own fork with an unresolved escalation, so the Yes child inherits a fixed outcome and a carried game.
		// Two 6 ETH commitments back 10 ETH of collateral, so the migrated vault's exit would leave commitments short.
		const endTime = await getQuestionEndDate(client, questionId)
		const forkThresholdAttoRep = (((await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6])
		await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
		await setVaultCapacityFixture(passiveRepHolder, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, passiveRepHolder.account.address, 6n * 10n ** 18n)
		await mockWindow.setTime(endTime + 10000n)
		await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, 6n * 10n ** 18n)
		await createCompleteSet(createWriteClient(mockWindow, TEST_ADDRESSES[1]), securityPoolAddresses.securityPool, 10n * 10n ** 18n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, repDeposit / 2n)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		const { vaultRepAtForkAttoRep } = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [1n])

		// The unrelated question that later forks the child universe ends during the truth auction wait.
		const forkingClient = createWriteClient(mockWindow, TEST_ADDRESSES[5])
		const secondForkQuestionData = { ...questionData, title: 'fork-fixed child commitment floor fork source', endTime: (await mockWindow.getTime()) + DAY }
		await createQuestion(forkingClient, secondForkQuestionData, outcomes)

		const { yesUniverse, yesSecurityPool } = getYesChildPool()
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		const bidder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
		await participateAuction(bidder, yesSecurityPool.truthAuction, vaultRepAtForkAttoRep / 2n, await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction))
		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		assert.strictEqual(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the fork-fixed child must be operational')

		assert.strictEqual(await client.readContract({ ...readChildPool, address: yesSecurityPool.securityPool, functionName: 'isEscalationResolved' }), true, 'the own fork fixes the child outcome')

		// A later fork of the child universe cannot fork this pool: its inherited outcome makes activateForkMode revert.
		const childRepToken = await getRepToken(client, yesSecurityPool.securityPool)
		await mockWindow.addStateOverrides({ [childRepToken]: { stateDiff: { [formatStorageSlot(getAddressMappingStorageSlot(forkingClient.account.address, 0n))]: (await getZoltarForkThreshold(client, yesUniverse)) * 2n } } })
		await forkUniverse(forkingClient, yesUniverse, buildQuestionId(secondForkQuestionData, outcomes))
		await assert.rejects(initiateSecurityPoolFork(client, yesSecurityPool.securityPool), /Forked/)

		// The remaining claims rest on pool-held ETH, so the migrated vault may leave below collateral.
		const collateralAttoEth = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
		await setUnderwritingLimit(client, yesSecurityPool.securityPool, 0n)
		assert.ok((await client.readContract({ ...readChildPool, address: yesSecurityPool.securityPool, functionName: 'totalUnderwritingLimitAttoEth' })) < collateralAttoEth, 'the exit leaves commitments below collateral')
		assert.strictEqual((await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)).underwritingLimitAttoEth, 0n, 'the migrated vault holds no commitment')
	})
})
