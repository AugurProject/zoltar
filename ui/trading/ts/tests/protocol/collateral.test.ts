import { expect, test } from 'bun:test'
import { createPublicClient, custom, isHex, decodeFunctionData, encodeAbiParameters, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { formatCollateralAmount, loadTradingCollateralAsset } from '../../protocol/collateral.js'
import { formatCompleteSetQuantity, formatCollateralEth } from '../../lib/shareValue.js'

const token = '0x00000000000000000000000000000000000000aa' as const
const abi = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)'])

test('reads an arbitrary ERC20 symbol and decimals instead of assuming ETH', async () => {
	const client = createPublicClient({
		transport: custom({
			request: async ({ params }) => {
				if (!Array.isArray(params)) throw new Error('Missing parameters')
				const transaction: unknown = params[0]
				if (transaction === null || typeof transaction !== 'object' || !('data' in transaction) || typeof transaction.data !== 'string' || !isHex(transaction.data, { strict: true })) throw new Error('Missing call')
				const name = decodeFunctionData({ abi, data: transaction.data }).functionName
				return name === 'symbol' ? encodeAbiParameters([{ type: 'string' }], ['TOKEN']) : encodeAbiParameters([{ type: 'uint8' }], [8])
			},
		}),
	})
	const collateral = await loadTradingCollateralAsset(client, token)
	expect(collateral).toEqual({ token, symbol: 'TOKEN', decimals: 8, native: false })
	expect(formatCollateralAmount(123_456_789n, { collateral })).toBe('1.2346 TOKEN')
})

test('ERC20s without optional metadata remain usable with labelled base units', async () => {
	const client = createPublicClient({
		transport: custom(
			{
				request: async () => {
					throw new Error('Metadata not supported')
				},
			},
			{ retryCount: 0 },
		),
	})
	expect(await loadTradingCollateralAsset(client, token)).toEqual({ token, symbol: 'Collateral base units', decimals: 0, native: false })
})

test('six-decimal outcome quantities and their redemption value agree', () => {
	const collateral = { token, symbol: 'USDC', decimals: 6, native: false }
	const market = { collateral, settlementCollateralAttoEth: 2_000_000n, shareTokenSupplyAttoShares: 2_000_000n }
	expect(formatCompleteSetQuantity(1_000_000n, 4, 'nearest', market)).toBe('1 complete set')
	expect(formatCollateralEth(1_000_000n, market)).toBe('1 USDC')
})
