import { describe, expect, test } from 'bun:test'
import { encodeFunctionData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { preparePortfolioCollateralRepairAuction } from './securityPoolPortfolioCollateralRepairAuctionFixture'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addRepToMigrationBalance, forkUniverse, getZoltarForkThreshold, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import {
	statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuction as auctionArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as engineArtifact,
	statoblast_SecurityPoolAuctionVault_SecurityPoolAuctionVault as vaultArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'

type Measurement = { label: string; gas: bigint; status: 'success' | 'reverted' }
type Bid = { id: bigint; vault: Address }
const bestPrice = 3n * unit
const tiedPrice = 6n * unit
const losingPrice = 50n * unit
const health = 12_000n
const bookSizes = [8, 256] as const
// Branch closing, the first branch choice and branch starting deploy child modules.
const branchTransactions = new Set(['close: finalize branch and install the auction cohort', 'fork: unmaterialized winner chooses a branch', 'fork: start the chosen branch'])
const setHealthTargetData = (target: bigint) => encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'setHealthTarget', args: [target] })
const claimEarningsData = encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'claimEarnings' })
const setCommitmentData = (commitment: bigint) => encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'setCommitment', args: [commitment] })
const withdrawPrincipalData = (amount: bigint, recipient: Address) => encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'withdrawPrincipal', args: [amount, recipient] })

