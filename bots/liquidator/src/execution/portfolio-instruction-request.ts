import type { OperatorSettings } from '#config/settings'
import type { PortfolioInstruction } from '#config/portfolio-instructions'
import type { PortfolioExecutionContext } from './portfolio-execution-snapshot.ts'
import { erc20Abi, zoltarAbi, securityPoolCapitalLedgerAbi as capitalAbi, securityPoolPortfolioForkCoordinatorAbi as forkAbi } from '@zoltar/bot-shared/contracts/abi'
import { encodeFunctionData, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import {
	buildPortfolioAuctionBidRequest,
	buildPortfolioAuctionMaterializeRequest,
	buildPortfolioAuctionRefundClaimRequest,
	buildPortfolioAuctionVaultExecuteRequest,
	buildPortfolioAuctionVaultDepositRequest,
	buildPortfolioCapitalClaimEarningsRequest,
	buildPortfolioCapitalSetHealthRequest,
	buildPortfolioCapitalSetCommitmentRequest,
	buildPortfolioCapitalWithdrawPrincipalRequest,
	loadPortfolioAuctionSnapshot,
} from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { PortfolioOpportunityExpired } from './portfolio-executor.ts'

type Request = { account: Address; to: Address; value: bigint; data: Hex }
type Context = PortfolioExecutionContext & { settings: OperatorSettings }
type PreparedInstruction = { request: Request; completes: boolean }
type VaultInstruction = Extract<PortfolioInstruction, { vault: Address }>
type AuctionInstruction = Exclude<PortfolioInstruction, VaultInstruction | { action: 'fork-choice' }>

async function forkChoiceRequest({ client, settings, observation, blockNumber }: Context, owner: Address, outcome: bigint): Promise<Request> {
	const { snapshot, selection } = observation
	const child = await client.readContract({ address: settings.deployment.zoltar, abi: zoltarAbi, functionName: 'getChildUniverseId', args: [selection.universeId, outcome], blockNumber })
	if (!settings.approvedUniverses.includes(child) || !settings.selectedPortfolios.some(scope => scope.address === selection.address && scope.universeId === child)) throw new Error('Select and approve the chosen child universe before recording an irreversible fork choice')
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
		if (vault.ownerPrincipalAttoRep + instruction.amountAttoRep > settings.portfolioPolicy.maximumPrincipalAttoRep || totalPrincipal + instruction.amountAttoRep > settings.portfolioPolicy.maximumTotalPrincipalAttoRep || observation.walletRep < instruction.amountAttoRep + settings.strategy.walletAttoRepReserve)
			throw new PortfolioOpportunityExpired('Vault funding exceeds exposure or wallet reserve limits')
		const allowance = await client.readContract({ address: snapshot.repToken, abi: erc20Abi, functionName: 'allowance', args: [owner, instruction.vault], blockNumber })
		if (allowance < instruction.amountAttoRep) return { completes: false, request: { account: owner, to: snapshot.repToken, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [instruction.vault, instruction.amountAttoRep] }) } }
		return { completes: true, request: buildPortfolioAuctionVaultDepositRequest({ bidder: owner, vault: instruction.vault, capitalLedger: snapshot.capitalLedger, amountAttoRep: instruction.amountAttoRep, targetHealthFactorBps: instruction.targetHealthFactorBps }) }
	}
	let operation
	switch (instruction.action) {
		case 'vault-earnings':
			operation = buildPortfolioCapitalClaimEarningsRequest(base)
			break
		case 'vault-health':
			operation = buildPortfolioCapitalSetHealthRequest({ ...base, targetHealthFactorBps: instruction.targetHealthFactorBps })
			break
		case 'vault-fork-choice':
			operation = await forkChoiceRequest(context, vault.owner, instruction.outcome)
			break
		case 'vault-retire':
			if (instruction.commitmentAttoEth > vault.ownerCommitmentAttoEth) throw new Error('Vault retirement cannot increase commitment')
			operation = buildPortfolioCapitalSetCommitmentRequest({ ...base, commitment: instruction.commitmentAttoEth })
			break
		case 'vault-withdraw':
			if (instruction.amountAttoRep > vault.withdrawableAttoRep) throw new PortfolioOpportunityExpired('Vault principal is not yet withdrawable')
			operation = buildPortfolioCapitalWithdrawPrincipalRequest({ ...base, amountAttoRep: instruction.amountAttoRep })
			break
		default:
			throw new Error('Unsupported vault instruction')
	}
	return { completes: true, request: buildPortfolioAuctionVaultExecuteRequest({ bidder: owner, vault: vault.owner, request: operation, sweep: { repToken: snapshot.repToken, recipient: owner } }) }
}

async function auctionInstructionRequest({ client, settings, observation, totalPrincipal, blockNumber }: Context, instruction: AuctionInstruction): Promise<PreparedInstruction> {
	const snapshot = observation.snapshot
	const pinnedClient = { ...client, getBlock: () => client.getBlock({ blockNumber }) }
	let auctionSnapshot = await loadPortfolioAuctionSnapshot({ client: pinnedClient, portfolio: instruction.portfolio, universeId: instruction.universeId, bidder: snapshot.owner, bidCount: 64 })
	if (instruction.action === 'auction-bid') {
		const request = buildPortfolioAuctionBidRequest(auctionSnapshot, instruction)
		const auction = auctionSnapshot.auction
		if (auction === undefined) throw new Error('Missing instruction auction')
		// Reserve the full possible award even with weak demand, in addition to existing pending bids.
		if (totalPrincipal + auction.inventoryAttoRep > settings.portfolioPolicy.maximumTotalPrincipalAttoRep || auction.inventoryAttoRep > settings.portfolioPolicy.maximumPrincipalAttoRep) throw new PortfolioOpportunityExpired('Auction award could exceed managed REP exposure limits')
		if (request.value > instruction.maximumValueAttoEth || (observation.managedCommitmentAttoEth ?? snapshot.ownerCommitmentAttoEth) + request.value > settings.portfolioPolicy.maximumCommitmentAttoEth) throw new PortfolioOpportunityExpired('Auction bid exceeds ETH or commitment limits')
		return { request, completes: true }
	}
	while (!auctionSnapshot.auction?.bids.some(bid => bid.id === instruction.bidId)) {
		const auction = auctionSnapshot.auction
		if (auction === undefined || auction.bidStart + 64n >= auction.totalBidCount) throw new Error('Instruction bid does not belong to this operator')
		auctionSnapshot = await loadPortfolioAuctionSnapshot({ client: pinnedClient, portfolio: instruction.portfolio, universeId: instruction.universeId, bidder: snapshot.owner, bidStart: auction.bidStart + 64n, bidCount: 64 })
	}
	const request = instruction.action === 'auction-activate' ? buildPortfolioAuctionMaterializeRequest(auctionSnapshot, instruction.bidId) : buildPortfolioAuctionRefundClaimRequest(auctionSnapshot, instruction.bidId, snapshot.owner)
	return { request, completes: true }
}

export async function buildPortfolioInstructionRequest(context: Context, instruction: PortfolioInstruction): Promise<PreparedInstruction> {
	if (instruction.action === 'fork-choice') return { request: await forkChoiceRequest(context, context.observation.snapshot.owner, instruction.outcome), completes: true }
	if ('vault' in instruction) return vaultInstructionRequest(context, instruction)
	return auctionInstructionRequest(context, instruction)
}
