import { describe, expect, test } from 'bun:test'
import { createPublicClient, custom, decodeFunctionData, encodeAbiParameters, getAddress, mainnet, type EIP1193Provider } from '#ethereum'
import { openOracleAbi, openOraclePriceCoordinatorAbi } from '#contracts/abi'
import { disputeRecord, pendingCoordinatorReports } from '#execution/recovery-support'
import { applyCoordinatorReports, type ActiveReport } from '#monitoring/oracle-log-state'
import type { OpenOracleStatePreimage } from '@zoltar/shared/openOracle'

const activeCoordinator = getAddress('0x0000000000000000000000000000000000000001')
const idleCoordinator = getAddress('0x0000000000000000000000000000000000000002')
const openOracle = getAddress('0x0000000000000000000000000000000000000003')
const reporter = getAddress('0x0000000000000000000000000000000000000004')
const weth = getAddress('0x0000000000000000000000000000000000000005')
const rep = getAddress('0x0000000000000000000000000000000000000006')
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
				const data = String(request.data)
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

	test('replaces stale cached reports with the coordinator snapshot', () => {
		const active = {
			game: {
				callbackContract: activeCoordinator,
				callbackGasLimit: 1_000_000n,
				currentAmount1: 1_000n,
				currentAmount2: 2_000n,
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
			helper: { blockNumber: 79n, blockTimestamp: 80n, creator: activeCoordinator, reportId: 7n },
		} satisfies OpenOracleStatePreimage
		const stale = { ...active, helper: { ...active.helper, reportId: 6n } }
		const reports = new Map<bigint, ActiveReport>([[6n, { latest: stale, settled: false, steps: [] }]])

		applyCoordinatorReports(reports, [active])

		expect([...reports.keys()]).toEqual([7n])
		expect(reports.get(7n)?.latest).toEqual(active)
	})
})
