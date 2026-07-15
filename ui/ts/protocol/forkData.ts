import type { Address } from '@zoltar/shared/ethereum'
import { requireAddressValue, requireBigintValue, requireBooleanValue, requireTupleValue } from './decoders.js'

type ForkDataView = {
	auctionableRepAtFork: bigint
	truthAuctionAddress: Address
	truthAuctionStartedAt: bigint
	migratedRep: bigint
	auctionedSecurityBondAllowance: bigint
	escalationElapsedAtFork: bigint
	escalationStartBondAtFork: bigint
	escalationNonDecisionThresholdAtFork: bigint
	forkOwnSecurityPool: boolean
	unresolvedEscalationAtFork: boolean
	forkOutcomeIndex: bigint
}

export function requireForkDataView(value: unknown): ForkDataView {
	const [auctionableRepAtFork, truthAuctionAddress, truthAuctionStartedAt, migratedRep, auctionedSecurityBondAllowance, escalationElapsedAtFork, escalationStartBondAtFork, escalationNonDecisionThresholdAtFork, forkOwnSecurityPool, unresolvedEscalationAtFork, forkOutcomeIndex] = requireTupleValue(
		value,
		11,
		'security pool fork data',
	)
	return {
		auctionableRepAtFork: requireBigintValue(auctionableRepAtFork, 'security pool fork data auctionable REP at fork'),
		truthAuctionAddress: requireAddressValue(truthAuctionAddress, 'security pool fork data truth auction address'),
		truthAuctionStartedAt: requireBigintValue(truthAuctionStartedAt, 'security pool fork data truth auction start time'),
		migratedRep: requireBigintValue(migratedRep, 'security pool fork data migrated REP'),
		auctionedSecurityBondAllowance: requireBigintValue(auctionedSecurityBondAllowance, 'security pool fork data auctioned security bond allowance'),
		escalationElapsedAtFork: requireBigintValue(escalationElapsedAtFork, 'security pool fork data escalation elapsed at fork'),
		escalationStartBondAtFork: requireBigintValue(escalationStartBondAtFork, 'security pool fork data escalation start bond at fork'),
		escalationNonDecisionThresholdAtFork: requireBigintValue(escalationNonDecisionThresholdAtFork, 'security pool fork data escalation non-decision threshold at fork'),
		forkOwnSecurityPool: requireBooleanValue(forkOwnSecurityPool, 'security pool fork data own-pool flag'),
		unresolvedEscalationAtFork: requireBooleanValue(unresolvedEscalationAtFork, 'security pool fork data unresolved escalation flag'),
		forkOutcomeIndex: requireBigintValue(forkOutcomeIndex, 'security pool fork data fork outcome index'),
	}
}
