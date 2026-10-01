import { statoblast_SecurityPoolForker_SecurityPoolForker } from '../../../types/contractArtifact'
import { claimAuctionProceeds, finalizeTruthAuction, initiateSecurityPoolFork, migrateRepToZoltar, startTruthAuction } from '../../../testSupport/simulator/utils/contracts/securityPoolForker'
import { QuestionOutcome } from '../../../testSupport/simulator/types/types'
import { getInfraContractAddresses } from '../../../testSupport/simulator/utils/contracts/deployStatoblast'
import { addressString } from '../../../testSupport/simulator/utils/bigint'
import { DAY, TEST_ADDRESSES } from '../../../testSupport/simulator/utils/constants'
import assert from '../../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { useStatoblastTruthAuctionFixture, type StatoblastTruthAuctionFixture } from '../fixture'

describe('Statoblast: truth auction', () => {
	const fixture = useStatoblastTruthAuctionFixture()

	const { setupStartedTruthAuction } = fixture

	let mockWindow: StatoblastTruthAuctionFixture['mockWindow']

	let client: StatoblastTruthAuctionFixture['client']

	let securityPoolAddresses: StatoblastTruthAuctionFixture['securityPoolAddresses']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
	})

	test('forker public entry points expose exact wrong-state and empty-action guards', async () => {
		const parentPool = securityPoolAddresses.securityPool
		const forkerAddress = getInfraContractAddresses().securityPoolForker
		const forkerAbi = statoblast_SecurityPoolForker_SecurityPoolForker.abi

		await assert.rejects(startTruthAuction(client, parentPool), /Not mig/)
		await assert.rejects(finalizeTruthAuction(client, parentPool, 1n), /No repair ETH/)
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
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				address: getInfraContractAddresses().securityPoolForker,
				functionName: 'settleAuctionBids',
				args: [yesSecurityPool.securityPool, client.account.address, [{ tick: 0n, bidIndex: 0n }], []],
			}),
			/Not final/,
		)
	})
})
