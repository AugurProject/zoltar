import type { Address } from '@zoltar/shared/ethereum'
import { requireAddressValue, requireBigintValue, requireBooleanValue, requireTupleValue } from './decoders.js'

type ForkDataView = {
	auctionableRepAtForkAttoRep: bigint
	truthAuctionAddress: Address
	truthAuctionStartedAt: bigint
	migratedRepAttoRep: bigint
	auctionedCoverageCommitmentAttoEth: bigint
	escalationElapsedAtFork: bigint
	escalationStartBondAtForkAttoRep: bigint
	escalationNonDecisionThresholdAtForkAttoRep: bigint
	forkOwnSecurityPool: boolean
	unresolvedEscalationAtFork: boolean
	forkOutcomeIndex: bigint
}

export function requireForkDataView(value: unknown): ForkDataView {
	const [auctionableRepAtForkAttoRep, truthAuctionAddress, truthAuctionStartedAt, migratedRepAttoRep, auctionedCoverageCommitmentAttoEth, escalationElapsedAtFork, escalationStartBondAtForkAttoRep, escalationNonDecisionThresholdAtForkAttoRep, forkOwnSecurityPool, unresolvedEscalationAtFork, forkOutcomeIndex] =
		requireTupleValue(value, 11, 'security pool fork data')
	return {
		auctionableRepAtForkAttoRep: requireBigintValue(auctionableRepAtForkAttoRep, 'security pool fork data auctionable REP at fork'),
		truthAuctionAddress: requireAddressValue(truthAuctionAddress, 'security pool fork data truth auction address'),
		truthAuctionStartedAt: requireBigintValue(truthAuctionStartedAt, 'security pool fork data truth auction start time'),
		migratedRepAttoRep: requireBigintValue(migratedRepAttoRep, 'security pool fork data migrated REP'),
		auctionedCoverageCommitmentAttoEth: requireBigintValue(auctionedCoverageCommitmentAttoEth, 'security pool fork data auctioned coverage commitment'),
		escalationElapsedAtFork: requireBigintValue(escalationElapsedAtFork, 'security pool fork data escalation elapsed at fork'),
		escalationStartBondAtForkAttoRep: requireBigintValue(escalationStartBondAtForkAttoRep, 'security pool fork data escalation start bond at fork'),
		escalationNonDecisionThresholdAtForkAttoRep: requireBigintValue(escalationNonDecisionThresholdAtForkAttoRep, 'security pool fork data escalation non-decision threshold at fork'),
		forkOwnSecurityPool: requireBooleanValue(forkOwnSecurityPool, 'security pool fork data own-pool flag'),
		unresolvedEscalationAtFork: requireBooleanValue(unresolvedEscalationAtFork, 'security pool fork data unresolved escalation flag'),
		forkOutcomeIndex: requireBigintValue(forkOutcomeIndex, 'security pool fork data fork outcome index'),
	}
}
