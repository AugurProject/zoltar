import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { forkUniverse, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'

describe('#1560 sealing after capital freeze collects no remaining fees', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 1_000n })
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
		const securityPool = { abi: securityPoolArtifact.abi, address: fixture.securityPool }
		const coordinator = await owner.readContract({ ...securityPool, functionName: 'forkController' })
		const settlement = await owner.readContract({ ...securityPool, functionName: 'settlement' })
		const collateral = await owner.readContract({ ...securityPool, functionName: 'collateralToken' })
		await fixture.base.mockWindow.impersonateAccount(coordinator)
		await fixture.base.mockWindow.setBalance(coordinator, unit)
		const authority = createWriteClient(fixture.base.mockWindow, BigInt(coordinator))
		const snapshot = () => owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'snapshotQuestion', args: [fixture.poolFor(fixture.base.questionId).questionLedger] })
		const cashBeforeFreeze = (await snapshot()).questionCashAttoEth
		// Reproduce the coordinator's production ordering, observing the first seal's return.
		await writeContractAndWait(authority, () => authority.writeContract({ ...capital, functionName: 'freeze' }))
		expect((await snapshot()).questionCashAttoEth).toBeLessThan(cashBeforeFreeze)
		const time = await owner.readContract({ ...securityPool, functionName: 'forkSecurityPoolTime', args: [fixture.base.genesisUniverse] })
		const { result } = await authority.simulateContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'sealUniverse', args: [fixture.base.genesisUniverse, time] })
		// Sealing reverts with 'Uncollected settlement fees' if any earned fee remained uncredited.
		expect(result).toHaveLength(2)
		const balance = () => owner.readContract({ abi: tokenArtifact.abi, address: collateral, functionName: 'balanceOf', args: [fixture.securityPool] })
		const before = await balance()
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: coordinator, functionName: 'freeze', args: [fixture.base.genesisUniverse] }))
		expect(await balance()).toBe(before)
	})
})
