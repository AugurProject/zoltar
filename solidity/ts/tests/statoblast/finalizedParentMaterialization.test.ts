import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	Zoltar_Zoltar as zoltarArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as coordinatorArtifact,
	statoblast_QuestionForker_QuestionForker as forkerArtifact,
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_tokens_ShareToken_ShareToken as shareArtifact,
} from '../../types/contractArtifact'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken, getChildUniverseId, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, splitMigrationRep, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: reject materializing a question that finalized before an unrelated fork', () => {
	const fixture = useSecurityPoolPortfolioFixture({})
	const p = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const forker = () => ({ abi: forkerArtifact.abi, address: getInfraContractAddresses().questionForker })
	const sourcePool = () => fixture.poolFor(fixture.base.questionId).questionLedger
	const shares = () => ({ abi: shareArtifact.abi, address: fixture.poolFor(fixture.base.questionId).shareToken })
	const coordinator = async () => ({ abi: coordinatorArtifact.abi, address: await fixture.owner().readContract({ ...p(), functionName: 'forkController' }) })

	test('#1495: a fork exactly at the game deadline interrupts parent withdrawals', async () => {
		await fixture.prepare()
		const owner = fixture.owner()
		const base = fixture.base
		const unrelated = { ...base.questionData, title: 'Unrelated fork at exact game deadline' }
		await createQuestion(owner, unrelated, base.outcomes)
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), sourcePool())
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
		const game = await owner.readContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'escalationGame' })
		const end = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		await base.mockWindow.setTime(end - 1n)
		await forkUniverse(owner, base.genesisUniverse, getQuestionId(unrelated, base.outcomes))
		expect((await getUniverseData(owner, base.genesisUniverse)).forkTime).toBe(end)
		await expect(owner.simulateContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'withdrawFromEscalationGame', args: [1, [0n]] })).rejects.toThrow('Deposits carry to child games')
	})

	test.each([true, false])('game finalized in the parent before an unrelated fork (disputed: %s)', async disputed => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const owner = fixture.owner(),
			trader = fixture.other(),
			base = fixture.base
		// Report on question A and let the game finalize.
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), sourcePool())
		const deposits: (readonly [number, bigint])[] = disputed
			? [
					[1, 100n * unit],
					[2, 70n * unit],
				]
			: [[1, 100n * unit]]
		for (const [outcome, amount] of deposits) await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
		const game = await owner.readContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'escalationGame' })
		const end = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		await base.mockWindow.setTime(end + DAY)
		expect(await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getFinalQuestionResolution' })).toBe(1n)

		// Fork the universe on an unrelated question and activate the outcome-1 branch.
		const unrelated = { ...base.questionData, title: `Unrelated fork after finality ${disputed}` }
		await createQuestion(owner, unrelated, base.outcomes)
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		const earliest = await owner.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getEarliestForkTime', args: [base.genesisUniverse] })
		if ((await base.mockWindow.getTime()) < earliest) await base.mockWindow.setTime(earliest)
		await forkUniverse(owner, base.genesisUniverse, getQuestionId(unrelated, base.outcomes))
		await addRepToMigrationBalance(owner, base.genesisUniverse, 1_000_000n * unit)
		await splitMigrationRep(owner, base.genesisUniverse, 1_000_000n * unit, [1n])
		const forkTime = (await getUniverseData(owner, base.genesisUniverse)).forkTime
		expect(forkTime).toBeGreaterThan(end)
		const c = await coordinator()
		await writeContractAndWait(owner, () => owner.writeContract({ ...c, functionName: 'choose', args: [base.genesisUniverse, 1n] }))
		const child = getChildUniverseId(base.genesisUniverse, 1)
		await base.mockWindow.setTime(forkTime + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ ...c, functionName: 'startBranch', args: [base.genesisUniverse, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...c, functionName: 'finalizeBranch', args: [child] }))

		for (const functionName of ['preparePortfolioQuestion', 'materializePortfolioQuestion'] as const) {
			await expect(writeContractAndWait(owner, () => owner.writeContract({ ...forker(), functionName, args: [sourcePool(), child] }))).rejects.toThrow('Question finalized in source universe')
			await expect(owner.readContract({ ...p(), functionName: 'getPool', args: [base.questionId, child] })).rejects.toThrow('Question pool unavailable')
		}

		await expect(trader.simulateContract({ ...shares(), functionName: 'migrate', args: [base.genesisUniverse * 256n + 1n, [1n]] })).rejects.toThrow('ShareToken question finalized before fork')
		await writeContractAndWait(trader, () => trader.writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'redeemShares' }))
		const rep = getRepTokenAddress(base.genesisUniverse)
		const repBefore = await getERC20Balance(owner, rep, owner.account.address)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'withdrawFromEscalationGame', args: [1, [0n]] }))
		expect((await getERC20Balance(owner, rep, owner.account.address)) - repBefore).toBe(disputed ? 142n * unit : 100n * unit)
	})
})
