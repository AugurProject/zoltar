import { expect, test } from 'bun:test'
import { getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createMockReadClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { loadSecurityPoolAccount } from '@zoltar/ui-statoblast-shared/protocol/securityPool.js'
import { loadSecurityPoolBranchAuction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolRepairAuction.js'
import { statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuction as auctionArtifact, statoblast_SecurityPoolUniformPriceRepairAuction_SecurityPoolUniformPriceRepairAuction as engineArtifact } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { capitalClient, modules } from './capitalClient.js'
import { capital, capitalSnapshot, index, owner, securityPool, token, unit } from './capitalFixture.js'

const auction = getAddress('0x0000000000000000000000000000000000000091')
const engine = getAddress('0x0000000000000000000000000000000000000092')
function fixture() {
	const source = capitalClient(capitalSnapshot({ universeId: 42n }))
	source.codes.set(auction, `0x${auctionArtifact.evm.deployedBytecode.object}`)
	source.codes.set(engine, `0x${engineArtifact.evm.deployedBytecode.object}`)
	const values: Record<string, unknown> = {
		repairAuctions: auction,
		branches: [0n, 1n, 0n, 0n, 0n, 0n, true, true, false],
		engine,
		unclaimedRepairAuctionBids: 1n,
		capital,
		controller: auction,
		universeId: 42n,
		priceFeed: zeroAddress,
		opened: true,
		initialized: true,
		finalized: true,
		closesAt: 900n,
		inventoryAttoRep: 10n * unit,
		shortfallAttoEth: 2n * unit,
		lotAttoEth: unit,
		targetLots: 2n,
		repGrid: 1n,
		openingConservativePrice: unit,
		minimumCollateralAttoRepPerLot: 2n * unit,
		maximumBidAttoRepPerLot: 10n * unit,
		maximumAdmissibleBidAttoRepPerLot: 10n * unit,
		depositedAttoEth: unit,
		bidderBidCount: 0n,
		refundCreditAttoEth: 0n,
		bids: [owner, false, false, 1n, 3n * unit],
		previewBid: { bidder: owner, filledLots: 1n, usedAttoEth: unit, principalAttoRep: 10n * unit, refundAttoEth: 0n },
		repairAuctionPositions: [{ bidder: owner, positionId: 0n, principal: 10n * unit, commitment: unit, liquidationStarted: 0n, claimed: false, materialized: false, earnedAttoEth: 7n, earnedAttoRep: 9n }],
		clearing: [10n * unit, 1n, unit, 10n * unit, 0n, 0n, 0n, 1n, false],
	}
	const scoped = new Map<string, unknown>()
	const reads: { functionName: string; address: Address; blockNumber?: bigint | undefined }[] = []
	const client = source.client.extend(() =>
		createMockReadClient(async request => {
			reads.push(request)
			const key = `${request.address}:${request.functionName}`
			if (scoped.has(key)) return scoped.get(key)
			if (request.functionName in values) return values[request.functionName]
			return source.client.readContract(request)
		}),
	)
	return { source, values, reads, client, set: (address: Address, name: string, value: unknown) => scoped.set(`${address}:${name}`, value) }
}

test('branch auction loading authenticates the adapter, engine and custody modules before offering bids', async () => {
	const source = fixture()
	expect((await loadSecurityPoolBranchAuction(source.client, securityPool, owner, 42n)).auction).toMatchObject({ address: auction, engine, finalized: true, unclaimedBidCount: 1n, bids: [] })
	expect(source.reads.some(read => read.functionName === 'vaultImplementation' || read.functionName === 'bidIdForVault')).toBe(false)
	source.values['bidderBidCount'] = 1n
	source.values['bidderBidId'] = 3n
	const loaded = await loadSecurityPoolBranchAuction(source.client, securityPool, owner, 42n)
	expect(loaded.auction?.bids.map(bid => [bid.id, bid.bidder, bid.fill?.filledLots, bid.claimed, bid.position?.materialized])).toEqual([[3n, owner, 1n, false, false]])
	expect(loaded.claimableBidIds).toEqual([3n])
	expect(new Set(source.reads.map(read => read.blockNumber))).toEqual(new Set([10n]))
	source.source.codes.set(engine, '0x6000')
	await expect(loadSecurityPoolBranchAuction(source.client, securityPool, owner, 42n)).rejects.toThrow('Could not verify the auction bidding contract code.')
})

test('branch auction loading rejects bids of another bidder', async () => {
	const source = fixture()
	source.values['bidderBidCount'] = 1n
	source.values['bidderBidId'] = 3n
	source.values['bids'] = [token, false, false, 1n, 3n * unit]
	await expect(loadSecurityPoolBranchAuction(source.client, securityPool, owner, 42n)).rejects.toThrow('another wallet')
	source.values['bids'] = [owner, false, false, 1n, 3n * unit]
	source.values['repairAuctionPositions'] = [{ bidder: token, positionId: 0n, principal: 10n * unit, commitment: unit, liquidationStarted: 0n, claimed: false, materialized: false, earnedAttoEth: 7n, earnedAttoRep: 9n }]
	await expect(loadSecurityPoolBranchAuction(source.client, securityPool, owner, 42n)).rejects.toThrow('identity')
})

test('branch auction loading rejects another fork route, ledger, custody authority or compiled runtime', async () => {
	for (const [address, getter, value] of [
		[auction, 'capital', token],
		[capital, 'forkAuthority', token],
		[engine, 'controller', token],
		[modules.repairAuctionDelegate, 'implementation', token],
		[index, 'capitalLedger', token],
		[modules.fees, 'capitalLedger', token],
		[capital, 'services', token],
		[securityPool, 'repairAuctionDeployer', token],
	] as const) {
		const source = fixture()
		source.set(address, getter, value)
		await expect(loadSecurityPoolBranchAuction(source.client, securityPool, owner, 42n)).rejects.toThrow()
	}
	for (const address of [auction, engine, capital, modules.capitalImplementation, modules.fork, modules.lifecycle, modules.repairAuctionDelegate, index, modules.indexImplementation, modules.fees, modules.feesImplementation, modules.services]) {
		const source = fixture()
		source.source.codes.set(address, '0x6000')
		await expect(loadSecurityPoolBranchAuction(source.client, securityPool, owner, 42n)).rejects.toThrow(/^(?:Could not verify the .* code\.|Could not verify the code or linked addresses for the .*\.)$/)
	}
})

test('a bidder account is funded and approved by the bidder itself for the capital ledger', async () => {
	const source = fixture()
	source.source.setSnapshot(capitalSnapshot({ universeId: 42n }))
	const snapshot = await loadSecurityPoolAccount(source.client, securityPool, owner, 42n)
	expect(snapshot.owner).toBe(owner)
	expect(snapshot).not.toHaveProperty('auctionVault')
	expect(source.source.reads.filter(read => read.name === 'balanceOf').at(-1)?.args).toEqual([owner])
	expect(source.source.reads.filter(read => read.name === 'allowance').at(-1)?.args).toEqual([owner, capital])
})
