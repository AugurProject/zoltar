import type { OperatorSettings } from '#config/settings'
import { serializePortfolioInstructions, type PortfolioInstruction } from '#config/portfolio-instructions'
import { loadManagedPortfolioObservations, type PortfolioObservation } from '#monitoring/portfolio-monitor'
import type { RuntimeState } from '#state/operator-state'
import { erc20Abi, zoltarAbi, securityPoolCapitalLedgerAbi as capitalAbi, securityPoolPortfolioForkCoordinatorAbi as forkAbi } from '@zoltar/bot-shared/contracts/abi'
import { createPublicClient, encodeFunctionData, type Account, type Chain, type Transport, type WalletClient, type createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { settledQuorumValue, sharedQuorumReadTargets } from '@zoltar/bot-shared/monitoring/read-quorum'
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
import { submitCall } from './submit-call.ts'
import { PortfolioOpportunityExpired } from './portfolio-executor.ts'

type Wallet = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>

/** Durable, one-shot instructions use the same quorum, simulation and journal as automatic takeovers. */
export async function executePortfolioInstruction(wallet: Wallet, settings: OperatorSettings, state: RuntimeState, pool: RpcPool, instruction: PortfolioInstruction, priceAllowed: (observation: PortfolioObservation) => Promise<boolean>) {
	if (!settings.runtime.execute || state.pendingTransactions.length !== 0 || state.pendingStagedOperations.length !== 0) throw new Error('Pending recovery or dry-run mode blocks portfolio instructions')
	const fingerprint = JSON.stringify(serializePortfolioInstructions([instruction])[0])
	const completed = state.completedPortfolioInstructions !== undefined && Object.hasOwn(state.completedPortfolioInstructions, instruction.id) ? state.completedPortfolioInstructions[instruction.id] : undefined
	if (completed !== undefined) {
		if (completed !== fingerprint) throw new Error('Completed portfolio instruction IDs cannot be reused with different terms')
		return false
	}
	const refresh = async () => {
		const readers = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(endpoint => ({ endpoint, client: createPublicClient({ chain: wallet.chain, transport: pool.transportFor(endpoint) }) }))
		const pinned = await sharedQuorumReadTargets(readers, settings.connectivity.rpcQuorum)
		const result = await settledQuorumValue(
			'portfolio instruction',
			pinned.readers.map(async ({ client, endpoint }) => {
				const observations = await loadManagedPortfolioObservations(
					client,
					settings,
					wallet.account.address,
					state.portfolioScopes.map(scope => ({ scope, targets: [] })),
					pinned.blockNumber,
				)
				const observation = observations.find(item => item.selection.address === instruction.portfolio && item.selection.universeId === instruction.universeId)
				if (observation === undefined || !observation.selected || !observation.approvedUniverse) throw new Error('Instruction portfolio and universe must be selected and approved')
				const snapshot = observation.snapshot
				const base = { owner: wallet.account.address, capitalLedger: snapshot.capitalLedger }
				const totalPrincipal = observations.reduce((sum, item) => sum + (item.managedPrincipalAttoRep ?? item.snapshot.ownerPrincipalAttoRep), 0n)
				let request: { account: typeof base.owner; to: typeof base.owner; value: bigint; data: `0x${string}` }
				let completes = true
				const choose = async (owner: typeof base.owner, outcome: bigint) => {
					const child = await client.readContract({ address: settings.deployment.zoltar, abi: zoltarAbi, functionName: 'getChildUniverseId', args: [instruction.universeId, outcome], blockNumber: pinned.blockNumber })
					if (!settings.approvedUniverses.includes(child) || !settings.selectedPortfolios.some(scope => scope.address === instruction.portfolio && scope.universeId === child)) throw new Error('Select and approve the chosen child universe before recording an irreversible fork choice')
					const controller = await client.readContract({ address: snapshot.capitalLedger, abi: capitalAbi, functionName: 'forkAuthority', blockNumber: pinned.blockNumber })
					return { account: owner, to: controller, value: 0n, data: encodeFunctionData({ abi: forkAbi, functionName: 'choose', args: [instruction.universeId, outcome] }) }
				}
				if (instruction.action === 'fork-choice') request = await choose(base.owner, instruction.outcome)
				else if ('vault' in instruction) {
					const vault = observation.ownedVaults?.find(account => account.owner === instruction.vault)
					if (vault === undefined) throw new Error('Vault is missing from authenticated managed exposure')
					const vaultBase = { owner: instruction.vault, capitalLedger: snapshot.capitalLedger }
					if (instruction.action === 'vault-deposit') {
						if (vault.ownerPrincipalAttoRep + instruction.amountAttoRep > settings.portfolioPolicy.maximumPrincipalAttoRep || totalPrincipal + instruction.amountAttoRep > settings.portfolioPolicy.maximumTotalPrincipalAttoRep || observation.walletRep < instruction.amountAttoRep + settings.strategy.walletAttoRepReserve)
							throw new PortfolioOpportunityExpired('Vault funding exceeds exposure or wallet reserve limits')
						const allowance = await client.readContract({ address: snapshot.repToken, abi: erc20Abi, functionName: 'allowance', args: [base.owner, instruction.vault], blockNumber: pinned.blockNumber })
						if (allowance < instruction.amountAttoRep) {
							completes = false
							request = { account: base.owner, to: snapshot.repToken, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [instruction.vault, instruction.amountAttoRep] }) }
						} else request = buildPortfolioAuctionVaultDepositRequest({ bidder: base.owner, vault: instruction.vault, capitalLedger: snapshot.capitalLedger, amountAttoRep: instruction.amountAttoRep, targetHealthFactorBps: instruction.targetHealthFactorBps })
					} else {
						let operation
						if (instruction.action === 'vault-earnings') operation = buildPortfolioCapitalClaimEarningsRequest(vaultBase)
						else if (instruction.action === 'vault-health') operation = buildPortfolioCapitalSetHealthRequest({ ...vaultBase, targetHealthFactorBps: instruction.targetHealthFactorBps })
						else if (instruction.action === 'vault-fork-choice') operation = await choose(vault.owner, instruction.outcome)
						else if (instruction.action === 'vault-retire') {
							if (instruction.commitmentAttoEth > vault.ownerCommitmentAttoEth) throw new Error('Vault retirement cannot increase commitment')
							operation = buildPortfolioCapitalSetCommitmentRequest({ ...vaultBase, commitment: instruction.commitmentAttoEth })
						} else {
							if (instruction.amountAttoRep > vault.withdrawableAttoRep) throw new PortfolioOpportunityExpired('Vault principal is not yet withdrawable')
							operation = buildPortfolioCapitalWithdrawPrincipalRequest({ ...vaultBase, amountAttoRep: instruction.amountAttoRep })
						}
						request = buildPortfolioAuctionVaultExecuteRequest({ bidder: base.owner, vault: vault.owner, request: operation, sweep: { repToken: snapshot.repToken, recipient: base.owner } })
					}
				} else {
					const pinnedClient = { ...client, getBlock: () => client.getBlock({ blockNumber: pinned.blockNumber }) }
					let auctionSnapshot = await loadPortfolioAuctionSnapshot({ client: pinnedClient, portfolio: instruction.portfolio, universeId: instruction.universeId, bidder: base.owner, bidCount: 64 })
					if (instruction.action === 'auction-bid') {
						request = buildPortfolioAuctionBidRequest(auctionSnapshot, instruction)
						const auction = auctionSnapshot.auction
						if (auction === undefined) throw new Error('Missing instruction auction')
						// Reserve a full-inventory award even when demand is weak. Existing
						// pending bids remain counted, deliberately conservatively.
						if (totalPrincipal + auction.inventoryAttoRep > settings.portfolioPolicy.maximumTotalPrincipalAttoRep || auction.inventoryAttoRep > settings.portfolioPolicy.maximumPrincipalAttoRep) throw new PortfolioOpportunityExpired('Auction award could exceed managed REP exposure limits')
						if (request.value > instruction.maximumValueAttoEth || (observation.managedCommitmentAttoEth ?? snapshot.ownerCommitmentAttoEth) + request.value > settings.portfolioPolicy.maximumCommitmentAttoEth) throw new PortfolioOpportunityExpired('Auction bid exceeds ETH or commitment limits')
					} else {
						while (!auctionSnapshot.auction?.bids.some(bid => bid.id === instruction.bidId)) {
							const auction = auctionSnapshot.auction
							if (auction === undefined || auction.bidStart + 64n >= auction.totalBidCount) throw new Error('Instruction bid does not belong to this operator')
							auctionSnapshot = await loadPortfolioAuctionSnapshot({ client: pinnedClient, portfolio: instruction.portfolio, universeId: instruction.universeId, bidder: base.owner, bidStart: auction.bidStart + 64n, bidCount: 64 })
						}
						request = instruction.action === 'auction-activate' ? buildPortfolioAuctionMaterializeRequest(auctionSnapshot, instruction.bidId) : buildPortfolioAuctionRefundClaimRequest(auctionSnapshot, instruction.bidId, base.owner)
					}
				}
				if (snapshot.owner !== wallet.account.address || observation.walletAttoEth < request.value + settings.portfolioPolicy.walletReserveAttoEth + settings.strategy.maximumGasCostAttoEth) throw new PortfolioOpportunityExpired('Instruction would consume the wallet gas reserve')
				if ((await client.getBlock({ blockNumber: pinned.blockNumber })).hash !== snapshot.blockHash) throw new Error('Instruction snapshot was replaced')
				return { endpoint, value: { request, observation, completes } }
			}),
			settings.connectivity.rpcQuorum,
		)
		if (instruction.action === 'auction-bid' && !(await priceAllowed(result.observation))) throw new PortfolioOpportunityExpired('Independent REP pricing does not allow the auction bid')
		return { request: result.request, completes: result.completes }
	}
	const { request, completes } = await refresh()
	const validate = async () => {
		const fresh = await refresh()
		if (fresh.request.to !== request.to || fresh.request.data !== request.data || fresh.request.value !== request.value || fresh.completes !== completes) throw new PortfolioOpportunityExpired('Instruction terms changed before submission')
	}
	let kind: 'migration' | 'deposit' | 'withdrawal' = 'withdrawal'
	if (instruction.action === 'fork-choice' || instruction.action === 'vault-fork-choice') kind = 'migration'
	if (instruction.action === 'auction-bid' || instruction.action === 'vault-deposit') kind = 'deposit'
	await submitCall(wallet, settings, state, pool, { ...request, gas: 'estimate', label: `Portfolio instruction ${instruction.id}: ${instruction.action}`, portfolioInstruction: completes ? { id: instruction.id, fingerprint } : undefined, preSubmit: validate, revalidateSimulationRevert: validate }, kind)
	return true
}
