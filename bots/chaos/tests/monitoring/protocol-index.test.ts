import { describe, expect, test } from 'bun:test'
import { bytesToHex, encodeAbiParameters, keccak256, toHex, type Address } from '../support/bot-shared.ts'
import { ChaosProtocolIndexReorgError, decodePackedOracleReport, deriveChildUniverseId, OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT, updateProtocolIndex, type ChaosProtocolIndex } from '../../src/monitoring/protocol-index.ts'
import type { ChaosReadClient } from '../../src/monitoring/discovery.ts'
import { address, hash } from '../operations/fixture.ts'

const indexDeployments = { openOracle: address(6), securityPoolForker: address(5), zoltar: address(2) } as const
const indexTrust = {
	coordinatorReports: [],
	maximumSettlementStepGasLimit: OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT,
	trustedRepTokens: [address(10)],
	weth: address(7),
} as const

function writeUnsigned(bytes: Uint8Array, offset: number, width: number, value: bigint) {
	let remaining = value
	for (let index = offset + width - 1; index >= offset; index -= 1) {
		bytes[index] = Number(remaining & 0xffn)
		remaining >>= 8n
	}
	if (remaining !== 0n) throw new Error('Fixture value does not fit field')
}

function writeAddress(bytes: Uint8Array, offset: number, value: Address) {
	const raw = value.slice(2)
	for (let index = 0; index < 20; index += 1) bytes[offset + index] = Number.parseInt(raw.slice(index * 2, index * 2 + 2), 16)
}

function packedReport(
	overrides: Partial<{
		callbackContract: Address
		callbackGasLimit: bigint
		creator: Address
		currentReporter: Address
		token1: Address
		token2: Address
	}> = {},
) {
	const bytes = new Uint8Array(235)
	writeUnsigned(bytes, 0, 16, 11n)
	writeUnsigned(bytes, 16, 16, 22n)
	writeAddress(bytes, 32, overrides.currentReporter ?? address(1))
	writeUnsigned(bytes, 52, 6, 1_000n)
	writeAddress(bytes, 64, overrides.token1 ?? address(7))
	writeUnsigned(bytes, 84, 6, 50n)
	writeUnsigned(bytes, 90, 6, 900n)
	writeUnsigned(bytes, 96, 16, 1_100n)
	writeAddress(bytes, 112, address(30))
	writeUnsigned(bytes, 132, 12, 44n)
	writeAddress(bytes, 144, overrides.token2 ?? address(10))
	writeUnsigned(bytes, 164, 3, 1n)
	writeUnsigned(bytes, 167, 3, 60n)
	writeUnsigned(bytes, 170, 3, 5n)
	writeUnsigned(bytes, 173, 2, 140n)
	writeAddress(bytes, 175, overrides.callbackContract ?? address(31))
	writeUnsigned(bytes, 195, 4, overrides.callbackGasLimit ?? 500_000n)
	writeUnsigned(bytes, 199, 3, 7n)
	writeUnsigned(bytes, 202, 1, 7n)
	writeAddress(bytes, 203, overrides.creator ?? address(32))
	writeUnsigned(bytes, 223, 6, 999n)
	writeUnsigned(bytes, 229, 6, 88n)
	return bytesToHex(bytes)
}

const migrationRepSplitTopic = keccak256(toHex('MigrationRepSplit(address,address,uint248,uint256,uint248,uint256,uint256)'))
const childRepSplitTopic = keccak256(toHex('ChildRepSplit(address,uint256,uint256,uint256)'))
const reportSubmittedTopic = keccak256(toHex('ReportSubmitted(uint256,bytes)'))
const ethRefundDeferredTopic = keccak256(toHex('EthRefundDeferred(address,uint256,uint256)'))
const pendingEthRefundWithdrawnTopic = keccak256(toHex('PendingEthRefundWithdrawn(address,uint256)'))

function indexedAddress(value: Address) {
	return toHex(BigInt(value), { size: 32 })
}

