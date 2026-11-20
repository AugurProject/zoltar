import { expect, test } from 'bun:test'
import { createPublicClient, decodeFunctionData, encodeAbiParameters, getAddress } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { networkConfiguration } from '#config/network'
import { constantProductPairAbi, poolAbi } from '#contracts/abi'
import { uniswapV3QuoterAbi } from '@zoltar/core-shared/evm/uniswapAbis'
import { quoteVenue, executableVenueQuotes } from '#monitoring/venue-quotes'
import { multicallProvider } from '../helpers/multicall-provider.ts'

const unit = 10n ** 18n
const network = networkConfiguration('mainnet')
const token = getAddress('0x0000000000000000000000000000000000000001')
const address = getAddress('0x0000000000000000000000000000000000000002')
const config = { network, router: address, v2Router: address, v4PoolManager: undefined, v4Quoter: undefined }
const amounts = { sellAmount: 150n * unit, buyAmount: 152n * unit, replacementAttoWeth: (1725n * unit) / 1000n }

for (const [issue, reserves] of [
	[1459, [75n * unit, (240n * unit) / 100n]],
	[1485, [1500n * unit, 15n * unit]],
] as const)
	test(`#${issue}: thin V2 liquidity never supplies an impact-inclusive replacement price`, async () => {
		const client = createPublicClient({
			chain: network.chain,
			transport: custom(
				multicallProvider(network.multicall3, ({ data }) => {
					const call = decodeFunctionData({ abi: constantProductPairAbi, data })
					return call.functionName === 'token0' ? encodeAbiParameters([{ type: 'address' }], [token]) : encodeAbiParameters([{ type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' }], [...reserves, 0n])
				}),
			),
		})
		const quotes = await quoteVenue(client, config, { venue: 'uniswap-v2', address, token, fee: 3000 }, amounts, 10n)
		expect(quotes.replacement).toBe((amounts.replacementAttoWeth * reserves[0]) / reserves[1])
		expect(executableVenueQuotes(quotes)).toBeUndefined()
	})

test('#1483: fair spot and TWAP cannot admit a shaped V3 full-size replacement', async () => {
	const sqrt = 2n ** 96n / 10n // token0=REP: marginal WETH/REP is approximately .01
	const client = createPublicClient({
		chain: network.chain,
		transport: custom(
			multicallProvider(network.multicall3, ({ to, data }) => {
				if (to === address) return encodeAbiParameters(poolAbi.find(item => item.type === 'function' && item.name === 'slot0')?.outputs ?? [], [sqrt, 0n, 0n, 0n, 0n, 0n, true])
				const call = decodeFunctionData({ abi: uniswapV3QuoterAbi, data })
				let amount = 2n * unit
				if (call.functionName !== 'quoteExactOutputSingle') amount = call.args[0].tokenIn === token ? (16059n * unit) / 10000n : (982n * unit) / 1000n
				return encodeAbiParameters(uniswapV3QuoterAbi[0].outputs, [amount, 0n, 0n, 0n])
			}),
		),
	})
	const quotes = await quoteVenue(client, config, { venue: 'uniswap-v3', address, token, fee: 100, spotTick: 0n, twapTick: 0n, liquidity: unit }, amounts, 10n)
	expect(quotes.replacement).toBe(amounts.replacementAttoWeth * 100n)
	expect(executableVenueQuotes(quotes)).toBeUndefined()
})
