import { describe, test } from 'bun:test'
import assert from '../../testSupport/simulator/utils/assert'
import { statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate } from '../../types/contractArtifact'
import { getSecurityPoolsEscalationGame } from '../../testSupport/simulator/utils/contracts/securityPool'
import { getSecurityPoolForkerForkData } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { useStatoblastForkMigrationFixture } from './fixture'

describe('Claim checkpoints: canonical source freeze boundary', () => {
	const fixture = useStatoblastForkMigrationFixture()

	test('an actual own-fork source becomes immutable strictly after its direct-claim window', async () => {
		const { client, mockWindow, securityPoolAddresses } = fixture
		await fixture.forkOwnGameAfterQuestionEnd()
		const game = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		const frozen = async () => await client.readContract({ abi: statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate.abi, address: game, functionName: 'isClaimHistoryFrozen' })
		assert.strictEqual(await frozen(), false, 'forking alone must not authorize caching mutable direct-claim offsets')
		const fork = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		const cutoff = fork.forkActivationTime + 8n * 7n * 24n * 60n * 60n
		await mockWindow.setTime(cutoff)
		assert.strictEqual(await frozen(), false, 'the inclusive direct-claim deadline is still mutable')
		await mockWindow.setTime(cutoff + 1n)
		assert.strictEqual(await frozen(), true, 'canonical forker data, rather than a caller flag, closes the history')
	})
})
