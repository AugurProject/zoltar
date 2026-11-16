import { expect, test } from 'bun:test'
import { discoverPortfolioEventDependencies } from '../../src/indexer/portfolio-discovery.ts'
import { encodeFunctionData, getAddress, zeroAddress, type Address } from '../../src/ethereum.ts'
import type { StateRead } from '../../src/snapshots.ts'

const factory = getAddress('0x1111111111111111111111111111111111111111')
const pool = getAddress('0x2222222222222222222222222222222222222222')
const portfolio = getAddress('0x3333333333333333333333333333333333333333')
const controller = getAddress('0x4444444444444444444444444444444444444444')
const capital = getAddress('0x7777777777777777777777777777777777777777')
const services = getAddress('0x8888888888888888888888888888888888888888')
const settlement = getAddress('0x9999999999999999999999999999999999999999')
const book = getAddress('0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa')
const reporters = getAddress('0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB')
const index = getAddress('0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC')
const streams = getAddress('0xDDdDddDdDdddDDddDDddDDDDdDdDDdDDdDDDDDDd')
const feed = getAddress('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')
const escrow = getAddress('0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF')
const emitter = { address: factory, kind: 'securityPoolFactory', label: 'Question factory', provenance: 'test' }
const event = { name: 'DeploySecurityPool', status: 'decoded' as const, arguments: { securityPool: pool, universeId: 0n }, summary: 'Question created' }
// Each read names the contract it must be asked of; `portfolio` and `capitalLedger` are back-references answered by several components.
const readTargets: Readonly<Record<string, readonly string[]>> = {
	getSecurityPoolPortfolio: [factory],
	factory: [portfolio],
	forkController: [portfolio],
	services: [portfolio],
	settlement: [portfolio],
	reporters: [portfolio],
	ledger: [settlement],
	universeId: [capital],
	commitmentIndex: [capital],
	feeStreams: [capital],
	portfolio: [controller, capital, services, settlement, book, reporters],
	capitalLedger: [portfolio, index, streams],
}
const reader =
	(overrides: Readonly<Record<string, unknown>> = {}): StateRead =>
	async (address, abi, name, args = []) => {
		encodeFunctionData({ abi, functionName: name, args })
		const values: Readonly<Record<string, unknown>> = { getSecurityPoolPortfolio: portfolio, factory, forkController: controller, services, settlement, reporters, ledger: book, commitmentIndex: index, feeStreams: streams, universeId: 0n, ...overrides }
		if (name === 'getSecurityPoolPortfolio') expect(args).toEqual([pool])
		expect(readTargets[name]).toContain(address)
		// The settlement book's authority is the settlement contract; every other back-reference is the portfolio.
		if (name === 'portfolio') return overrides['portfolio'] ?? overrides[`portfolio:${address}`] ?? (address === book ? settlement : portfolio)
		if (name === 'capitalLedger') return address === portfolio ? (overrides['capitalLedger'] ?? capital) : (overrides[`capitalLedger:${address}`] ?? capital)
		if (!(name in values)) throw new Error(`Unexpected discovery read ${name}`)
		return values[name]
	}
const capitalComponents = [
	{ address: capital, kind: 'securityPoolCapitalLedger', label: 'Portfolio Capital Ledger' },
	{ address: index, kind: 'securityPoolCommitmentIndex', label: 'Capital Commitment Index' },
	{ address: streams, kind: 'securityPoolCapitalFeeStreams', label: 'Capital Fee Streams' },
]

test('question factory deployment discovers authenticated portfolio and shared fork controller', async () => {
	expect(await discoverPortfolioEventDependencies(emitter, event, reader())).toEqual([
		{ address: portfolio, kind: 'securityPoolPortfolio', label: 'Security Portfolio' },
		{ address: controller, kind: 'securityPoolPortfolioForkCoordinator', label: 'Portfolio Fork Coordinator' },
		{ address: services, kind: 'securityPoolPortfolioServices', label: 'Portfolio Services' },
		{ address: settlement, kind: 'securityPoolPortfolioSettlement', label: 'Portfolio Settlement' },
		{ address: book, kind: 'securityPoolSettlementBook', label: 'Portfolio Settlement Book' },
		{ address: reporters, kind: 'securityPoolReporterLedger', label: 'Portfolio Reporter Ledger' },
		...capitalComponents,
	])
})

for (const [override, value, error] of [
	['services', zeroAddress, 'services binding'],
	[`portfolio:${services}`, pool, 'services binding'],
	['settlement', zeroAddress, 'settlement binding'],
	[`portfolio:${settlement}`, pool, 'settlement binding'],
	['ledger', zeroAddress, 'settlement book binding'],
	[`portfolio:${book}`, portfolio, 'settlement book binding'],
	['reporters', zeroAddress, 'reporter ledger binding'],
	[`portfolio:${reporters}`, pool, 'reporter ledger binding'],
	['commitmentIndex', zeroAddress, 'commitment index binding'],
	[`capitalLedger:${index}`, pool, 'commitment index binding'],
	['feeStreams', zeroAddress, 'fee streams binding'],
	[`capitalLedger:${streams}`, pool, 'fee streams binding'],
] as const) {
	test(`rejects an unauthenticated portfolio component edge ${override}`, async () => {
		await expect(discoverPortfolioEventDependencies(emitter, event, reader({ [override]: value }))).rejects.toThrow(error)
	})
}

