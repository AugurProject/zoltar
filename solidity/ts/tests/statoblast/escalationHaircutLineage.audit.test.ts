import { describe, test } from 'bun:test'
import { encodeDeployData } from '@zoltar/core-shared/evm/ethereum'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { getEthRaiseCapAttoEth } from '../../testSupport/simulator/utils/contracts/auction'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { createCompleteSet, depositRepToVault, depositToEscalationGame, getRepToken, getSystemState } from '../../testSupport/simulator/utils/contracts/securityPool'
import { claimForkedEscalationDeposits, createChildUniverse, finalizeTruthAuction, getOwnForkRepBuckets, initiateSecurityPoolFork, migrateRepToZoltar, migrateVault, startTruthAuction } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { getQuestionEndDate, participateAuction } from '../../testSupport/simulator/utils/contracts/statoblast'
import { approveAndDepositRepToVault, setVaultCapacityFixture, triggerOwnGameFork } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { getRepTokenAddress, getTotalTheoreticalSupply } from '../../testSupport/simulator/utils/contracts/zoltar'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { createWriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import assert from '../../testSupport/simulator/utils/assert'
import {
	statoblast_EscalationGame_EscalationGame,
	statoblast_SecurityPool_SecurityPool,
	test_statoblast_EscalationHaircutLineageAttackMocks_EscalationHaircutLineageAttackAuctionMock,
	test_statoblast_EscalationHaircutLineageAttackMocks_EscalationHaircutLineageAttackChildMock,
	test_statoblast_EscalationHaircutLineageAttackMocks_EscalationHaircutLineageAttackParentMock,
	test_statoblast_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackFactoryMock,
	test_statoblast_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackShareTokenMock,
} from '../../types/contractArtifact'
import { useStatoblastTruthAuctionFixture } from './fixture'

describe('Audit PoC: fake lineage cannot haircut a canonical child escalation game', () => {
	const fixture = useStatoblastTruthAuctionFixture()
	const { repDeposit, statoblastSecurityMultiplierBps, genesisUniverse, getYesChildPool } = fixture

	test('a fake child reporting a canonical game cannot apply its truth-auction haircut', async () => {
		const { client, mockWindow, questionId, securityPoolAddresses } = fixture
		const deploy = async (deployData: `0x${string}`) => {
			const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: deployData }) })
			const address = receipt.contractAddress
			if (address === undefined || address === null) throw new Error('mock deployment address missing')
			return address
		}

		// Canonical own-fork with an unresolved escalation game, copied from the startup fork-path scenario.
		const endTime = await getQuestionEndDate(client, questionId)
		const forkThresholdAttoRep = (((await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6])
		await approveAndDepositRepToVault(passiveRepHolder, 2n * forkThresholdAttoRep, questionId)
		await setVaultCapacityFixture(passiveRepHolder, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, passiveRepHolder.account.address, repDeposit / 4n)
		await mockWindow.setTime(endTime + 10000n)
		await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, repDeposit / 4n)
		await createCompleteSet(createWriteClient(mockWindow, TEST_ADDRESSES[1]), securityPoolAddresses.securityPool, 10n * 10n ** 18n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, repDeposit / 2n)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		const { vaultRepAtForkAttoRep } = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [1n])

		const { yesUniverse, yesSecurityPool } = getYesChildPool()
		const childRepToken = getRepTokenAddress(yesUniverse)
		const victimGame = await client.readContract({ address: yesSecurityPool.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'escalationGame' })
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		assert.strictEqual(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'canonical child must run a truth auction')
		const bidder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
		await participateAuction(bidder, yesSecurityPool.truthAuction, vaultRepAtForkAttoRep / 2n, await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction))

		// Attacker lineage: a mock parent in the forked universe whose factory returns an attacker child and auction.
		const forker = getInfraContractAddresses().securityPoolForker
		const attackShareToken = await deploy(encodeDeployData({ abi: test_statoblast_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackShareTokenMock.abi, bytecode: `0x${test_statoblast_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackShareTokenMock.evm.bytecode.object}`, args: [] }))
		const attackFactory = await deploy(encodeDeployData({ abi: test_statoblast_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackFactoryMock.abi, bytecode: `0x${test_statoblast_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackFactoryMock.evm.bytecode.object}`, args: [] }))
		const attackParent = await deploy(
			encodeDeployData({
				abi: test_statoblast_EscalationHaircutLineageAttackMocks_EscalationHaircutLineageAttackParentMock.abi,
				bytecode: `0x${test_statoblast_EscalationHaircutLineageAttackMocks_EscalationHaircutLineageAttackParentMock.evm.bytecode.object}`,
				args: [addressString(GENESIS_REPUTATION_TOKEN), attackFactory, attackShareToken, genesisUniverse, questionId, statoblastSecurityMultiplierBps],
			}),
		)
		const attackAuction = await deploy(encodeDeployData({ abi: test_statoblast_EscalationHaircutLineageAttackMocks_EscalationHaircutLineageAttackAuctionMock.abi, bytecode: `0x${test_statoblast_EscalationHaircutLineageAttackMocks_EscalationHaircutLineageAttackAuctionMock.evm.bytecode.object}`, args: [] }))
		const attackChild = await deploy(
			encodeDeployData({
				abi: test_statoblast_EscalationHaircutLineageAttackMocks_EscalationHaircutLineageAttackChildMock.abi,
				bytecode: `0x${test_statoblast_EscalationHaircutLineageAttackMocks_EscalationHaircutLineageAttackChildMock.evm.bytecode.object}`,
				args: [attackParent, attackFactory, forker, attackAuction, yesUniverse],
			}),
		)
		await client.waitForTransactionReceipt({
			hash: await client.writeContract({ abi: test_statoblast_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackFactoryMock.abi, address: attackFactory, functionName: 'configureChild', args: [attackChild, attackAuction] }),
		})
		await initiateSecurityPoolFork(client, attackParent)
		await createChildUniverse(client, attackParent, QuestionOutcome.Yes)

		// Report REP purchases sized so the forker removes 90% of the victim game's REP.
		const victimGameRepBefore = await getERC20Balance(client, childRepToken, victimGame)
		const disputeStakedAttoRep = await client.readContract({ address: victimGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'totalDisputeStakedAttoRep' })
		assert.ok(disputeStakedAttoRep > 0n, 'victim game must hold carried escalation REP')
		const targetHaircutAttoRep = (victimGameRepBefore * 9n) / 10n
		const combinedAttoRep = vaultRepAtForkAttoRep + disputeStakedAttoRep
		const reportedPurchaseAttoRep = (targetHaircutAttoRep * combinedAttoRep + disputeStakedAttoRep - 1n) / disputeStakedAttoRep
		await client.waitForTransactionReceipt({
			hash: await client.writeContract({ abi: test_statoblast_EscalationHaircutLineageAttackMocks_EscalationHaircutLineageAttackAuctionMock.abi, address: attackAuction, functionName: 'setTotalAttoRepPurchased', args: [reportedPurchaseAttoRep] }),
		})
		await client.waitForTransactionReceipt({
			hash: await client.writeContract({ abi: test_statoblast_EscalationHaircutLineageAttackMocks_EscalationHaircutLineageAttackChildMock.abi, address: attackChild, functionName: 'arm', args: [securityPoolAddresses.securityPool, victimGame] }),
		})

		await assert.rejects(finalizeTruthAuction(client, attackChild), /Escalation game pool/, 'a fake child must not finalize against a canonical escalation game')
		assert.strictEqual(await client.readContract({ address: victimGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'truthAuctionRepBeforeAttoRep' }), 0n, 'the canonical game haircut must remain unapplied')
		assert.strictEqual(await getERC20Balance(client, childRepToken, victimGame), victimGameRepBefore, 'the canonical game must keep its carried REP')

		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		assert.strictEqual(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the canonical child must still finalize its truth auction')
	})
})
