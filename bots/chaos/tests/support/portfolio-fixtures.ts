import type { EcosystemSnapshot, AuctionSnapshot } from '../../src/operations/types.ts'
import { address } from '../operations/fixture.ts'

export function auctionFixture(): AuctionSnapshot {
	return {
		address: address(600),
		collateralToken: address(7),
		walletCollateral: '1000000000000000000',
		collateralAllowance: '1000000000000000000',
		engine: address(601),
		portfolio: address(501),
		universeId: '2',
		forkController: address(602),
		startTime: '1',
		endTime: '2100000000',
		opened: true,
		finalized: false,
		lotAttoEth: 1000n.toString(),
		repGrid: '3',
		unroundedCollateralAttoRepPerLot: 10n.toString(),
		minimumCollateralAttoRepPerLot: 12n.toString(),
		maximumBidAttoRepPerLot: 900n.toString(),
		pendingEthRefund: '0',
		bids: [{ bidId: '1', vault: address(603), lots: '2', minimumAttoRepPerLot: 15n.toString(), targetHealthBps: '10000', settled: false }],
		refundableBidIds: ['1'],
	}
}

export function readyChildFixture(sourcePool: `0x${string}`, portfolio: `0x${string}`, childPool = address(91), childUniverseId = '91') {
	return { portfolio, branchReady: true, sourcePool, sourceGame: address(0), childUniverseId, childPool, game: address(0), historyOutcomesInitialized: 0, historyReady: true, feedRequired: false, dependenciesRequired: false }
}

export function capitalFixture(snapshot: EcosystemSnapshot) {
	const pool = snapshot.pools[0]
	if (pool === undefined) throw new Error('Missing question')
	return {
		admissibleQuestionIds: [],
		portfolio: pool.portfolio,
		universeId: pool.universeId,
		capitalLedger: address(502),
		commitmentIndex: address(503),
		repToken: pool.repToken,
		priceFeed: address(504),
		forkController: address(505),
		owner: snapshot.wallet.address,
		positionId: '1',
		principalAttoRep: 1000000000000000000n.toString(),
		pledgedAttoRep: 1000000000000000000n.toString(),
		commitmentAttoEth: 1000000000000000n.toString(),
		withdrawableAttoRep: 100n.toString(),
		feesAttoEth: 20n.toString(),
		feesAttoRep: 10n.toString(),
		targetHealthFactorBps: '15000',
		minimumCommitmentAttoEth: 100n.toString(),
		securityMultiplierBps: '12000',
		ownerConservativePrice: '1000000000000000000',
		priceValid: true,
		priceValidUntil: '9999999999',
		forkTime: '0',
		frozen: false,
		importing: false,
		exported: false,
		retirementPending: false,
		retirementReady: true,
	}
}