test('a settled price report discovers the escrow that names the emitting feed', async () => {
	const funded = { ...event, name: 'PriceReported', arguments: { reportId: '7', price: '1', lastSettlementTimestamp: '2' } }
	const feedEmitter = { ...emitter, address: feed, kind: 'sharedPoolPriceFeed' }
	const read =
		(candidate: unknown, escrowFeed: unknown = feed): StateRead =>
		async (address, abi, name, args = []) => {
			encodeFunctionData({ abi, functionName: name, args })
			if (name === 'reportCandidates') {
				expect(address).toBe(feed)
				expect(args).toEqual([7n])
				return candidate
			}
			expect(name).toBe('feed')
			expect(address).toBe(escrow)
			return escrowFeed
		}
	expect(await discoverPortfolioEventDependencies(feedEmitter, funded, read([escrow, pool, pool, 0n]))).toEqual([{ address: escrow, kind: 'sharedPoolReportEscrow', label: 'Shared Report Escrow' }])
	await expect(discoverPortfolioEventDependencies(feedEmitter, funded, read([zeroAddress, pool, pool, 0n]))).rejects.toThrow('escrow binding')
	await expect(discoverPortfolioEventDependencies(feedEmitter, funded, read([escrow, pool, pool, 0n], pool))).rejects.toThrow('escrow binding')
	await expect(discoverPortfolioEventDependencies(feedEmitter, funded, read(escrow))).rejects.toThrow('invalid tuple')
	await expect(discoverPortfolioEventDependencies(feedEmitter, { ...funded, arguments: {} }, read([escrow]))).rejects.toThrow('missing its report')
	expect(await discoverPortfolioEventDependencies(feedEmitter, { ...funded, name: 'PriceReportRejected' }, read([escrow, pool, pool, 0n]))).toEqual([{ address: escrow, kind: 'sharedPoolReportEscrow', label: 'Shared Report Escrow' }])
	// Only a registered shared price feed's decision triggers the read: a request has no completed escrow yet.
	expect(await discoverPortfolioEventDependencies({ ...feedEmitter, kind: 'priceCoordinator' }, funded, read([escrow]))).toEqual([])
	expect(await discoverPortfolioEventDependencies(feedEmitter, { ...funded, name: 'ReportFundingAssigned' }, read([escrow]))).toEqual([])
})

for (const [name, value, error] of [
	['getSecurityPoolPortfolio', zeroAddress, 'portfolio binding'],
	['factory', pool, 'factory binding'],
	['forkController', zeroAddress, 'controller binding'],
	[`portfolio:${controller}`, pool, 'controller binding'],
] as const) {
	test(`rejects an unauthenticated ${name} custody edge`, async () => {
		await expect(discoverPortfolioEventDependencies(emitter, event, reader({ [name]: value }))).rejects.toThrow(error)
	})
}

test('non-auction branches stop after the bounded auction address lookup', async () => {
	let reads = 0
	const result = await discoverPortfolioEventDependencies({ ...emitter, address: controller, kind: 'securityPoolPortfolioForkCoordinator' }, { ...event, name: 'BranchStarted', arguments: { universeId: '2' } }, async (address, abi, name, args = []) => {
		encodeFunctionData({ abi, functionName: name, args })
		expect(address).toBe(controller)
		expect(name).toBe('auctions')
		expect(args).toEqual([2n])
		reads++
		return zeroAddress
	})
	expect(result).toEqual([])
	expect(reads).toBe(1)
})

test('untrusted emitters and failed decodes cannot trigger dependency reads', async () => {
	const unexpected: StateRead = async () => {
		throw new Error('Unexpected read')
	}
	expect(await discoverPortfolioEventDependencies({ ...emitter, kind: 'shareToken' }, event, unexpected)).toEqual([])
	expect(await discoverPortfolioEventDependencies(emitter, { ...event, status: 'failed' }, unexpected)).toEqual([])
})

for (const [name, value, error] of [
	['forkAuthority', pool, 'authority mismatch'],
	['engine', zeroAddress, 'engine binding mismatch'],
	['controller', pool, 'engine binding mismatch'],
] as const) {
	test(`rejects an unauthenticated auction ${name} edge`, async () => {
		const auction = getAddress('0x5555555555555555555555555555555555555555')
		const engine = getAddress('0x6666666666666666666666666666666666666666')
		const values: Readonly<Record<string, unknown>> = { auctions: auction, forkAuthority: controller, engine, controller: auction, [name]: value }
		const read: StateRead = async (address, abi, functionName, args = []) => {
			encodeFunctionData({ abi, functionName, args })
			const targets: Readonly<Record<string, Address>> = { auctions: controller, forkAuthority: auction, engine: auction, controller: engine }
			const target = targets[functionName]
			if (target === undefined) throw new Error(`Unexpected discovery target ${functionName}`)
			expect(address).toBe(target)
			if (!(functionName in values)) throw new Error(`Unexpected discovery read ${functionName}`)
			return values[functionName]
		}
		await expect(discoverPortfolioEventDependencies({ ...emitter, address: controller, kind: 'securityPoolPortfolioForkCoordinator' }, { ...event, name: 'BranchStarted', arguments: { universeId: '2' } }, read)).rejects.toThrow(error)
	})
}

test('universe preparation discovers authenticated capital custody', async () => {
	expect(await discoverPortfolioEventDependencies({ ...emitter, address: portfolio, kind: 'securityPoolPortfolio' }, { ...event, name: 'UniversePrepared', arguments: { universeId: 0n, capitalLedger: capital } }, reader())).toEqual(capitalComponents)
})
for (const [name, value] of [
	['capitalLedger', zeroAddress],
	[`portfolio:${capital}`, pool],
	['universeId', 1n],
] as const) {
	test(`rejects mismatched capital ${name}`, async () => {
		await expect(discoverPortfolioEventDependencies({ ...emitter, address: portfolio, kind: 'securityPoolPortfolio' }, { ...event, name: 'UniversePrepared', arguments: { universeId: 0n, capitalLedger: capital } }, reader({ [name]: value }))).rejects.toThrow('capital')
	})
}
