import { abiForKind, catalogAbis } from '../abi-catalog.ts'
import { dependencyDiscoveryKinds, discoveredContractKinds } from '../contract-discovery.ts'
import type { SystemContractKind } from '../system-interfaces.ts'
import type { StoredLog } from '../types.ts'
import { type DomainEventProjection, eventProjectionsFrom, type Projection } from './events.ts'

type EventDomainDefinition = {
	readonly domain: DomainEventProjection['domain']
	readonly entityType: string
	readonly identityFields?: readonly string[]
}

const definitions = (domain: DomainEventProjection['domain'], entityType: string, eventNames: readonly string[], identityFields?: readonly string[]): Readonly<Record<string, EventDomainDefinition>> =>
	Object.fromEntries(eventNames.map(eventName => [eventName, { domain, entityType, ...(identityFields === undefined ? {} : { identityFields }) }]))

// This is the scanner's explicit semantic taxonomy, keyed by event name. Every
// event name that a contract kind in `taxonomyContractKinds` declares is listed
// here, apart from the documented `unclassifiedEvents`. Generic token events
// share names across contracts, so `domainProjectionFrom` projects `Transfer`
// and `Approval` only for AMM pairs, `ApprovalForAll` only for share tokens and
// `Deposit`/`Withdrawal` only for WETH. Logs are fetched by contract address, so
// events of contracts the indexer never registers (the settlement book,
// reporter ledger, portfolio services and settlement, capital fee streams and
// the shared report escrow) are not ingested and are deliberately absent.
const eventDomains: Readonly<Record<string, EventDomainDefinition>> = {
	...definitions('system', 'question', ['QuestionCreated'], ['questionId']),
	...definitions('system', 'deployment', ['DeploymentAddressesSet']),
	...definitions('system', 'reputation-token', ['ReputationTokenInitialized', 'TheoreticalSupplySet', 'Mint', 'Burn']),
	...definitions('system', 'share-token', ['ApprovalForAll', 'AuthorizationUpdated', 'TransferSingle', 'TransferBatch', 'Migrate', 'PortfolioRecoveryRightsTransferred', 'PortfolioRecoveryRightsConsumed']),
	...definitions('risk', 'pool', ['CompleteSetRedeemedByTransfer'], ['securityPool']),
	...definitions('system', 'token-authorization', ['AuthorizationUsed', 'AuthorizationCanceled']),
	...definitions('system', 'weth', ['Deposit', 'Withdrawal']),
	...definitions('report', 'open-oracle-report', ['ReportSubmitted', 'ReportDisputed', 'ReportSettled'], ['reportId']),
	...definitions('oracle', 'price-coordinator', ['PendingReportRecovered', 'PriceReportRejected', 'PriceReported', 'PriceRequested', 'RepEthPriceSet', 'SecurityPoolSet', 'SharedPriceFeedSet', 'InternalApproval']),
	...definitions('oracle', 'price-feed', ['CoordinatorRegistered', 'ExposureCheckpoint', 'ReportFundingAssigned', 'ReportOperationAttempted']),
	...definitions('escalation', 'escalation', [
		'CarryDepositConsumed',
		'ClaimCheckpointProgress',
		'ClaimDeposit',
		'DepositOnOutcome',
		'ForkCarryCheckpoint',
		'ForkContinuationResumed',
		'ForkedEscrowExported',
		'ForkedEscrowRecorded',
		'GameContinuedFromFork',
		'GameStarted',
		'InheritedThresholdTie',
		'InheritedThresholdTieReopened',
		'LocalDepositAppended',
		'NonDecisionReached',
		'OrdinarySettlementInitialized',
		'EscalationSurplusAccrued',
		'OrdinaryResidualRepBurned',
		'ForkContinuationResidualRepBurned',
		'VaultEscrowUpdated',
		'VaultUnresolvedTotalsExported',
	]),
	...definitions('auction', 'auction', ['AuctionStarted', 'BidSubmitted', 'AuctionFinalized', 'BidSettled', 'FeesRemoved', 'RefundWithdrawn', 'RaisedWithdrawn']),
	...definitions('risk', 'pool', ['DeploySecurityPool', 'SecurityPoolRegistered', 'AwaitingForkContinuationSet', 'CompleteSetCreated', 'CompleteSetRedeemed', 'EscalationGameSet', 'QuestionAccountingCheckpoint', 'ShareTokenSupplySet', 'SharesRedeemed', 'SystemStateSet', 'EthReceived'], ['securityPool']),
	...definitions('risk', 'vault', ['PrincipalDeposited', 'PrincipalWithdrawn', 'CommitmentAuthorized', 'EarningsClaimed'], ['owner']),
	...definitions('risk', 'capital-position', ['CommitmentCured', 'CommitmentTakenOver', 'AuctionCohortInstalled', 'AuctionBidMaterialized'], ['positionId', 'sourceId']),
	...definitions('risk', 'portfolio', ['QuestionRegistered', 'CompleteSetsFunded', 'UniversePrepared', 'SetupAdvanced', 'RetirementServed', 'CapitalPriceAccepted', 'UnassignedFeesBurned']),
	...definitions('risk', 'portfolio', ['PortfolioRegistered'], ['portfolio']),
	// The portfolio auction controls a uniform-price auction engine at another address; only the engine's events build the auction views.
	...definitions('risk', 'portfolio-auction', ['AuctionOpened', 'WinningVaultCreated', 'AuctionClosed']),
	...definitions('fork', 'portfolio-branch', ['ForkFrozen', 'BranchChosen', 'BranchStarted', 'BranchActivated', 'NeutralCashRecovered'], ['universeId']),
	...definitions('trading', 'amm', ['PositionExitedByTransfer', 'PairCreated', 'LiquidityAdded', 'LiquidityInitialized', 'LiquidityRemoved', 'PredeploymentSharesQuarantined', 'Swap', 'Sync', 'Transfer', 'Approval'], ['pair']),
	...definitions('fork', 'fork', ['ChildReputationTokenInitialized', 'UniverseInitialized', 'UniverseForked', 'DeployChild', 'MigrationRepAdded', 'MigrationRepSplit', 'RepBurned'], ['universeId']),
}