// Production composition: the portfolio fork coordinator, the real uniform-price
// engine with its AVL bid tree, one isolated vault per bid and the child capital
// ledger. Every measured amount is receipt gas, net of refunds.
// A larger tied book only grows logarithmic tree paths; the bounded-growth check
// guards the owner, keeper and bidder paths against a history-dependent loop.
describe('Statoblast: collateral-repair-auction lifecycle gas baselines', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const reports = new Map<number, Measurement[]>()
	for (const bookSize of bookSizes) {
		test(`a ${bookSize}-bid tied book keeps bidding, refunds, vault, fee, retirement, liquidation and fork paths bounded`, async () => {
			const context = await preparePortfolioCollateralRepairAuction(fixture)
			const { owner, other, mock } = context
			const filler = createWriteClient(mock, TEST_ADDRESSES[2])
			const keeper = createWriteClient(mock, TEST_ADDRESSES[3])
			const stranger = createWriteClient(mock, TEST_ADDRESSES[4])
			const measurements: Measurement[] = []
			const record = (label: string, gas: bigint, status: Measurement['status'] = 'success') => {
				measurements.push({ label, gas, status })
				return gas
			}
			const gasOf = async (label: string, client: WriteClient, send: () => Promise<Hex>) => {
				const hash = await writeContractAndWait(client, send)
				return record(label, (await client.waitForTransactionReceipt({ hash })).gasUsed)
			}
			// The usual client replays reverted sends as errors. Mine the deliberately
			// failing transaction and read its receipt to record the failure-path cost.
			const revertedGasOf = async (label: string, client: WriteClient, to: Address, data: Hex) => {
				const hash = await mock.requestRaw({ method: 'eth_sendTransaction', params: [{ from: client.account.address, to, data, gas: '0x4c4b40', gasPrice: '0x0' }] })
				if (typeof hash !== 'string') throw new Error('Missing reverted transaction hash')
				await mock.requestRaw({ method: 'evm_mine', params: [] })
				const receipt = await mock.requestRaw({ method: 'eth_getTransactionReceipt', params: [hash] })
				if (typeof receipt !== 'object' || receipt === null || !('status' in receipt) || !('gasUsed' in receipt) || typeof receipt.gasUsed !== 'string') throw new Error('Missing reverted transaction receipt')
				expect(receipt.status).toBe('0x0')
				return record(label, BigInt(receipt.gasUsed), 'reverted')
			}
			const auction = { abi: auctionArtifact.abi, address: context.auction } as const
			const engine = { abi: engineArtifact.abi, address: context.engine } as const
			const capital = { abi: capitalArtifact.abi, address: context.capital } as const
			const token = { abi: tokenArtifact.abi, address: context.token } as const
			const forks = { abi: forkArtifact.abi, address: context.forks } as const
			const bid = async (label: string | undefined, bidder: WriteClient, lots: bigint, price: bigint): Promise<Bid> => {
				const id = (await bidder.readContract({ ...engine, functionName: 'bidCount' })) + 1n
				const send = () => bidder.writeContract({ ...auction, functionName: 'submitBid', args: [lots, price, health], value: lots * unit })
				if (label === undefined) await writeContractAndWait(bidder, send)
				else await gasOf(label, bidder, send)
				const [, vault] = await bidder.readContract({ ...engine, functionName: 'bids', args: [id] })
				return { id, vault }
			}
			const executeData = (target: Address, data: Hex) => encodeFunctionData({ abi: vaultArtifact.abi, functionName: 'execute', args: [target, 0n, data] })
			const vaultCall = (label: string, client: WriteClient, vault: Address, target: Address, data: Hex, sweep = false) =>
				gasOf(label, client, () =>
					sweep ? client.writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'executeAndSweep', args: [target, 0n, data, context.token, client.account.address] }) : client.writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'execute', args: [target, 0n, data] }),
				)
			// Anvil consumes a snapshot on revert; restoring re-arms the same point.
			const snapshot = async (): Promise<{ id: string }> => ({ id: await mock.anvilSnapshot() })
			const restore = async (point: { id: string }) => {
				await mock.anvilRevert(point.id)
				point.id = await mock.anvilSnapshot()
			}
			const fill = (id: bigint) => owner.readContract({ ...engine, functionName: 'previewBid', args: [id] })
			const positionIdOf = async (vault: Address) => (await owner.readContract({ ...capital, functionName: 'ownerAccount', args: [vault] })).positionId
			const claim = (label: string, client: WriteClient, vault: Address) => vaultCall(label, client, vault, context.capital, claimEarningsData, true)

			await context.report()
			await context.open()
			// The measured winner leads the book; the early loser is admissible until
			// strictly better tied demand covers the five saleable lots.
			const winner = await bid('bid: first bid in an empty book', other, 2n, bestPrice)
			const loser = await bid('bid: later losing bid', other, 1n, losingPrice)
			let lastFiller: Bid | undefined
			for (let count = 1; count <= bookSize; count++) lastFiller = await bid(count === bookSize ? 'bid: last tied bid in the book' : undefined, filler, 1n, tiedPrice)
			if (lastFiller === undefined) throw new Error('Missing tied bids')
			await revertedGasOf('refund failure: credit a bid that may still win', owner, context.auction, encodeFunctionData({ abi: auctionArtifact.abi, functionName: 'settleRefund', args: [winner.id] }))
			const earlySnapshot = await snapshot()
			await gasOf('early refund: permissionless credit', owner, () => owner.writeContract({ ...auction, functionName: 'settleRefund', args: [loser.id] }))
			await gasOf('early refund: bidder withdrawal', other, () => other.writeContract({ ...auction, functionName: 'withdrawRefunds', args: [stranger.account.address] }))
			await gasOf('refund: withdrawal with no credit', other, () => other.writeContract({ ...auction, functionName: 'withdrawRefunds', args: [stranger.account.address] }))
			await restore(earlySnapshot)
			await gasOf('early refund: combined credit and withdrawal by the bidder', other, () => other.writeContract({ ...auction, functionName: 'settleAndWithdrawRefund', args: [loser.id, stranger.account.address] }))
			await restore(earlySnapshot)
			await gasOf('early refund: permissionless credit before a combined withdrawal', owner, () => owner.writeContract({ ...auction, functionName: 'settleRefund', args: [loser.id] }))
			await gasOf('early refund: combined withdrawal after someone else credited', other, () => other.writeContract({ ...auction, functionName: 'settleAndWithdrawRefund', args: [loser.id, stranger.account.address] }))
			await revertedGasOf('refund failure: combined withdrawal with nothing left', other, context.auction, encodeFunctionData({ abi: auctionArtifact.abi, functionName: 'settleAndWithdrawRefund', args: [loser.id, stranger.account.address] }))
			await restore(earlySnapshot)
			await context.closingQuote()
			await mock.setTime(context.deadline)
			await gasOf('close: finalize branch and install the auction cohort', owner, () => owner.writeContract({ ...forks, functionName: 'finalizeBranch', args: [context.child] }))
			expect((await fill(winner.id)).filledLots).toBe(2n)
			expect((await fill(loser.id)).filledLots).toBe(0n)
			let partial: Bid | undefined
			let empty: Bid | undefined
			for (let id = lastFiller.id; id > loser.id && (partial === undefined || empty === undefined); id--) {
				const result = await fill(id)
				if (result.filledLots === 0n && empty === undefined) empty = { id, vault: result.vault }
				if (result.filledLots !== 0n && partial === undefined) partial = { id, vault: result.vault }
			}
			if (partial === undefined || empty === undefined) throw new Error('Expected both partial and unfilled tied bids')
			const cohort = await owner.readContract({ ...capital, functionName: 'auctionCohort' })
			const finalized = await snapshot()

			// Refunds after closing: the full loser, an unfilled tied bid, and an
			// unfilled bid credited by a keeper before the bidder withdraws.
			await gasOf('refund: credit the fully unfilled loser after closing', owner, () => owner.writeContract({ ...auction, functionName: 'settleRefund', args: [loser.id] }))
			await gasOf('refund: credit an unfilled tied bid after closing', owner, () => owner.writeContract({ ...auction, functionName: 'settleRefund', args: [empty.id] }))
			await gasOf('refund: bidder withdrawal after closing', other, () => other.writeContract({ ...auction, functionName: 'withdrawRefunds', args: [other.account.address] }))
			await gasOf('refund: credit a partially filled bid after closing', owner, () => owner.writeContract({ ...auction, functionName: 'settleRefund', args: [partial.id] }))
			await revertedGasOf('refund failure: credit an already credited bid', owner, context.auction, encodeFunctionData({ abi: auctionArtifact.abi, functionName: 'settleRefund', args: [partial.id] }))
			await restore(finalized)
			await gasOf('refund: combined credit and withdrawal of the unfilled loser after closing', other, () => other.writeContract({ ...auction, functionName: 'settleAndWithdrawRefund', args: [loser.id, other.account.address] }))
			await gasOf('refund: combined credit and withdrawal of an unfilled tied bid after closing', filler, () => filler.writeContract({ ...auction, functionName: 'settleAndWithdrawRefund', args: [empty.id, filler.account.address] }))
			await restore(finalized)

			// Owner vault operations: the first voluntary operation materializes the
			// winner's share of the cohort; later operations should not repeat it.
			await revertedGasOf('vault failure: operation by a non-owner', stranger, winner.vault, executeData(context.capital, setHealthTargetData(health)))
			const firstOwnerOperation = await vaultCall('vault: first owner operation (materializes)', other, winner.vault, context.capital, setHealthTargetData(health))
			expect(await positionIdOf(winner.vault)).not.toBe(0n)
			const secondOwnerOperation = await vaultCall('vault: second owner operation', other, winner.vault, context.capital, setHealthTargetData(health))
			const thirdOwnerOperation = await vaultCall('vault: third owner operation', other, winner.vault, context.capital, setHealthTargetData(health))
			const recovery = encodeFunctionData({ abi: tokenArtifact.abi, functionName: 'transfer', args: [filler.account.address, 0n] })
			await vaultCall('vault: unfilled bid recovery operation', filler, empty.vault, context.token, recovery)
			await vaultCall('vault: unfilled bid repeated recovery operation', filler, empty.vault, context.token, recovery)
			await writeContractAndWait(owner, () => owner.writeContract({ ...token, functionName: 'transfer', args: [other.account.address, 20n * unit] }))
			await approveToken(other, context.token, winner.vault)
			await gasOf('vault: deposit principal after materialization', other, () => other.writeContract({ abi: vaultArtifact.abi, address: winner.vault, functionName: 'depositPrincipal', args: [context.capital, unit, health] }))
			await vaultCall('vault: withdraw principal and sweep', other, winner.vault, context.capital, withdrawPrincipalData(unit, winner.vault), true)
			await revertedGasOf('vault failure: owner operation that reverts in the ledger', other, winner.vault, executeData(context.capital, withdrawPrincipalData(1_000n * unit, winner.vault)))
			await restore(finalized)
			await gasOf('keeper: materialize a winner', keeper, () => keeper.writeContract({ ...capital, functionName: 'materializeAuctionBid', args: [winner.id] }))
			await gasOf('keeper: repeat materialization of the same winner', keeper, () => keeper.writeContract({ ...capital, functionName: 'materializeAuctionBid', args: [winner.id] }))
			const firstAfterKeeper = await vaultCall('vault: first owner operation after keeper materialization', other, winner.vault, context.capital, setHealthTargetData(health))
			const secondAfterKeeper = await vaultCall('vault: second owner operation after keeper materialization', other, winner.vault, context.capital, setHealthTargetData(health))
			await restore(finalized)

			// Fee claims: the winner's first claim detaches its frozen auction fee
			// ownership; the second claim is an ordinary owner claim.
			await mock.advanceTime(2n * DAY)
			await context.report()
			await gasOf('fees: permissionless ledger checkpoint', stranger, () => stranger.writeContract({ ...capital, functionName: 'checkpoint' }))
			await claim('fees: first claim by an unmaterialized winner', other, winner.vault)
			await claim('fees: second claim', other, winner.vault)
			await mock.advanceTime(DAY)
			await claim('fees: claim after one more vested day', other, winner.vault)
			const retirementHistory = await snapshot()
			// Retirement with prior retirement history from another winner and the incumbent.
			await materializedPositionId(partial)
			await vaultCall('retirement: another winner requests retirement', filler, partial.vault, context.capital, setCommitmentData(0n))
			await gasOf('retirement: incumbent requests partial retirement', owner, () => owner.writeContract({ ...capital, functionName: 'setCommitment', args: [100n * unit] }))
			await materializedPositionId(winner)
			await vaultCall('retirement: winner requests retirement after history', other, winner.vault, context.capital, setCommitmentData(0n))
			await gasOf('retirement: permissionless service after history', stranger, () => stranger.writeContract({ ...capital, functionName: 'serveRetirement', args: [0n] }))
			await restore(retirementHistory)
			await materializedPositionId(winner)
			await vaultCall('retirement: winner requests retirement without history', other, winner.vault, context.capital, setCommitmentData(0n))
			await gasOf('retirement: permissionless service without history', stranger, () => stranger.writeContract({ ...capital, functionName: 'serveRetirement', args: [0n] }))
			await restore(finalized)

			// Expired price: claims and checkpoints continue; price-gated operations fail.
			const validUntil = await owner.readContract({ ...capital, functionName: 'priceValidUntil' })
			await mock.setTime(BigInt(validUntil) + 1n)
			await gasOf('stale price: permissionless ledger checkpoint', stranger, () => stranger.writeContract({ ...capital, functionName: 'checkpoint' }))
			await claim('stale price: first claim by an unmaterialized winner', other, winner.vault)
			await claim('stale price: second claim', other, winner.vault)
			await revertedGasOf('stale price failure: raise the health target', other, winner.vault, executeData(context.capital, setHealthTargetData(health + 1n)))
			await revertedGasOf('stale price failure: withdraw pledged principal', other, winner.vault, executeData(context.capital, withdrawPrincipalData(unit, winner.vault)))
			await restore(finalized)

			// Liquidation of an unmaterialized winner by a keeper, then of a
			// materialized winner, after the REP price leaves the winner undercollateralized.
			// The incumbent first retires its spare capacity so distressed commitment
			// is needed by claims and must be taken over instead of simply cured.
			await gasOf('retirement: incumbent retires all spare capacity', owner, () => owner.writeContract({ ...capital, functionName: 'setCommitment', args: [0n] }))
			await writeContractAndWait(owner, () => owner.writeContract({ ...token, functionName: 'transfer', args: [keeper.account.address, 60n * unit] }))
			await approveToken(keeper, context.token, context.capital)
			await gasOf('liquidation: keeper deposits principal', keeper, () => keeper.writeContract({ ...capital, functionName: 'depositFor', args: [keeper.account.address, 60n * unit] }))
			await context.report(5n * unit, 10n * unit)
			const distressStart = await owner.readContract({ ...capital, functionName: 'liquidationStarted', args: [cohort[1]] })
			expect(distressStart).toBeGreaterThan(0n)
			// One hour of uninterrupted distress earns the full award; the price
			// observation must be refreshed because the feed window is shorter.
			await mock.advanceTime(3_601n)
			await context.report(5n * unit, 10n * unit)
			expect(await owner.readContract({ ...capital, functionName: 'liquidationStarted', args: [cohort[1]] })).toBe(distressStart)
			const totalCommitment = (await owner.readContract({ ...capital, functionName: 'totals' }))[1]
			const demand = await owner.readContract({ ...capital, functionName: 'demandAttoEth' })
			const acceptedPriceEpoch = await owner.readContract({ ...capital, functionName: 'acceptedPriceEpoch' })
			const liquidation = await snapshot()
			// Only the winner cures, through its vault; its first operation materializes the position. Without spare
			// capacity the cure has nothing to remove and the whole exit waits in the retirement queue.
			await vaultCall(totalCommitment > demand ? 'liquidation: winner cures its unmaterialized vault' : 'liquidation: winner exit without spare capacity only materializes and queues', other, winner.vault, context.capital, setCommitmentData(0n))
			await restore(liquidation)
			const takeoverBounds = { maximumOwnerPrincipal: 100n * unit, maximumOwnerCommitment: 10n * unit, expectedTargetHealthFactorBps: 10_000n, expectedAcceptedPriceEpoch: acceptedPriceEpoch, expectedSourceBatch: 0n }
			const winnerCommitment = (await owner.readContract({ ...capital, functionName: 'auctionPosition', args: [winner.id] })).commitment
			await revertedGasOf('liquidation failure: takeover rejected by bounds', keeper, context.capital, encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'takeOverAuctionBid', args: [winner.id, winnerCommitment, 0n, 60n * unit, { ...takeoverBounds, maximumOwnerPrincipal: 1n }] }))
			await gasOf('liquidation: keeper takes over an unmaterialized winner', keeper, () => keeper.writeContract({ ...capital, functionName: 'takeOverAuctionBid', args: [winner.id, winnerCommitment, 0n, 60n * unit, takeoverBounds] }))
			await restore(liquidation)
			await writeContractAndWait(stranger, () => stranger.writeContract({ ...capital, functionName: 'materializeAuctionBid', args: [winner.id] }))
			const materializedId = await positionIdOf(winner.vault)
			await gasOf('liquidation: keeper takes over a materialized winner', keeper, () => keeper.writeContract({ ...capital, functionName: 'takeOverWithBounds', args: [materializedId, winnerCommitment, 0n, 60n * unit, takeoverBounds] }))
			await restore(finalized)

			// Fork transition: the winner's first operation after the child forks is
			// its branch choice; parent fee claims stay available after the branch starts.
			const threshold = await getZoltarForkThreshold(owner, context.child)
			await addRepToMigrationBalance(owner, context.source, threshold)
			await splitMigrationRep(owner, context.source, threshold, [1])
			const forkTime = context.deadline + 8n * DAY
			await mock.setTime(forkTime)
			await forkUniverse(owner, context.child, fixture.base.questionId)
			const choose = encodeFunctionData({ abi: forkArtifact.abi, functionName: 'choose', args: [context.child, 1n] })
			await vaultCall('fork: unmaterialized winner chooses a branch', other, winner.vault, context.forks, choose)
			await vaultCall('fork: another winner chooses a branch', filler, partial.vault, context.forks, choose)
			await mock.setTime(forkTime + 56n * DAY)
			await gasOf('fork: start the chosen branch', owner, () => owner.writeContract({ ...forks, functionName: 'startBranch', args: [context.child, 1n] }))
			await claim('fork: parent fee claim after choosing', other, winner.vault)
			await claim('fork: repeated parent fee claim', other, winner.vault)
			await restore(finalized)

			// Every bidder, owner and keeper transaction stays within an ordinary allowance.
			reports.set(bookSize, measurements)
			if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log(`collateralRepairAuctionGas:${bookSize}`, JSON.stringify(measurements.map(entry => ({ ...entry, gas: entry.gas.toString() }))))
			expect(measurements.filter(measurement => !branchTransactions.has(measurement.label) && measurement.gas >= 3_000_000n).map(measurement => measurement.label)).toEqual([])
			expect(secondOwnerOperation).toBeLessThan(firstOwnerOperation)
			expect(thirdOwnerOperation).toBeLessThan(firstOwnerOperation)
			expect(secondAfterKeeper).toBeLessThanOrEqual(firstAfterKeeper)

			async function materializedPositionId(target: Bid) {
				const current = await positionIdOf(target.vault)
				if (current !== 0n) return current
				await writeContractAndWait(stranger, () => stranger.writeContract({ ...capital, functionName: 'materializeAuctionBid', args: [target.id] }))
				return positionIdOf(target.vault)
			}
		})
	}
	test('a thirty-two-fold larger tied book grows every measured path by at most a logarithmic allowance', () => {
		const small = reports.get(bookSizes[0])
		const large = reports.get(bookSizes[1])
		if (small === undefined || large === undefined) throw new Error('Both book sizes must be measured first')
		for (const entry of small) {
			const counterpart = large.find(candidate => candidate.label === entry.label)
			if (counterpart === undefined) throw new Error(`Missing large-book measurement for ${entry.label}`)
			expect(counterpart.status).toBe(entry.status)
			// Fee detachment pushes frozen budgets down one root-to-leaf path with
			// several writes per level; the allowance covers five extra levels.
			expect(counterpart.gas).toBeLessThan(entry.gas + 350_000n)
		}
	})
})
