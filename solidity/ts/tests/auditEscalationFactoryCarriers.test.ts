import { describe, expect, test } from 'bun:test'
import { getCreateAddress } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_EscalationGame_EscalationGame as gameArtifact, statoblast_QuestionLedger_QuestionLedger as poolArtifact } from '../types/contractArtifact'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { getRepTokenAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { approveToken } from '../testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

// Audit hardening: the factory stores the game's creation code in two code carriers. A carrier
// that began with a chunk byte could fail to deploy when that byte is 0xEF (EIP-3541), and was
// executable. Each carrier now starts with STOP and the game is rebuilt from the bytes after it.
describe('audit: escalation game creation-code carriers start with STOP', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })

	test('both carriers begin with a STOP byte and a game still deploys from them', async () => {
		const owner = fixture.owner()
		const pool = { abi: poolArtifact.abi, address: fixture.poolFor(fixture.base.questionId).questionLedger }
		const factory = await owner.readContract({ ...pool, functionName: 'escalationGameFactory' })
		// The factory creates its proof verifier first, then the two carriers.
		const carriers = [2n, 3n].map(nonce => getCreateAddress({ from: factory, nonce }))
		let carried = 0
		for (const address of carriers) {
			const code = await owner.getBytecode({ address })
			if (code === undefined) throw new Error('Missing creation-code carrier')
			expect(code.slice(0, 4)).toBe('0x00')
			carried += (code.length - 2) / 2 - 1
		}
		expect(carried).toBe(gameArtifact.evm.bytecode.object.length / 2)

		await fixture.prepare(1_000n * unit, 10n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), pool.address)
		await writeContractAndWait(owner, () => owner.writeContract({ ...pool, functionName: 'depositWalletRepToEscalationGame', args: [QuestionOutcome.Yes, 100n * unit] }))
		const game = await owner.readContract({ ...pool, functionName: 'escalationGame' })
		expect(await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'questionLedger' })).toBe(pool.address)
	})
})
