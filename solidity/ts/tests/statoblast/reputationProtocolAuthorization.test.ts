import assert from '../../testSupport/simulator/utils/assert'
import { describe, test } from 'bun:test'
import { statoblast_interfaces_IEscalationGame_IEscalationGameAuthorization, statoblast_SecurityPool_SecurityPool as poolArtifact } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast REP authorization entry points', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const reportBond = 100n * unit
	const initializeEscalationGame = async () => {
		const client = fixture.owner()
		const pool = fixture.poolFor(fixture.base.questionId).securityPool
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(client, getRepTokenAddress(fixture.base.genesisUniverse), pool)
		await writeContractAndWait(client, () => client.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [1, reportBond] }))
		return client.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGame' })
	}
	test('genesis REP escalation deposits reject ERC-2612 permit routing', async () => {
		const client = fixture.owner()
		const escalationGame = await initializeEscalationGame()
		await assert.rejects(
			client.writeContract({
				abi: statoblast_interfaces_IEscalationGame_IEscalationGameAuthorization.abi,
				address: escalationGame,
				functionName: 'depositRepOnOutcomeWithPermit',
				args: [QuestionOutcome.Yes, reportBond, 9_000_000_000n, 27, `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`],
			}),
			/Genesis REP does not support permit/,
		)
	})

	test('genesis REP escalation deposits reject ERC-3009 authorization routing', async () => {
		const client = fixture.owner()
		const escalationGame = await initializeEscalationGame()
		await assert.rejects(
			client.writeContract({
				abi: statoblast_interfaces_IEscalationGame_IEscalationGameAuthorization.abi,
				address: escalationGame,
				functionName: 'depositRepOnOutcomeWithAuthorization',
				args: [client.account.address, QuestionOutcome.No, reportBond * 4n, 0n, 9_000_000_000n, `0x${'00'.repeat(32)}`, 27, `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`],
			}),
			/Genesis REP does not support authorization/,
		)
	})
})
