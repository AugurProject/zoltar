import { expect, test } from 'bun:test'
import { createPublicClient, custom, isHex, decodeFunctionData, encodeAbiParameters, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { formatCollateralAmount, loadTradingCollateralAsset } from '../../protocol/collateral.js'
import { formatCompleteSetQuantity, formatCollateralEth } from '../../lib/shareValue.js'

const token = '0x00000000000000000000000000000000000000aa' as const
const abi = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)'])

function metadataClient(symbol: string, decimals: number) {
	return createPublicClient({
		transport: custom({
			request: async ({ params }) => {
				if (!Array.isArray(params)) throw new Error('Missing parameters')
				const transaction: unknown = params[0]
				if (transaction === null || typeof transaction !== 'object' || !('data' in transaction) || typeof transaction.data !== 'string' || !isHex(transaction.data, { strict: true })) throw new Error('Missing call')
				const name = decodeFunctionData({ abi, data: transaction.data }).functionName
				return name === 'symbol' ? encodeAbiParameters([{ type: 'string' }], [symbol]) : encodeAbiParameters([{ type: 'uint8' }], [decimals])
			},
		}),
	})
}

test('reads an arbitrary ERC20 decimals and marks its self-reported symbol as unverified', async () => {
	const collateral = await loadTradingCollateralAsset(metadataClient('TOKEN', 8), token)
	expect(collateral).toEqual({ token, symbol: 'TOKEN (0x000000…0000aa)', decimals: 8, native: false })
	expect(formatCollateralAmount(123_456_789n, { collateral })).toBe('1.2346 TOKEN (0x000000…0000aa)')
})

// #1462: a counterfeit token claiming a reserved symbol must not read as the real collateral.
test.each([
	{ symbol: 'USDC', decimals: 6 },
	{ symbol: 'ETH', decimals: 18 },
	{ symbol: 'WETH', decimals: 18 },
])('#1462 labels a non-allowlisted token claiming $symbol with its address', async ({ symbol, decimals }) => {
	const collateral = await loadTradingCollateralAsset(metadataClient(symbol, decimals), token)
	expect(collateral.symbol).not.toBe(symbol)
	expect(collateral.symbol).toBe(`${symbol} (0x000000…0000aa)`)
	expect(collateral.native).toBe(false)
	expect(formatCollateralAmount(1_500n * 10n ** BigInt(decimals), { collateral })).toEndWith(` ${symbol} (0x000000…0000aa)`)
})

test('names a non-allowlisted token without a symbol by its address', async () => {
	expect((await loadTradingCollateralAsset(metadataClient(' ', 18), token)).symbol).toBe('Token 0x000000…0000aa')
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
