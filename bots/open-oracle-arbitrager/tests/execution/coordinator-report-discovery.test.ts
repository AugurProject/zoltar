import { describe, expect, test } from 'bun:test'
import { bytesToHex, createPublicClient, custom, decodeFunctionData, encodeAbiParameters, getAddress, hexToBytes, isHex, mainnet, toHex, type EIP1193Provider, type Hex } from '#ethereum'
import { openOracleAbi, openOraclePriceCoordinatorAbi } from '#contracts/abi'
import { disputeRecord, legacyReplacementAmountsWithQuorum, pendingCoordinatorReports, pendingCoordinatorReportsWithQuorum, replacementDisputeAmountsWithQuorum } from '#execution/recovery-support'
import { applyCoordinatorReports, type ActiveReport } from '#monitoring/oracle-log-state'
import { ConnectivityDegradedError } from '#monitoring/resilience'
import { encodeOpenOracleStatePreimagePacked, OPEN_ORACLE_REPORT_DISPUTED_TOPIC, type OpenOracleStatePreimage } from '@zoltar/shared/openOracle'

const activeCoordinator = getAddress('0x0000000000000000000000000000000000000001')
const idleCoordinator = getAddress('0x0000000000000000000000000000000000000002')
const openOracle = getAddress('0x0000000000000000000000000000000000000003')
const reporter = getAddress('0x0000000000000000000000000000000000000004')
const weth = getAddress('0x0000000000000000000000000000000000000005')
const rep = getAddress('0x0000000000000000000000000000000000000006')

function requiredHex(value: unknown) {
	if (typeof value !== 'string' || !isHex(value, { strict: true })) throw new Error('Expected hex RPC request data')
	return bytesToHex(hexToBytes(value))
}

const gameOutputs = [
	{ type: 'uint128' },
	{ type: 'uint128' },
	{ type: 'address' },
	{ type: 'uint48' },
	{ type: 'uint48' },
	{ type: 'address' },
	{ type: 'uint48' },
	{ type: 'uint48' },
	{ type: 'uint128' },
	{ type: 'address' },
	{ type: 'uint96' },
	{ type: 'address' },
	{ type: 'uint24' },
	{ type: 'uint24' },
	{ type: 'uint24' },
	{ type: 'uint16' },
	{ type: 'address' },
	{ type: 'uint32' },
	{ type: 'uint24' },
	{ type: 'uint8' },
] as const

function reportState(reportId: bigint, amount1: bigint, amount2: bigint): OpenOracleStatePreimage {
	return {
		game: {
			callbackContract: activeCoordinator,
			callbackGasLimit: 1_000_000n,
			currentAmount1: amount1,
			currentAmount2: amount2,
			currentReporter: reporter,
			disputeDelay: 10n,
			escalationHalt: 10_000n,
			feePercentage: 20n,
			flags: 7n,
			lastReportOppoTime: 89n,
			multiplier: 140n,
			numReports: 1n,
			protocolFee: 30n,
			protocolFeeRecipient: activeCoordinator,
			reportTimestamp: 90n,
			settlementTime: 300n,
			settlementTimestamp: 0n,
			settlerRewardAttoEth: 1n,
			token1: weth,
			token2: rep,
		},
		helper: { blockNumber: 79n, blockTimestamp: 80n, creator: activeCoordinator, reportId },
	}
}

