import { boundCloneRuntimeCode, universeCloneBindings } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuction as auctionArtifact, statoblast_SecurityPoolUniformPriceRepairAuction_SecurityPoolUniformPriceRepairAuction as engineArtifact } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { auctionAddress, auctionEngine, capital, owner, token, unit } from './capitalFixture.js'
import { modules } from './capitalClient.js'
import { priceFixture } from './priceFixture.js'
export { auctionAddress, auctionEngine }
export async function auctionFixture() {
	const fixture = priceFixture()
	fixture.setWeth(100n * unit)
	fixture.setAllowances(100n * unit, 100n * unit)
	const fork = await fixture.fork()
	Object.assign(fixture.values, {
		repairAuctions: auctionAddress,
		oracleExposure: 20n * unit,
		getForkTime: 0n,
		forkAuthority: modules.fork,
		capital,
		engine: auctionEngine,
		closesAt: 3_000n,
		inventoryAttoRep: 100n * unit,
		shortfallAttoEth: 10n * unit,
		lotAttoEth: unit,
		targetLots: 10n,
		repGrid: 2n,
		openingConservativePrice: 2n * unit,
		minimumCollateralAttoRepPerLot: 4n * unit,
		opened: true,
		finalized: false,
		initialized: true,
		unclaimedRepairAuctionBids: 1n,
		controller: auctionAddress,
		maximumBidAttoRepPerLot: 100n * unit,
		maximumAdmissibleBidAttoRepPerLot: 100n * unit,
		depositedAttoEth: 2n * unit,
		securityMultiplierBps: 20_000n,
		conservativePrice: 2n * unit,
		liquidationPrice: unit,
		priceValidUntil: 4_000n,
		acceptedExposureLimitAttoEth: 20n * unit,
		acceptedRepExposureLimitAttoRep: 100n * unit,
		earlyRefundAttoEth: 0n,
		bidderBidCount: 1n,
		bidderBidId: 1n,
		bids: [owner, false, false, 2n, 60n * unit],
		previewBid: [owner, 1n, unit, 100n * unit, unit],
		clearing: [100n * unit, 1n, unit, 100n * unit, false],
		repairAuctionPositions: [[owner, 100n * unit, unit, 0n, false, 7n * unit, 9n * unit]],
	})
	fixture.set(capital, 'universeId', 42n)
	fixture.set(auctionAddress, 'universeId', 42n)
	fixture.source.codes.set(capital, boundCloneRuntimeCode(modules.capitalImplementation, universeCloneBindings(42n, token)))
	fixture.source.codes.set(auctionAddress, `0x${auctionArtifact.evm.deployedBytecode.object}`)
	fixture.source.codes.set(auctionEngine, `0x${engineArtifact.evm.deployedBytecode.object}`)
	return { ...fixture, fork }
}
