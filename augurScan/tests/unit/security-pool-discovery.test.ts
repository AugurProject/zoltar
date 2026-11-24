import { expect, test } from 'bun:test'
import { discoverSecurityPoolEventDependencies } from '../../src/indexer/security-pool-discovery.ts'
import { encodeFunctionData, getAddress, zeroAddress, type Address } from '../../src/ethereum.ts'
import type { StateRead } from '../../src/snapshots.ts'

const factory = getAddress('0x1111111111111111111111111111111111111111')
const pool = getAddress('0x2222222222222222222222222222222222222222')
const securityPool = getAddress('0x3333333333333333333333333333333333333333')
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
const event = { name: 'DeployQuestionLedger', status: 'decoded' as const, arguments: { questionLedger: pool, universeId: 0n }, summary: 'Question created' }
// Each read names the contract it must be asked of; `securityPool` and `capitalLedger` are back-references answered by several components.
const readTargets: Readonly<Record<string, readonly string[]>> = {
	securityPoolOf: [factory],
	factory: [securityPool],
	forkController: [securityPool],
	services: [securityPool],
	settlement: [securityPool],
	reporters: [securityPool],
	ledger: [settlement],
	universeId: [capital],
	commitmentIndex: [capital],
	feeStreams: [capital],
	securityPool: [controller, capital, services, settlement, book, reporters],
	capitalLedger: [securityPool, index, streams],
}
const reader =
	(overrides: Readonly<Record<string, unknown>> = {}): StateRead =>
	async (address, abi, name, args = []) => {
		encodeFunctionData({ abi, functionName: name, args })
		const values: Readonly<Record<string, unknown>> = { securityPoolOf: securityPool, factory, forkController: controller, services, settlement, reporters, ledger: book, commitmentIndex: index, feeStreams: streams, universeId: 0n, ...overrides }
		if (name === 'securityPoolOf') expect(args).toEqual([pool])
		expect(readTargets[name]).toContain(address)
		// The settlement book's authority is the settlement contract; every other back-reference is the security pool.
		if (name === 'securityPool') return overrides['securityPool'] ?? overrides[`securityPool:${address}`] ?? (address === book ? settlement : securityPool)
		if (name === 'capitalLedger') return address === securityPool ? (overrides['capitalLedger'] ?? capital) : (overrides[`capitalLedger:${address}`] ?? capital)
		if (!(name in values)) throw new Error(`Unexpected discovery read ${name}`)
		return values[name]
	}
const capitalComponents = [
	{ address: capital, kind: 'securityPoolCapitalLedger', label: 'Security Pool Capital Ledger' },
	{ address: index, kind: 'securityPoolCommitmentIndex', label: 'Capital Commitment Index' },
	{ address: streams, kind: 'securityPoolCapitalFeeStreams', label: 'Capital Fee Streams' },
]

test('question factory deployment discovers authenticated security pool and shared fork controller', async () => {
	expect(await discoverSecurityPoolEventDependencies(emitter, event, reader())).toEqual([
		{ address: securityPool, kind: 'securityPool', label: 'Security Pool' },
		{ address: controller, kind: 'securityPoolForkCoordinator', label: 'Security Pool Fork Coordinator' },
		{ address: services, kind: 'securityPoolServices', label: 'Security Pool Services' },
		{ address: settlement, kind: 'securityPoolSettlement', label: 'Security Pool Settlement' },
		{ address: book, kind: 'securityPoolSettlementBook', label: 'Security Pool Settlement Book' },
		{ address: reporters, kind: 'securityPoolReporterLedger', label: 'Security Pool Reporter Ledger' },
		...capitalComponents,
	])
})