describe('configured coordinator report discovery', () => {
	test('loads current report state at one block without querying event history', async () => {
		const methods: string[] = []
		const blockTags: unknown[] = []
		const provider: EIP1193Provider = {
			request: parameters => {
				methods.push(parameters.method)
				if (parameters.method !== 'eth_call' || !Array.isArray(parameters.params)) throw new Error(`Unexpected RPC method ${parameters.method}`)
				const request = parameters.params[0]
				if (typeof request !== 'object' || request === null || !('to' in request) || !('data' in request)) throw new Error('Malformed contract read')
				blockTags.push(parameters.params[1])
				const to = String(request.to).toLowerCase()
				const data = requiredHex(request.data)
				if (to === activeCoordinator.toLowerCase() || to === idleCoordinator.toLowerCase()) {
					const decoded = decodeFunctionData({ abi: openOraclePriceCoordinatorAbi, data })
					if (decoded.functionName !== 'pendingReportId') throw new Error(`Unexpected coordinator read ${decoded.functionName}`)
					return Promise.resolve(encodeAbiParameters([{ type: 'uint256' }], [to === activeCoordinator.toLowerCase() ? 7n : 0n]))
				}
				if (to !== openOracle.toLowerCase()) throw new Error(`Unexpected contract ${to}`)
				const decoded = decodeFunctionData({ abi: openOracleAbi, data })
				if (decoded.functionName === 'storedGame') {
					return Promise.resolve(encodeAbiParameters(gameOutputs, [1_000n, 2_000n, reporter, 90n, 0n, weth, 89n, 300n, 10_000n, activeCoordinator, 1n, rep, 1n, 10n, 20n, 140n, activeCoordinator, 1_000_000n, 30n, 7n]))
				}
				if (decoded.functionName === 'storedHelper') {
					return Promise.resolve(encodeAbiParameters([{ type: 'address' }, { type: 'uint48' }, { type: 'uint48' }], [activeCoordinator, 80n, 79n]))
				}
				if (decoded.functionName === 'disputeHistory') {
					return Promise.resolve(encodeAbiParameters([{ type: 'uint128' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'uint48' }], [1_400n, 2_300n, 15n, 95n]))
				}
				throw new Error(`Unexpected OpenOracle read ${decoded.functionName}`)
			},
		}
		const client = createPublicClient({ chain: mainnet, transport: custom(provider) })
		const reports = await pendingCoordinatorReports(client, { coordinatorAddresses: [activeCoordinator, idleCoordinator], openOracle }, 100n)
		const replacement = await disputeRecord(client, openOracle, 7n, 2n, 100n)

		expect(reports.map(report => report.helper.reportId)).toEqual([7n])
		expect(reports[0]?.game.currentAmount2).toBe(2_000n)
		expect(replacement).toEqual({ amount1: 1_400n, amount2: 2_300n, reportTimestamp: 95n })
		expect(methods).toEqual(['eth_call', 'eth_call', 'eth_call', 'eth_call', 'eth_call'])
		expect(blockTags).toEqual(['0x64', '0x64', '0x64', '0x64', '0x64'])
	})

	test('requires independent agreement for execution discovery and tolerates one unavailable reader', async () => {
		const methods: string[] = []
		const blockHash = `0x${'ab'.repeat(32)}` as Hex
		const rawBlock = {
			baseFeePerGas: '0x1',
			difficulty: '0x0',
			extraData: '0x',
			gasLimit: '0x1c9c380',
			gasUsed: '0x0',
			hash: blockHash,
			logsBloom: `0x${'00'.repeat(256)}`,
			miner: getAddress('0x0000000000000000000000000000000000000000'),
			mixHash: `0x${'00'.repeat(32)}`,
			nonce: '0x0000000000000000',
			number: '0x64',
			parentHash: `0x${'bb'.repeat(32)}`,
			receiptsRoot: `0x${'cc'.repeat(32)}`,
			sha3Uncles: `0x${'dd'.repeat(32)}`,
			size: '0x1',
			stateRoot: `0x${'ee'.repeat(32)}`,
			timestamp: '0x64',
			totalDifficulty: '0x0',
			transactions: [],
			transactionsRoot: `0x${'ff'.repeat(32)}`,
			uncles: [],
		}
		const provider = (reportId: bigint, unavailable = false, reorg = false, missingBlockHash = false): EIP1193Provider => {
			let blockReads = 0
			return {
				request: parameters => {
					methods.push(parameters.method)
					if (unavailable) throw new ConnectivityDegradedError('RPC connection unavailable')
					if (parameters.method === 'eth_getBlockByNumber') {
						blockReads += 1
						return Promise.resolve({ ...rawBlock, hash: missingBlockHash ? undefined : reorg && blockReads > 1 ? (`0x${'bc'.repeat(32)}` as Hex) : blockHash })
					}
					if (parameters.method !== 'eth_call' || !Array.isArray(parameters.params)) throw new Error(`Unexpected RPC method ${parameters.method}`)
					const request = parameters.params[0]
					if (typeof request !== 'object' || request === null || !('to' in request) || !('data' in request)) throw new Error('Malformed contract read')
					const to = String(request.to).toLowerCase()
					const data = requiredHex(request.data)
					if (to === activeCoordinator.toLowerCase()) {
						const decoded = decodeFunctionData({ abi: openOraclePriceCoordinatorAbi, data })
						if (decoded.functionName !== 'pendingReportId') throw new Error(`Unexpected coordinator read ${decoded.functionName}`)
						return Promise.resolve(encodeAbiParameters([{ type: 'uint256' }], [reportId]))
					}
					if (to !== openOracle.toLowerCase()) throw new Error(`Unexpected contract ${to}`)
					const decoded = decodeFunctionData({ abi: openOracleAbi, data })
					if (decoded.functionName === 'storedGame') return Promise.resolve(encodeAbiParameters(gameOutputs, [1_000n, 2_000n, reporter, 90n, 0n, weth, 89n, 300n, 10_000n, activeCoordinator, 1n, rep, 1n, 10n, 20n, 140n, activeCoordinator, 1_000_000n, 30n, 7n]))
					if (decoded.functionName === 'storedHelper') return Promise.resolve(encodeAbiParameters([{ type: 'address' }, { type: 'uint48' }, { type: 'uint48' }], [activeCoordinator, 80n, 79n]))
					if (decoded.functionName === 'disputeHistory') return Promise.resolve(encodeAbiParameters([{ type: 'uint128' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'uint48' }], [1_400n, 2_300n, 15n, 95n]))
					throw new Error(`Unexpected OpenOracle read ${decoded.functionName}`)
				},
			}
		}
		const client = (reportId: bigint, unavailable = false, reorg = false, missingBlockHash = false) => createPublicClient({ chain: mainnet, transport: custom(provider(reportId, unavailable, reorg, missingBlockHash)) })
		const config = { connectivity: { publicRpcUrls: ['https://public.example'], readRpcUrl: 'https://primary.example' }, coordinatorAddresses: [activeCoordinator], openOracle, quorumRpcUrls: ['https://secondary.example', 'https://tertiary.example'] }

		const reports = await pendingCoordinatorReportsWithQuorum([client(7n), client(7n), client(7n, true)], config, 100n)

		expect(reports.map(report => report.helper.reportId)).toEqual([7n])
		expect(methods).not.toContain('eth_getLogs')
		await expect(pendingCoordinatorReportsWithQuorum([client(7n), client(8n)], { ...config, quorumRpcUrls: ['https://secondary.example'] }, 100n)).rejects.toThrow('RPC disagreement')
		await expect(pendingCoordinatorReportsWithQuorum([client(7n, false, false, true)], { ...config, quorumRpcUrls: [] }, 100n)).rejects.toThrow('RPC https://primary.example failed while calling eth_getBlockByNumber: pending coordinator report snapshot block 100 is missing its canonical hash before the read')
		await expect(pendingCoordinatorReportsWithQuorum([client(7n, false, true), client(7n, false, true)], { ...config, quorumRpcUrls: ['https://secondary.example'] }, 100n)).rejects.toThrow('changed during pending coordinator report snapshot')
		await expect(replacementDisputeAmountsWithQuorum([client(7n, false, true), client(7n, false, true)], { connectivity: config.connectivity, openOracle, quorumRpcUrls: ['https://secondary.example'] }, 7n, 2n, 100n)).rejects.toThrow('changed during replacement dispute snapshot')
	})

	test('replaces stale cached reports with the coordinator snapshot', () => {
		const active = reportState(7n, 1_000n, 2_000n)
		const stale = { ...active, helper: { ...active.helper, reportId: 6n } }
		const reports = new Map<bigint, ActiveReport>([[6n, { latest: stale, settled: false, steps: [] }]])

		applyCoordinatorReports(reports, [active])

		expect([...reports.keys()]).toEqual([7n])
		expect(reports.get(7n)?.latest).toEqual(active)
	})

	test('recovers a legacy restarted position replacement from report-specific logs with quorum', async () => {
		const blockHash = `0x${'aa'.repeat(32)}` as Hex
		const entryTransactionHash = `0x${'11'.repeat(32)}` as Hex
		const successorTransactionHash = `0x${'22'.repeat(32)}` as Hex
		const reportTopic = toHex(7n, { size: 32 })
		const rawBlock = {
			baseFeePerGas: '0x1',
			difficulty: '0x0',
			extraData: '0x',
			gasLimit: '0x1c9c380',
			gasUsed: '0x0',
			hash: blockHash,
			logsBloom: `0x${'00'.repeat(256)}`,
			miner: getAddress('0x0000000000000000000000000000000000000000'),
			mixHash: `0x${'00'.repeat(32)}`,
			nonce: '0x0000000000000000',
			number: '0xfa',
			parentHash: `0x${'bb'.repeat(32)}`,
			receiptsRoot: `0x${'cc'.repeat(32)}`,
			sha3Uncles: `0x${'dd'.repeat(32)}`,
			size: '0x1',
			stateRoot: `0x${'ee'.repeat(32)}`,
			timestamp: '0x64',
			totalDifficulty: '0x0',
			transactions: [],
			transactionsRoot: `0x${'ff'.repeat(32)}`,
			uncles: [],
		}
		const entryLog = { address: openOracle, blockHash, blockNumber: '0x63', data: encodeOpenOracleStatePreimagePacked(reportState(7n, 1_000n, 2_000n)), logIndex: '0x0', removed: false, topics: [OPEN_ORACLE_REPORT_DISPUTED_TOPIC, reportTopic], transactionHash: entryTransactionHash, transactionIndex: '0x0' }
		const successorLog = { address: openOracle, blockHash, blockNumber: '0x64', data: encodeOpenOracleStatePreimagePacked(reportState(7n, 1_400n, 2_300n)), logIndex: '0x0', removed: false, topics: [OPEN_ORACLE_REPORT_DISPUTED_TOPIC, reportTopic], transactionHash: successorTransactionHash, transactionIndex: '0x0' }
		const calls: Array<{ method: string; params?: unknown; providerIndex: number }> = []
		const activeLogCalls = [0, 0]
		const maximumLogCalls = [0, 0]
		const provider = (providerIndex: number): EIP1193Provider => ({
			request: async parameters => {
				calls.push({ method: parameters.method, params: parameters.params, providerIndex })
				if (parameters.method === 'eth_getLogs') {
					activeLogCalls[providerIndex] = (activeLogCalls[providerIndex] ?? 0) + 1
					maximumLogCalls[providerIndex] = Math.max(maximumLogCalls[providerIndex] ?? 0, activeLogCalls[providerIndex] ?? 0)
					await Promise.resolve()
					activeLogCalls[providerIndex] = (activeLogCalls[providerIndex] ?? 1) - 1
					if (!Array.isArray(parameters.params)) throw new Error('Malformed log request')
					const request = parameters.params[0]
					if (typeof request !== 'object' || request === null || !('fromBlock' in request)) throw new Error('Malformed log filter')
					if (request.fromBlock === '0x0') return [entryLog]
					if (request.fromBlock === '0x64') return [successorLog]
					return []
				}
				if (parameters.method === 'eth_getBlockByNumber') return Promise.resolve(rawBlock)
				throw new Error(`Unexpected RPC method ${parameters.method}`)
			},
		})
		const clients = [createPublicClient({ chain: mainnet, transport: custom(provider(0)) }), createPublicClient({ chain: mainnet, transport: custom(provider(1)) })]

		const replacement = await legacyReplacementAmountsWithQuorum(clients, { connectivity: { publicRpcUrls: ['https://public.example'], readRpcUrl: 'https://primary.example' }, openOracle, quorumRpcUrls: ['https://secondary.example'] }, { entrySubmissionBlockNumber: '0', entryTransactionHash, reportId: '7' }, 250n)

		expect(replacement).toEqual({ amounts: { amount1: 1_400n, amount2: 2_300n }, blockHash })
		const logCalls = calls.filter(call => call.method === 'eth_getLogs')
		expect(logCalls).toHaveLength(4)
		expect(maximumLogCalls).toEqual([1, 1])
		for (const providerIndex of [0, 1]) {
			expect(logCalls.filter(call => call.providerIndex === providerIndex).map(call => call.params)).toEqual([
				[{ address: openOracle.toLowerCase(), fromBlock: '0x0', toBlock: '0x63', topics: [OPEN_ORACLE_REPORT_DISPUTED_TOPIC, reportTopic] }],
				[{ address: openOracle.toLowerCase(), fromBlock: '0x64', toBlock: '0xc7', topics: [OPEN_ORACLE_REPORT_DISPUTED_TOPIC, reportTopic] }],
			])
		}

		const reorgProvider = (): EIP1193Provider => {
			let blockReads = 0
			return {
				request: async parameters => {
					if (parameters.method === 'eth_getBlockByNumber') {
						blockReads += 1
						return { ...rawBlock, hash: blockReads === 1 ? blockHash : (`0x${'bc'.repeat(32)}` as Hex) }
					}
					if (parameters.method !== 'eth_getLogs' || !Array.isArray(parameters.params)) throw new Error(`Unexpected RPC method ${parameters.method}`)
					const request = parameters.params[0]
					if (typeof request !== 'object' || request === null || !('fromBlock' in request)) throw new Error('Malformed log filter')
					await Promise.resolve()
					if (request.fromBlock === '0x0') return [entryLog]
					if (request.fromBlock === '0x64') return [successorLog]
					return []
				},
			}
		}
		const reorgClients = [createPublicClient({ chain: mainnet, transport: custom(reorgProvider()) }), createPublicClient({ chain: mainnet, transport: custom(reorgProvider()) })]
		await expect(
			legacyReplacementAmountsWithQuorum(reorgClients, { connectivity: { publicRpcUrls: ['https://public.example'], readRpcUrl: 'https://primary.example' }, openOracle, quorumRpcUrls: ['https://secondary.example'] }, { entrySubmissionBlockNumber: '0', entryTransactionHash, reportId: '7' }, 250n),
		).rejects.toThrow('changed during legacy replacement recovery')
	})
})
