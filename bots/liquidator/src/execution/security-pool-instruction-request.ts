import type { OperatorSettings } from '#config/settings'
import type { SecurityPoolInstruction } from '#config/security-pool-instructions'
import type { SecurityPoolExecutionContext } from './security-pool-execution-snapshot.ts'
import { erc20Abi, zoltarAbi, securityPoolCapitalLedgerAbi as capitalAbi, securityPoolForkCoordinatorAbi as forkAbi } from '@zoltar/bot-shared/contracts/abi'
import { encodeFunctionData, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import {
	buildSecurityPoolAuctionBidRequest,
	quoteSecurityPoolAuctionBid,
	buildSecurityPoolAuctionMaterializeRequest,
	buildSecurityPoolAuctionRefundClaimRequest,
	buildSecurityPoolAuctionVaultExecuteRequest,
	buildSecurityPoolAuctionVaultDepositRequest,
	buildSecurityPoolCapitalClaimEarningsRequest,
	buildSecurityPoolCapitalSetHealthRequest,
	buildSecurityPoolCapitalSetCommitmentRequest,
	buildSecurityPoolCapitalWithdrawPrincipalRequest,
	loadSecurityPoolAuctionSnapshot,
} from '@zoltar/statoblast-shared/statoblast/securityPool'
import { SecurityPoolOpportunityExpired } from './security-pool-executor.ts'

type Request = { account: Address; to: Address; value: bigint; data: Hex }
type Context = SecurityPoolExecutionContext & { settings: OperatorSettings }
type PreparedInstruction = { request: Request; completes: boolean }
type InstructionDisposition = { disposition: 'skip' | 'retry'; reason: string }
type VaultInstruction = Extract<SecurityPoolInstruction, { vault: Address }>
type AuctionInstruction = Exclude<SecurityPoolInstruction, VaultInstruction | { action: 'fork-choice' }>

async function forkChoiceRequest({ client, settings, observation, blockNumber }: Context, owner: Address, outcome: bigint): Promise<Request> {
	const { snapshot, selection } = observation
	const child = await client.readContract({ address: settings.deployment.zoltar, abi: zoltarAbi, functionName: 'getChildUniverseId', args: [selection.universeId, outcome], blockNumber })
	if (!settings.approvedUniverses.includes(child) || !settings.selectedSecurityPools.some(scope => scope.address === selection.address && scope.universeId === child)) throw new Error('Select and approve the chosen child universe before recording an irreversible fork choice')
	const controller = await client.readContract({ address: snapshot.capitalLedger, abi: capitalAbi, functionName: 'forkAuthority', blockNumber })
	return { account: owner, to: controller, value: 0n, data: encodeFunctionData({ abi: forkAbi, functionName: 'choose', args: [selection.universeId, outcome] }) }
}

async function vaultInstructionRequest(context: Context, instruction: VaultInstruction): Promise<PreparedInstruction> {
	const { client, settings, observation, totalPrincipal, blockNumber } = context
	const snapshot = observation.snapshot
	const owner = snapshot.owner
	const vault = observation.ownedVaults?.find(account => account.owner === instruction.vault)
	if (vault === undefined) throw new Error('Vault is missing from authenticated managed exposure')
	const base = { owner: instruction.vault, capitalLedger: snapshot.capitalLedger }
	if (instruction.action === 'vault-deposit') {
		if (
			(observation.managedPrincipalAttoRep ?? snapshot.ownerPrincipalAttoRep) + instruction.amountAttoRep > settings.securityPoolPolicy.maximumPrincipalAttoRep ||
			totalPrincipal === undefined ||
			totalPrincipal + instruction.amountAttoRep > settings.securityPoolPolicy.maximumTotalPrincipalAttoRep ||
			observation.walletRep < instruction.amountAttoRep + settings.strategy.walletAttoRepReserve
		)
			throw new SecurityPoolOpportunityExpired('Vault funding exceeds exposure or wallet reserve limits')
		const allowance = await client.readContract({ address: snapshot.repToken, abi: erc20Abi, functionName: 'allowance', args: [owner, instruction.vault], blockNumber })
		if (allowance < instruction.amountAttoRep) return { completes: false, request: { account: owner, to: snapshot.repToken, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [instruction.vault, instruction.amountAttoRep] }) } }
		return { completes: true, request: buildSecurityPoolAuctionVaultDepositRequest({ bidder: owner, vault: instruction.vault, capitalLedger: snapshot.capitalLedger, amountAttoRep: instruction.amountAttoRep, targetHealthFactorBps: instruction.targetHealthFactorBps }) }
	}
	let operation
	switch (instruction.action) {
		case 'vault-earnings':
			operation = buildSecurityPoolCapitalClaimEarningsRequest(base)
			break
		case 'vault-health':
			operation = buildSecurityPoolCapitalSetHealthRequest({ ...base, targetHealthFactorBps: instruction.targetHealthFactorBps })
			break
		case 'vault-fork-choice':
			operation = await forkChoiceRequest(context, vault.owner, instruction.outcome)
			break
		case 'vault-retire':
			if (instruction.commitmentAttoEth > vault.ownerCommitmentAttoEth) throw new Error('Vault retirement cannot increase commitment')
			operation = buildSecurityPoolCapitalSetCommitmentRequest({ ...base, commitment: instruction.commitmentAttoEth })
			break
		case 'vault-withdraw':
			if (instruction.amountAttoRep > vault.withdrawableAttoRep) throw new SecurityPoolOpportunityExpired('Vault principal is not yet withdrawable')
			operation = buildSecurityPoolCapitalWithdrawPrincipalRequest({ ...base, amountAttoRep: instruction.amountAttoRep })
			break
		default:
			throw new Error('Unsupported vault instruction')
	}
	return { completes: true, request: buildSecurityPoolAuctionVaultExecuteRequest({ bidder: owner, vault: vault.owner, request: operation, sweep: { repToken: snapshot.repToken, recipient: owner } }) }
}

async function auctionInstructionRequest({ client, settings, observation, totalPrincipal, blockNumber }: Context, instruction: AuctionInstruction): Promise<PreparedInstruction | InstructionDisposition> {
	const snapshot = observation.snapshot
	const pinnedClient = { ...client, getBlock: () => client.getBlock({ blockNumber }) }
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
	if (instruction.action === 'auction-activate') {
		const auction = auctionSnapshot.auction
		const bid = auction?.bids.find(candidate => candidate.id === instruction.bidId)
		if (auction === undefined || bid === undefined) throw new Error('Authenticated auction bid is missing')
		if (!auction.finalized) return { disposition: 'retry', reason: 'Auction is still open' }
		if (bid.fill === undefined || bid.fill.filledLots === 0n) return { disposition: 'skip', reason: 'Finalized auction bid has no winning fill' }
		if (bid.materialized) return { disposition: 'skip', reason: 'Winning auction vault is already active' }
	}
	const request = instruction.action === 'auction-activate' ? buildSecurityPoolAuctionMaterializeRequest(auctionSnapshot, instruction.bidId) : buildSecurityPoolAuctionRefundClaimRequest(auctionSnapshot, instruction.bidId, snapshot.owner)
	return { request, completes: true }
}

export async function buildSecurityPoolInstructionRequest(context: Context, instruction: SecurityPoolInstruction): Promise<PreparedInstruction | InstructionDisposition> {
	if (instruction.action === 'fork-choice') return { request: await forkChoiceRequest(context, context.observation.snapshot.owner, instruction.outcome), completes: true }
	if ('vault' in instruction) return vaultInstructionRequest(context, instruction)
	return auctionInstructionRequest(context, instruction)
}
