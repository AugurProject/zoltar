import { describe, expect, test } from 'bun:test'
import type { Hex } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact } from '../../types/contractArtifact'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

const gas = 16_777_216n

describe('Statoblast timestamp accounting gas through public entry points', () => {
	const fixture = useSecurityPoolPortfolioFixture()

	test('purchases, fee refresh, redemption, reporting and child activation fit with a populated schedule', async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const buyer = fixture.other()
		const measurements = new Map<string, bigint>()
		const record = async (label: string, client: WriteClient, hash: Hex) => {
			const receipt = await client.waitForTransactionReceipt({ hash })
			expect(receipt.status).toBe('success')
			expect(receipt.gasUsed).toBeLessThan(12_000_000n)
			measurements.set(label, receipt.gasUsed)
		}
		const pool = (questionId: bigint) => ({ abi: poolArtifact.abi, address: fixture.poolFor(questionId).securityPool })
		const report = (client: WriteClient, questionId: bigint, outcome: number, amount: bigint) => writeContractAndWait(client, () => client.writeContract({ ...pool(questionId), functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount], gas }))

		await fixture.prepare()
		const questionIds = [base.questionId]
		const end = base.questionData.endTime
		for (let index = 0; index < 16; index++) {
			const question = makeQuestion(`Timestamp gas market ${index}`, end)
			await createQuestion(owner, question, base.outcomes)
			const questionId = getQuestionId(question, base.outcomes)
			await fixture.register(questionId)
			questionIds.push(questionId)
		}
		for (const questionId of questionIds) {
			await base.mockWindow.advanceTime(37n)
			await fixture.mint(unit, questionId)
			await approveToken(owner, getRepTokenAddress(base.genesisUniverse), pool(questionId).address)
		}
		const portfolio = { abi: portfolioArtifact.abi, address: fixture.portfolio }
		const [fee] = await buyer.readContract({ ...portfolio, functionName: 'purchaseQuote', args: [base.genesisUniverse, base.questionId, unit] })
		await record(
			'purchase',
			buyer,
			await writeContractAndWait(buyer, () =>
				buyer.writeContract({
					...portfolio,
					functionName: 'createCompleteSet',
					args: [base.genesisUniverse, base.questionId, unit, buyer.account.address, 0n, (fee * 10_100n + 9_999n) / 10_000n],
					gas,
				}),
			),
		)
		await record('fee refresh', buyer, await writeContractAndWait(buyer, () => buyer.writeContract({ ...pool(base.questionId), functionName: 'refreshPortfolioFees', gas })))
		await record('complete-set redemption', buyer, await writeContractAndWait(buyer, () => buyer.writeContract({ ...pool(base.questionId), functionName: 'redeemCompleteSet', args: [unit / 2n], gas })))

		await base.mockWindow.setTime(end + 1n)
		await record('first report', owner, await report(owner, base.questionId, 1, 100n * unit))
		for (const questionId of questionIds.slice(1)) {
			await base.mockWindow.advanceTime(37n)
			await report(owner, questionId, 1, 100n * unit)
		}
		await approveToken(buyer, getRepTokenAddress(base.genesisUniverse), pool(base.questionId).address)
		await record('counter-report', buyer, await report(buyer, base.questionId, 2, 200n * unit))
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner, base.genesisUniverse, base.questionId)
		const { forkTime } = await getUniverseData(owner, base.genesisUniverse)
		const child = getChildUniverseId(base.genesisUniverse, 1)
		const forks = await owner.readContract({ ...portfolio, functionName: 'forkController' })
		const coordinator = { abi: forkArtifact.abi, address: forks }
		await record('freeze source', owner, await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'freeze', args: [base.genesisUniverse], gas })))
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'choose', args: [base.genesisUniverse, 1n] }))
		await base.mockWindow.setTime(forkTime + 56n * DAY)
		await record('startBranch', owner, await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'startBranch', args: [base.genesisUniverse, 1n], gas })))
		await base.mockWindow.setTime(forkTime + 63n * DAY)
		await record('finalizeBranch', owner, await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'finalizeBranch', args: [child], gas })))
		console.log('Timestamp accounting receipt gas', Object.fromEntries(measurements))
	})
})
