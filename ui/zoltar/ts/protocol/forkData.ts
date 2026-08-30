import type { Address } from '@zoltar/shared/ethereum'
import { requireAddressValue, requireBigintValue, requireBooleanValue, requireTupleValue } from './decoders.js'

type ForkDataView = {
	auctionableAttoRepAtFork: bigint
	truthAuctionAddress: Address
	truthAuctionStartedAt: bigint
	migratedAttoRep: bigint
	auctionedCapacityOwnershipAttoRep: bigint
	escalationElapsedAtFork: bigint
	escalationStartBondAtForkAttoRep: bigint
	escalationNonDecisionThresholdAtForkAttoRep: bigint
	forkOwnSecurityPool: boolean
	unresolvedEscalationAtFork: boolean
	forkOutcomeIndex: bigint
	forkActivationTime: bigint
}

export function requireForkDataView(value: unknown): ForkDataView {
	const [
		auctionableAttoRepAtFork,
		truthAuctionAddress,
		truthAuctionStartedAt,
		migratedAttoRep,
		auctionedCapacityOwnershipAttoRep,
		escalationElapsedAtFork,
		escalationStartBondAtForkAttoRep,
		escalationNonDecisionThresholdAtForkAttoRep,
		forkOwnSecurityPool,
		unresolvedEscalationAtFork,
		forkOutcomeIndex,
		forkActivationTime,
	] = requireTupleValue(value, 12, 'security pool fork data')
	return {
		auctionableAttoRepAtFork: requireBigintValue(auctionableAttoRepAtFork, 'security pool fork data auctionable REP at fork'),
		truthAuctionAddress: requireAddressValue(truthAuctionAddress, 'security pool fork data truth auction address'),
		truthAuctionStartedAt: requireBigintValue(truthAuctionStartedAt, 'security pool fork data truth auction start time'),
		migratedAttoRep: requireBigintValue(migratedAttoRep, 'security pool fork data migrated REP'),
		auctionedCapacityOwnershipAttoRep: requireBigintValue(auctionedCapacityOwnershipAttoRep, 'security pool fork data auctioned capacity ownership'),
		escalationElapsedAtFork: requireBigintValue(escalationElapsedAtFork, 'security pool fork data escalation elapsed at fork'),
		escalationStartBondAtForkAttoRep: requireBigintValue(escalationStartBondAtForkAttoRep, 'security pool fork data escalation start bond at fork'),
		escalationNonDecisionThresholdAtForkAttoRep: requireBigintValue(escalationNonDecisionThresholdAtForkAttoRep, 'security pool fork data escalation non-decision threshold at fork'),
		forkOwnSecurityPool: requireBooleanValue(forkOwnSecurityPool, 'security pool fork data own-pool flag'),
		unresolvedEscalationAtFork: requireBooleanValue(unresolvedEscalationAtFork, 'security pool fork data unresolved escalation flag'),
		forkOutcomeIndex: requireBigintValue(forkOutcomeIndex, 'security pool fork data fork outcome index'),
		forkActivationTime: requireBigintValue(forkActivationTime, 'security pool fork data fork activation time'),
	}
}
