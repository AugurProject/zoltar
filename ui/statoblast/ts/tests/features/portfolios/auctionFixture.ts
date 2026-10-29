import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuction as auctionArtifact,
	statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as engineArtifact,
	statoblast_SecurityPoolAuctionVault_SecurityPoolAuctionVault as vaultArtifact,
} from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { capital, owner, unit } from './capitalFixture.js'
import { modules } from './capitalClient.js'
import { priceFixture } from './priceFixture.js'
export const auctionAddress = getAddress('0x0000000000000000000000000000000000000091')
export const auctionEngine = getAddress('0x0000000000000000000000000000000000000092')
export const auctionVault = getAddress('0x0000000000000000000000000000000000000093')
export async function auctionFixture() {
	const fixture = priceFixture()
	const fork = await fixture.fork()
	Object.assign(fixture.values, {
		auctions: auctionAddress,
		auctionReserveFactorBps: 5_000n,
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
		minimumExecutionReservePerLot: unit / 100n,
		bidReservePerLotAttoEth: unit / 50n,
		repGrid: 2n,
		openingConservativePrice: 2n * unit,
		topUpPerLotAttoRep: 4n * unit,
		opened: true,
		finalized: false,
		initialized: true,
		controller: auctionAddress,
		initialMaximumAttoRepPerLot: 2n * unit,
		depositedAttoEth: 2n * unit,
		securityMultiplierBps: 20_000n,
		conservativePrice: 2n * unit,
		liquidationPrice: unit,
		priceValidUntil: 4_000n,
		acceptedExposureLimitAttoEth: 20n * unit,
		acceptedRepExposureLimitAttoRep: 100n * unit,
		refundCreditAttoRep: 0n,
		refundCreditAttoEth: 0n,
		bidderBidCount: 1n,
		bidderBidId: 1n,
		owner,
		initialCapital: capital,
		auction: auctionAddress,
		bidId: 1n,
		bidIdForVault: 1n,
		bids: [owner, auctionVault, 12_000n, 2n, unit, false, false],
		previewBid: [owner, auctionVault, 12_000n, 1n, unit, 2n * unit, unit],
		clearing: [2n * unit, 1n, unit, 2n * unit, 0n, 0n, 0n, 1n, false],
		auctionPosition: [auctionVault, 0n, 6n * unit, unit, 12_000n, 0n, false, 7n * unit, 9n * unit],
	})
	fixture.set(capital, 'universeId', 42n)
	fixture.set(auctionAddress, 'universeId', 42n)
	fixture.source.codes.set(auctionAddress, `0x${auctionArtifact.evm.deployedBytecode.object}`)
	fixture.source.codes.set(auctionEngine, `0x${engineArtifact.evm.deployedBytecode.object}`)
	fixture.source.codes.set(auctionVault, `0x${vaultArtifact.evm.deployedBytecode.object}`)
	return { ...fixture, fork }
}
