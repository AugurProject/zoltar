import { catalogAbis } from '../abi-catalog.ts'
import type { StoredLog } from '../types.ts'
import { type DomainEventProjection, eventProjectionsFrom, type Projection } from './events.ts'

type EventDomainDefinition = {
	readonly domain: DomainEventProjection['domain']
	readonly entityType: string
	readonly identityFields?: readonly string[]
}

const definitions = (domain: DomainEventProjection['domain'], entityType: string, eventNames: readonly string[], identityFields?: readonly string[]): Readonly<Record<string, EventDomainDefinition>> =>
	Object.fromEntries(eventNames.map(eventName => [eventName, { domain, entityType, ...(identityFields === undefined ? {} : { identityFields }) }]))

// This is the scanner's explicit semantic taxonomy. It intentionally excludes
// generic ERC approvals/transfers while covering every protocol lifecycle event
// emitted by the contracts represented in the operations views.
const eventDomains: Readonly<Record<string, EventDomainDefinition>> = {
	...definitions('system', 'question', ['QuestionCreated'], ['questionId']),
	...definitions('system', 'deployment', ['DeploymentAddressesSet']),
	...definitions('system', 'reputation-token', ['TheoreticalSupplySet', 'Mint', 'Burn']),
	...definitions('system', 'share-token', ['AuthorizationUpdated', 'TransferSingle', 'TransferBatch', 'Migrate']),
	...definitions('report', 'open-oracle-report', ['ReportSubmitted', 'ReportDisputed', 'ReportSettled'], ['reportId']),
	...definitions('oracle', 'price-coordinator', ['CoordinatorStateCheckpoint', 'ExecutedStagedOperation', 'LiquidationRouteStaged', 'PendingReportRecovered', 'PriceReportRejected', 'PriceReported', 'PriceRequested', 'RepEthPriceSet', 'SecurityPoolSet', 'StagedOperationQueued', 'InternalApproval']),
	...definitions('escalation', 'escalation', [
		'CarryDepositConsumed',
		'ClaimDeposit',
		'DepositOnOutcome',
		'ForkCarryCheckpoint',
		'ForkContinuationResumed',
		'ForkedEscrowClaimed',
		'ForkedEscrowExported',
		'ForkedEscrowRecorded',
		'GameContinuedFromFork',
		'GameStarted',
		'InheritedThresholdTie',
		'LocalDepositAppended',
		'NonDecisionReached',
		'ResidualRepSweptToSecurityPool',
		'ForkContinuationResidualRepBurned',
		'TruthAuctionHaircutApplied',
		'VaultEscrowUpdated',
		'VaultUnresolvedTotalsExported',
	]),
	...definitions('auction', 'auction', ['AuctionStarted', 'BidSubmitted', 'AuctionFinalized', 'BidSettled', 'EthRefundCredited', 'PendingEthRefundWithdrawn']),
	...definitions(
		'risk',
		'pool',
		['DeploySecurityPool', 'SecurityPoolRegistered', 'AwaitingForkContinuationSet', 'CompleteSetCreated', 'CompleteSetRedeemed', 'EscalationGameSet', 'PoolAccountingCheckpoint', 'PoolForkModeActivated', 'ShareTokenSupplySet', 'SharesRedeemed', 'SystemStateSet', 'TotalRepBackingUnitsSet'],
		['securityPool'],
	),
	...definitions('risk', 'vault', ['DepositToEscalationGame', 'RepDepositedToVault', 'RepRedeemedFromVault', 'RepWithdrawnFromVault', 'VaultAccountingCheckpoint', 'VaultBadDebtRecorded', 'VaultLiquidated', 'VaultDepositTargetHealthFactorRecorded'], ['vault', 'targetVault']),
	...definitions('approval', 'liquidation-approval', ['LiquidationApprovalSet', 'LiquidationApprovalReserved', 'LiquidationApprovalReleased', 'LiquidationApprovalConsumed', 'LiquidationApprovalRevoked', 'LiquidationApprovalNonceInvalidated'], ['approvalId', 'receiverVault']),
	...definitions('trading', 'amm', ['PairCreated', 'LiquidityAdded', 'LiquidityInitialized', 'LiquidityRemoved', 'PredeploymentSharesQuarantined', 'Swap', 'Sync', 'Transfer', 'Approval'], ['pair']),
	...definitions(
		'fork',
		'fork',
		[
			'UniverseInitialized',
			'UniverseForked',
			'DeployChild',
			'EscalationMigrationEntitlementInitialized',
			'EscalationMigrationEntitlementMaterialized',
			'MigrationRepAdded',
			'MigrationRepSplit',
			'RepBurned',
			'ChildDisputeStakedRepMaterialized',
			'ChildPoolLinked',
			'ChildRepSplit',
			'ClaimAuctionProceeds',
			'ClaimForkedEscalationDepositsToWallet',
			'DisputeStakedRepDrainedAtFork',
			'ParentRepLocked',
			'PoolHeldRepSweptToChild',
			'SecurityPoolForkSnapshot',
			'TruthAuctionFinalized',
			'TruthAuctionStarted',
			'VaultBadDebtMigrated',
			'VaultMigrationCheckpoint',
		],
		['universeId', 'parentUniverseId', 'parent', 'parentPool', 'securityPool', 'childUniverseId', 'childPool'],
	),
}

// Every taxonomy entry must name an event the pinned ABI catalog can decode;
// otherwise a renamed contract event would silently stop projecting.
const catalogEventNames = new Set(catalogAbis().flatMap(abi => abi.flatMap(item => (item.type === 'event' && typeof item.name === 'string' ? [item.name] : []))))
const unbackedEventNames = Object.keys(eventDomains).filter(eventName => !catalogEventNames.has(eventName))
if (unbackedEventNames.length > 0) throw new Error(`Semantic event taxonomy names events missing from the ABI catalog: ${unbackedEventNames.join(', ')}`)

const domainProjectionFrom = (log: StoredLog): DomainEventProjection | undefined => {
	const eventName = log.decoded.name
	const data = log.decoded.arguments
	if (eventName === undefined || data === undefined || log.decoded.status !== 'decoded') return undefined
	const definition = eventDomains[eventName]
	if (definition === undefined) return undefined
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
	const approvalId = data['approvalId']
	const approvalIdentity = typeof approvalId === 'string' ? approvalId.toLowerCase() : typeof data['receiverVault'] === 'string' ? `nonce:${data['receiverVault'].toLowerCase()}` : undefined
	const fieldIdentity = definition.identityFields?.map(field => data[field]).find(value => typeof value === 'string')
	const identitySuffix = typeof fieldIdentity === 'string' ? fieldIdentity.toLowerCase() : undefined
	const entityIdentity =
		definition.domain === 'report' && typeof reportId === 'string'
			? `${log.address.toLowerCase()}:${reportId}`
			: definition.entityType === 'vault' && identitySuffix !== undefined
				? `${log.address.toLowerCase()}:${identitySuffix}`
				: definition.entityType === 'liquidation-approval' && approvalIdentity !== undefined
					? `${log.address.toLowerCase()}:${approvalIdentity}`
					: (identitySuffix ?? log.address.toLowerCase())
	return {
		type: 'domainEvent',
		domain: definition.domain,
		entityType: definition.entityType,
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
