import { describe, expect, test } from 'bun:test'
import { parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { useSecurityPoolPortfolioFixture, unit } from './securityPoolPortfolioFixture'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as coordinatorArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
} from '../../types/contractArtifact'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { addRepToMigrationBalance, splitMigrationRep, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { manipulatePriceOracle } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'

const abi = parseAbi(['function recapitalizeUniverse(uint248 universeId) payable'])

describe('Statoblast: voluntary portfolio settlement repair', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const repair = (universeId: bigint, amount: bigint) => fixture.other().writeContract({ address: fixture.portfolio, abi, functionName: 'recapitalizeUniverse', args: [universeId], value: amount })

	test('rejects empty donations and universes that cannot accept voluntary repair', async () => {
		await expect(repair(fixture.base.genesisUniverse, 0n)).rejects.toThrow('Repair amount zero')
		await expect(repair(fixture.base.genesisUniverse + 1n, unit)).rejects.toThrow('Universe is not ready')
	})

	test('never accepts cash beyond the existing settlement shortfall', async () => {
		await expect(repair(fixture.base.genesisUniverse, unit)).rejects.toThrow('Repair exceeds settlement shortfall')
		await fixture.prepare()
		await fixture.mint()
		await expect(repair(fixture.base.genesisUniverse, unit)).rejects.toThrow('Repair exceeds settlement shortfall')
	})

	test('repair of a native partial branch preserves claims and cannot jump queued retirement', async () => {
		const { owner, other, base, portfolio } = fixture
		await fixture.prepare()
		await fixture.deposit(1_000n * unit, other())
		await fixture.authorize(1_000n * unit, 200n * unit, other())
		await fixture.mint()
		await approveToken(owner(), getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await forkUniverse(owner(), base.genesisUniverse, base.questionId)
		const coordinator = await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'forkController' })
		const choose = (sender: ReturnType<typeof owner>, outcome: bigint) => writeContractAndWait(sender, () => sender.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'choose', args: [base.genesisUniverse, outcome] }))
		await choose(owner(), 1n)
		await choose(other(), 2n)
		const forkTime = (await getUniverseData(owner(), base.genesisUniverse)).forkTime
		await base.mockWindow.setTime(forkTime + 63n * DAY)
		const child = getChildUniverseId(base.genesisUniverse, 1)
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'startBranch', args: [base.genesisUniverse, 1n] }))
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'finalizeBranch', args: [child] }))
		const capital = await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'capitalLedger', args: [child] })
		const engine = await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'settlement' })
		const book = await owner().readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' })
		const bookId = await owner().readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [child] })
		const totals = () => owner().readContract({ abi: bookArtifact.abi, address: book, functionName: 'totals', args: [bookId] })
		const initial = await totals()
		expect(initial[0]).toBeGreaterThan(0n)
		expect(initial[0]).toBeLessThan(initial[1])
		await expect(repair(child, 1n)).rejects.toThrow('Capital price stale')
		// Only the namespace and its price coordinator are needed; reporter history remains lazy.
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'preparePortfolioQuestion', args: [fixture.poolFor(base.questionId).securityPool, child] }))
		const childPool = await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'getPool', args: [base.questionId, child] })
		const priceCoordinator = await owner().readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'openOraclePriceCoordinator' })
		await addRepToMigrationBalance(owner(), base.genesisUniverse, 100n * unit)
		await splitMigrationRep(owner(), base.genesisUniverse, 100n * unit, [1n])
		await manipulatePriceOracle(owner(), base.mockWindow, priceCoordinator)
		const account = await owner().readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerAccount', args: [owner().account.address] })
		const position = account.positions.find(id => id !== 0n)
		if (position === undefined) throw new Error('Chosen commitment missing')
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'requestRetirement', args: [position] }))
		const queued = await totals()
		await expect(repair(child, 1n)).rejects.toThrow('Insufficient healthy shared commitment')
		expect((await totals()).slice(0, 2)).toEqual(queued.slice(0, 2))
		// The owner voluntarily opens fresh backing after the existing queue has priority.
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'fundExecutionReserve', args: [owner().account.address], value: unit }))
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'authorize', args: [100n * unit, 20n * unit] }))
		const before = await totals()
		const donorBefore = await other().readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerAccount', args: [other().account.address] })
		const donation = before[1] - before[0]
		await writeContractAndWait(other(), () => repair(child, donation))
		const after = await totals()
		expect(after[0]).toBe(before[1])
		expect(after[1]).toBe(before[1])
		expect(await owner().readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'demandAttoEth' })).toBe(after[0])
		expect(await other().readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerAccount', args: [other().account.address] })).toEqual(donorBefore)
	})
})
