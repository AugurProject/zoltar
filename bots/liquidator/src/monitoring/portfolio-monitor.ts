import { verifyPortfolioCustody } from './portfolio-identity.ts'
import type { OperatorSettings } from '#config/settings'
import type { PortfolioSelection } from '#config/portfolio-policy'
import { erc20Abi, securityPoolAbi, securityPoolFactoryAbi } from '@zoltar/bot-shared/contracts/abi'
import { getAddress, parseAbiItem, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { loadPortfolioCapitalSnapshot, requiredPortfolioExecutionReserve, type PortfolioCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { ReadClient } from './vault-positions.ts'
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
	parseAbiItem('function seedPool() view returns (address)'),
	parseAbiItem('function originUniverseId() view returns (uint248)'),
	parseAbiItem('function zoltar() view returns (address)'),
	parseAbiItem('function portfolio() view returns (address)'),
	parseAbiItem('function universeId() view returns (uint248)'),
	parseAbiItem('function acceptedPriceEpoch() view returns (uint256)'),
	parseAbiItem('function getRepToken(uint248 universeId) view returns (address)'),
	parseAbiItem('function lastPositionId() view returns (uint96)'),
	parseAbiItem('function accountOf(uint96 id) view returns ((address owner,uint96 batch,uint256 rep,uint256 commitment,uint256 maxHealthyPrice,uint256 releasedRep,uint256 ethFees,uint256 repFees,uint256 remainingCommitment) account)'),
	parseAbiItem('function positionExecutionReserveAttoEth(uint96 id) view returns (uint256)'),
	parseAbiItem('function liquidationStarted(uint96 id) view returns (uint48)'),
	parseAbiItem('function previewRetirement(uint96 id,uint256 acceptedPrice,uint256 demand) view returns ((uint8 status,uint96 effectiveCurrentBatch,uint256 healthyCommitment,uint256 spareCommitment,uint256 queuedAheadCommitment,uint256 commitmentReduction,uint256 releasedRep) preview)'),
] as const

export type PortfolioScope = PortfolioSelection & { nextPositionId: bigint; sweepEnd: bigint; retirementObservations?: { id: bigint; commitment: bigint; batch: bigint; since: bigint }[] }
export type PortfolioPosition = {
	id: bigint
	owner: Address
	batch: bigint
	rep: bigint
	commitment: bigint
	maxHealthyPrice: bigint
	remainingCommitment: bigint
	executionReserveAttoEth: bigint
	requiredExecutionReserveAttoEth: bigint
	liquidationStarted: bigint
	retirementStatus: string
	stalledRetirement: boolean
}
export type PortfolioObservation = {
	selection: PortfolioSelection
	selected: boolean
	chosenChildUniverseId?: bigint
	approvedUniverse: boolean
	snapshot: PortfolioCapitalSnapshot
	acceptedPriceEpoch: bigint
	knownPositionCount: bigint
	positions: PortfolioPosition[]
	nextScope: PortfolioScope
	walletRep: bigint
	walletAttoEth: bigint
}

/** Retain every previously managed scope: deselection cannot hide deployed principal from total limits. */
export function managedPortfolioScopes(previous: readonly PortfolioScope[], selected: readonly PortfolioSelection[]) {
	const scopes = new Map(previous.map(scope => [`${scope.address.toLowerCase()}:${scope.universeId}`, scope]))
	for (const selection of selected) {
		const key = `${selection.address.toLowerCase()}:${selection.universeId}`
		if (!scopes.has(key)) scopes.set(key, { ...selection, nextPositionId: 1n, sweepEnd: 0n })
	}
	if (scopes.size > 64) throw new Error('Managed portfolio scope history exceeds 64; reconcile exposure before adding more portfolios')
	return [...scopes.values()]
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

async function loadPortfolioPosition(client: ReadClient, snapshot: PortfolioCapitalSnapshot, id: bigint): Promise<PortfolioPosition> {
	const blockNumber = snapshot.blockNumber
	const [rawAccount, reserve, started] = await Promise.all([
		client.readContract({ address: snapshot.commitmentIndex, abi: portfolioMonitorAbi, functionName: 'accountOf', args: [id], blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: portfolioMonitorAbi, functionName: 'positionExecutionReserveAttoEth', args: [id], blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: portfolioMonitorAbi, functionName: 'liquidationStarted', args: [id], blockNumber }),
	])
	const account = record(rawAccount, 'Portfolio position')
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
		owner: address(account['owner']),
		batch: uint(account['batch']),
		rep: uint(account['rep']),
		commitment: uint(account['commitment']),
		maxHealthyPrice: uint(account['maxHealthyPrice']),
		remainingCommitment: uint(account['remainingCommitment']),
		executionReserveAttoEth: uint(reserve),
		requiredExecutionReserveAttoEth: requiredPortfolioExecutionReserve({ commitment: uint(account['commitment']), ...snapshot.economics }),
		liquidationStarted: uint(started),
	}
}

export async function loadPortfolioObservation(client: ReadClient, settings: OperatorSettings, wallet: Address | undefined, scope: PortfolioScope, blockNumber: bigint, positionIds?: readonly bigint[]): Promise<PortfolioObservation> {
	const [factory, protocol, seed] = await Promise.all([
		client.readContract({ address: scope.address, abi: portfolioMonitorAbi, functionName: 'factory', blockNumber }),
		client.readContract({ address: scope.address, abi: portfolioMonitorAbi, functionName: 'zoltar', blockNumber }),
		client.readContract({ address: scope.address, abi: portfolioMonitorAbi, functionName: 'seedPool', blockNumber }),
	])
	if (address(factory) !== settings.deployment.securityPoolFactory || address(protocol) !== settings.deployment.zoltar) throw new Error('Selected portfolio belongs to another factory or Zoltar')
	const seedAddress = address(seed)
	const [origin, seedUniverse, seedFactory, seedParent, seedProtocol, originUniverse] = await Promise.all([
		client.readContract({ address: address(factory), abi: securityPoolFactoryAbi, functionName: 'getSecurityPoolOriginId', args: [seedAddress], blockNumber }),
		client.readContract({ address: seedAddress, abi: securityPoolAbi, functionName: 'universeId', blockNumber }),
		client.readContract({ address: seedAddress, abi: securityPoolAbi, functionName: 'securityPoolFactory', blockNumber }),
		client.readContract({ address: seedAddress, abi: securityPoolAbi, functionName: 'parent', blockNumber }),
		client.readContract({ address: seedAddress, abi: securityPoolAbi, functionName: 'zoltar', blockNumber }),
		client.readContract({ address: scope.address, abi: portfolioMonitorAbi, functionName: 'originUniverseId', blockNumber }),
	])
	const canonicalSeed = await client.readContract({ address: address(factory), abi: securityPoolFactoryAbi, functionName: 'getSecurityPool', args: [origin, seedUniverse], blockNumber })
	if (getAddress(canonicalSeed) !== seedAddress || getAddress(seedFactory) !== settings.deployment.securityPoolFactory || getAddress(seedParent) !== zeroAddress || getAddress(seedProtocol) !== settings.deployment.zoltar || seedUniverse !== originUniverse)
		throw new Error('Portfolio constructor seed is not a canonical origin pool')
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
	const positions: PortfolioPosition[] = []
	for (const id of positionIds ?? page.ids) {
		if (id === 0n || id > uint(lastPositionId)) throw new Error('Portfolio position is outside the authenticated registry')
		const position = await loadPortfolioPosition(client, snapshot, id)
		if (position.owner === zeroAddress) throw new Error('Portfolio registry position has no owner')
		positions.push(position)
	}
	const retirementObservations = new Map((scope.retirementObservations ?? []).map(entry => [entry.id, entry]))
	for (const position of positions) {
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
	return {
		...(chosenChildUniverseId === undefined ? {} : { chosenChildUniverseId }),
		selection: { address: scope.address, universeId: scope.universeId },
		selected: settings.selectedPortfolios.some(selection => selection.address === scope.address && selection.universeId === scope.universeId),
		approvedUniverse: settings.approvedUniverses.includes(scope.universeId),
		snapshot,
		acceptedPriceEpoch: uint(epoch),
		knownPositionCount: uint(lastPositionId),
		positions,
		nextScope: page.nextScope,
		walletRep,
		walletAttoEth,
	}
}

/** Fork exports cannot erase risk: the chosen child must remain within the explicitly managed scope set. */
export function requireCompletePortfolioExposure(observations: readonly PortfolioObservation[]) {
	for (const observation of observations) {
		if (observation.chosenChildUniverseId !== undefined && !observations.some(child => child.selection.address === observation.selection.address && child.selection.universeId === observation.chosenChildUniverseId))
			throw new Error(`Add chosen fork universe ${observation.chosenChildUniverseId} for portfolio ${observation.selection.address} to selectedPortfolios before continuing; exported principal must remain in managed exposure`)
	}
}
