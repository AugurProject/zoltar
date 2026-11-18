import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_factories_EscalationGameFactory_EscalationGameFactory as escalationFactoryArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
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
		await window.setTime(forkTime + 65n * DAY)
		await writeContractAndWait(caller, () => caller.writeContract(finalize))
		expect(await demand()).toBe(before)
		expect((await question())[1]).toBe(0n)
		await window.setTime(forkTime + 66n * DAY + 1n)
		await writeContractAndWait(caller, () => caller.writeContract(finalize))
		const [, frozen] = await question()
		expect(frozen).not.toBe(0n)
		expect(await demand()).toBe(before - 10n * unit)
		await writeContractAndWait(caller, () => caller.writeContract(finalize))
		expect((await question())[1]).toBe(frozen)
		expect(await demand()).toBe(before - 10n * unit)
	})

	test('predeploying reporting code leaves the game dormant until a funded report', async () => {
		const owner = fixture.owner()
		const caller = fixture.other()
		const pool = { abi: poolArtifact.abi, address: fixture.poolFor(fixture.base.questionId).securityPool }
		const prepare = { abi: escalationFactoryArtifact.abi, address: getInfraContractAddresses().escalationGameFactory, functionName: 'prepareEscalationGame' as const, args: [pool.address] as const }
		await fixture.prepare()
		await fixture.mint(unit)
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), pool.address)
		const game = { abi: gameArtifact.abi, address: (await caller.simulateContract(prepare)).result }
		await writeContractAndWait(caller, () => caller.writeContract(prepare))
		expect((await caller.simulateContract(prepare)).result).toBe(game.address)
		expect(await caller.readContract({ ...pool, functionName: 'escalationGame' })).toBe(zeroAddress)
		expect(await caller.readContract({ ...game, functionName: 'activationTime' })).toBe(0n)
		await expect(caller.writeContract({ ...game, functionName: 'start', args: [1n, 2n] })).rejects.toThrow('Only owner')
		await expect(caller.writeContract({ ...game, functionName: 'depositRepOnOutcome', args: [1, 100n * unit] })).rejects.toThrow('Game inactive')
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		const report = { ...pool, functionName: 'depositWalletRepToEscalationGame' as const, args: [1, 100n * unit] as const }
		await expect(caller.writeContract(report)).rejects.toThrow()
		expect(await caller.readContract({ ...game, functionName: 'activationTime' })).toBe(0n)
		expect(await caller.readContract({ ...pool, functionName: 'escalationGame' })).toBe(zeroAddress)
		const hash = await writeContractAndWait(owner, () => owner.writeContract({ ...report, gas: 5_000_000n }))
		expect((await owner.getTransactionReceipt({ hash })).gasUsed).toBeLessThan(5_000_000n)
		expect(await owner.readContract({ ...pool, functionName: 'escalationGame' })).toBe(game.address)
		expect(await owner.readContract({ ...game, functionName: 'activationTime' })).toBeGreaterThan(fixture.base.questionData.endTime)
	})
})
