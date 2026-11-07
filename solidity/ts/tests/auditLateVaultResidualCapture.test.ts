import { describe, expect, test } from 'bun:test'
import { encodeDeployData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { deployContract } from '../testSupport/deployContract'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { approveToken, getERC20Balance } from '../testSupport/simulator/utils/utilities'
import { forkUniverse, getRepTokenAddress, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { createQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_EscalationGame_EscalationGame as gameArtifact, statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact, statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact } from '../types/contractArtifact'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

describe('Wallet reporting without standalone vault backing', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const pool = () => ({ abi: poolArtifact.abi, address: fixture.poolFor(fixture.base.questionId).securityPool })
	const token = () => getRepTokenAddress(fixture.base.genesisUniverse)
	const game = () => fixture.owner().readContract({ ...pool(), functionName: 'escalationGame' })
	const report = (sender = fixture.other(), outcome = 1, amount = 100n * unit) => writeContractAndWait(sender, () => sender.writeContract({ ...pool(), functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
	const snapshot = async (sender: WriteClient) => ({
		wallet: await getERC20Balance(sender, token(), sender.account.address),
		capital: await getERC20Balance(sender, token(), fixture.capitalLedger),
		game: await game(),
		totals: await sender.readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'totals' }),
	})

	test('a wallet funds the first report at question end without acquiring any pool capital', async () => {
		const reporter = fixture.other()
		await approveToken(reporter, token(), pool().address)
		const before = await snapshot(reporter)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime - 1n)
		await report()
		const after = await snapshot(reporter)
		expect(after.wallet).toBe(before.wallet - 100n * unit)
		expect(after.capital).toBe(before.capital)
		expect(after.totals).toEqual(before.totals)
		expect(after.game).not.toBe(zeroAddress)
		const end = await reporter.readContract({ abi: gameArtifact.abi, address: after.game, functionName: 'getEscalationGameEndDate' })
		await fixture.base.mockWindow.setTime(end + 1n)
		await writeContractAndWait(reporter, () => reporter.writeContract({ ...pool(), functionName: 'withdrawFromEscalationGame', args: [1, [0n]] }))
		expect(await getERC20Balance(reporter, token(), reporter.account.address)).toBe(before.wallet)
		expect((await snapshot(reporter)).totals).toEqual(before.totals)
	})

	test('first reports enforce question end and failed funding rolls back game deployment', async () => {
		const reporter = fixture.other()
		const before = await snapshot(reporter)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime - 2n)
		await expect(report()).rejects.toThrow('Question active')
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime)
		await expect(report()).rejects.toThrow()
		expect(await snapshot(reporter)).toEqual(before)
		await approveToken(reporter, token(), pool().address)
		await expect(report(reporter, 3)).rejects.toThrow()
		await expect(report(reporter, 1, 0n)).rejects.toThrow()
		expect(await snapshot(reporter)).toEqual(before)
		await report()
	})

	test('a prepared first report can challenge another report, but cannot deposit after finality', async () => {
		await approveToken(fixture.other(), token(), pool().address)
		await approveToken(fixture.owner(), token(), pool().address)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime)
		await report(fixture.owner())
		const before = await snapshot(fixture.other())
		await report(fixture.other(), 2, 200n * unit)
		expect((await snapshot(fixture.other())).wallet).toBe(before.wallet - 200n * unit)
		expect((await snapshot(fixture.other())).totals).toEqual(before.totals)
		const end = await fixture.owner().readContract({ abi: gameArtifact.abi, address: await game(), functionName: 'getEscalationGameEndDate' })
		await fixture.base.mockWindow.setTime(end + 1n)
		const final = await snapshot(fixture.other())
		await expect(report()).rejects.toThrow()
		expect(await snapshot(fixture.other())).toEqual(final)
	})

	test('an orphan game cannot accept wallet deposits or mutate canonical accounting', async () => {
		const sender = fixture.other()
		const infra = getInfraContractAddresses()
		const orphan = await deployContract(sender, encodeDeployData({ abi: gameArtifact.abi, bytecode: `0x${gameArtifact.evm.bytecode.object}`, args: [pool().address, token(), infra.escalationGameProofVerifier, infra.escalationGameClaimDelegate, infra.escalationGameDepositDelegate] }))
		await writeContractAndWait(sender, () => sender.writeContract({ abi: gameArtifact.abi, address: orphan, functionName: 'start', args: [100n * unit, 200n * unit] }))
		await approveToken(sender, token(), orphan)
		const before = await snapshot(sender)
		await expect(sender.writeContract({ abi: gameArtifact.abi, address: orphan, functionName: 'depositRepOnOutcome', args: [1, 100n * unit] })).rejects.toThrow('Game inactive')
		expect(await snapshot(sender)).toEqual(before)
	})

	test('a universe fork blocks new reports before and after native fork activation', async () => {
		const owner = fixture.owner()
		await approveToken(fixture.other(), token(), pool().address)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime)
		await report()
		const question = { ...fixture.base.questionData, title: 'Wallet report fork guard' }
		await createQuestion(owner, question, fixture.base.outcomes)
		await approveToken(owner, token(), getZoltarAddress())
		await forkUniverse(owner, fixture.base.genesisUniverse, getQuestionId(question, fixture.base.outcomes))
		const before = await snapshot(fixture.other())
		await expect(report()).rejects.toThrow('Forked')
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'initiateSecurityPoolFork', args: [pool().address] }))
		expect(await fixture.owner().readContract({ ...pool(), functionName: 'systemState' })).toBe(1n)
		await expect(report()).rejects.toThrow('Forked')
		expect(await snapshot(fixture.other())).toEqual(before)
	})
})
