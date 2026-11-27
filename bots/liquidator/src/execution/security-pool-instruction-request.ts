import type { OperatorSettings } from '#config/settings'
import type { CapitalInstruction, SecurityPoolInstruction } from '#config/security-pool-instructions'
import type { SecurityPoolExecutionContext } from './security-pool-execution-snapshot.ts'
import { erc20Abi, zoltarAbi, securityPoolCapitalLedgerAbi as capitalAbi, securityPoolForkCoordinatorAbi as forkAbi } from '@zoltar/bot-shared/contracts/abi'
import { encodeFunctionData, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import {
	buildSecurityPoolAuctionBidRequest,
	quoteSecurityPoolAuctionBid,
	buildSecurityPoolAuctionRefundRequest,
	buildSecurityPoolCapitalClaimEarningsRequest,
	buildSecurityPoolCapitalDepositAndSetHealthRequest,
	buildSecurityPoolCapitalSetHealthRequest,
	buildSecurityPoolCapitalSetCommitmentRequest,
	buildSecurityPoolCapitalWithdrawPrincipalRequest,
	loadSecurityPoolAuctionSnapshot,
	securityPoolAuctionClaimBatch,
} from '@zoltar/statoblast-shared/statoblast/securityPool'
import { SecurityPoolOpportunityExpired } from './security-pool-executor.ts'

type Request = { account: Address; to: Address; value: bigint; data: Hex }
type Context = SecurityPoolExecutionContext & { settings: OperatorSettings }
type PreparedInstruction = { request: Request; completes: boolean }
type InstructionDisposition = { disposition: 'skip' | 'retry'; reason: string }
type AuctionInstruction = Exclude<SecurityPoolInstruction, CapitalInstruction | { action: 'fork-choice' | 'auction-claim' }>
type PinnedClient = Parameters<typeof loadSecurityPoolAuctionSnapshot>[0]['client']

const pinned = ({ client, blockNumber }: Context): PinnedClient => ({ ...client, getBlock: () => client.getBlock({ blockNumber }) })

/** Every bid of the operator in this universe's auction that is not yet claimed, split by whether it can be claimed now. */
async function unclaimedOperatorBids(client: PinnedClient, securityPool: Address, universeId: bigint, owner: Address) {
	const claimable: bigint[] = []
	const waiting: bigint[] = []
	for (let bidStart = 0n; ; bidStart += 64n) {
		const auction = (await loadSecurityPoolAuctionSnapshot({ client, securityPool, universeId, bidder: owner, bidStart, bidCount: 64 })).auction
		if (auction === undefined) break
		for (const bid of auction.bids) {
			if (bid.claimed) continue
			if (bid.claimable) claimable.push(bid.id)
			else waiting.push(bid.id)
		}
		if (bidStart + 64n >= auction.totalBidCount) break
	}
	return { claimable, waiting }
}

const claimRequest = (owner: Address, capitalLedger: Address, bidIds: readonly bigint[]): Request => ({ account: owner, to: capitalLedger, value: 0n, data: encodeFunctionData({ abi: capitalAbi, functionName: 'materializeRepairAuctionBids', args: [bidIds] }) })

/**
 * A bidder cannot export a fork choice while any of its repair auction bids in this universe is unclaimed, winning or
 * not, so the operator's claimable bids are claimed first, at most one SDK claim batch per transaction so
 * each claim fits in a block, and the choice follows once none remain.
 */
async function forkChoiceRequest(context: Context, owner: Address, outcome: bigint): Promise<PreparedInstruction | InstructionDisposition> {
	const { client, settings, observation, blockNumber } = context
	const { snapshot, selection } = observation
	const child = await client.readContract({ address: settings.deployment.zoltar, abi: zoltarAbi, functionName: 'getChildUniverseId', args: [selection.universeId, outcome], blockNumber })
	if (!settings.approvedUniverses.includes(child) || !settings.selectedSecurityPools.some(scope => scope.address === selection.address && scope.universeId === child)) throw new Error('Select and approve the chosen child universe before recording an irreversible fork choice')
	const unclaimed = await client.readContract({ address: snapshot.capitalLedger, abi: capitalAbi, functionName: 'unclaimedRepairAuctionBids', args: [owner], blockNumber })
	if (unclaimed > 0n) {
		const bids = await unclaimedOperatorBids(pinned(context), selection.address, selection.universeId, owner)
		if (bids.claimable.length > 0) return { completes: false, request: claimRequest(owner, snapshot.capitalLedger, securityPoolAuctionClaimBatch(bids.claimable).bidIds) }
		return { disposition: 'retry', reason: 'Claim repair auction bids before choosing; the auction has not settled every unclaimed bid yet' }
	}
	const controller = await client.readContract({ address: snapshot.capitalLedger, abi: capitalAbi, functionName: 'forkAuthority', blockNumber })
	return { completes: true, request: { account: owner, to: controller, value: 0n, data: encodeFunctionData({ abi: forkAbi, functionName: 'choose', args: [selection.universeId, outcome] }) } }
}

/** Claim the listed bids of the operator; anyone may claim, but this signer claims only its own bids. */
async function auctionClaimRequest(context: Context, instruction: Extract<SecurityPoolInstruction, { action: 'auction-claim' }>): Promise<PreparedInstruction | InstructionDisposition> {
	const snapshot = context.observation.snapshot
	const bids = await unclaimedOperatorBids(pinned(context), instruction.securityPool, instruction.universeId, snapshot.owner)
	const pending = instruction.bidIds.filter(bidId => bids.claimable.includes(bidId) || bids.waiting.includes(bidId))
	if (pending.length === 0) return { disposition: 'skip', reason: 'The listed auction bids are already claimed or are not this operator’s bids' }
	if (pending.some(bidId => bids.waiting.includes(bidId))) return { disposition: 'retry', reason: 'Auction is still open for a listed bid' }
	// Each transaction claims at most one batch; the instruction stays open until every listed bid is claimed.
	const batch = securityPoolAuctionClaimBatch(pending)
	return { completes: batch.completes, request: claimRequest(snapshot.owner, snapshot.capitalLedger, batch.bidIds) }
}

const isCapitalInstruction = (instruction: SecurityPoolInstruction): instruction is CapitalInstruction => instruction.action.startsWith('capital-')

/** Direct operations on the operator's own capital account, which also holds its winning auction lots. */
async function capitalInstructionRequest(context: Context, instruction: CapitalInstruction): Promise<PreparedInstruction> {
	const { client, settings, observation, totalPrincipal, blockNumber } = context
	const snapshot = observation.snapshot
	const owner = snapshot.owner
	const base = { owner, capitalLedger: snapshot.capitalLedger }
	switch (instruction.action) {
		case 'capital-deposit': {
			if (
				(observation.managedPrincipalAttoRep ?? snapshot.ownerPrincipalAttoRep) + instruction.amountAttoRep > settings.securityPoolPolicy.maximumPrincipalAttoRep ||
				totalPrincipal === undefined ||
				totalPrincipal + instruction.amountAttoRep > settings.securityPoolPolicy.maximumTotalPrincipalAttoRep ||
				observation.walletRep < instruction.amountAttoRep + settings.strategy.walletAttoRepReserve
			)
				throw new SecurityPoolOpportunityExpired('Capital funding exceeds exposure or wallet reserve limits')
			const allowance = await client.readContract({ address: snapshot.repToken, abi: erc20Abi, functionName: 'allowance', args: [owner, snapshot.capitalLedger], blockNumber })
			if (allowance < instruction.amountAttoRep) return { completes: false, request: { account: owner, to: snapshot.repToken, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [snapshot.capitalLedger, instruction.amountAttoRep] }) } }
			return { completes: true, request: buildSecurityPoolCapitalDepositAndSetHealthRequest({ ...base, amountAttoRep: instruction.amountAttoRep, targetHealthFactorBps: instruction.targetHealthFactorBps }) }
		}
		case 'capital-earnings':
			return { completes: true, request: buildSecurityPoolCapitalClaimEarningsRequest(base) }
		case 'capital-health':
			return { completes: true, request: buildSecurityPoolCapitalSetHealthRequest({ ...base, targetHealthFactorBps: instruction.targetHealthFactorBps }) }
		case 'capital-retire':
			if (instruction.commitmentAttoEth > snapshot.ownerCommitmentAttoEth) throw new Error('Capital retirement cannot increase commitment')
			return { completes: true, request: buildSecurityPoolCapitalSetCommitmentRequest({ ...base, commitment: instruction.commitmentAttoEth }) }
		case 'capital-withdraw':
			if (instruction.amountAttoRep > snapshot.withdrawableAttoRep) throw new SecurityPoolOpportunityExpired('Capital principal is not yet withdrawable')
			return { completes: true, request: buildSecurityPoolCapitalWithdrawPrincipalRequest({ ...base, amountAttoRep: instruction.amountAttoRep }) }
		default:
			throw new Error('Unsupported capital instruction')
	}
}