function canonicalLog(parameters: { address: Address; blockNumber: bigint; data: `0x${string}`; logIndex: number; topics: `0x${string}`[]; transactionIndex?: number }) {
	return {
		address: parameters.address,
		blockHash: hash(Number(parameters.blockNumber)),
		blockNumber: parameters.blockNumber,
		data: parameters.data,
		logIndex: parameters.logIndex,
		removed: false,
		topics: parameters.topics,
		transactionHash: hash(500 + Number(parameters.blockNumber) * 10 + parameters.logIndex),
		transactionIndex: parameters.transactionIndex ?? 0,
	}
}

function migrationRepSplitLog(parameters: { amount: bigint; blockNumber: bigint; cumulative: bigint; logIndex: number; migrator?: Address; outcomeIndex?: bigint; childUniverseId?: bigint }) {
	const migrator = parameters.migrator ?? address(1)
	const outcomeIndex = parameters.outcomeIndex ?? 1n
	const childUniverseId = parameters.childUniverseId ?? deriveChildUniverseId(0n, outcomeIndex)
	return canonicalLog({
		address: indexDeployments.zoltar,
		blockNumber: parameters.blockNumber,
		data: encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [migrator, outcomeIndex, parameters.amount, parameters.cumulative]),
		logIndex: parameters.logIndex,
		topics: [migrationRepSplitTopic, indexedAddress(migrator), toHex(0n, { size: 32 }), toHex(childUniverseId, { size: 32 })],
	})
}

function childRepSplitLog(parameters: { blockNumber: bigint; cumulative: bigint; logIndex: number; outcomeIndex?: bigint; pool?: Address }) {
	const outcomeIndex = parameters.outcomeIndex ?? 1n
	const pool = parameters.pool ?? address(22)
	return canonicalLog({
		address: indexDeployments.securityPoolForker,
		blockNumber: parameters.blockNumber,
		data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [parameters.cumulative, 0n]),
		logIndex: parameters.logIndex,
		topics: [childRepSplitTopic, indexedAddress(pool), toHex(outcomeIndex, { size: 32 })],
	})
}

function refundLog(parameters: { amount: bigint; auction?: Address; blockNumber: bigint; logIndex: number; pending?: bigint; withdrawn?: boolean }) {
	return canonicalLog({
		address: parameters.auction ?? address(20),
		blockNumber: parameters.blockNumber,
		data: parameters.withdrawn === true ? encodeAbiParameters([{ type: 'uint256' }], [parameters.amount]) : encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [parameters.amount, parameters.pending ?? parameters.amount]),
		logIndex: parameters.logIndex,
		topics: [parameters.withdrawn === true ? pendingEthRefundWithdrawnTopic : ethRefundDeferredTopic, indexedAddress(address(1))],
	})
}

function refundGeneration(log: ReturnType<typeof refundLog>) {
	return keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }], [log.blockHash, log.transactionHash, BigInt(log.logIndex)]))
}

function eventIndexClient(logs: ReturnType<typeof canonicalLog>[], oracleReads: bigint[] = [], canonicalBlockHash = (blockNumber: bigint) => hash(Number(blockNumber))) {
	const implementation = {
		async getBlock(parameters: { blockNumber?: bigint }) {
			const number = parameters.blockNumber
			if (number === undefined) throw new Error('Block number required')
			return { hash: canonicalBlockHash(number), number, timestamp: 1_000n }
		},
		async getLogs(parameters: { address?: Address | Address[] }) {
			let requested: Address[] = []
			if (Array.isArray(parameters.address)) requested = parameters.address
			else if (parameters.address !== undefined) requested = [parameters.address]
			return logs.filter(log => requested.some(address => address.toLowerCase() === log.address.toLowerCase()))
		},
		async readContract(parameters: { args?: readonly unknown[]; functionName: string }) {
			if (parameters.functionName !== 'oracleGame') throw new Error(`Unexpected read ${parameters.functionName}`)
			const reportId = parameters.args?.[0]
			if (typeof reportId !== 'bigint') throw new Error('Oracle report ID required')
			oracleReads.push(reportId)
			return hash(900 + Number(reportId))
		},
	}
	return new Proxy({} as ChaosReadClient, {
		get(_target, property) {
			const value = implementation[property as keyof typeof implementation]
			if (value === undefined) throw new Error(`Unexpected method ${String(property)}`)
			return value
		},
	})
}

