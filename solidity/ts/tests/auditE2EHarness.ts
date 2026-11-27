import { expect } from 'bun:test'
import { decodeEventLog, toEventSelector, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_QuestionForker_QuestionForker as forkerArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as coordinatorArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_tokens_ShareToken_ShareToken as shareArtifact,
	Zoltar_Zoltar as zoltarArtifact,
} from '../types/contractArtifact'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { BURN_ADDRESS, DAY, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { approveToken, getChildUniverseId, getERC20Balance } from '../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress, splitMigrationRep } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { hashCarryLeaf, hashParent, SparseNullifierTree } from './carryProofHelpers'
import type { useSecurityPoolFixture } from './statoblast/securityPoolFixture'

// Shared end-to-end harness for the auditE2E* integration tests. It drives the real
// security pool fixture through native forks and rebuilds carry proofs from on-chain nodes.

export const INVALID = 0
export const YES = 1
export const NO = 2
export const NONE = 3n
export const OUTCOMES = [INVALID, YES, NO] as const
export const BRANCH_GAS = 16_777_216n
export const WEEK = 7n * DAY

export type CarryLeaf = {
	hash: Hex
	depositor: Address
	amount: bigint
	parentDepositIndex: bigint
	cumulative: bigint
	sourceNodeId: bigint
	leafIndex: bigint
	game: Address
	/** Index inside the owning game's local deposit list for this outcome. */
	localIndex: bigint
}

const subtreeHash = (hashes: readonly Hex[], start: number, height: number): Hex => {
	if (height === 0) {
		const leaf = hashes[start]
		if (leaf === undefined) throw new Error(`Missing carry leaf ${start}`)
		return leaf
	}
	const half = 2 ** (height - 1)
	return hashParent(subtreeHash(hashes, start, height - 1), subtreeHash(hashes, start + half, height - 1))
}

const peaksOf = (leafCount: number) => {
	const peaks: { height: number; start: number }[] = []
	let start = 0
	for (let height = 31; height >= 0; height--) {
		if (((leafCount >> height) & 1) === 0) continue
		peaks.push({ height, start })
		start += 2 ** height
	}
	return peaks
}

/** Sibling list and peak height in the exact layout `computeMerkleMountainRangeRootFromProof` expects. */
const buildMmrProof = (hashes: readonly Hex[], leafIndex: number) => {
	const peaks = peaksOf(hashes.length)
	const own = peaks.find(peak => leafIndex >= peak.start && leafIndex < peak.start + 2 ** peak.height)
	if (own === undefined) throw new Error('Leaf is outside the carry range')
	const siblings: Hex[] = []
	const offset = leafIndex - own.start
	for (let level = 0; level < own.height; level++) {
		const block = (offset >> level) ^ 1
		siblings.push(subtreeHash(hashes, own.start + block * 2 ** level, level))
	}
	for (const peak of [...peaks].sort((left, right) => left.height - right.height)) {
		if (peak.height === own.height) continue
		siblings.push(subtreeHash(hashes, peak.start, peak.height))
	}
	return { siblings, peakHeight: BigInt(own.height) }
}

/** Mirror of `EscalationGameProofVerifier.computeAllocatedWinningWithdrawal` for unscaled claims. */
export const expectedWinningClaim = (amount: bigint, cumulative: bigint, binding: bigint, winningBalance: bigint) => {
	const cap = binding + binding / 2n
	const eligiblePrincipal = winningBalance < cap ? winningBalance : cap
	if (eligiblePrincipal === 0n) return { payout: amount, burn: 0n }
	const start = cumulative - amount
	const end = cumulative < cap ? cumulative : cap
	let eligible = end > start ? end - start : 0n
	if (eligible > amount) eligible = amount
	return { payout: amount + (eligible * ((binding * 3n) / 5n)) / eligiblePrincipal, burn: (eligible * ((binding * 2n) / 5n)) / eligiblePrincipal }
}

export const median = (values: readonly [bigint, bigint, bigint]) => {
	const [low, middle, high] = values
	const smaller = low < middle ? low : middle
	const larger = low < middle ? middle : low
	if (high <= smaller) return smaller
	return high < larger ? high : larger
}

type Fixture = ReturnType<typeof useSecurityPoolFixture>

export function createE2E(fixture: Fixture) {
	const owner = () => fixture.owner()
	const mock = () => fixture.base.mockWindow
	const account = (index: number) => {
		const address = TEST_ADDRESSES[index]
		if (address === undefined) throw new Error(`No test account ${index}`)
		return createWriteClient(mock(), address)
	}
	const securityPool = () => ({ abi: securityPoolArtifact.abi, address: fixture.securityPool })
	const forker = () => ({ abi: forkerArtifact.abi, address: getInfraContractAddresses().questionForker })
	const zoltar = () => ({ abi: zoltarArtifact.abi, address: getZoltarAddress() })
	const coordinator = async () => ({ abi: coordinatorArtifact.abi, address: await owner().readContract({ ...securityPool(), functionName: 'forkController' }) })
	const reporterLedger = (universe: bigint) => owner().readContract({ ...securityPool(), functionName: 'reporterLedger', args: [universe] })
	const capital = (universe: bigint) => owner().readContract({ ...securityPool(), functionName: 'capitalLedger', args: [universe] })
	const settlement = () => owner().readContract({ ...securityPool(), functionName: 'settlement' })
	const services = () => owner().readContract({ ...securityPool(), functionName: 'services' })
	const collateral = () => owner().readContract({ ...securityPool(), functionName: 'collateralToken' })
	const book = async () => ({ abi: bookArtifact.abi, address: await owner().readContract({ abi: settlementArtifact.abi, address: await settlement(), functionName: 'ledger' }) })
	const bookId = async (universe: bigint) => owner().readContract({ abi: settlementArtifact.abi, address: await settlement(), functionName: 'bookIds', args: [universe] })
	const bookQuestion = async (universe: bigint, questionId: bigint) => owner().readContract({ ...(await book()), functionName: 'question', args: [await bookId(universe), questionId] })
	const bookTotals = async (universe: bigint) => owner().readContract({ ...(await book()), functionName: 'totals', args: [await bookId(universe)] })
	const rep = (universe: bigint, holder: Address) => getERC20Balance(owner(), getRepTokenAddress(universe), holder)
	const cash = async (holder: Address) => getERC20Balance(owner(), await collateral(), holder)
	const supply = (universe: bigint) => owner().readContract({ ...zoltar(), functionName: 'getUniverseTheoreticalSupplyAttoRep', args: [universe] })
	const burned = () => rep(fixture.base.genesisUniverse, addressString(BURN_ADDRESS))
	const forkTime = async (universe: bigint) => (await getUniverseData(owner(), universe)).forkTime
	const gameOf = (pool: Address) => owner().readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGame' })
	const poolOf = (questionId: bigint, universe: bigint) => owner().readContract({ ...securityPool(), functionName: 'getQuestionLedger', args: [questionId, universe] })
	const game = (address: Address) => ({ abi: gameArtifact.abi, address })
	const ledgerQuestion = async (universe: bigint, questionId: bigint) => owner().readContract({ abi: reporterArtifact.abi, address: await reporterLedger(universe), functionName: 'question', args: [universe, questionId] })
	const ledgerBook = async (universe: bigint) => {
		const [liveAttoRep, finalAttoRep, , , , , exists, isSealed] = await owner().readContract({ abi: reporterArtifact.abi, address: await reporterLedger(universe), functionName: 'books', args: [universe] })
		return { liveAttoRep, finalAttoRep, exists, isSealed }
	}
	const gameBalance = async (address: Address) => owner().readContract({ abi: reporterArtifact.abi, address: await reporterLedger(fixture.base.genesisUniverse), functionName: 'balanceOfGame', args: [address] })
	const balances = (address: Address) => owner().readContract({ ...game(address), functionName: 'getOutcomeBalancesAttoRep' })

	/** A new question that has already ended, so anyone can fork a universe on it. */
	const unrelatedQuestion = async (title: string) => {
		const data = { ...fixture.base.questionData, title, endTime: (await mock().getTime()) - 1n }
		await createQuestion(owner(), data, fixture.base.outcomes)
		return getQuestionId(data, fixture.base.outcomes)
	}
	const forkOn = async (sender: WriteClient, universe: bigint, questionId: bigint) => {
		await approveToken(sender, getRepTokenAddress(universe), getZoltarAddress())
		await forkUniverse(sender, universe, questionId)
		return forkTime(universe)
	}
	/** Mint child REP for `sender` in one branch by burning parent REP into migration. */
	const migrateWalletRep = async (sender: WriteClient, universe: bigint, amount: bigint, outcomes: number[]) => {
		await approveToken(sender, getRepTokenAddress(universe), getZoltarAddress())
		await addRepToMigrationBalance(sender, universe, amount)
		await splitMigrationRep(sender, universe, amount, outcomes)
	}
	/** `choose` must fit the per-transaction gas cap once the fork is frozen and the branch prepared. */
	const choose = async (sender: WriteClient, universe: bigint, outcome: number) => {
		const target = await coordinator()
		await writeContractAndWait(sender, () => sender.writeContract({ ...target, functionName: 'freeze', args: [universe], gas: BRANCH_GAS }))
		await writeContractAndWait(sender, () => sender.writeContract({ ...target, functionName: 'prepareBranch', args: [universe, BigInt(outcome)], gas: BRANCH_GAS }))
		const hash = await writeContractAndWait(sender, () => sender.writeContract({ ...target, functionName: 'choose', args: [universe, BigInt(outcome)], gas: BRANCH_GAS }))
		return (await sender.getTransactionReceipt({ hash })).gasUsed
	}
	const freeze = async (universe: bigint, sender = owner()) => {
		const target = await coordinator()
		await writeContractAndWait(sender, () => sender.writeContract({ ...target, functionName: 'freeze', args: [universe], gas: BRANCH_GAS }))
	}
	/** Each branch step is its own transaction, as on mainnet. `finalize` can be skipped to interleave an auction. */
	const startBranch = async (parent: bigint, outcome: number, sender = owner()) => {
		const target = await coordinator()
		const choiceDeadline = (await forkTime(parent)) + 8n * WEEK
		if ((await mock().getTime()) < choiceDeadline) await mock().setTime(choiceDeadline)
		await freeze(parent, sender)
		await writeContractAndWait(sender, () => sender.writeContract({ ...target, functionName: 'prepareBranch', args: [parent, BigInt(outcome)], gas: BRANCH_GAS }))
		await writeContractAndWait(sender, () => sender.writeContract({ ...target, functionName: 'startBranch', args: [parent, BigInt(outcome)], gas: BRANCH_GAS }))
		return getChildUniverseId(parent, outcome)
	}
	const finalizeBranch = async (parent: bigint, outcome: number, sender = owner()) => {
		const target = await coordinator()
		const child = getChildUniverseId(parent, outcome)
		const deadline = (await forkTime(parent)) + 9n * WEEK
		if ((await mock().getTime()) < deadline) await mock().setTime(deadline)
		await writeContractAndWait(sender, () => sender.writeContract({ ...target, functionName: 'finalizeBranch', args: [child], gas: BRANCH_GAS }))
		return child
	}
	const activateBranch = async (parent: bigint, outcome: number, sender = owner()) => {
		await startBranch(parent, outcome, sender)
		return finalizeBranch(parent, outcome, sender)
	}
	const activationTime = async (universe: bigint) => {
		const [, wallAnchor] = await owner().readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'clocks', args: [universe] })
		return BigInt(wallAnchor)
	}
	const materialize = async (source: Address, child: bigint, sender = owner()) => {
		for (let step = 0; step < 3; step++) await writeContractAndWait(sender, () => sender.writeContract({ ...forker(), functionName: 'materializeSecurityPoolQuestion', args: [source, child], gas: BRANCH_GAS }))
		const questionId = await owner().readContract({ abi: poolArtifact.abi, address: source, functionName: 'questionId' })
		const pool = await poolOf(questionId, child)
		return { pool, game: await gameOf(pool), universe: child }
	}
	const deposit = async (sender: WriteClient, pool: Address, outcome: number, amount: bigint) => {
		const universe = await owner().readContract({ abi: poolArtifact.abi, address: pool, functionName: 'universeId' })
		const token = getRepTokenAddress(universe)
		const before = await getERC20Balance(owner(), token, sender.account.address)
		await approveToken(sender, token, pool)
		await writeContractAndWait(sender, () => sender.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
		return before - (await getERC20Balance(owner(), token, sender.account.address))
	}

	/** Every local deposit node of one game, in creation order. */
	const readNodes = async (address: Address) => {
		const nodes: { id: bigint; parentNodeId: bigint; depositor: Address; outcome: bigint; amount: bigint; parentDepositIndex: bigint; cumulative: bigint; carryLeafIndex: bigint }[] = []
		for (let id = 1n; ; id++) {
			const [parentNodeId, depositor, outcome, amount, parentDepositIndex, cumulative, carryLeafIndex] = await owner().readContract({ ...game(address), functionName: 'nodes', args: [id] })
			if (depositor === zeroAddress) return nodes
			nodes.push({ id, parentNodeId, depositor, outcome: BigInt(outcome), amount, parentDepositIndex, cumulative, carryLeafIndex })
		}
	}
	/** The exported carry leaves of one outcome after walking `lineage` (oldest game first). */
	const lineageLeaves = async (lineage: readonly Address[], outcome: number) => {
		const leaves: CarryLeaf[] = []
		for (const address of lineage) {
			const local = (await readNodes(address)).filter(node => node.outcome === BigInt(outcome))
			for (const [localIndex, node] of local.entries()) {
				if (node.carryLeafIndex !== BigInt(leaves.length)) throw new Error(`Carry leaf index ${node.carryLeafIndex} does not continue the lineage at ${leaves.length}`)
				leaves.push({
					hash: hashCarryLeaf(node.depositor, outcome, node.amount, node.parentDepositIndex, node.cumulative, node.id),
					depositor: node.depositor,
					amount: node.amount,
					parentDepositIndex: node.parentDepositIndex,
					cumulative: node.cumulative,
					sourceNodeId: node.id,
					leafIndex: BigInt(leaves.length),
					game: address,
					localIndex: BigInt(localIndex),
				})
			}
		}
		return leaves
	}
	/** The deposits made in one game itself, positioned where they sit in that game's exported carry range. */
	const localLeaves = async (address: Address, outcome: number) =>
		(await readNodes(address))
			.filter(node => node.outcome === BigInt(outcome))
			.map(
				(node, localIndex): CarryLeaf => ({
					hash: hashCarryLeaf(node.depositor, outcome, node.amount, node.parentDepositIndex, node.cumulative, node.id),
					depositor: node.depositor,
					amount: node.amount,
					parentDepositIndex: node.parentDepositIndex,
					cumulative: node.cumulative,
					sourceNodeId: node.id,
					leafIndex: node.carryLeafIndex,
					game: address,
					localIndex: BigInt(localIndex),
				}),
			)
	const proofFor = (leaves: readonly CarryLeaf[], leaf: CarryLeaf, tree: SparseNullifierTree) => {
		const { siblings, peakHeight } = buildMmrProof(
			leaves.map(entry => entry.hash),
			Number(leaf.leafIndex),
		)
		return {
			depositor: leaf.depositor,
			amountAttoRep: leaf.amount,
			parentDepositIndex: leaf.parentDepositIndex,
			cumulativeAmountAttoRep: leaf.cumulative,
			sourceNodeId: leaf.sourceNodeId,
			leafIndex: leaf.leafIndex,
			merkleMountainRangeSiblings: siblings,
			merkleMountainRangePeakIndex: peakHeight,
			nullifierSiblings: tree.getProof(leaf.leafIndex),
		}
	}
	/** Claims `claimed` (all owned by one depositor) in a single transaction and returns the wallet delta. */
	const claimInherited = async (sender: WriteClient, pool: Address, outcome: number, leaves: readonly CarryLeaf[], claimed: readonly CarryLeaf[], tree: SparseNullifierTree) => {
		const universe = await owner().readContract({ abi: poolArtifact.abi, address: pool, functionName: 'universeId' })
		const beneficiary = claimed[0]?.depositor
		if (beneficiary === undefined) throw new Error('Nothing to claim')
		const before = await rep(universe, beneficiary)
		// Each proof's nullifier path is built against the tree as the previous proofs in this batch left it.
		const proofs: ReturnType<typeof proofFor>[] = []
		for (const leaf of claimed) {
			proofs.push(proofFor(leaves, leaf, tree))
			tree.consume(leaf.leafIndex)
		}
		const supplyBefore = await supply(universe)
		const hash = await writeContractAndWait(sender, () => sender.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'withdrawForkedEscalationDeposits', args: [outcome, proofs], gas: BRANCH_GAS }))
		const receipt = await sender.getTransactionReceipt({ hash })
		const claimEvent = gameArtifact.abi.find(item => item.type === 'event' && item.name === 'ClaimDeposit')
		if (claimEvent === undefined) throw new Error('ClaimDeposit event missing')
		let emittedBurn = 0n
		for (const log of receipt.logs) {
			if (log.topics[0] !== toEventSelector(claimEvent)) continue
			const claim = decodeEventLog({ abi: gameArtifact.abi, data: log.data, topics: log.topics })
			if (claim.eventName === 'ClaimDeposit') emittedBurn += claim.args.burnAmountAttoRep
		}
		expect(emittedBurn).toBe(supplyBefore - (await supply(universe)))
		const prepaidEvent = gameArtifact.abi.find(item => item.type === 'event' && item.name === 'WinningHaircutPrepaid')
		if (prepaidEvent === undefined) throw new Error('WinningHaircutPrepaid event missing')
		const paidByFork = await sender.readContract({ ...game(await gameOf(pool)), functionName: 'winnerHaircutPaidByFork' })
		expect(receipt.logs.some(log => log.topics[0] === toEventSelector(prepaidEvent))).toBe(paidByFork)
		return (await rep(universe, beneficiary)) - before
	}
	/** Every depositor claims all of their carried deposits on the winning outcome, newest first, with exact payouts. */
	const claimEveryWinner = async (sender: WriteClient, pool: Address, outcome: number, leaves: readonly CarryLeaf[], binding: bigint, winningBalance: bigint, tree = new SparseNullifierTree()) => {
		let paid = 0n
		let burn = 0n
		for (const depositor of [...new Set(leaves.map(leaf => leaf.depositor))].reverse()) {
			const mine = leaves.filter(leaf => leaf.depositor === depositor).reverse()
			const expected = mine.map(leaf => expectedWinningClaim(leaf.amount, leaf.cumulative, binding, winningBalance))
			const received = await claimInherited(sender, pool, outcome, leaves, mine, tree)
			expect(received).toBe(expected.reduce((sum, claim) => sum + claim.payout, 0n))
			paid += received
			burn += expected.reduce((sum, claim) => sum + claim.burn, 0n)
			const again = mine[0]
			if (again !== undefined) await expect(simulateInheritedClaim(sender, pool, outcome, leaves, again, tree)).rejects.toThrow()
		}
		return { paid, burn, tree }
	}
	const simulateInheritedClaim = (sender: WriteClient, pool: Address, outcome: number, leaves: readonly CarryLeaf[], leaf: CarryLeaf, tree: SparseNullifierTree) =>
		sender.simulateContract({ abi: poolArtifact.abi, address: pool, functionName: 'withdrawForkedEscalationDeposits', args: [outcome, [proofFor(leaves, leaf, tree)]] })
	const claimLocal = async (sender: WriteClient, pool: Address, outcome: number, indexes: readonly bigint[], beneficiary: Address) => {
		const universe = await owner().readContract({ abi: poolArtifact.abi, address: pool, functionName: 'universeId' })
		const before = await rep(universe, beneficiary)
		await writeContractAndWait(sender, () => sender.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'withdrawFromEscalationGame', args: [outcome, [...indexes]], gas: BRANCH_GAS }))
		return (await rep(universe, beneficiary)) - before
	}
	const sweep = (sender: WriteClient, address: Address) => writeContractAndWait(sender, () => sender.writeContract({ ...game(address), functionName: 'sweepResidualRepToQuestionLedger', gas: BRANCH_GAS }))
	const shares = (questionId = fixture.base.questionId) => ({ abi: shareArtifact.abi, address: fixture.poolFor(questionId).shareToken })
	const shareBalance = (holder: Address, universe: bigint, outcome: number, questionId = fixture.base.questionId) => owner().readContract({ ...shares(questionId), functionName: 'balanceOf', args: [holder, universe * 256n + BigInt(outcome)] })
	const migrateShares = async (sender: WriteClient, universe: bigint, outcome: number, branches: number[], questionId = fixture.base.questionId) =>
		writeContractAndWait(sender, () => sender.writeContract({ ...shares(questionId), functionName: 'migrate', args: [universe * 256n + BigInt(outcome), branches.map(BigInt)], gas: BRANCH_GAS }))
	const redeemShares = async (sender: WriteClient, pool: Address) => {
		const universe = await owner().readContract({ abi: poolArtifact.abi, address: pool, functionName: 'universeId' })
		const before = { cash: await cash(sender.account.address), rep: await rep(universe, sender.account.address) }
		await writeContractAndWait(sender, () => sender.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'redeemShares', args: [], gas: BRANCH_GAS }))
		return { cash: (await cash(sender.account.address)) - before.cash, rep: (await rep(universe, sender.account.address)) - before.rep }
	}

	return {
		owner,
		mock,
		account,
		securityPool,
		forker,
		zoltar,
		coordinator,
		reporterLedger,
		capital,
		settlement,
		services,
		collateral,
		book,
		bookId,
		bookQuestion,
		bookTotals,
		rep,
		cash,
		supply,
		burned,
		forkTime,
		gameOf,
		poolOf,
		game,
		ledgerQuestion,
		ledgerBook,
		gameBalance,
		balances,
		unrelatedQuestion,
		forkOn,
		migrateWalletRep,
		choose,
		freeze,
		startBranch,
		finalizeBranch,
		activateBranch,
		activationTime,
		materialize,
		deposit,
		readNodes,
		lineageLeaves,
		localLeaves,
		proofFor,
		claimInherited,
		claimEveryWinner,
		simulateInheritedClaim,
		claimLocal,
		sweep,
		shares,
		shareBalance,
		migrateShares,
		redeemShares,
	}
}