for (const [override, value, error] of [
	['services', zeroAddress, 'services binding'],
	[`securityPool:${services}`, pool, 'services binding'],
	['settlement', zeroAddress, 'settlement binding'],
	[`securityPool:${settlement}`, pool, 'settlement binding'],
	['ledger', zeroAddress, 'settlement book binding'],
	[`securityPool:${book}`, securityPool, 'settlement book binding'],
	['reporters', zeroAddress, 'reporter ledger binding'],
	[`securityPool:${reporters}`, pool, 'reporter ledger binding'],
	['commitmentIndex', zeroAddress, 'commitment index binding'],
	[`capitalLedger:${index}`, pool, 'commitment index binding'],
	['feeStreams', zeroAddress, 'fee streams binding'],
	[`capitalLedger:${streams}`, pool, 'fee streams binding'],
] as const) {
	test(`rejects an unauthenticated security pool component edge ${override}`, async () => {
		await expect(discoverSecurityPoolEventDependencies(emitter, event, reader({ [override]: value }))).rejects.toThrow(error)
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
	expect(await discoverSecurityPoolEventDependencies(feedEmitter, funded, read([escrow, pool, pool, 0n]))).toEqual([{ address: escrow, kind: 'sharedPoolReportEscrow', label: 'Shared Report Escrow' }])
	await expect(discoverSecurityPoolEventDependencies(feedEmitter, funded, read([zeroAddress, pool, pool, 0n]))).rejects.toThrow('escrow binding')
	await expect(discoverSecurityPoolEventDependencies(feedEmitter, funded, read([escrow, pool, pool, 0n], pool))).rejects.toThrow('escrow binding')
	await expect(discoverSecurityPoolEventDependencies(feedEmitter, funded, read(escrow))).rejects.toThrow('invalid tuple')
	await expect(discoverSecurityPoolEventDependencies(feedEmitter, { ...funded, arguments: {} }, read([escrow]))).rejects.toThrow('missing its report')
	expect(await discoverSecurityPoolEventDependencies(feedEmitter, { ...funded, name: 'PriceReportRejected' }, read([escrow, pool, pool, 0n]))).toEqual([{ address: escrow, kind: 'sharedPoolReportEscrow', label: 'Shared Report Escrow' }])
	// Only a registered shared price feed's decision triggers the read: a request has no completed escrow yet.
	expect(await discoverSecurityPoolEventDependencies({ ...feedEmitter, kind: 'priceCoordinator' }, funded, read([escrow]))).toEqual([])
	expect(await discoverSecurityPoolEventDependencies(feedEmitter, { ...funded, name: 'ReportFundingAssigned' }, read([escrow]))).toEqual([])
})

for (const [name, value, error] of [
	['securityPoolOf', zeroAddress, 'security pool binding'],
	['factory', pool, 'factory binding'],
	['forkController', zeroAddress, 'controller binding'],
	[`securityPool:${controller}`, pool, 'controller binding'],
] as const) {
	test(`rejects an unauthenticated ${name} custody edge`, async () => {
		await expect(discoverSecurityPoolEventDependencies(emitter, event, reader({ [name]: value }))).rejects.toThrow(error)
	})
}

test('non-auction branches stop after the bounded auction address lookup', async () => {
	let reads = 0
	const result = await discoverSecurityPoolEventDependencies({ ...emitter, address: controller, kind: 'securityPoolForkCoordinator' }, { ...event, name: 'BranchStarted', arguments: { universeId: '2' } }, async (address, abi, name, args = []) => {
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
	expect(await discoverSecurityPoolEventDependencies({ ...emitter, kind: 'shareToken' }, event, unexpected)).toEqual([])
	expect(await discoverSecurityPoolEventDependencies(emitter, { ...event, status: 'failed' }, unexpected)).toEqual([])
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
		await expect(discoverSecurityPoolEventDependencies({ ...emitter, address: controller, kind: 'securityPoolForkCoordinator' }, { ...event, name: 'BranchStarted', arguments: { universeId: '2' } }, read)).rejects.toThrow(error)
	})
}

test('universe preparation discovers authenticated capital custody', async () => {
	expect(await discoverSecurityPoolEventDependencies({ ...emitter, address: securityPool, kind: 'securityPool' }, { ...event, name: 'UniversePrepared', arguments: { universeId: 0n, capitalLedger: capital } }, reader())).toEqual(capitalComponents)
})
for (const [name, value] of [
	['capitalLedger', zeroAddress],
	[`securityPool:${capital}`, pool],
	['universeId', 1n],
] as const) {
	test(`rejects mismatched capital ${name}`, async () => {
		await expect(discoverSecurityPoolEventDependencies({ ...emitter, address: securityPool, kind: 'securityPool' }, { ...event, name: 'UniversePrepared', arguments: { universeId: 0n, capitalLedger: capital } }, reader({ [name]: value }))).rejects.toThrow('capital')
	})
}
