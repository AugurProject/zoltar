/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/shared/ethereum'
import { requireForkDataView } from '../../protocol/forkData.js'

describe('fork data decoder', () => {
	test('accepts the current tuple including fork activation time', () => {
		const truthAuctionAddress = getAddress('0x00000000000000000000000000000000000000a1')
		expect(requireForkDataView([1n, truthAuctionAddress, 2n, 3n, 4n, 5n, 6n, 7n, true, false, 8n, 9n])).toEqual({
			auctionableAttoRepAtFork: 1n,
			truthAuctionAddress,
			truthAuctionStartedAt: 2n,
			migratedAttoRep: 3n,
			auctionedCapacityOwnershipAttoRep: 4n,
			escalationElapsedAtFork: 5n,
			escalationStartBondAtForkAttoRep: 6n,
			escalationNonDecisionThresholdAtForkAttoRep: 7n,
			forkOwnSecurityPool: true,
			unresolvedEscalationAtFork: false,
			forkOutcomeIndex: 8n,
			forkActivationTime: 9n,
		})
	})

	test('rejects the prior tuple shape', () => {
		expect(() => requireForkDataView([1n, getAddress('0x00000000000000000000000000000000000000a1'), 2n, 3n, 4n, 5n, 6n, 7n, true, false, 8n])).toThrow('Unexpected security pool fork data response')
	})
})
