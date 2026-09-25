import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import type { LiveMarket } from '../../protocol/live.js'

export const FIXTURE_NOW = 1_000_000n
export const FIXTURE_DAY = 24n * 60n * 60n

export function fixtureAddress(byte: string) {
	return getAddress(`0x${byte.repeat(20)}`)
}

export function liveMarketFixture(overrides: Partial<LiveMarket> & Pick<LiveMarket, 'pool'>): LiveMarket {
	return {
		pair: fixtureAddress('ee'),
		shareToken: fixtureAddress('dd'),
		universeId: 0n,
		questionId: 1n,
		title: 'Will it rain?',
		description: 'Resolves YES if it rains.',
		endTime: FIXTURE_NOW + 30n * FIXTURE_DAY,
		statoblastSecurityMultiplierBps: 10_000n,
		initialReportPriorityFeeAttoEthPerGas: 0n,
		systemState: 0,
		awaitingForkContinuation: false,
		universeForkTime: 0n,
		vaultCount: 1n,
		shareTokenSupplyAttoShares: 0n,
		settlementCollateralAttoEth: 0n,
		currentRetentionRate: 0n,
		totalCapacityOwnershipAttoRep: 0n,
		feeEligibleCapacityOwnershipAttoRep: 0n,
		mintingCapacityCeilingAttoEth: 0n,
		availableMintingCapacityAttoEth: 0n,
		feeBps: 30n,
		tradingStatus: 0,
		questionOutcome: 3,
		yesReserve: 10n ** 36n,
		noReserve: 10n ** 36n,
		lpTotalSupply: 10n ** 36n,
		...overrides,
	}
}
