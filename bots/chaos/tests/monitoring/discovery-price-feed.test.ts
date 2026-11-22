import { expect, test } from 'bun:test'
import { openOraclePriceCoordinatorAbi, sharedPoolPriceFeedAbi } from '@zoltar/bot-shared/contracts/abi'
import { createPublicClient, decodeFunctionData, encodeAbiParameters, isHex } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { discoverPoolPriceFeed } from '../../src/monitoring/discovery-price-feed.ts'
import { address } from '../operations/fixture.ts'

test('#1252 discovers a shared-feed bounty without funding a public RPC call sender', async () => {
	const baseFeePerGas = 1_111_894_317n
	const coordinator = address(21)
	const feed = address(80)
	const reads: string[] = []
	const client = createPublicClient({
		chain: mainnet,
		transport: custom({
			async request({ method, params }) {
				if (method !== 'eth_call' || !Array.isArray(params)) throw new Error('Unexpected RPC request')
				const call = params[0]
				if (typeof call !== 'object' || call === null || !('data' in call) || !isHex(call.data) || !('to' in call)) throw new Error('Invalid contract call')
				if ('gasPrice' in call) throw new Error('Insufficient funds for gas * price + value')
				expect(params[1]).toBe('0xa')
				const abi = call.to === coordinator.toLowerCase() ? openOraclePriceCoordinatorAbi : sharedPoolPriceFeedAbi
				const { functionName } = decodeFunctionData({ abi, data: call.data })
				reads.push(functionName)
				switch (functionName) {
					case 'priceFeed':
						return encodeAbiParameters([{ type: 'address' }], [feed])
					case 'collateralToken':
						return encodeAbiParameters([{ type: 'address' }], [address(7)])
					case 'aggregateExposureAttoEth':
						return encodeAbiParameters([{ type: 'uint256' }], [10n])
					case 'maxSettlementBaseFeeMultiplierBps':
						return encodeAbiParameters([{ type: 'uint256' }], [30_000n])
					case 'minimumToken2ReportAttoRep':
						return encodeAbiParameters([{ type: 'uint256' }], [0n])
					case 'minimumReportCollateral':
						return encodeAbiParameters([{ type: 'uint256' }], [10_001n])
					case 'minimumToken1ReportAttoEth':
						return encodeAbiParameters([{ type: 'uint256' }], [10_002n])
					default:
						throw new Error(`Unexpected contract read ${functionName}`)
				}
			},
		}),
	})
	const funding = {
		escalationHaltMultiplierBps: '10000',

		initialReportPriorityFeeAttoEthPerGas: 1n.toString(),

		settlementCallbackGasLimit: '1',
	}
	const snapshot = await discoverPoolPriceFeed(client, coordinator, 10n, funding, baseFeePerGas, 0n)
	expect(snapshot.requestPriceCostAttoEth).toBe((392_002n * 3n * (baseFeePerGas + 1n) + 101n).toString())
	expect(snapshot.minimumToken1ReportAttoEth).toBe('10002')
	expect(reads).not.toContain('getRequestPriceCostAttoEth')
})
