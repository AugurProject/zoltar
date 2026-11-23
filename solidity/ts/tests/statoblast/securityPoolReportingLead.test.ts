import { describe, expect, test } from 'bun:test'
import { parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_QuestionLedger_QuestionLedger as poolArtifact, statoblast_EscalationGame_EscalationGame as gameArtifact } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'

describe('Statoblast: reporting lead bounds', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	test('#1328 an intervening leader top-up cannot turn a protected reply into trailing stake', async () => {
		const owner = fixture.owner()
		const pool = fixture.poolFor(fixture.base.questionId).questionLedger
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), pool)
		const deposit = (outcome: number, amount: bigint) => writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
		await deposit(1, 100n * unit)
		await deposit(2, 90n * unit)
		const game = { abi: gameArtifact.abi, address: await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGame' }) }
		// A 20 REP reply would lead now; the leader's preceding top-up changes that.
		await deposit(1, 100n * unit)
		const before = await owner.readContract({ ...game, functionName: 'getOutcomeBalancesAttoRep' })
		const protectedAbi = parseAbi(['function depositWalletRepToEscalationGameWithLead(uint8 outcome,uint256 maximumDepositAttoRep)'])
		const protectedDeposit = (amount: bigint) => writeContractAndWait(owner, () => owner.writeContract({ abi: protectedAbi, address: pool, functionName: 'depositWalletRepToEscalationGameWithLead', args: [2, amount] }))
		await expect(protectedDeposit(20n * unit)).rejects.toThrow('Deposit does not lead')
		expect(await owner.readContract({ ...game, functionName: 'getOutcomeBalancesAttoRep' })).toEqual(before)
		await protectedDeposit(121n * unit)
		const after = await owner.readContract({ ...game, functionName: 'getOutcomeBalancesAttoRep' })
		expect(after[2]).toBeGreaterThan(after[1])
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), game.address)
		const directAbi = parseAbi(['function depositRepOnOutcomeWithLead(uint8 outcome,uint256 maximumDepositAttoRep)'])
		const direct = (outcome: number, amount: bigint) => writeContractAndWait(owner, () => owner.writeContract({ abi: directAbi, address: game.address, functionName: 'depositRepOnOutcomeWithLead', args: [outcome, amount] }))
		await expect(direct(1, 2n * unit)).rejects.toThrow('Deposit does not lead')
		expect(await owner.readContract({ ...game, functionName: 'getOutcomeBalancesAttoRep' })).toEqual(after)
		await direct(1, 12n * unit)
		const threshold = await owner.readContract({ ...game, functionName: 'nonDecisionThresholdAttoRep' })
		await direct(2, threshold)
		// Matching two threshold-filled sides must remain possible to force non-decision.
		await direct(1, threshold)
		const final = await owner.readContract({ ...game, functionName: 'getOutcomeBalancesAttoRep' })
		expect(final[1]).toBe(threshold)
		expect(final[2]).toBe(threshold)
	})
})
