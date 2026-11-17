import { describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { ReputationToken_ReputationToken as tokenArtifact, statoblast_EscalationChallengeEscrow_EscalationChallengeEscrow as escrowArtifact, statoblast_EscalationGame_EscalationGame as gameArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact } from '../types/contractArtifact'
import { deployContract } from '../testSupport/deployContract'
import { SparseNullifierTree } from './carryProofHelpers'
import { createE2E } from './auditE2EHarness'
import { createWriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { approveToken, getERC20Balance } from '../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

const batchAbi = gameArtifact.abi

describe('collective escalation response', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const e2e = createE2E(fixture)
	const prepare = async () => {
		const owner = fixture.owner()
		const pool = fixture.poolFor(fixture.base.questionId).securityPool
		const rep = getRepTokenAddress(fixture.base.genesisUniverse)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(owner, rep, pool)
		const deposit = (outcome: number, amount: bigint) => writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
		await deposit(1, 50_000n * unit)
		await deposit(2, 50_000n * unit)
		const game = await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGame' })
		const read = <const Name extends 'getEscalationGameEndDate' | 'totalCostAttoRep' | 'startBondAttoRep' | 'getQuestionResolution' | 'getOutcomeBalancesAttoRep' | 'responseRestartedUntil'>(functionName: Name) => owner.readContract({ abi: gameArtifact.abi, address: game, functionName })
		await fixture.base.mockWindow.setTime((await read('getEscalationGameEndDate')) - 1n)
		await deposit(2, await read('startBondAttoRep'))
		await fixture.base.mockWindow.setTime((await read('getEscalationGameEndDate')) - 2n * DAY)
		const cost = await read('totalCostAttoRep')
		const amount = ((cost - 50_000n * unit) * 6n) / 10n
		const deadline = await read('getEscalationGameEndDate')
		const escrow = await deployContract(owner, encodeDeployData({ abi: escrowArtifact.abi, bytecode: `0x${escrowArtifact.evm.bytecode.object}`, args: [game, 1, deadline] }))
		const contribution = async (sender: ReturnType<typeof fixture.owner>, value = amount, validUntil = deadline) => {
			await approveToken(sender, rep, escrow)
			return writeContractAndWait(sender, () => sender.writeContract({ abi: escrowArtifact.abi, address: escrow, functionName: 'contribute', args: [value, validUntil] }))
		}
		const activated = () => owner.readContract({ abi: escrowArtifact.abi, address: escrow, functionName: 'activated' })
		const withdraw = (sender: ReturnType<typeof fixture.owner>) => writeContractAndWait(sender, () => sender.writeContract({ abi: escrowArtifact.abi, address: escrow, functionName: 'withdraw' }))
		const activate = (sender = owner) => writeContractAndWait(sender, () => sender.writeContract({ abi: escrowArtifact.abi, address: escrow, functionName: 'activate' }))
		const deposits = () => owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getDepositsByOutcome', args: [1, 0n, 100n] })
		const balance = (address: Address) => getERC20Balance(owner, rep, address)
		return { owner, pool, rep, game, read, amount, deadline, escrow, contribution, activated, withdraw, activate, deposits, balance, deposit }
	}

	test('escrow combines insufficient replies, preserves native owners and pays only them', async () => {
		const context = await prepare()
		const { owner, read, contribution, activated, deposits, balance, pool, game, amount, escrow } = context
		const other = fixture.other()
		const beforeBalances = await read('getOutcomeBalancesAttoRep')
		const beforeEnd = await read('getEscalationGameEndDate')
		await contribution(owner)
		expect(await activated()).toBe(false)
		expect(await read('getOutcomeBalancesAttoRep')).toEqual(beforeBalances)
		expect(await read('getEscalationGameEndDate')).toBe(beforeEnd)
		await expect(context.activate(e2e.account(2))).rejects.toThrow('Challenge not funded')
		await contribution(other)
		expect(await activated()).toBe(true)
		expect(await read('getQuestionResolution')).toBe(1n)
		expect(await read('getEscalationGameEndDate')).toBeGreaterThan(beforeEnd)
		const records = (await deposits()).slice(-2)
		expect(records.map(record => record.depositor.toLowerCase())).toEqual([owner.account.address.toLowerCase(), other.account.address.toLowerCase()])
		expect(records.map(record => record.amountAttoRep)).toEqual([amount, amount])
		expect(await balance(escrow)).toBe(0n)
		await expect(context.withdraw(owner)).rejects.toThrow('Challenge activated')
		await expect(context.activate()).rejects.toThrow('Challenge closed')
		await expect(contribution(e2e.account(2))).rejects.toThrow('Challenge closed')
		await fixture.base.mockWindow.setTime((await read('getEscalationGameEndDate')) + 1n)
		const beforeOwner = await balance(owner.account.address)
		const beforeOther = await balance(other.account.address)
		const stranger = e2e.account(2)
		const beforeStranger = await balance(stranger.account.address)
		for (const index of [1n, 2n]) await writeContractAndWait(stranger, () => stranger.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'withdrawFromEscalationGame', args: [1, [index]] }))
		expect(await balance(owner.account.address)).toBeGreaterThan(beforeOwner)
		expect(await balance(other.account.address)).toBeGreaterThan(beforeOther)
		expect(await balance(stranger.account.address)).toBe(beforeStranger)
		expect(await balance(escrow)).toBe(0n)
		// Ordinary claims are the same game nodes, rather than escrow-owned receipts.
		expect(await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getFinalQuestionResolution' })).toBe(1n)
	})

	test('pooled funding activates at the exact response deadline and gives the displaced side fresh time', async () => {
		const { owner, contribution, escrow, rep, deadline, read, amount, activated } = await prepare()
		await contribution(owner)
		const other = fixture.other()
		await approveToken(other, rep, escrow)
		await fixture.base.mockWindow.setTime(deadline - 1n)
		const secondAmount = ((await read('totalCostAttoRep')) * 101n) / 100n - 50_000n * unit - amount
		await writeContractAndWait(other, () => other.writeContract({ abi: escrowArtifact.abi, address: escrow, functionName: 'contribute', args: [secondAmount, deadline] }))
		expect((await other.getBlock()).timestamp).toBe(deadline)
		expect(await activated()).toBe(true)
		expect(await read('responseRestartedUntil')).toBe(deadline + 3n * DAY)
		expect(await read('getQuestionResolution')).toBe(1n)
	})

	test('small front-running contributions cannot occupy every slot and block larger funders', async () => {
		const { owner, game, escrow, rep, read, contribution, activated, amount, balance } = await prepare()
		const bond = await read('startBondAttoRep')
		const smallContributors = []
		for (let index = 0; index < 16; index++) {
			const sender = createWriteClient(fixture.base.mockWindow, 0x131600n + BigInt(index))
			await fixture.base.mockWindow.impersonateAccount(sender.account.address)
			await fixture.base.mockWindow.setBalance(sender.account.address, unit)
			await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: rep, functionName: 'transfer', args: [sender.account.address, bond] }))
			await contribution(sender, bond)
			smallContributors.push(sender)
		}
		expect(await activated()).toBe(false)
		const first = smallContributors[0]
		const second = smallContributors[1]
		if (first === undefined || second === undefined) throw new Error('Missing crowding accounts')
		await contribution(fixture.other())
		expect(await balance(first.account.address)).toBe(bond)
		expect(await owner.readContract({ abi: escrowArtifact.abi, address: escrow, functionName: 'contributionsAttoRep', args: [first.account.address] })).toBe(0n)
		const hash = await contribution(owner)
		expect((await owner.getTransactionReceipt({ hash })).gasUsed).toBeLessThan(16_777_216n)
		expect(await activated()).toBe(true)
		expect(await balance(second.account.address)).toBe(bond)
		const records = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getDepositsByOutcome', args: [1, 0n, 100n] })
		expect(records.slice(1)).toHaveLength(16)
		expect(records.find(record => record.depositor.toLowerCase() === fixture.other().account.address.toLowerCase())?.amountAttoRep).toBe(amount)
	})

	test('withdrawal is owner-only, frees funding and remains available after expiry', async () => {
		const { owner, contribution, withdraw, balance, escrow, activated, deadline, read, activate } = await prepare()
		const before = await balance(owner.account.address)
		await contribution(owner)
		await expect(withdraw(fixture.other())).rejects.toThrow('No contribution')
		await withdraw(owner)
		expect(await balance(owner.account.address)).toBe(before)
		expect(await balance(escrow)).toBe(0n)
		await contribution(fixture.other())
		expect(await activated()).toBe(false)
		await expect(activate()).rejects.toThrow('Challenge not funded')
		await fixture.base.mockWindow.setTime(deadline + 1n)
		await expect(activate()).rejects.toThrow('Challenge closed')
		await expect(contribution(owner)).rejects.toThrow('Contribution expired')
		await withdraw(fixture.other())
		expect(await balance(escrow)).toBe(0n)
		expect(await read('getQuestionResolution')).toBe(2n)
	})

	test('stale consent and below-curve batches cannot spend funds or extend the window', async () => {
		const { owner, game, rep, amount, read, contribution, balance, deadline } = await prepare()
		await expect(contribution(owner, amount, 1n)).rejects.toThrow('Contribution expired')
		await expect(contribution(owner, amount, deadline - 1n)).rejects.toThrow('Challenge outlasts consent')
		await approveToken(owner, rep, game)
		const before = await balance(owner.account.address)
		const end = await read('getEscalationGameEndDate')
		await expect(writeContractAndWait(owner, () => owner.writeContract({ abi: batchAbi, address: game, functionName: 'depositRepOnOutcomeForBatch', args: [1, [owner.account.address], [amount]] }))).rejects.toThrow('Invalid deposit preview')
		expect(await balance(owner.account.address)).toBe(before)
		expect(await read('getEscalationGameEndDate')).toBe(end)
	})

	test('permissionless activation cannot redirect contributions or restart an unchanged leader', async () => {
		const { owner, contribution, activate, deposits, read, deposit, amount, balance } = await prepare()
		await contribution(owner)
		await deposit(1, amount * 2n)
		const end = await read('getEscalationGameEndDate')
		const stranger = e2e.account(2)
		const before = await balance(stranger.account.address)
		await activate(stranger)
		expect((await deposits()).at(-1)?.depositor.toLowerCase()).toBe(owner.account.address.toLowerCase())
		expect(await read('getEscalationGameEndDate')).toBe(end)
		expect(await balance(stranger.account.address)).toBe(before)
		await expect(contribution(fixture.other())).rejects.toThrow('Challenge closed')
	})

	test('activated contributions carry through a fork with individual claim ownership', async () => {
		const { owner, pool, game, contribution, read, escrow } = await prepare()
		await contribution(owner)
		await contribution(fixture.other())
		const leaves = await e2e.localLeaves(game, 1)
		expect(leaves).toHaveLength(3)
		await e2e.forkOn(owner, fixture.base.genesisUniverse, await e2e.unrelatedQuestion('Collective response carry fork'))
		const childUniverse = await e2e.activateBranch(fixture.base.genesisUniverse, 1)
		const child = await e2e.materialize(pool, childUniverse)
		const childEnd = await owner.readContract({ abi: gameArtifact.abi, address: child.game, functionName: 'getEscalationGameEndDate' })
		await fixture.base.mockWindow.setTime(childEnd + 1n)
		const tree = new SparseNullifierTree()
		const stranger = e2e.account(2)
		for (const leaf of leaves.slice(1)) {
			expect(await e2e.claimInherited(stranger, child.pool, 1, leaves, [leaf], tree)).toBeGreaterThan(0n)
		}
		expect(await e2e.rep(childUniverse, escrow)).toBe(0n)
		expect(await read('getQuestionResolution')).toBe(1n)
	})

	test('a fixed-outcome fork continuation cannot accept pending challenge funds', async () => {
		const owner = fixture.owner()
		const pool = fixture.poolFor(fixture.base.questionId).securityPool
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await e2e.deposit(owner, pool, 1, 50_000n * unit)
		await e2e.deposit(fixture.other(), pool, 2, 40_000n * unit)
		await e2e.forkOn(owner, fixture.base.genesisUniverse, fixture.base.questionId)
		const child = await e2e.materialize(pool, await e2e.activateBranch(fixture.base.genesisUniverse, 1))
		expect(await owner.readContract({ abi: gameArtifact.abi, address: child.game, functionName: 'fixedQuestionOutcome' })).toBe(1n)
		expect(await owner.readContract({ abi: gameArtifact.abi, address: child.game, functionName: 'getQuestionResolution' })).toBe(3n)
		const deadline = await owner.readContract({ abi: gameArtifact.abi, address: child.game, functionName: 'getEscalationGameEndDate' })
		await expect(deployContract(owner, encodeDeployData({ abi: escrowArtifact.abi, bytecode: `0x${escrowArtifact.evm.bytecode.object}`, args: [child.game, 1, deadline] }))).rejects.toThrow('Game inactive')
	})

	test('pending REP is refundable after an unrelated universe fork', async () => {
		const { owner, contribution, withdraw, escrow, balance, activate } = await prepare()
		await contribution(owner)
		await e2e.forkOn(owner, fixture.base.genesisUniverse, await e2e.unrelatedQuestion('Collective response refund fork'))
		expect(await owner.readContract({ abi: escrowArtifact.abi, address: escrow, functionName: 'canActivate' })).toBe(false)
		await expect(activate()).rejects.toThrow('Game inactive')
		await expect(contribution(fixture.other())).rejects.toThrow('Game inactive')
		const before = await balance(owner.account.address)
		await withdraw(owner)
		expect(await balance(owner.account.address)).toBeGreaterThan(before)
		expect(await balance(escrow)).toBe(0n)
	})

	test('batch limits, caller funding and full-allocation checks precede any accepted report', async () => {
		const { owner, game, rep, read, amount, balance } = await prepare()
		const other = fixture.other()
		const write = (beneficiaries: Address[], amounts: bigint[], sender = owner) => writeContractAndWait(sender, () => sender.writeContract({ abi: batchAbi, address: game, functionName: 'depositRepOnOutcomeForBatch', args: [1, beneficiaries, amounts] }))
		const before = await balance(owner.account.address)
		const end = await read('getEscalationGameEndDate')
		await expect(write([], [])).rejects.toThrow('Invalid contribution count')
		await expect(write([owner.account.address], [])).rejects.toThrow('Invalid contribution count')
		await expect(
			write(
				Array.from({ length: 17 }, () => owner.account.address),
				Array.from({ length: 17 }, () => amount),
			),
		).rejects.toThrow('Invalid contribution count')
		await expect(write([owner.account.address], [1n])).rejects.toThrow('Invalid contribution')
		await approveToken(owner, rep, game)
		await expect(write([owner.account.address], [2n * amount], other)).rejects.toThrow('SafeERC20Ops token call reverted')
		expect(await balance(owner.account.address)).toBe(before)
		expect(await read('getEscalationGameEndDate')).toBe(end)
		const threshold = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'nonDecisionThresholdAttoRep' })
		await expect(write([owner.account.address], [threshold])).rejects.toThrow('Contributions would be trimmed')
		const each = (amount * 2n) / 16n
		const hash = await write(
			Array.from({ length: 16 }, () => owner.account.address),
			Array.from({ length: 16 }, () => each),
		)
		expect((await owner.getTransactionReceipt({ hash })).gasUsed).toBeLessThan(16_777_216n)
		expect(await read('getQuestionResolution')).toBe(1n)
	})

	test('collective funding can reach a threshold tie and authorize non-decision', async () => {
		const { owner, contribution, activated, game, deposit, read } = await prepare()
		const threshold = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'nonDecisionThresholdAttoRep' })
		await deposit(2, threshold)
		const gap = threshold - (await read('getOutcomeBalancesAttoRep'))[1]
		await contribution(owner, gap / 2n)
		expect(await activated()).toBe(false)
		await contribution(fixture.other(), gap - gap / 2n)
		expect(await activated()).toBe(true)
		expect(await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'canTriggerOwnFork' })).toBe(true)
	})

	test('a batch on the third outcome releases only the native minimum-balance surplus', async () => {
		const { owner, game, rep, read, pool } = await prepare()
		const before = await e2e.gameBalance(game)
		await approveToken(owner, rep, game)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: batchAbi, address: game, functionName: 'depositRepOnOutcomeForBatch', args: [0, [owner.account.address, fixture.other().account.address], [35_000n * unit, 35_000n * unit]] }))
		expect(await read('getQuestionResolution')).toBe(0n)
		expect(await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'creditedSurplusAttoRep' })).toBe(50_000n * unit)
		expect(await e2e.gameBalance(game)).toBe(before + 20_000n * unit)
		await fixture.base.mockWindow.setTime((await read('getEscalationGameEndDate')) + 1n)
		for (const [index, beneficiary] of [
			[0n, owner.account.address],
			[1n, fixture.other().account.address],
		] as const) {
			expect(await e2e.claimLocal(e2e.account(2), pool, 0, [index], beneficiary)).toBeGreaterThan(0n)
		}
	})

	test('two individually insufficient reports activate together and retain their owners', async () => {
		const owner = fixture.owner()
		const other = fixture.other()
		const pool = fixture.poolFor(fixture.base.questionId).securityPool
		const rep = getRepTokenAddress(fixture.base.genesisUniverse)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(owner, rep, pool)
		await approveToken(other, rep, pool)
		const deposit = (outcome: number, amount: bigint) => writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
		await deposit(1, 50_000n * unit)
		await deposit(2, 50_000n * unit)
		const game = await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGame' })
		const read = <const Name extends 'getEscalationGameEndDate' | 'totalCostAttoRep' | 'startBondAttoRep' | 'getQuestionResolution'>(functionName: Name) => owner.readContract({ abi: gameArtifact.abi, address: game, functionName })
		await fixture.base.mockWindow.setTime((await read('getEscalationGameEndDate')) - 1n)
		await deposit(2, await read('startBondAttoRep'))
		await fixture.base.mockWindow.setTime((await read('getEscalationGameEndDate')) - 2n * DAY)
		const cost = await read('totalCostAttoRep')
		const amount = ((cost - 50_000n * unit) * 6n) / 10n
		await expect(deposit(1, amount)).rejects.toThrow('Invalid deposit preview')
		await approveToken(owner, rep, game)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: batchAbi, address: game, functionName: 'depositRepOnOutcomeForBatch', args: [1, [owner.account.address, other.account.address], [amount, amount]] }))
		expect(await read('getQuestionResolution')).toBe(1n)
		const deposits = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getDepositsByOutcome', args: [1, 0n, 100n] })
		expect(deposits.slice(-2).map(deposit => deposit.depositor.toLowerCase())).toEqual([owner.account.address.toLowerCase(), other.account.address.toLowerCase()])
	})
})
