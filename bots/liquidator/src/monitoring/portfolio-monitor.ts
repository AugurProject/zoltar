import { loadSponsoredOperationReport } from './portfolio-report.ts'
import { loadOwnedPortfolioVaults } from './portfolio-owned-vaults.ts'
import { verifyPortfolioCustody } from './portfolio-identity.ts'
import { authenticatePortfolioAuction, loadPortfolioAuctionPosition, portfolioAuctionPage, type PortfolioAuctionTarget, type PortfolioTarget } from './portfolio-auction.ts'
import type { OperatorSettings } from '#config/settings'
import type { PortfolioSelection } from '#config/portfolio-policy'
import { erc20Abi, securityPoolCapitalLedgerAbi, securityPoolAuctionVaultAbi, portfolioRuntimeIdentities } from '@zoltar/bot-shared/contracts/abi'
import { verifyRuntimeIdentity } from '@zoltar/bot-shared/monitoring/runtime-identity'
import { getAddress, parseAbiItem, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { decodeAuctionVaultBindings, loadPortfolioCapitalSnapshot, type PortfolioCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { ReadClient } from './read-client.ts'
import { record } from '@zoltar/bot-shared/infrastructure/json-validation'

function uint(value: unknown): bigint {
	if (typeof value !== 'bigint' || value < 0n || value >= 2n ** 256n) throw new Error('Invalid portfolio unsigned integer response')
	return value
}
function address(value: unknown): Address {
	if (typeof value !== 'string') throw new Error('Invalid portfolio address response')
	return getAddress(value)
}

const portfolioMonitorAbi = [
	parseAbiItem('function factory() view returns (address)'),
	parseAbiItem('function forkController() view returns (address)'),
	parseAbiItem('function choices(uint248 universeId,address owner) view returns (uint256 outcome,bool recorded)'),
	parseAbiItem('function getChildUniverseId(uint248 universeId,uint256 outcome) view returns (uint248)'),
	parseAbiItem('function originUniverseId() view returns (uint248)'),
	parseAbiItem('function zoltar() view returns (address)'),
	parseAbiItem('function portfolio() view returns (address)'),
	parseAbiItem('function universeId() view returns (uint248)'),
	parseAbiItem('function acceptedPriceEpoch() view returns (uint256)'),
	parseAbiItem('function getRepToken(uint248 universeId) view returns (address)'),
	parseAbiItem('function lastPositionId() view returns (uint96)'),
	parseAbiItem('function accountOf(uint96 id) view returns ((address owner,uint96 batch,uint256 rep,uint256 commitment,uint256 maxHealthyPrice,uint256 releasedRep,uint256 ethFees,uint256 repFees,uint256 remainingCommitment) account)'),
	parseAbiItem('function liquidationStarted(uint96 id) view returns (uint48)'),
	parseAbiItem('function previewRetirement(uint96 id,uint256 acceptedPrice,uint256 demand) view returns ((uint8 status,uint96 effectiveCurrentBatch,uint256 healthyCommitment,uint256 spareCommitment,uint256 queuedAheadCommitment,uint256 commitmentReduction,uint256 releasedRep) preview)'),
] as const

export type PortfolioScope = PortfolioSelection & { managedVaults?: Address[]; nextPositionId: bigint; sweepEnd: bigint; auctionAfterBidId?: bigint; retirementObservations?: { id: bigint; commitment: bigint; batch: bigint; since: bigint }[] }
export type PortfolioPosition = {
	id: bigint
	auctionTarget?: PortfolioAuctionTarget
	owner: Address
	controllingOwner?: Address
	batch: bigint
	rep: bigint
	commitment: bigint
	maxHealthyPrice: bigint
	remainingCommitment: bigint
	liquidationStarted: bigint
	retirementStatus: string
	stalledRetirement: boolean
}
export type PortfolioObservation = {
	selection: PortfolioSelection
	pendingOperationReport?: Awaited<ReturnType<typeof loadSponsoredOperationReport>>
	selected: boolean
	managedPrincipalAttoRep?: bigint
	managedCommitmentAttoEth?: bigint
	ownedVaults?: PortfolioCapitalSnapshot[]
	chosenVaultChildUniverseIds?: bigint[]
	chosenChildUniverseId?: bigint
	approvedUniverse: boolean
	snapshot: PortfolioCapitalSnapshot
	acceptedPriceEpoch: bigint
	knownPositionCount: bigint
	knownAuctionBidCount?: bigint
	positions: PortfolioPosition[]
	nextScope: PortfolioScope
	walletRep: bigint
	walletAttoEth: bigint
}

/** Retain every previously managed scope: deselection cannot hide deployed principal from total limits. */
export function managedPortfolioScopes(previous: readonly PortfolioScope[], selected: readonly PortfolioSelection[]): PortfolioScope[] {
	const scopes = new Map(previous.map(scope => [`${scope.address.toLowerCase()}:${scope.universeId}`, scope]))
	for (const selection of selected) {
		const key = `${selection.address.toLowerCase()}:${selection.universeId}`
		if (!scopes.has(key)) scopes.set(key, { ...selection, nextPositionId: 1n, sweepEnd: 0n })
	}
	if (scopes.size > 64) throw new Error('Managed portfolio scope history exceeds 64; reconcile exposure before adding more portfolios')
	const vaultsByPortfolio = new Map<string, Set<Address>>()
	for (const scope of scopes.values()) {
		const key = scope.address.toLowerCase()
		const vaults = vaultsByPortfolio.get(key) ?? new Set<Address>()
		for (const vault of scope.managedVaults ?? []) vaults.add(vault)
		vaultsByPortfolio.set(key, vaults)
	}
	return [...scopes.values()].map(scope => ({ ...scope, managedVaults: [...(vaultsByPortfolio.get(scope.address.toLowerCase()) ?? [])] }))
}

/** @internal Tests verify the fixed sweep end prevents new positions from indefinitely postponing older ones. */
export function portfolioPositionPage(scope: PortfolioScope, lastPositionId: bigint, maximum: number) {
	const end = scope.sweepEnd === 0n || scope.sweepEnd > lastPositionId ? lastPositionId : scope.sweepEnd
	const start = scope.nextPositionId > end ? 1n : scope.nextPositionId
	const ids: bigint[] = []
	for (let id = start; id <= end && ids.length < maximum; id++) ids.push(id)
	const next = (ids.at(-1) ?? 0n) + 1n
	return { ids, nextScope: { ...scope, nextPositionId: next > end ? 1n : next, sweepEnd: next > end ? 0n : end } }
}

async function isCanonicalAuctionVaultImplementation(client: ReadClient, implementation: Address, blockNumber: bigint) {
	try {
		verifyRuntimeIdentity(await client.getCode({ address: implementation, blockNumber }), portfolioRuntimeIdentities.SecurityPoolAuctionVault, 'position auction vault implementation')
		return true
	} catch (error) {
		if (error instanceof Error && ['Unrecognized position auction vault implementation runtime code', 'Inconsistent position auction vault implementation runtime immutable values'].includes(error.message)) return false
		throw error
	}
}

async function loadPortfolioPosition(client: ReadClient, snapshot: PortfolioCapitalSnapshot, id: bigint): Promise<PortfolioPosition> {
	const blockNumber = snapshot.blockNumber
	const [rawAccount, started] = await Promise.all([
		client.readContract({ address: snapshot.commitmentIndex, abi: portfolioMonitorAbi, functionName: 'accountOf', args: [id], blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: portfolioMonitorAbi, functionName: 'liquidationStarted', args: [id], blockNumber }),
	])
	const account = record(rawAccount, 'Portfolio position')
	const owner = address(account['owner'])
	// Ordinary EOAs and other account contracts have no known auction signer, and
	// any contract may open a position, so a clone-shaped owner whose
	// implementation is not the canonical vault stays an ordinary owner instead of
	// stalling the scan. A clone of the canonical implementation names its
	// controlling wallet.
	const bindings = decodeAuctionVaultBindings(await client.getCode({ address: owner, blockNumber }))
	let controllingOwner = owner
	if (bindings !== undefined && (await isCanonicalAuctionVaultImplementation(client, bindings.implementation, blockNumber))) {
		controllingOwner = getAddress(await client.readContract({ address: owner, abi: securityPoolAuctionVaultAbi, functionName: 'owner', blockNumber }))
		if (controllingOwner !== bindings.owner) throw new Error('Position auction vault owner does not match its code')
	}
	let retirementStatus = 'Not retiring'
	if (uint(account['batch']) !== 0n && uint(account['commitment']) !== 0n) {
		const raw = await client.readContract({ address: snapshot.commitmentIndex, abi: portfolioMonitorAbi, functionName: 'previewRetirement', args: [id, snapshot.conservativePrice, snapshot.demandAttoEth], blockNumber })
		const preview = record(raw, 'Retirement preview')
		const status = preview['status']
		if (typeof status !== 'bigint' && typeof status !== 'number') throw new Error('Invalid retirement preview status')
		const label = ['Not retiring', 'Imports are open', 'Demand exceeds healthy commitment', 'Earlier requests reserve available capacity', 'Insufficient spare commitment', 'Ready to serve'][Number(status)]
		if (label === undefined) throw new Error('Invalid retirement preview status')
		retirementStatus = label
	}
	return {
		retirementStatus,
		stalledRetirement: false,
		id,
		owner,
		controllingOwner,
		batch: uint(account['batch']),
		rep: uint(account['rep']),
		commitment: uint(account['commitment']),
		maxHealthyPrice: uint(account['maxHealthyPrice']),
		remainingCommitment: uint(account['remainingCommitment']),
		liquidationStarted: uint(started),
	}
}

/** @internal Single-scope reader exposed for authenticated monitoring regression tests. */
export async function loadPortfolioObservation(client: ReadClient, settings: OperatorSettings, wallet: Address | undefined, scope: PortfolioScope, blockNumber: bigint, targets?: readonly PortfolioTarget[]): Promise<PortfolioObservation> {
	const [factory, protocol] = await Promise.all([client.readContract({ address: scope.address, abi: portfolioMonitorAbi, functionName: 'factory', blockNumber }), client.readContract({ address: scope.address, abi: portfolioMonitorAbi, functionName: 'zoltar', blockNumber })])
	if (address(factory) !== settings.deployment.securityPoolFactory || address(protocol) !== settings.deployment.zoltar) throw new Error('Selected portfolio belongs to another factory or Zoltar')
	// A fixed nonzero observer permits monitoring before a signer is configured; no action can use it.
	const owner = wallet ?? getAddress('0x0000000000000000000000000000000000000001')
	const snapshot = await loadPortfolioCapitalSnapshot({ client, portfolio: scope.address, universeId: scope.universeId, owner, blockNumber })
	await verifyPortfolioCustody(client, snapshot, settings.deployment.zoltar)
	let chosenChildUniverseId: bigint | undefined
	if (snapshot.exported) {
		const controller = address(await client.readContract({ address: scope.address, abi: portfolioMonitorAbi, functionName: 'forkController', blockNumber }))
		const choice = await client.readContract({ address: controller, abi: portfolioMonitorAbi, functionName: 'choices', args: [scope.universeId, owner], blockNumber })
		if (!Array.isArray(choice) || choice[1] !== true) throw new Error('Exported managed capital has no authenticated fork choice')
		chosenChildUniverseId = uint(await client.readContract({ address: settings.deployment.zoltar, abi: portfolioMonitorAbi, functionName: 'getChildUniverseId', args: [scope.universeId, uint(choice[0])], blockNumber }))
	}
	const [authority, indexAuthority, universeId, token, epoch, lastPositionId, walletRep, walletAttoEth] = await Promise.all([
		client.readContract({ address: snapshot.capitalLedger, abi: portfolioMonitorAbi, functionName: 'portfolio', blockNumber }),
		client.readContract({ address: snapshot.commitmentIndex, abi: portfolioMonitorAbi, functionName: 'portfolio', blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: portfolioMonitorAbi, functionName: 'universeId', blockNumber }),
		client.readContract({ address: settings.deployment.zoltar, abi: portfolioMonitorAbi, functionName: 'getRepToken', args: [scope.universeId], blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: portfolioMonitorAbi, functionName: 'acceptedPriceEpoch', blockNumber }),
		client.readContract({ address: snapshot.commitmentIndex, abi: portfolioMonitorAbi, functionName: 'lastPositionId', blockNumber }),
		wallet === undefined ? 0n : client.readContract({ address: snapshot.repToken, abi: erc20Abi, functionName: 'balanceOf', args: [wallet], blockNumber }),
		wallet === undefined ? 0n : client.getBalance({ address: wallet, blockNumber }),
	])
	if (address(authority) !== scope.address || address(indexAuthority) !== snapshot.capitalLedger || universeId !== scope.universeId || address(token) !== snapshot.repToken || snapshot.chainId !== settings.network.chainId) throw new Error('Portfolio capital identity does not match the approved universe')
	const page = portfolioPositionPage(scope, uint(lastPositionId), settings.portfolioPolicy.maximumPositionsPerScan)
	const cohort = await client.readContract({ address: snapshot.capitalLedger, abi: securityPoolCapitalLedgerAbi, functionName: 'auctionCohort', blockNumber })
	const owned = await loadOwnedPortfolioVaults(client, snapshot, scope.managedVaults ?? [])
	page.nextScope.managedVaults = owned.vaults
	const chosenVaultChildUniverseIds = await Promise.all(owned.chosenOutcomes.map(async outcome => uint(await client.readContract({ address: settings.deployment.zoltar, abi: portfolioMonitorAbi, functionName: 'getChildUniverseId', args: [scope.universeId, outcome], blockNumber }))))
	const positions: PortfolioPosition[] = []
	for (const id of targets ?? page.ids) {
		if (typeof id !== 'bigint') continue
		if (id === 0n || id > uint(lastPositionId)) throw new Error('Portfolio position is outside the authenticated registry')
		if (id === cohort[1]) continue
		const position = await loadPortfolioPosition(client, snapshot, id)
		if (position.owner === zeroAddress) throw new Error('Portfolio registry position has no owner')
		positions.push(position)
	}
	let knownAuctionBidCount = 0n
	if (cohort[2] !== 0n) {
		const auction = await authenticatePortfolioAuction(client, snapshot, getAddress(cohort[0]))
		knownAuctionBidCount = auction.bidCount
		const bids = targets === undefined ? await portfolioAuctionPage(client, auction.engine, blockNumber, scope.auctionAfterBidId ?? 0n, auction.bidCount, settings.portfolioPolicy.maximumPositionsPerScan) : { ids: [], auctionAfterBidId: scope.auctionAfterBidId ?? 0n }
		page.nextScope.auctionAfterBidId = bids.auctionAfterBidId
		const threshold = await client.readContract({ address: snapshot.capitalLedger, abi: securityPoolCapitalLedgerAbi, functionName: 'maximumHealthyPrice', args: [cohort[3], cohort[4]], blockNumber })
		for (const candidate of targets ?? bids.ids.map(bidId => ({ auction: auction.address, bidId }))) {
			if (typeof candidate === 'bigint') continue
			if (candidate.auction !== auction.address) throw new Error('Auction target controller changed')
			const position = await loadPortfolioAuctionPosition(client, snapshot, auction, candidate.bidId, threshold)
			if (position !== undefined) {
				if ('vault' in candidate && candidate.vault !== position.owner) throw new Error('Auction target vault changed')
				positions.push(position)
			}
		}
	}
	const retirementObservations = new Map((scope.retirementObservations ?? []).map(entry => [entry.id, entry]))
	for (const position of positions) {
		if (position.auctionTarget !== undefined) continue
		if (position.batch === 0n || position.commitment === 0n) {
			retirementObservations.delete(position.id)
			continue
		}
		const previous = retirementObservations.get(position.id)
		const progress = previous?.commitment === position.commitment && previous.batch === position.batch ? previous : { id: position.id, commitment: position.commitment, batch: position.batch, since: snapshot.timestamp }
		position.stalledRetirement = snapshot.timestamp - progress.since >= BigInt(settings.portfolioPolicy.stalledRetirementSeconds)
		retirementObservations.delete(position.id)
		retirementObservations.set(position.id, progress)
	}
	page.nextScope.retirementObservations = [...retirementObservations.values()].slice(-256)
	if ((await client.getBlock({ blockNumber })).hash !== snapshot.blockHash) throw new Error('Portfolio snapshot changed during discovery')
	const pendingOperationReport = snapshot.priceFeed === zeroAddress ? undefined : await loadSponsoredOperationReport(client, snapshot)
	return {
		...(chosenChildUniverseId === undefined ? {} : { chosenChildUniverseId }),
		pendingOperationReport,
		managedPrincipalAttoRep: (pendingOperationReport?.reservedRep ?? 0n) + snapshot.ownerPrincipalAttoRep + owned.pendingPrincipal + owned.accounts.reduce((sum, account) => sum + account.ownerPrincipalAttoRep, 0n),
		managedCommitmentAttoEth: snapshot.ownerCommitmentAttoEth + owned.pendingCommitment + owned.accounts.reduce((sum, account) => sum + account.ownerCommitmentAttoEth, 0n),
		ownedVaults: owned.accounts,
		chosenVaultChildUniverseIds,
		selection: { address: scope.address, universeId: scope.universeId },
		selected: settings.selectedPortfolios.some(selection => selection.address === scope.address && selection.universeId === scope.universeId),
		approvedUniverse: settings.approvedUniverses.includes(scope.universeId),
		snapshot,
		acceptedPriceEpoch: uint(epoch),
		knownPositionCount: uint(lastPositionId),
		knownAuctionBidCount,
		positions,
		nextScope: page.nextScope,
		walletRep,
		walletAttoEth,
	}
}

/** @internal Fork exports cannot erase risk: the chosen child must remain within the explicitly managed scope set. */
export function requireCompletePortfolioExposure(observations: readonly PortfolioObservation[]) {
	for (const observation of observations) {
		for (const universe of [...(observation.chosenVaultChildUniverseIds ?? []), ...(observation.chosenChildUniverseId === undefined ? [] : [observation.chosenChildUniverseId])]) {
			if (!observations.some(child => child.selection.address === observation.selection.address && child.selection.universeId === universe))
				throw new Error(`Add chosen fork universe ${universe} for portfolio ${observation.selection.address} to selectedPortfolios before continuing; exported principal must remain in managed exposure`)
		}
	}
}

/** Newly discovered vaults must enter every managed universe before any exposure-based decision. */
export async function loadManagedPortfolioObservations(client: ReadClient, settings: OperatorSettings, wallet: Address | undefined, requests: readonly { scope: PortfolioScope; targets?: readonly PortfolioTarget[] | undefined }[], blockNumber: bigint) {
	const observations: PortfolioObservation[] = []
	for (const request of requests) observations.push(await loadPortfolioObservation(client, settings, wallet, request.scope, blockNumber, request.targets))
	const scopes = managedPortfolioScopes(
		observations.map(item => item.nextScope),
		[],
	)
	for (const [index, request] of requests.entries()) {
		const expanded = scopes.find(scope => scope.address === request.scope.address && scope.universeId === request.scope.universeId)
		const observed = observations[index]
		if (expanded === undefined || observed === undefined) throw new Error('Managed exposure scope disappeared')
		if ((expanded.managedVaults ?? []).some(vault => !observed.ownedVaults?.some(account => account.owner === vault))) observations[index] = await loadPortfolioObservation(client, settings, wallet, { ...request.scope, managedVaults: expanded.managedVaults ?? [] }, blockNumber, request.targets)
	}
	requireCompletePortfolioExposure(observations)
	return observations
}