describe('durable protocol index', () => {
	test('keeps one refund generation across accumulation and advances it after withdrawal', async () => {
		const firstDeferred = refundLog({ amount: 5n, blockNumber: 10n, logIndex: 0 })
		const accumulated = refundLog({ amount: 3n, blockNumber: 11n, logIndex: 0, pending: 8n })
		const initial = await updateProtocolIndex({
			anchorBlockNumber: 11n,
			auctionAddresses: [address(20)],
			chainId: 31337,
			client: eventIndexClient([accumulated, firstDeferred]),
			escalationGames: [],
			...indexDeployments,
			...indexTrust,
			startBlock: 10n,
			wallet: address(1),
		})
		expect(initial.index).toMatchObject({
			auctionRefunds: {
				[address(20).toLowerCase()]: { generation: refundGeneration(firstDeferred), pendingAttoEth: 8n.toString() },
			},
		})

		const withdrawn = await updateProtocolIndex({
			anchorBlockNumber: 12n,
			auctionAddresses: [address(20)],
			chainId: 31337,
			client: eventIndexClient([refundLog({ amount: 8n, blockNumber: 12n, logIndex: 0, withdrawn: true })]),
			escalationGames: [],
			...indexDeployments,
			...indexTrust,
			previous: initial.index,
			startBlock: 10n,
			wallet: address(1),
		})
		expect(withdrawn.index).toMatchObject({ auctionRefunds: {} })

		const laterDeferred = refundLog({ amount: 8n, blockNumber: 13n, logIndex: 0 })
		const later = await updateProtocolIndex({
			anchorBlockNumber: 13n,
			auctionAddresses: [address(20)],
			chainId: 31337,
			client: eventIndexClient([laterDeferred]),
			escalationGames: [],
			...indexDeployments,
			...indexTrust,
			previous: withdrawn.index,
			startBlock: 10n,
			wallet: address(1),
		})
		expect(later.index).toMatchObject({
			auctionRefunds: {
				[address(20).toLowerCase()]: { generation: refundGeneration(laterDeferred), pendingAttoEth: 8n.toString() },
			},
		})
		expect(refundGeneration(laterDeferred)).not.toBe(refundGeneration(firstDeferred))
	})

	test('rejects discontinuous deferred-refund episode histories', async () => {
		const cases: Array<{ expected: string; logs: ReturnType<typeof refundLog>[] }> = [
			{
				expected: 'did not start from zero',
				logs: [refundLog({ amount: 5n, blockNumber: 10n, logIndex: 0, pending: 8n })],
			},
			{
				expected: 'continuity failed',
				logs: [refundLog({ amount: 5n, blockNumber: 10n, logIndex: 0 }), refundLog({ amount: 3n, blockNumber: 10n, logIndex: 1, pending: 9n })],
			},
			{
				expected: 'has no authenticated active refund episode',
				logs: [refundLog({ amount: 5n, blockNumber: 10n, logIndex: 0, withdrawn: true })],
			},
			{
				expected: 'amount does not match',
				logs: [refundLog({ amount: 5n, blockNumber: 10n, logIndex: 0 }), refundLog({ amount: 4n, blockNumber: 10n, logIndex: 1, withdrawn: true })],
			},
		]
		for (const candidate of cases) {
			await expect(
				updateProtocolIndex({
					anchorBlockNumber: 10n,
					auctionAddresses: [address(20)],
					chainId: 31337,
					client: eventIndexClient(candidate.logs),
					escalationGames: [],
					...indexDeployments,
					...indexTrust,
					startBlock: 10n,
					wallet: address(1),
				}),
			).rejects.toThrow(candidate.expected)
		}
	})

	test('rejects a persisted refund generation across a reorg and derives the replacement generation', async () => {
		const originalLog = refundLog({ amount: 8n, blockNumber: 10n, logIndex: 0 })
		const original = await updateProtocolIndex({
			anchorBlockNumber: 10n,
			auctionAddresses: [address(20)],
			chainId: 31337,
			client: eventIndexClient([originalLog]),
			escalationGames: [],
			...indexDeployments,
			...indexTrust,
			startBlock: 10n,
			wallet: address(1),
		})
		const replacementBlockHash = hash(999)
		const replacementLog = { ...originalLog, blockHash: replacementBlockHash }
		const replacementClient = eventIndexClient([replacementLog], [], blockNumber => (blockNumber === 10n ? replacementBlockHash : hash(Number(blockNumber))))
		await expect(
			updateProtocolIndex({
				anchorBlockNumber: 10n,
				auctionAddresses: [address(20)],
				chainId: 31337,
				client: replacementClient,
				escalationGames: [],
				...indexDeployments,
				...indexTrust,
				previous: original.index,
				startBlock: 10n,
				wallet: address(1),
			}),
		).rejects.toBeInstanceOf(ChaosProtocolIndexReorgError)

		const replacement = await updateProtocolIndex({
			anchorBlockNumber: 10n,
			auctionAddresses: [address(20)],
			chainId: 31337,
			client: replacementClient,
			escalationGames: [],
			...indexDeployments,
			...indexTrust,
			startBlock: 10n,
			wallet: address(1),
		})
		expect(replacement.index.auctionRefunds[address(20).toLowerCase()]?.generation).toBe(refundGeneration(replacementLog))
		expect(refundGeneration(replacementLog)).not.toBe(refundGeneration(originalLog))
	})

	test('decodes the complete packed OpenOracle preimage and timestamp deadlines', () => {
		const report = decodePackedOracleReport(42n, address(6), packedReport())
		expect(report).toMatchObject({
			currentAmount1: '11',
			currentAmount2: '22',
			currentReporter: address(1),
			disputeAfterTimestamp: '1060',
			disputeBeforeTimestamp: '1900',
			escalationHalt: '1100',
			flags: 7,
			multiplier: 140,
			reportId: '42',
			settleAfterTimestamp: '1900',
			token1: address(7),
			token2: address(10),
		})
		expect(report.game).toMatchObject({ callbackContract: address(31), callbackGasLimit: 500000, protocolFeeRecipient: address(30), settlerReward: '44' })
		expect(report.helper).toEqual({ blockNumber: '88', blockTimestamp: '999', creator: address(32) })
	})

	test('advances a bounded canonical cursor and rejects a changed persisted cursor hash', async () => {
		let changed = false
		const implementation = {
			async getBlock(parameters: { blockNumber?: bigint }) {
				const number = parameters.blockNumber
				if (number === undefined) throw new Error('Block number required')
				return { hash: changed && number === 12n ? hash(999) : hash(Number(number)), number, timestamp: 1_000n }
			},
			async getLogs() {
				return []
			},
		}
		const client = new Proxy({} as ChaosReadClient, {
			get(_target, property) {
				const value = implementation[property as keyof typeof implementation]
				if (value === undefined) throw new Error(`Unexpected method ${String(property)}`)
				return value
			},
		})
		const update = await updateProtocolIndex({ anchorBlockNumber: 12n, auctionAddresses: [], chainId: 31337, client, escalationGames: [], maxBlockSpan: 3n, ...indexDeployments, ...indexTrust, startBlock: 10n, wallet: address(1) })
		expect(update.complete).toBe(true)
		expect(update.index.cursor).toEqual({ blockHash: hash(12), blockNumber: '12' })
		expect(update.index.escalationDeposits).toEqual([])
		changed = true
		await expect(updateProtocolIndex({ anchorBlockNumber: 13n, auctionAddresses: [], chainId: 31337, client, escalationGames: [], ...indexDeployments, ...indexTrust, previous: update.index, startBlock: 10n, wallet: address(1) })).rejects.toBeInstanceOf(ChaosProtocolIndexReorgError)
	})

	test('ignores unrelated OpenOracle logs without trying to decode a report id', async () => {
		const implementation = {
			async getBlock(parameters: { blockNumber?: bigint }) {
				const number = parameters.blockNumber
				if (number === undefined) throw new Error('Block number required')
				return { hash: hash(Number(number)), number, timestamp: 1_000n }
			},
			async getLogs(parameters: { address?: Address | Address[] }) {
				return parameters.address === address(6) ? [{ address: address(6), blockHash: hash(10), blockNumber: 10n, data: '0x', logIndex: 0, removed: false, topics: [hash(777)], transactionHash: hash(500), transactionIndex: 0 }] : []
			},
		}
		const client = new Proxy({} as ChaosReadClient, {
			get(_target, property) {
				const value = implementation[property as keyof typeof implementation]
				if (value === undefined) throw new Error(`Unexpected method ${String(property)}`)
				return value
			},
		})
		const update = await updateProtocolIndex({ anchorBlockNumber: 10n, auctionAddresses: [], chainId: 31337, client, escalationGames: [], ...indexDeployments, ...indexTrust, startBlock: 10n, wallet: address(1) })
		expect(update.complete).toBe(true)
		expect(update.index.reports).toEqual([])
	})

	test('indexes only signer standalone and exact canonical coordinator reports', async () => {
		const signerReport = canonicalLog({
			address: indexDeployments.openOracle,
			blockNumber: 10n,
			data: packedReport({ callbackContract: address(0), callbackGasLimit: 0n, creator: address(1) }),
			logIndex: 0,
			topics: [reportSubmittedTopic, toHex(1n, { size: 32 })],
		})
		const coordinatorReport = canonicalLog({
			address: indexDeployments.openOracle,
			blockNumber: 10n,
			data: packedReport({ callbackContract: address(20), callbackGasLimit: 4_000_000n, creator: address(20), currentReporter: address(20) }),
			logIndex: 1,
			topics: [reportSubmittedTopic, toHex(2n, { size: 32 })],
		})
		const hostileTokenReport = canonicalLog({
			address: indexDeployments.openOracle,
			blockNumber: 10n,
			data: packedReport({ callbackContract: address(0), callbackGasLimit: 0n, creator: address(1), token2: address(99) }),
			logIndex: 2,
			topics: [reportSubmittedTopic, toHex(3n, { size: 32 })],
		})
		const excessiveCallbackReport = canonicalLog({
			address: indexDeployments.openOracle,
			blockNumber: 10n,
			data: packedReport({ callbackContract: address(21), callbackGasLimit: 8_000_001n, creator: address(21), currentReporter: address(21) }),
			logIndex: 3,
			topics: [reportSubmittedTopic, toHex(4n, { size: 32 })],
		})
		const oracleReads: bigint[] = []
		const update = await updateProtocolIndex({
			anchorBlockNumber: 10n,
			auctionAddresses: [],
			chainId: 31337,
			client: eventIndexClient([signerReport, coordinatorReport, hostileTokenReport, excessiveCallbackReport], oracleReads),
			coordinatorReports: [
				{ coordinator: address(20), pendingReportId: '2', repToken: address(10) },
				{ coordinator: address(21), pendingReportId: '4', repToken: address(10) },
			],
			escalationGames: [],
			maximumSettlementStepGasLimit: OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT,
			...indexDeployments,
			startBlock: 10n,
			trustedRepTokens: [address(10)],
			wallet: address(1),
			weth: address(7),
		})
		expect(update.index.reports.map(candidate => candidate.reportId)).toEqual(['1', '2'])
		expect(oracleReads).toEqual([1n, 2n])

		const pruned = await updateProtocolIndex({
			anchorBlockNumber: 10n,
			auctionAddresses: [],
			chainId: 31337,
			client: eventIndexClient([]),
			coordinatorReports: [],
			escalationGames: [],
			maximumSettlementStepGasLimit: OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT,
			...indexDeployments,
			previous: update.index,
			startBlock: 10n,
			trustedRepTokens: [address(10)],
			wallet: address(1),
			weth: address(7),
		})
		expect(pruned.index.reports.map(candidate => candidate.reportId)).toEqual(['1'])
	})

	test('keeps the durable shape JSON-safe', () => {
		const index: ChaosProtocolIndex = {
			auctionBids: { [address(20)]: [{ amountAttoEth: 10n.toString(), index: '0', refunded: false, tick: '-1' }] },
			auctionRefunds: {},
			chainId: 1,
			childRepSplits: [],
			cursor: { blockHash: hash(10), blockNumber: '10' },
			escalationDeposits: [{ amountAttoRep: 9n.toString(), claimed: false, depositIndex: '2', escalationGame: address(21), outcome: 1, parentDepositIndex: '2', pool: address(22), vault: address(1) }],
			migrationRepSplits: [],
			...indexDeployments,
			reports: [],
			schemaVersion: 3,
			startBlock: '1',
			wallet: address(1),
		}
		expect(JSON.stringify(JSON.parse(JSON.stringify(index)))).toBe(JSON.stringify(index))
	})

	test('replays out-of-order canonical migration logs into deterministic cumulative routes', async () => {
		const firstWalletSplit = migrationRepSplitLog({ amount: 3n, blockNumber: 10n, cumulative: 3n, logIndex: 0 })
		const poolSplit = childRepSplitLog({ blockNumber: 11n, cumulative: 40n, logIndex: 0 })
		const secondWalletSplit = migrationRepSplitLog({ amount: 2n, blockNumber: 12n, cumulative: 5n, logIndex: 0 })
		const update = await updateProtocolIndex({
			anchorBlockNumber: 12n,
			auctionAddresses: [],
			chainId: 31337,
			client: eventIndexClient([secondWalletSplit, poolSplit, firstWalletSplit]),
			escalationGames: [],
			...indexDeployments,
			...indexTrust,
			startBlock: 10n,
			wallet: address(1),
		})
		expect(update.index.migrationRepSplits).toEqual([
			{
				childMigrationRepAmountAttoRep: 5n.toString(),
				childUniverseId: deriveChildUniverseId(0n, 1n).toString(),
				outcomeIndex: '1',
				universeId: '0',
			},
		])
		expect(update.index.childRepSplits).toEqual([{ childPoolRepSplitAttoRep: 40n.toString(), outcomeIndex: '1', pool: address(22) }])
		const advanced = await updateProtocolIndex({
			anchorBlockNumber: 13n,
			auctionAddresses: [],
			chainId: 31337,
			client: eventIndexClient([childRepSplitLog({ blockNumber: 13n, cumulative: 60n, logIndex: 1 }), migrationRepSplitLog({ amount: 2n, blockNumber: 13n, cumulative: 7n, logIndex: 0 })]),
			escalationGames: [],
			...indexDeployments,
			...indexTrust,
			previous: update.index,
			startBlock: 10n,
			wallet: address(1),
		})
		expect(advanced.index.migrationRepSplits[0]?.childMigrationRepAmountAttoRep).toBe('7')
		expect(advanced.index.childRepSplits[0]?.childPoolRepSplitAttoRep).toBe('60')
	})

	test('rejects incomplete, forged, duplicate, and non-monotonic migration histories', async () => {
		const cases: Array<{ expected: string; logs: ReturnType<typeof canonicalLog>[] }> = [
			{
				expected: 'cumulative progress is discontinuous',
				logs: [migrationRepSplitLog({ amount: 2n, blockNumber: 10n, cumulative: 3n, logIndex: 0 })],
			},
			{
				expected: 'child universe ID does not match',
				logs: [migrationRepSplitLog({ amount: 2n, blockNumber: 10n, childUniverseId: deriveChildUniverseId(0n, 1n) + 1n, cumulative: 2n, logIndex: 0 })],
			},
			{
				expected: 'invalid data length',
				logs: (() => {
					const log = migrationRepSplitLog({ amount: 2n, blockNumber: 10n, cumulative: 2n, logIndex: 0 })
					return [{ ...log, data: '0x' as const }]
				})(),
			},
			{
				expected: 'duplicate log',
				logs: (() => {
					const log = migrationRepSplitLog({ amount: 2n, blockNumber: 10n, cumulative: 2n, logIndex: 0 })
					return [log, log]
				})(),
			},
			{
				expected: 'cumulative progress did not increase',
				logs: [childRepSplitLog({ blockNumber: 10n, cumulative: 4n, logIndex: 0 }), childRepSplitLog({ blockNumber: 10n, cumulative: 4n, logIndex: 1 })],
			},
		]
		for (const candidate of cases) {
			await expect(updateProtocolIndex({ anchorBlockNumber: 10n, auctionAddresses: [], chainId: 31337, client: eventIndexClient(candidate.logs), escalationGames: [], ...indexDeployments, ...indexTrust, startBlock: 10n, wallet: address(1) })).rejects.toThrow(candidate.expected)
		}
	})

	test('binds persisted progress to both canonical migration emitters', async () => {
		const initial = await updateProtocolIndex({ anchorBlockNumber: 10n, auctionAddresses: [], chainId: 31337, client: eventIndexClient([]), escalationGames: [], ...indexDeployments, ...indexTrust, startBlock: 10n, wallet: address(1) })
		await expect(updateProtocolIndex({ anchorBlockNumber: 11n, auctionAddresses: [], chainId: 31337, client: eventIndexClient([]), escalationGames: [], ...indexDeployments, ...indexTrust, previous: initial.index, startBlock: 10n, wallet: address(1), zoltar: address(99) })).rejects.toThrow('Zoltar deployment changed')
		await expect(updateProtocolIndex({ anchorBlockNumber: 11n, auctionAddresses: [], chainId: 31337, client: eventIndexClient([]), escalationGames: [], ...indexDeployments, ...indexTrust, previous: initial.index, securityPoolForker: address(99), startBlock: 10n, wallet: address(1) })).rejects.toThrow(
			'SecurityPoolForker deployment changed',
		)
	})

	test('retains more than ten thousand distinct durable migration routes', async () => {
		const routeCount = 10_001
		const previous: ChaosProtocolIndex = {
			auctionBids: {},
			auctionRefunds: {},
			chainId: 31337,
			childRepSplits: Array.from({ length: routeCount }, (_, index) => ({ childPoolRepSplitAttoRep: 1n.toString(), outcomeIndex: (index + 1).toString(), pool: address(22) })),
			cursor: { blockHash: hash(10), blockNumber: '10' },
			escalationDeposits: [],
			migrationRepSplits: Array.from({ length: routeCount }, (_, index) => {
				const outcomeIndex = BigInt(index + 1)
				return {
					childMigrationRepAmountAttoRep: 1n.toString(),
					childUniverseId: deriveChildUniverseId(0n, outcomeIndex).toString(),
					outcomeIndex: outcomeIndex.toString(),
					universeId: '0',
				}
			}),
			...indexDeployments,
			reports: [],
			schemaVersion: 3,
			startBlock: '1',
			wallet: address(1),
		}
		const update = await updateProtocolIndex({
			anchorBlockNumber: 10n,
			auctionAddresses: [],
			chainId: 31337,
			client: eventIndexClient([]),
			escalationGames: [],
			...indexDeployments,
			...indexTrust,
			previous,
			startBlock: 1n,
			wallet: address(1),
		})
		expect(update.index.migrationRepSplits).toHaveLength(routeCount)
		expect(update.index.childRepSplits).toHaveLength(routeCount)
	})

	test('prunes terminal bids and escalation deposits even when the cursor is already current', async () => {
		const terminalIndex: ChaosProtocolIndex = {
			auctionBids: { [address(20)]: [{ amountAttoEth: 10n.toString(), index: '0', refunded: true, tick: '-1' }] },
			auctionRefunds: {},
			chainId: 31337,
			childRepSplits: [],
			cursor: { blockHash: hash(10), blockNumber: '10' },
			escalationDeposits: [{ amountAttoRep: 9n.toString(), claimed: true, depositIndex: '2', escalationGame: address(21), outcome: 1, parentDepositIndex: '2', pool: address(22), vault: address(1) }],
			migrationRepSplits: [],
			...indexDeployments,
			reports: [],
			schemaVersion: 3,
			startBlock: '1',
			wallet: address(1),
		}
		const implementation = {
			async getBlock(parameters: { blockNumber?: bigint }) {
				const number = parameters.blockNumber
				if (number === undefined) throw new Error('Block number required')
				return { hash: hash(Number(number)), number, timestamp: 1_000n }
			},
		}
		const client = new Proxy({} as ChaosReadClient, {
			get(_target, property) {
				const value = implementation[property as keyof typeof implementation]
				if (value === undefined) throw new Error(`Unexpected method ${String(property)}`)
				return value
			},
		})
		const update = await updateProtocolIndex({ anchorBlockNumber: 10n, auctionAddresses: [address(20)], chainId: 31337, client, escalationGames: [{ escalationGame: address(21), pool: address(22) }], ...indexDeployments, ...indexTrust, previous: terminalIndex, startBlock: 1n, wallet: address(1) })
		expect(update.index.auctionBids).toEqual({})
		expect(update.index.escalationDeposits).toEqual([])
	})

	test('marks both winning claims and losing carry consumptions terminal', async () => {
		const game = address(21)
		const pool = address(22)
		const previous: ChaosProtocolIndex = {
			auctionBids: {},
			auctionRefunds: {},
			chainId: 31337,
			childRepSplits: [],
			cursor: { blockHash: hash(9), blockNumber: '9' },
			escalationDeposits: [
				{ amountAttoRep: 9n.toString(), claimed: false, depositIndex: '2', escalationGame: game, outcome: 1, parentDepositIndex: '102', pool, vault: address(1) },
				{ amountAttoRep: 10n.toString(), claimed: false, depositIndex: '3', escalationGame: game, outcome: 2, parentDepositIndex: '103', pool, vault: address(1) },
			],
			migrationRepSplits: [],
			...indexDeployments,
			reports: [],
			schemaVersion: 3,
			startBlock: '1',
			wallet: address(1),
		}
		const claimTopic = keccak256(toHex('ClaimDeposit(address,uint8,uint256,uint256,uint256,uint256,bool)'))
		const carryTopic = keccak256(toHex('CarryDepositConsumed(uint256,uint256,address,uint8,uint256,uint8,uint256,bytes32,bytes32)'))
		const implementation = {
			async getBlock(parameters: { blockNumber?: bigint }) {
				const number = parameters.blockNumber
				if (number === undefined) throw new Error('Block number required')
				return { hash: hash(Number(number)), number, timestamp: 1_000n }
			},
			async getLogs(parameters: { address?: Address | Address[] }) {
				if (parameters.address === address(6)) return []
				if (Array.isArray(parameters.address) && parameters.address.some(value => value.toLowerCase() === indexDeployments.zoltar.toLowerCase())) return []
				return [
					{
						address: game,
						blockHash: hash(10),
						blockNumber: 10n,
						data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bool' }], [9n, 8n, 1n, true]),
						logIndex: 0,
						removed: false,
						topics: [claimTopic, toHex(BigInt(address(1)), { size: 32 }), toHex(1n, { size: 32 }), toHex(102n, { size: 32 })],
						transactionHash: hash(500),
						transactionIndex: 0,
					},
					{
						address: game,
						blockHash: hash(10),
						blockNumber: 10n,
						data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }], [2, 10n, 1, 0n, hash(700), hash(701)]),
						logIndex: 1,
						removed: false,
						topics: [carryTopic, toHex(103n, { size: 32 }), toHex(3n, { size: 32 }), toHex(BigInt(address(1)), { size: 32 })],
						transactionHash: hash(501),
						transactionIndex: 0,
					},
				]
			},
		}
		const client = new Proxy({} as ChaosReadClient, {
			get(_target, property) {
				const value = implementation[property as keyof typeof implementation]
				if (value === undefined) throw new Error(`Unexpected method ${String(property)}`)
				return value
			},
		})
		const update = await updateProtocolIndex({ anchorBlockNumber: 10n, auctionAddresses: [], chainId: 31337, client, escalationGames: [{ escalationGame: game, pool }], ...indexDeployments, ...indexTrust, previous, startBlock: 1n, wallet: address(1) })
		expect(update.index.escalationDeposits).toEqual([])
	})
})
