import { expect, spyOn, test } from 'bun:test'
import { createPublicClient, custom, decodeFunctionData, encodeAbiParameters, getAddress, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { erc20Abi, multicall3Abi, quoterAbi } from '#contracts/abi'
import { networkConfiguration } from '#config/network'
import { loadBalances } from '#execution/dispute-execution'
import { multicallProvider } from '../helpers/multicall-provider.ts'

const network = networkConfiguration('sepolia', {})
const wallet = { account: privateKeyToAccount(`0x${'11'.repeat(32)}`) }
const account = wallet.account.address
const healthyToken = getAddress('0x0000000000000000000000000000000000000001')
const revertingToken = getAddress('0x0000000000000000000000000000000000000002')

test('reads inventory in one batch, tolerates a reverting token, and values REP on the best fee tier', async () => {
	const logged = spyOn(console, 'error').mockImplementation(() => {})
	try {
		const blockTags: unknown[] = []
		let batches = 0
		const provider = multicallProvider(network.multicall3, ({ blockTag, data, to }) => {
			blockTags.push(blockTag)
			if (to.toLowerCase() === network.multicall3.toLowerCase()) {
				const decoded = decodeFunctionData({ abi: multicall3Abi, data })
				expect(decoded.args[0]).toBe(account)
				return encodeAbiParameters([{ type: 'uint256' }], [5n * 10n ** 18n])
			}
			if (to.toLowerCase() === network.quoter.toLowerCase()) {
				const decoded = decodeFunctionData({ abi: quoterAbi, data })
				if (decoded.functionName !== 'quoteExactInputSingle') throw new Error('Unexpected quote')
				const fee = Number(decoded.args[0].fee)
				if (fee === 3000) return encodeAbiParameters(quoterAbi[0].outputs, [3n * 10n ** 18n, 0n, 0n, 0n])
				if (fee === 500) return encodeAbiParameters(quoterAbi[0].outputs, [2n * 10n ** 18n, 0n, 0n, 0n])
				throw new Error('no pool for fee tier')
			}
			if (to.toLowerCase() === revertingToken.toLowerCase()) throw new Error('balanceOf reverted')
			const decoded = decodeFunctionData({ abi: erc20Abi, data })
			if (decoded.functionName !== 'balanceOf') throw new Error('Unexpected token read')
			if (to.toLowerCase() === network.weth.toLowerCase()) return encodeAbiParameters([{ type: 'uint256' }], [10n ** 18n])
			if (to.toLowerCase() === network.rep.toLowerCase()) return encodeAbiParameters([{ type: 'uint256' }], [100n * 10n ** 18n])
			return encodeAbiParameters([{ type: 'uint256' }], [42n])
		})
		const client = createPublicClient({
			chain: network.chain,
			transport: custom({
				request: parameters => {
					if (parameters.method === 'eth_call') batches += 1
					return provider.request(parameters)
				},
			}),
		})
		const balances = await loadBalances(client, wallet, { network }, [healthyToken, revertingToken], 100n)
		expect(balances?.raw).toEqual({ attoWeth: 10n ** 18n, ethAttoEth: 5n * 10n ** 18n, repAttoRep: 100n * 10n ** 18n, tokens: new Map([[healthyToken.toLowerCase(), 42n]]) })
		expect(balances?.snapshot).toEqual({ availableEth: '5', availableRep: '100', availableWeth: '1', repValueWeth: '3', totalValueWeth: '9' })
		// One batch for the five balances, one for the four REP valuation tiers.
		expect(batches).toBe(2)
		expect(blockTags).toHaveLength(9)
		expect(blockTags.every(blockTag => blockTag === '0x64')).toBeTrue()
		expect(logged).toHaveBeenCalledTimes(1)
		expect(String(logged.mock.calls[0]?.[0])).toContain(`token=${revertingToken} balanceUnavailable=`)
		expect(await loadBalances(client, undefined, { network }, [healthyToken])).toBeUndefined()
	} finally {
		logged.mockRestore()
	}
})
