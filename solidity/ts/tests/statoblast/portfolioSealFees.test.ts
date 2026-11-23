import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { forkUniverse, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('#1560 sealing after capital freeze collects no remaining fees', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 1_000n })
	test.each([0n, 30n, 300n])('partial checkpoint at %s seconds', async checkpointAt => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const owner = fixture.owner()
		const capital = { abi: capitalArtifact.abi, address: fixture.capitalLedger }
		if (checkpointAt !== 0n) {
			await fixture.base.mockWindow.advanceTime(checkpointAt)
			await writeContractAndWait(owner, () => owner.writeContract({ ...capital, functionName: 'checkpoint' }))
		}
		await fixture.base.mockWindow.advanceTime(60n + checkpointAt)
		const question = { ...fixture.base.questionData, title: 'Fee sealing fork', endTime: (await owner.getBlock()).timestamp - 1n }
		await createQuestion(owner, question, fixture.base.outcomes)
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner, fixture.base.genesisUniverse, getQuestionId(question, fixture.base.outcomes))
		const portfolio = { abi: portfolioArtifact.abi, address: fixture.portfolio }
		const coordinator = await owner.readContract({ ...portfolio, functionName: 'forkController' })
		const settlement = await owner.readContract({ ...portfolio, functionName: 'settlement' })
		const collateral = await owner.readContract({ ...portfolio, functionName: 'collateralToken' })
		await fixture.base.mockWindow.impersonateAccount(coordinator)
		await fixture.base.mockWindow.setBalance(coordinator, unit)
		const authority = createWriteClient(fixture.base.mockWindow, BigInt(coordinator))
		const snapshot = () => owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'snapshotQuestion', args: [fixture.poolFor(fixture.base.questionId).securityPool] })
		const cashBeforeFreeze = (await snapshot()).questionCashAttoEth
		// Reproduce the coordinator's production ordering, observing the first seal's return.
		await writeContractAndWait(authority, () => authority.writeContract({ ...capital, functionName: 'freeze' }))
		expect((await snapshot()).questionCashAttoEth).toBeLessThan(cashBeforeFreeze)
		const time = await owner.readContract({ ...portfolio, functionName: 'forkPortfolioTime', args: [fixture.base.genesisUniverse] })
		const { result } = await authority.simulateContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'sealUniverse', args: [fixture.base.genesisUniverse, time] })
		expect(result[2]).toBe(0n)
		const balance = () => owner.readContract({ abi: tokenArtifact.abi, address: collateral, functionName: 'balanceOf', args: [fixture.portfolio] })
		const before = await balance()
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: coordinator, functionName: 'freeze', args: [fixture.base.genesisUniverse] }))
		expect(await balance()).toBe(before)
	})
})
