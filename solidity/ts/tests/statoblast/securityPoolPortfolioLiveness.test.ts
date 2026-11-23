import { describe, expect, test } from 'bun:test'
import {
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast contract liveness', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })

	test('a finalized inherited question releases demand before its child pool exists', async () => {
		const owner = fixture.owner()
		const caller = fixture.other()
		const questionId = fixture.base.questionId
		const root = { abi: portfolioArtifact.abi, address: fixture.portfolio }
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.mint(20n * unit, fixture.secondQuestionId)
		const { child, forks, forkTime } = await fixture.forkAndStartYesBranch()
		const window = fixture.base.mockWindow
		await window.setTime(forkTime + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'finalizeBranch', args: [child] }))
		const [, activatedAt] = await owner.readContract({ abi: forkArtifact.abi, address: forks, functionName: 'clocks', args: [child] })
		const settlement = { abi: settlementArtifact.abi, address: await owner.readContract({ ...root, functionName: 'settlement' }) }
		const ledger = { abi: bookArtifact.abi, address: await owner.readContract({ ...settlement, functionName: 'ledger' }) }
		const bookId = await owner.readContract({ ...settlement, functionName: 'bookIds', args: [child] })
		const capital = { abi: capitalArtifact.abi, address: await owner.readContract({ ...root, functionName: 'capitalLedger', args: [child] }) }
		const demand = () => caller.readContract({ ...capital, functionName: 'demandAttoEth' })
		const question = () => caller.readContract({ ...ledger, functionName: 'question', args: [bookId, questionId] })
		const finalize = { ...settlement, functionName: 'finalizeQuestion' as const, args: [child, questionId] as const }
		const before = await demand()
		expect((await question())[1]).toBe(0n)
		await expect(owner.readContract({ ...root, functionName: 'getPool', args: [questionId, child] })).rejects.toThrow('Question pool unavailable')
		await window.setTime(activatedAt + 2n * DAY)
		await writeContractAndWait(caller, () => caller.writeContract(finalize))
		expect(await demand()).toBe(before)
		expect((await question())[1]).toBe(0n)
		await window.setTime(activatedAt + 3n * DAY + 1n)
		await writeContractAndWait(caller, () => caller.writeContract(finalize))
		const [, frozen] = await question()
		expect(frozen).not.toBe(0n)
		expect(await demand()).toBe(before - 10n * unit)
		await writeContractAndWait(caller, () => caller.writeContract(finalize))
		expect((await question())[1]).toBe(frozen)
		expect(await demand()).toBe(before - 10n * unit)
	})
})
