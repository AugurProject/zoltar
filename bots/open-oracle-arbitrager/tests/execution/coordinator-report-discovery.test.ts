import { describe, expect, test } from 'bun:test'
import { bytesToHex, mainnet } from '@zoltar/core-shared/evm/ethereum'
import { createPublicClient, decodeFunctionData, encodeAbiParameters, getAddress, hexToBytes, isHex, type EIP1193Provider, type Hex } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { openOracleAbi, openOraclePriceCoordinatorAbi } from '#contracts/abi'
import { pendingCoordinatorReports, pendingCoordinatorReportsWithQuorum, replacementDisputeAmountsWithQuorum } from '#execution/recovery-support'
import { applyCoordinatorReports, type ActiveReport } from '#monitoring/oracle-log-state'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import { type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { multicallProvider } from '../helpers/multicall-provider.ts'

const activeCoordinator = getAddress('0x0000000000000000000000000000000000000001')
const idleCoordinator = getAddress('0x0000000000000000000000000000000000000002')
const openOracle = getAddress('0x0000000000000000000000000000000000000003')
const reporter = getAddress('0x0000000000000000000000000000000000000004')
const weth = getAddress('0x0000000000000000000000000000000000000005')
const rep = getAddress('0x0000000000000000000000000000000000000006')
const multicall3 = getAddress('0x0000000000000000000000000000000000000007')
const network = { multicall3 }

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
		const contractReads: string[] = []
		const inner = multicallProvider(multicall3, ({ blockTag, data, to }) => {
			blockTags.push(blockTag)
			const target = to.toLowerCase()
			if (target === activeCoordinator.toLowerCase() || target === idleCoordinator.toLowerCase()) {
				const decoded = decodeFunctionData({ abi: openOraclePriceCoordinatorAbi, data: requiredHex(data) })
				if (decoded.functionName !== 'pendingReportId') throw new Error(`Unexpected coordinator read ${decoded.functionName}`)
				contractReads.push(decoded.functionName)
				return encodeAbiParameters([{ type: 'uint256' }], [target === activeCoordinator.toLowerCase() ? 7n : 0n])
			}
			if (target !== openOracle.toLowerCase()) throw new Error(`Unexpected contract ${target}`)
			const decoded = decodeFunctionData({ abi: openOracleAbi, data: requiredHex(data) })
			contractReads.push(decoded.functionName)
			if (decoded.functionName === 'storedGame') {
				return encodeAbiParameters(gameOutputs, [1_000n, 2_000n, reporter, 90n, 0n, weth, 89n, 300n, 10_000n, activeCoordinator, 1n, rep, 1n, 10n, 20n, 140n, activeCoordinator, 1_000_000n, 30n, 7n])
			}
			if (decoded.functionName === 'storedHelper') {
				return encodeAbiParameters([{ type: 'address' }, { type: 'uint48' }, { type: 'uint48' }], [activeCoordinator, 80n, 79n])
			}
			throw new Error(`Unexpected OpenOracle read ${decoded.functionName}`)
		})
		const provider: EIP1193Provider = {
			request: parameters => {
				methods.push(parameters.method)
				return inner.request(parameters)
			},
		}
		const client = createPublicClient({ chain: mainnet, transport: custom(provider) })
		const reports = await pendingCoordinatorReports(client, { coordinatorAddresses: [activeCoordinator, idleCoordinator], network, openOracle }, 100n)

		expect(reports.map(report => report.helper.reportId)).toEqual([7n])
		expect(reports[0]?.game.currentAmount2).toBe(2_000n)
		// Both coordinators share one batched request and the pending report's game and helper share another.
		expect(methods).toEqual(['eth_call', 'eth_call'])
		expect(contractReads).toEqual(['pendingReportId', 'pendingReportId', 'storedGame', 'storedHelper'])
		expect(blockTags).toEqual(['0x64', '0x64', '0x64', '0x64'])
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
			const inner = multicallProvider(
				multicall3,
				({ data, to }) => {
					const target = to.toLowerCase()
					if (target === activeCoordinator.toLowerCase()) {
						const decoded = decodeFunctionData({ abi: openOraclePriceCoordinatorAbi, data: requiredHex(data) })
						if (decoded.functionName !== 'pendingReportId') throw new Error(`Unexpected coordinator read ${decoded.functionName}`)
						return encodeAbiParameters([{ type: 'uint256' }], [reportId])
					}
					if (target !== openOracle.toLowerCase()) throw new Error(`Unexpected contract ${target}`)
					const decoded = decodeFunctionData({ abi: openOracleAbi, data: requiredHex(data) })
					if (decoded.functionName === 'storedGame') return encodeAbiParameters(gameOutputs, [1_000n, 2_000n, reporter, 90n, 0n, weth, 89n, 300n, 10_000n, activeCoordinator, 1n, rep, 1n, 10n, 20n, 140n, activeCoordinator, 1_000_000n, 30n, 7n])
					if (decoded.functionName === 'storedHelper') return encodeAbiParameters([{ type: 'address' }, { type: 'uint48' }, { type: 'uint48' }], [activeCoordinator, 80n, 79n])
					if (decoded.functionName === 'disputeHistory') return encodeAbiParameters([{ type: 'uint128' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'uint48' }], [1_400n, 2_300n, 15n, 95n])
					throw new Error(`Unexpected OpenOracle read ${decoded.functionName}`)
				},
				parameters => {
					if (parameters.method === 'eth_getBlockByNumber') {
						blockReads += 1
						const reorganizedHash: Hex = `0x${'bc'.repeat(32)}`
						if (missingBlockHash) return { ...rawBlock, hash: undefined }
						return { ...rawBlock, hash: reorg && blockReads > 1 ? reorganizedHash : blockHash }
					}
					throw new Error(`Unexpected RPC method ${parameters.method}`)
				},
			)
			return {
				request: parameters => {
					methods.push(parameters.method)
					if (unavailable) throw new ConnectivityDegradedError('RPC connection unavailable')
					return inner.request(parameters)
				},
			}
		}
		const client = (reportId: bigint, unavailable = false, reorg = false, missingBlockHash = false) => createPublicClient({ chain: mainnet, transport: custom(provider(reportId, unavailable, reorg, missingBlockHash)) })
		const config = { connectivity: { publicRpcUrls: ['https://public.example'], readRpcUrl: 'https://primary.example' }, coordinatorAddresses: [activeCoordinator], network, openOracle, quorumRpcUrls: ['https://secondary.example', 'https://tertiary.example'] }

		const reports = await pendingCoordinatorReportsWithQuorum([client(7n), client(7n), client(7n, true)], config, 100n)

		expect(reports.map(report => report.helper.reportId)).toEqual([7n])
		expect(methods).not.toContain('eth_getLogs')
		const replacement = await replacementDisputeAmountsWithQuorum([client(7n), client(7n)], { connectivity: config.connectivity, openOracle, quorumRpcUrls: ['https://secondary.example'] }, 7n, 2n, 100n)
		expect(replacement.record).toEqual({ amount1: 1_400n, amount2: 2_300n, reportTimestamp: 95n })
		await expect(pendingCoordinatorReportsWithQuorum([client(7n), client(8n)], { ...config, quorumRpcUrls: ['https://secondary.example'] }, 100n)).rejects.toThrow('RPC disagreement')
		await expect(pendingCoordinatorReportsWithQuorum([client(7n, false, false, true)], { ...config, quorumRpcUrls: [] }, 100n)).rejects.toThrow('RPC https://primary.example failed while calling eth_getBlockByNumber: RPC returned a mined block without a hash')
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
})
