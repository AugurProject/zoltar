import { expect, test } from 'bun:test'
import { getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createMockReadClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { loadSecurityPoolAccount } from '@zoltar/ui-statoblast-shared/protocol/securityPool.js'
import { authenticateSecurityPoolAuctionVault, loadSecurityPoolBranchAuction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolRepairAuction.js'
import {
	statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuction as auctionArtifact,
	statoblast_SecurityPoolUniformPriceRepairAuction_SecurityPoolUniformPriceRepairAuction as engineArtifact,
	statoblast_SecurityPoolRepairAuctionVault_SecurityPoolRepairAuctionVault as vaultArtifact,
} from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { auctionVaultRuntimeCode, predictAuctionVaultAddress } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { capitalClient, modules } from './capitalClient.js'
import { capital, capitalSnapshot, index, owner, securityPool, token, unit } from './capitalFixture.js'

const auction = getAddress('0x0000000000000000000000000000000000000091')
const engine = getAddress('0x0000000000000000000000000000000000000092')
const implementation = getAddress('0x0000000000000000000000000000000000000094')
const bindings = { implementation, owner, capital, auction, bidId: 3n }
const vault = predictAuctionVaultAddress(bindings)
function fixture() {
	const source = capitalClient(capitalSnapshot({ universeId: 42n }))
	source.codes.set(auction, `0x${auctionArtifact.evm.deployedBytecode.object}`)
	source.codes.set(engine, `0x${engineArtifact.evm.deployedBytecode.object}`)
	source.codes.set(implementation, `0x${vaultArtifact.evm.deployedBytecode.object}`)
	source.codes.set(vault, auctionVaultRuntimeCode(bindings))
	const values: Record<string, unknown> = {
		repairAuctions: auction,
		engine,
		vaultImplementation: implementation,
		capital,
		owner,
		initialCapital: capital,
		repairAuction: auction,
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
		repGrid: 1n,
		openingConservativePrice: unit,
		minimumCollateralAttoRepPerLot: 2n * unit,
		maximumBidAttoRepPerLot: 10n * unit,
		maximumAdmissibleBidAttoRepPerLot: 10n * unit,
		depositedAttoEth: unit,
		bidderBidCount: 0n,
		refundCreditAttoEth: 0n,
		bids: [owner, vault, 12_000n, 1n, 3n * unit, false, false],
		previewBid: { bidder: owner, vault, targetHealthBps: 12_000n, filledLots: 1n, usedAttoEth: unit, principalAttoRep: 10n * unit, refundAttoEth: 0n },
		repairAuctionPosition: { vault, positionId: 0n, principal: 10n * unit, commitment: unit, targetHealthFactorBps: 12_000n, liquidationStarted: 0n, materialized: false, earnedAttoEth: 7n, earnedAttoRep: 9n },
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

test('selected vault authentication uses its initial branch without scanning bids or assuming the wallet is its capital owner', async () => {
	const source = fixture()
	const result = await authenticateSecurityPoolAuctionVault(source.client, securityPool, vault, 10n)
	expect(result).toEqual({ vault, bidder: owner, auction, initialCapital: capital, initialUniverse: 42n, bidId: 3n, filledLots: 1n, materialized: false })
	expect(new Set(source.reads.map(read => read.blockNumber))).toEqual(new Set([10n]))
	expect(source.reads.some(read => read.functionName === 'bidderBidCount' || read.functionName === 'bidderBidId')).toBe(false)
	source.values['repairAuctionPosition'] = { vault, positionId: 1n, principal: 10n * unit, commitment: unit, targetHealthFactorBps: 12_000n, liquidationStarted: 0n, materialized: true, earnedAttoEth: 7n, earnedAttoRep: 9n }
	expect((await authenticateSecurityPoolAuctionVault(source.client, securityPool, vault, 10n)).materialized).toBe(true)
})

test('unopened or losing vaults need no nonexistent cohort position to recover accidentally sent assets', async () => {
	const source = fixture()
	source.values['finalized'] = false
	expect(await authenticateSecurityPoolAuctionVault(source.client, securityPool, vault, 10n)).toMatchObject({ filledLots: 0n, materialized: false })
	expect(source.reads.some(read => read.functionName === 'repairAuctionPosition')).toBe(false)
	source.values['finalized'] = true
	source.values['previewBid'] = { bidder: owner, vault, filledLots: 0n }
	expect(await authenticateSecurityPoolAuctionVault(source.client, securityPool, vault, 10n)).toMatchObject({ filledLots: 0n, materialized: false })
	expect(source.reads.some(read => read.functionName === 'repairAuctionPosition')).toBe(false)
})

test('vault binding rejects another owner, fork route, initial ledger, bid or compiled runtime', async () => {
	for (const [address, getter, value] of [
		[vault, 'owner', token],
		[modules.fork, 'repairAuctions', token],
		[securityPool, 'capitalLedger', token],
		[auction, 'bidIdForVault', 4n],
		[capital, 'securityPool', token],
		[modules.repairAuctionDelegate, 'implementation', token],
		[index, 'capitalLedger', token],
		[modules.fees, 'capitalLedger', token],
		[capital, 'services', token],
		[securityPool, 'repairAuctionDeployer', token],
	] as const) {
		const source = fixture()
		source.set(address, getter, value)
		await expect(authenticateSecurityPoolAuctionVault(source.client, securityPool, vault, 10n)).rejects.toThrow()
	}
	for (const address of [vault, auction, engine, capital, modules.capitalImplementation, implementation, modules.fork, modules.lifecycle, modules.repairAuctionDelegate, index, modules.indexImplementation, modules.fees, modules.feesImplementation, modules.services]) {
		const source = fixture()
		source.source.codes.set(address, '0x6000')
		await expect(authenticateSecurityPoolAuctionVault(source.client, securityPool, vault, 10n)).rejects.toThrow(/^(?:Could not verify the .* code\.|Could not verify the auction position contract\.|Could not verify the code or linked addresses for the .*\.)$/)
	}
	// Counterfeit clones: another implementation, foreign bindings, or a clone at the wrong address.
	for (const [code, reason] of [
		[auctionVaultRuntimeCode({ ...bindings, implementation: token }), 'address does not match'],
		[auctionVaultRuntimeCode({ ...bindings, bidId: 4n }), 'Could not verify the code or linked addresses for the auction position.'],
		[auctionVaultRuntimeCode({ ...bindings, owner: token }), 'Could not verify the code or linked addresses for the auction position.'],
	] as const) {
		const source = fixture()
		source.source.codes.set(vault, code)
		await expect(authenticateSecurityPoolAuctionVault(source.client, securityPool, vault, 10n)).rejects.toThrow(reason)
	}
	const misplaced = fixture()
	const elsewhere = getAddress('0x0000000000000000000000000000000000000093')
	misplaced.source.codes.set(elsewhere, auctionVaultRuntimeCode(bindings))
	misplaced.set(auction, 'bidIdForVault', 3n)
	await expect(authenticateSecurityPoolAuctionVault(misplaced.client, securityPool, elsewhere, 10n)).rejects.toThrow('address does not match')
	const foreignImplementation = fixture()
	foreignImplementation.set(auction, 'vaultImplementation', token)
	await expect(authenticateSecurityPoolAuctionVault(foreignImplementation.client, securityPool, vault, 10n)).rejects.toThrow('unexpected contract code')
})

test('branch auction loading authenticates the adapter, engine, implementation and each vault clone before offering bids', async () => {
	const source = fixture()
	expect((await loadSecurityPoolBranchAuction(source.client, securityPool, owner, 42n)).auction).toMatchObject({ address: auction, engine, vaultImplementation: implementation, finalized: true, bids: [] })
	source.values['bidderBidCount'] = 1n
	source.values['bidderBidId'] = 3n
	expect((await loadSecurityPoolBranchAuction(source.client, securityPool, owner, 42n)).auction?.bids.map(bid => bid.vault)).toEqual([vault])
	source.source.codes.set(vault, auctionVaultRuntimeCode({ ...bindings, implementation: token }))
	await expect(loadSecurityPoolBranchAuction(source.client, securityPool, owner, 42n)).rejects.toThrow('Could not verify the code or linked addresses for the auction position.')
	source.source.codes.set(vault, auctionVaultRuntimeCode(bindings))
	source.source.codes.set(implementation, '0x6000')
	await expect(loadSecurityPoolBranchAuction(source.client, securityPool, owner, 42n)).rejects.toThrow('Could not verify the auction position contract code.')
	source.source.codes.set(implementation, `0x${vaultArtifact.evm.deployedBytecode.object}`)
	source.source.codes.set(engine, '0x6000')
	await expect(loadSecurityPoolBranchAuction(source.client, securityPool, owner, 42n)).rejects.toThrow('Could not verify the auction bidding contract code.')
})

test('selected auction vault accounts retain vault liabilities while funding comes from the authenticated bidder', async () => {
	const source = fixture()
	const initial = capitalSnapshot()
	source.source.setSnapshot(capitalSnapshot({ owner: vault, universeId: 42n, positions: [], ownerAccount: { ...initial.ownerAccount, positionId: 0n } }))
	const snapshot = await loadSecurityPoolAccount(source.client, securityPool, vault, 42n)
	expect(snapshot.owner).toBe(vault)
	expect(snapshot.auctionVault).toMatchObject({ vault, bidder: owner, auction, initialCapital: capital, initialUniverse: 42n, bidId: 3n, materialized: false })
	expect(snapshot.positions).toEqual([])
	expect(snapshot.ownerPrincipalAttoRep).toBe(initial.ownerPrincipalAttoRep)
	expect(source.source.reads.filter(read => read.name === 'balanceOf').at(-1)?.args).toEqual([owner])
	expect(source.source.reads.filter(read => read.name === 'allowance').at(-1)?.args).toEqual([owner, vault])
	source.set(vault, 'owner', token)
	await expect(loadSecurityPoolAccount(source.client, securityPool, vault, 42n)).rejects.toThrow()
	// A clone-shaped account of another implementation is an ordinary owner: readable, funded by itself, with no vault authority.
	source.set(vault, 'owner', owner)
	source.source.codes.set(vault, auctionVaultRuntimeCode({ ...bindings, implementation: token }))
	const ordinary = await loadSecurityPoolAccount(source.client, securityPool, vault, 42n)
	expect(ordinary.auctionVault).toBeUndefined()
	expect(source.source.reads.filter(read => read.name === 'balanceOf').at(-1)?.args).toEqual([vault])
})