// Every taxonomy entry must name an event the pinned ABI catalog can decode;
// otherwise a renamed contract event would silently stop projecting.
const abiEventNames = (abi: ReturnType<typeof catalogAbis>[number]): readonly string[] => abi.flatMap(item => (item.type === 'event' && typeof item.name === 'string' ? [item.name] : []))
const catalogEventNames = new Set(catalogAbis().flatMap(abiEventNames))
const unbackedEventNames = Object.keys(eventDomains).filter(eventName => !catalogEventNames.has(eventName))
if (unbackedEventNames.length > 0) throw new Error(`Semantic event taxonomy names events missing from the ABI catalog: ${unbackedEventNames.join(', ')}`)

// Protocol contract kinds whose logs the indexer ingests from a manifest or a
// portfolio-discovery read, together with the delegates that emit at those addresses.
const listedTaxonomyContractKinds: readonly SystemContractKind[] = [
	'ammFactory',
	'ammPair',
	'ammRouter',
	'deploymentStatusOracle',
	'escalationGame',
	'escalationGameClaimDelegate',
	'escalationGameDepositDelegate',
	'openOracle',
	'priceCoordinator',
	'reputationToken',
	'securityPool',
	'securityPoolCapitalAuctionDelegate',
	'securityPoolCapitalLedger',
	'securityPoolCapitalLifecycleDelegate',
	'securityPoolEventEmitter',
	'securityPoolFactory',
	'securityPoolOperationsDelegate',
	'securityPoolPortfolio',
	'securityPoolPortfolioAuction',
	'securityPoolPortfolioForkCoordinator',
	'securityPoolSettlementDelegate',
	'securityPoolUniformPriceAuction',
	'shareToken',
	'sharedPoolPriceFeed',
	'weth',
	'zoltar',
	'zoltarQuestionData',
]

// Kinds discovered from event arguments join the guard automatically; the Uniswap
// dependencies among them have their own projection and no semantic taxonomy.
const dependencyKinds: ReadonlySet<SystemContractKind> = new Set(Object.values(dependencyDiscoveryKinds))
const taxonomyContractKinds = [...new Set([...listedTaxonomyContractKinds, ...discoveredContractKinds.filter(kind => !dependencyKinds.has(kind))])]