async function auctionInstructionRequest(context: Context, instruction: AuctionInstruction): Promise<PreparedInstruction | InstructionDisposition> {
	const { settings, observation, totalPrincipal } = context
	const snapshot = observation.snapshot
	const pinnedClient = pinned(context)
	let auctionSnapshot = await loadSecurityPoolAuctionSnapshot({ client: pinnedClient, securityPool: instruction.securityPool, universeId: instruction.universeId, bidder: snapshot.owner, bidCount: 64 })
	if (instruction.action === 'auction-bid') {
		const auction = auctionSnapshot.auction
		if (auctionSnapshot.forkTime !== 0n || (auction !== undefined && (auction.finalized || auctionSnapshot.timestamp >= auction.closesAt))) return { disposition: 'skip', reason: 'The auction can no longer accept bids' }
		if (auction === undefined || !auction.opened) return { disposition: 'retry', reason: 'The auction is not open yet' }
		if (auction.maximumAdmissibleBidAttoRepPerLot < auction.minimumCollateralAttoRepPerLot || instruction.minimumAttoRepPerLot > auction.maximumAdmissibleBidAttoRepPerLot) return { disposition: 'retry', reason: 'Better funded bids currently exclude these terms' }
		const quote = quoteSecurityPoolAuctionBid(auctionSnapshot, instruction)
		// Reserve the full possible award once per auction, including additional bids.
		const reserved = observation.pendingAuction?.address === auction.address ? observation.pendingAuction.principal : 0n
		const incrementalPrincipal = auction.inventoryAttoRep > reserved ? auction.inventoryAttoRep - reserved : 0n
		if (totalPrincipal === undefined || totalPrincipal + incrementalPrincipal > settings.securityPoolPolicy.maximumTotalPrincipalAttoRep || (observation.managedPrincipalAttoRep ?? snapshot.ownerPrincipalAttoRep) + incrementalPrincipal > settings.securityPoolPolicy.maximumPrincipalAttoRep)
			return { disposition: 'retry', reason: 'Auction award could exceed managed REP exposure limits' }
		if (quote.bidAttoEth > instruction.maximumValueAttoEth || (observation.managedCommitmentAttoEth ?? snapshot.ownerCommitmentAttoEth) + quote.bidAttoEth > settings.securityPoolPolicy.maximumCommitmentAttoEth) return { disposition: 'retry', reason: 'Auction bid exceeds collateral or commitment limits' }
		if (auctionSnapshot.walletCollateral < quote.bidAttoEth) return { disposition: 'retry', reason: 'Insufficient wallet collateral for the bid' }
		if (auctionSnapshot.collateralAllowance < quote.bidAttoEth)
			return { completes: false, request: { account: snapshot.owner, to: auctionSnapshot.collateralToken, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [auction.address, auctionSnapshot.collateralAllowance === 0n ? quote.bidAttoEth : 0n] }) } }
		return { request: buildSecurityPoolAuctionBidRequest(auctionSnapshot, instruction), completes: true }
	}
	while (!auctionSnapshot.auction?.bids.some(bid => bid.id === instruction.bidId)) {
		const auction = auctionSnapshot.auction
		if (auction === undefined || auction.bidStart + 64n >= auction.totalBidCount) throw new Error('Instruction bid does not belong to this operator')
		auctionSnapshot = await loadSecurityPoolAuctionSnapshot({ client: pinnedClient, securityPool: instruction.securityPool, universeId: instruction.universeId, bidder: snapshot.owner, bidStart: auction.bidStart + 64n, bidCount: 64 })
	}
	const request = buildSecurityPoolAuctionRefundRequest(auctionSnapshot, instruction.bidId, snapshot.owner)
	return { request, completes: true }
}

export async function buildSecurityPoolInstructionRequest(context: Context, instruction: SecurityPoolInstruction): Promise<PreparedInstruction | InstructionDisposition> {
	if (instruction.action === 'fork-choice') return forkChoiceRequest(context, context.observation.snapshot.owner, instruction.outcome)
	if (instruction.action === 'auction-claim') return auctionClaimRequest(context, instruction)
	if (isCapitalInstruction(instruction)) return capitalInstructionRequest(context, instruction)
	return auctionInstructionRequest(context, instruction)
}
