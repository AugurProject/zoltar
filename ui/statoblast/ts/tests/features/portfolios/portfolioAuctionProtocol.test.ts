import { expect, test } from 'bun:test'
import { getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createMockReadClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { loadPortfolioAccount } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { authenticatePortfolioAuctionVault, loadPortfolioBranchAuction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolioAuction.js'
import {
	statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuction as auctionArtifact,
	statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as engineArtifact,
	statoblast_SecurityPoolAuctionVault_SecurityPoolAuctionVault as vaultArtifact,
} from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { capitalClient, modules } from './capitalClient.js'
import { capital, capitalSnapshot, index, owner, portfolio, token, unit } from './capitalFixture.js'

const auction = getAddress('0x0000000000000000000000000000000000000091')
const engine = getAddress('0x0000000000000000000000000000000000000092')
const vault = getAddress('0x0000000000000000000000000000000000000093')
function fixture() {
	const source = capitalClient()
	source.codes.set(auction, `0x${auctionArtifact.evm.deployedBytecode.object}`)
	source.codes.set(engine, `0x${engineArtifact.evm.deployedBytecode.object}`)
	source.codes.set(vault, `0x${vaultArtifact.evm.deployedBytecode.object}`)
	const values: Record<string, unknown> = {
		auctions: auction,
		engine,
		capital,
		owner,
		initialCapital: capital,
		auction,
		bidId: 3n,
		bidIdForVault: 3n,
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
		minimumExecutionReservePerLot: 10n,
		repGrid: 1n,
		openingConservativePrice: unit,
		minimumCollateralAttoRepPerLot: 2n * unit,
		maximumBidAttoRepPerLot: 10n * unit,
		depositedAttoEth: unit,
		bidderBidCount: 0n,
		refundCreditAttoEth: 0n,
		bids: [owner, vault, 12_000n, 1n, 3n * unit, false, false],
		previewBid: { bidder: owner, vault, targetHealthBps: 12_000n, filledLots: 1n, usedAttoEth: unit, principalAttoRep: 10n * unit, refundAttoEth: 0n },
		auctionPosition: { vault, positionId: 0n, principal: 10n * unit, commitment: unit, targetHealthFactorBps: 12_000n, liquidationStarted: 0n, materialized: false, earnedAttoEth: 7n, earnedAttoRep: 9n },
		clearing: [10n * unit, 1n, unit, 10n * unit, 0n, 0n, 0n, 0n, 1n, false],
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

test('selected vault authentication uses its initial branch without scanning bids or assuming the wallet is its capital owner', async () => {
	const source = fixture()
	const result = await authenticatePortfolioAuctionVault(source.client, portfolio, vault, 10n)
	expect(result).toEqual({ vault, bidder: owner, auction, initialCapital: capital, initialUniverse: 42n, bidId: 3n, filledLots: 1n, materialized: false })
	expect(new Set(source.reads.map(read => read.blockNumber))).toEqual(new Set([10n]))
	expect(source.reads.some(read => read.functionName === 'bidderBidCount' || read.functionName === 'bidderBidId')).toBe(false)
	source.values.auctionPosition = { vault, positionId: 1n, principal: 10n * unit, commitment: unit, targetHealthFactorBps: 12_000n, liquidationStarted: 0n, materialized: true, earnedAttoEth: 7n, earnedAttoRep: 9n }
	expect((await authenticatePortfolioAuctionVault(source.client, portfolio, vault, 10n)).materialized).toBe(true)
})

test('unopened or losing vaults need no nonexistent cohort position to recover accidentally sent assets', async () => {
	const source = fixture()
	source.values.finalized = false
	expect(await authenticatePortfolioAuctionVault(source.client, portfolio, vault, 10n)).toMatchObject({ filledLots: 0n, materialized: false })
	expect(source.reads.some(read => read.functionName === 'auctionPosition')).toBe(false)
	source.values.finalized = true
	source.values.previewBid = { bidder: owner, vault, filledLots: 0n }
	expect(await authenticatePortfolioAuctionVault(source.client, portfolio, vault, 10n)).toMatchObject({ filledLots: 0n, materialized: false })
	expect(source.reads.some(read => read.functionName === 'auctionPosition')).toBe(false)
})

test('vault binding rejects another owner, fork route, initial ledger, bid or compiled runtime', async () => {
	for (const [address, getter, value] of [
		[vault, 'owner', token],
		[modules.fork, 'auctions', token],
		[portfolio, 'capitalLedger', token],
		[auction, 'bidIdForVault', 4n],
		[capital, 'portfolio', token],
		[modules.auctionDelegate, 'ledger', token],
		[index, 'portfolio', token],
		[capital, 'services', token],
		[portfolio, 'auctionDeployer', token],
	] as const) {
		const source = fixture()
		source.set(address, getter, value)
		await expect(authenticatePortfolioAuctionVault(source.client, portfolio, vault, 10n)).rejects.toThrow()
	}
	for (const address of [vault, auction, engine, capital, modules.fork, modules.lifecycle, modules.auctionDelegate, index, modules.fees, modules.services]) {
		const source = fixture()
		source.source.codes.set(address, '0x6000')
		await expect(authenticatePortfolioAuctionVault(source.client, portfolio, vault, 10n)).rejects.toThrow('runtime')
	}
})

test('branch auction loading authenticates the adapter and engine runtime before offering bids', async () => {
	const source = fixture()
	expect((await loadPortfolioBranchAuction(source.client, portfolio, owner, 42n)).auction).toMatchObject({ address: auction, engine, finalized: true, bids: [] })
	source.source.codes.set(engine, '0x6000')
	await expect(loadPortfolioBranchAuction(source.client, portfolio, owner, 42n)).rejects.toThrow('auction engine runtime')
})

test('selected auction vault accounts retain vault liabilities while funding comes from the authenticated bidder', async () => {
	const source = fixture()
	const initial = capitalSnapshot()
	source.source.setSnapshot(capitalSnapshot({ owner: vault, universeId: 42n, positions: [], ownerAccount: { ...initial.ownerAccount, positionId: 0n } }))
	const snapshot = await loadPortfolioAccount(source.client, portfolio, vault, 42n)
	expect(snapshot.owner).toBe(vault)
	expect(snapshot.auctionVault).toMatchObject({ vault, bidder: owner, auction, initialCapital: capital, initialUniverse: 42n, bidId: 3n, materialized: false })
	expect(snapshot.positions).toEqual([])
	expect(snapshot.ownerPrincipalAttoRep).toBe(initial.ownerPrincipalAttoRep)
	expect(source.source.reads.filter(read => read.name === 'balanceOf').at(-1)?.args).toEqual([owner])
	expect(source.source.reads.filter(read => read.name === 'allowance').at(-1)?.args).toEqual([owner, vault])
	source.set(vault, 'owner', token)
	await expect(loadPortfolioAccount(source.client, portfolio, vault, 42n)).rejects.toThrow()
})