// `URI` is declared by IERC1155, but ShareToken never emits it.
const unclassifiedEvents: ReadonlySet<string> = new Set(['URI'])

// The reverse direction, by event name: a new or renamed event on an indexed
// contract must be listed here, or it would be stored as a raw log and never projected.
const unclassifiedEventNames = taxonomyContractKinds.flatMap(kind => {
	const abi = abiForKind(kind)
	if (abi === undefined) throw new Error(`Semantic event taxonomy names a contract kind without an ABI: ${kind}`)
	return abiEventNames(abi).flatMap(eventName => (eventDomains[eventName] === undefined && !unclassifiedEvents.has(eventName) ? [`${kind}.${eventName}`] : []))
})
if (unclassifiedEventNames.length > 0) throw new Error(`Semantic event taxonomy is missing events emitted by indexed contracts: ${unclassifiedEventNames.join(', ')}`)

const domainEntityIdentity = (definition: { readonly domain: string; readonly entityType: string }, address: string, identity: { identitySuffix: string | undefined; reportId: unknown }): string => {
	if (definition.domain === 'report' && typeof identity.reportId === 'string') return `${address}:${identity.reportId}`
	if (['vault', 'capital-position', 'portfolio-branch'].includes(definition.entityType) && identity.identitySuffix !== undefined) return `${address}:${identity.identitySuffix}`
	return identity.identitySuffix ?? address
}

const domainProjectionFrom = (log: StoredLog): DomainEventProjection | undefined => {
	const eventName = log.decoded.name
	const data = log.decoded.arguments
	if (eventName === undefined || data === undefined || log.decoded.status !== 'decoded') return undefined
	const definition = eventDomains[eventName]
	if (definition === undefined) return undefined
	if (eventName === 'ApprovalForAll' && log.contractKind !== 'shareToken') return undefined
	if ((eventName === 'Deposit' || eventName === 'Withdrawal') && log.contractKind !== 'weth') return undefined
	if (eventName === 'PairCreated' && log.contractKind !== 'ammFactory') return undefined
	if ((eventName === 'Transfer' || eventName === 'Approval') && log.contractKind !== 'ammPair') return undefined
	// Augur's two-way pair emits reserve-oriented Swap evidence. Uniswap V3/V4
	// also emit an event named Swap, but their sqrt-price shape belongs to the
	// dedicated Uniswap projection and cannot be interpreted as Augur reserves.
	if (eventName === 'Swap' && !(typeof data['yesForNo'] === 'boolean' && typeof data['amountIn'] === 'string' && typeof data['amountOut'] === 'string' && typeof data['resultingYesReserve'] === 'string' && typeof data['resultingNoReserve'] === 'string')) return undefined
	// Uniswap V2 also emits Sync, but its reserve0/reserve1 payload does not
	// describe Augur YES/NO reserves and must remain in the dedicated Uniswap
	// observation path only.
	if (eventName === 'Sync' && !(typeof data['yesReserve'] === 'string' && typeof data['noReserve'] === 'string')) return undefined
	const reportId = data['reportId']
	const fieldIdentity = definition.identityFields?.map(field => data[field]).find(value => typeof value === 'string')
	const identitySuffix = typeof fieldIdentity === 'string' ? fieldIdentity.toLowerCase() : undefined
	const entityIdentity = domainEntityIdentity(definition, log.address.toLowerCase(), { identitySuffix, reportId })
	return {
		type: 'domainEvent',
		domain: definition.domain,
		entityType: log.contractKind === 'sharedPoolPriceFeed' && definition.domain === 'oracle' ? 'price-feed' : definition.entityType,
		entityIdentity,
		semanticEventKind: eventName,
		data,
		relatedEntities: log.decoded.referencedAddresses?.map(item => item.toLowerCase()) ?? [],
	}
}

export const projectionsFrom = (log: StoredLog): readonly Projection[] => {
	const eventProjections = eventProjectionsFrom(log)
	const domainProjection = domainProjectionFrom(log)
	return domainProjection === undefined ? eventProjections : [...eventProjections, domainProjection]
}
