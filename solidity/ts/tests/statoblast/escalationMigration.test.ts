import { describe, expect, test } from 'bun:test'
import { type Address, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
	Zoltar_Zoltar as zoltarArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { approveToken, getChildUniverseId, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, splitMigrationRep, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { computeForkContinuationParentDepositIndex, createCarryProof, hashParent, readCarryLeafHash, SparseNullifierTree } from '../carryProofHelpers'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: portfolio reporting carry and atomic claims', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const sourcePool = () => fixture.poolFor(fixture.base.questionId).securityPool
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const forker = () => ({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker })
	const gameFor = (pool: Address) => fixture.owner().readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGame' })
	const deposit = async (sender: WriteClient, pool: Address, outcome: number, amount: bigint, universe = fixture.base.genesisUniverse) => {
		await approveToken(sender, getRepTokenAddress(universe), pool)
		await writeContractAndWait(sender, () => sender.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
	}
	const prepareReports = async (differentOwners = false, losingAmount = 20n * unit) => {
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await deposit(fixture.owner(), sourcePool(), 1, 40n * unit)
		await deposit(differentOwners ? fixture.other() : fixture.owner(), sourcePool(), 1, 60n * unit)
		if (losingAmount > 0n) await deposit(fixture.other(), sourcePool(), 2, losingAmount)
		return gameFor(sourcePool())
	}
	const activate = async (source: Address, universe = fixture.base.genesisUniverse, outcome = 1, fundWallet = false) => {
		const owner = fixture.owner()
		const earliest = await owner.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getEarliestForkTime', args: [universe] })
		if ((await fixture.base.mockWindow.getTime()) < earliest) await fixture.base.mockWindow.setTime(earliest)
		const question = { ...fixture.base.questionData, title: `Reporting carry external fork ${universe}`, endTime: (await fixture.base.mockWindow.getTime()) - 1n }
		await createQuestion(owner, question, fixture.base.outcomes)
		await approveToken(owner, getRepTokenAddress(universe), getZoltarAddress())
		await forkUniverse(owner, universe, getQuestionId(question, fixture.base.outcomes))
		if (fundWallet) {
			await addRepToMigrationBalance(owner, universe, 1_000_000n * unit)
			await splitMigrationRep(owner, universe, 1_000_000n * unit, [BigInt(outcome)])
		}
		const controller = await owner.readContract({ ...portfolio(), functionName: 'forkController' })
		const branch = { abi: forkArtifact.abi, address: controller }
		const child = getChildUniverseId(universe, outcome)
		await fixture.base.mockWindow.setTime((await getUniverseData(owner, universe)).forkTime + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'startBranch', args: [universe, BigInt(outcome)] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'finalizeBranch', args: [child] }))
		for (let step = 0; step < 3; step++) await writeContractAndWait(owner, () => owner.writeContract({ ...forker(), functionName: 'materializePortfolioQuestion', args: [source, child] }))
		const pool = await owner.readContract({ ...portfolio(), functionName: 'getPool', args: [fixture.base.questionId, child] })
		return { pool, game: await gameFor(pool), universe: child }
	}
	const state = async (pool: Address, universe = fixture.base.genesisUniverse) => {
		const owner = fixture.owner()
		const game = await gameFor(pool)
		const ledger = await owner.readContract({ ...portfolio(), functionName: 'reporterLedger', args: [universe] })
		return {
			game,
			wallets: await Promise.all([owner, fixture.other()].map(sender => getERC20Balance(owner, getRepTokenAddress(universe), sender.account.address))),
			escrow: game === zeroAddress ? 0n : await owner.readContract({ abi: reporterArtifact.abi, address: ledger, functionName: 'balanceOfGame', args: [game] }),
			custody: await getERC20Balance(owner, getRepTokenAddress(universe), ledger),
			carry: game === zeroAddress ? undefined : await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getForkCarrySnapshot' }),
			deposits: game === zeroAddress ? undefined : await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getDepositsByOutcome', args: [1, 0n, 10n] }),
		}
	}
	const finalize = async (game: Address) => {
		const deadline = await fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		await fixture.base.mockWindow.setTime(deadline + DAY)
	}
	const rootProof = async (source: Address, index: bigint, tree: SparseNullifierTree) =>
		createCarryProof(fixture.owner(), source, { expectedOutcome: 1, parentDepositIndex: index, leafIndex: index, sourceNodeId: index + 1n, merkleMountainRangePeakIndex: 1n, merkleMountainRangeSiblings: [await readCarryLeafHash(fixture.owner(), source, 2n - index)], nullifierSiblings: tree.getProof(index) })

	test('unfunded reporting rolls back game creation and central custody', async () => {
		const owner = fixture.owner()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		const token = getRepTokenAddress(fixture.base.genesisUniverse)
		await approveToken(owner, token, sourcePool())
		const balance = await getERC20Balance(owner, token, owner.account.address)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'transfer', args: [fixture.other().account.address, balance] }))
		const before = await state(sourcePool())
		expect(before.game).toBe(zeroAddress)
		expect(before.wallets[0]).toBe(0n)
		await expect(owner.writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'depositWalletRepToEscalationGame', args: [1, 10n * unit] })).rejects.toThrow('SafeERC20Ops token call reverted')
		expect(await state(sourcePool())).toEqual(before)
		await deposit(fixture.other(), sourcePool(), 1, 10n * unit)
		expect(await gameFor(sourcePool())).not.toBe(zeroAddress)
	})

	test('active claims and mixed-depositor local batches revert without consuming any deposit', async () => {
		const owner = fixture.owner()
		const game = await prepareReports(true)
		const beforeActive = await state(sourcePool())
		await expect(owner.writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'withdrawFromEscalationGame', args: [1, [0n]] })).rejects.toThrow('Question not final')
		expect(await state(sourcePool())).toEqual(beforeActive)
		await finalize(game)
		const before = await state(sourcePool())
		await expect(owner.writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'withdrawFromEscalationGame', args: [1, [0n, 1n]] })).rejects.toThrow('One depositor')
		expect(await state(sourcePool())).toEqual(before)
		for (const index of [0n, 1n]) await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'withdrawFromEscalationGame', args: [1, [index]] }))
		const after = await state(sourcePool())
		expect(after.wallets[0]).toBe((before.wallets[0] ?? 0n) + 52n * unit)
		expect(after.wallets[1]).toBe((before.wallets[1] ?? 0n) + 60n * unit)
		expect(after.escrow).toBe(0n)
	})

	test.each([false, true])('a failed inherited batch restores prior proofs, transfers, and custody (different owners: %s)', async differentOwners => {
		const owner = fixture.owner()
		const source = await prepareReports(differentOwners)
		const child = await activate(sourcePool())
		await finalize(child.game)
		const before = await state(child.pool, child.universe)
		const tree = new SparseNullifierTree()
		const first = await rootProof(source, 0n, tree)
		tree.consume(0n)
		const second = await rootProof(source, 1n, tree)
		const bad = differentOwners ? second : { ...second, amountAttoRep: second.amountAttoRep + 1n }
		await expect(owner.writeContract({ abi: poolArtifact.abi, address: child.pool, functionName: 'withdrawForkedEscalationDeposits', args: [1, [first, bad]] })).rejects.toThrow(differentOwners ? 'One depositor' : 'Bad carry proof')
		expect(await state(child.pool, child.universe)).toEqual(before)
		for (const proof of [first, second]) await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: child.pool, functionName: 'withdrawForkedEscalationDeposits', args: [1, [proof]] }))
		const after = await state(child.pool, child.universe)
		expect(after.wallets[0]).toBe((before.wallets[0] ?? 0n) + (differentOwners ? 52n : 112n) * unit)
		expect(after.wallets[1]).toBe((before.wallets[1] ?? 0n) + (differentOwners ? 60n : 0n) * unit)
		expect(after.escrow).toBe(0n)
		await expect(owner.writeContract({ abi: poolArtifact.abi, address: child.pool, functionName: 'withdrawForkedEscalationDeposits', args: [1, [first]] })).rejects.toThrow('Bad nullifier proof')
	})

	test('an unresolved continuation accepts a funded opposing challenge during its response window', async () => {
		await prepareReports(false, 0n)
		const child = await activate(sourcePool(), fixture.base.genesisUniverse, 1, true)
		expect(await fixture.owner().readContract({ abi: gameArtifact.abi, address: child.game, functionName: 'getQuestionResolution' })).toBe(1n)
		await deposit(fixture.owner(), child.pool, 2, 200n * unit, child.universe)
		const balances = await fixture.owner().readContract({ abi: gameArtifact.abi, address: child.game, functionName: 'getOutcomeBalancesAttoRep' })
		expect(balances[2]).toBe(200n * unit)
	})

	test('root and child-local reporting leaves survive a second unrelated fork without replaying local IDs', async () => {
		const owner = fixture.owner()
		const source = await prepareReports()
		const child = await activate(sourcePool(), fixture.base.genesisUniverse, 1, true)
		await deposit(owner, child.pool, 1, 30n * unit, child.universe)
		const childSnapshot = await owner.readContract({ abi: gameArtifact.abi, address: child.game, functionName: 'getForkCarrySnapshot' })
		const grandchild = await activate(child.pool, child.universe)
		const snapshot = await owner.readContract({ abi: gameArtifact.abi, address: grandchild.game, functionName: 'getForkCarrySnapshot' })
		expect(snapshot).toEqual(childSnapshot)
		expect(snapshot[1][1]).toBe(3n)
		await finalize(grandchild.game)
		const before = await state(grandchild.pool, grandchild.universe)
		const tree = new SparseNullifierTree()
		for (const index of [0n, 1n]) {
			const root = await rootProof(source, index, tree)
			const proof = { ...root, merkleMountainRangeSiblings: [...root.merkleMountainRangeSiblings, await readCarryLeafHash(owner, child.game, 1n)] }
			await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: grandchild.pool, functionName: 'withdrawForkedEscalationDeposits', args: [1, [proof]] }))
			tree.consume(index)
		}
		const localId = computeForkContinuationParentDepositIndex(child.game, 1, 0n)
		const local = await createCarryProof(owner, child.game, {
			expectedOutcome: 1,
			parentDepositIndex: localId,
			sourceNodeId: 1n,
			leafIndex: 2n,
			merkleMountainRangePeakIndex: 0n,
			merkleMountainRangeSiblings: [hashParent(await readCarryLeafHash(owner, source, 1n), await readCarryLeafHash(owner, source, 2n))],
			nullifierSiblings: tree.getProof(localId),
		})
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: grandchild.pool, functionName: 'withdrawForkedEscalationDeposits', args: [1, [local]] }))
		const after = await state(grandchild.pool, grandchild.universe)
		expect(after.wallets[0]).toBe((before.wallets[0] ?? 0n) + 142n * unit)
		expect(after.escrow).toBe(0n)
		await expect(owner.writeContract({ abi: poolArtifact.abi, address: grandchild.pool, functionName: 'withdrawForkedEscalationDeposits', args: [1, [local]] })).rejects.toThrow('Bad nullifier proof')
	})
})
