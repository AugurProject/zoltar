import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { expect, test } from 'bun:test'
import { createPublicClient, custom, isHex, encodeAbiParameters, keccak256, stringToHex } from '@zoltar/core-shared/evm/ethereum'
import { loadBudgetMint, requireTokenMintFunding } from '../../protocol/minting.js'
import { feeAccountingRpcResult } from '../support/feeAccountingRpc.js'
import { smallReserveMarketFixture } from '../support/liveMarketFixture.js'

function mintClient(current: ReturnType<typeof smallReserveMarketFixture>, requiredRep = 0n, funding?: { balance: bigint; allowance: bigint; fee: bigint }) {
	return createPublicClient({
		transport: custom({
			async request({ method, params }) {
				if (method === 'eth_blockNumber') return '0x1'
				if (method === 'eth_getBlockByNumber') return { number: '0x1', hash: `0x${'01'.repeat(32)}`, timestamp: '0x1', transactions: [] }
				if (method !== 'eth_call' || !Array.isArray(params)) throw new Error(`Unexpected RPC ${method}`)
				const call: unknown = params[0]
				if (typeof call !== 'object' || call === null || !('data' in call) || typeof call.data !== 'string' || !isHex(call.data)) throw new Error('Missing call data')
				if (funding !== undefined) {
					const selector = (signature: string) => keccak256(stringToHex(signature)).slice(0, 10)
					if (call.data.startsWith(selector('purchaseQuote(uint248,uint256,uint256)'))) return encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [funding.fee, 0n])
					if (call.data.startsWith(selector('balanceOf(address)'))) return encodeAbiParameters([{ type: 'uint256' }], [funding.balance])
					if (call.data.startsWith(selector('allowance(address,address)'))) return encodeAbiParameters([{ type: 'uint256' }], [funding.allowance])
				}
				if (call.data.startsWith(keccak256(stringToHex('quoteMintRecoveryRep(uint248,uint256,uint256)')).slice(0, 10))) return encodeAbiParameters([{ type: 'uint256' }], [requiredRep])
				const result = feeAccountingRpcResult(`0x${call.data.slice(2)}`, current, 1n)
				if (result === undefined) throw new Error('Unexpected contract call')
				return result
			},
		}),
	})
}

test('cash-only mint submission rechecks recovery REP in the current central state', async () => {
	const cached = smallReserveMarketFixture({ settlementRecoveryAttoRep: 0n })
	const current = { ...cached, settlementRecoveryAttoRep: 1n }
	await expect(loadBudgetMint(mintClient(current), cached, 10n, 1n)).rejects.toThrow('New complete sets require recovery REP. Purchase complete sets from this market’s security pool in Statoblast.')
})

test('cash-only mint rejects a REP contribution even when the withdrawable REP snapshot rounds to zero', async () => {
	const market = smallReserveMarketFixture({ settlementRecoveryAttoRep: 0n })
	await expect(loadBudgetMint(mintClient(market, 1n), market, 10n, 1n)).rejects.toThrow('New complete sets require recovery REP. Purchase complete sets from this market’s security pool in Statoblast.')
})

test('final token funding uses actual spend and rechecks fee, balance and allowance (#1768)', async () => {
	const account = '0x0000000000000000000000000000000000000001'
	const market = smallReserveMarketFixture({ collateral: { token: account, symbol: 'USDC', decimals: 6, native: false } })
	const funding = { balance: 99n, allowance: 99n, fee: 9n }
	const client = mintClient(market, 0n, funding)
	const validate = () => requireTokenMintFunding(client, deploymentConfigurationFixture(), market, account, 90n, 100n)
	await expect(validate()).resolves.toBeUndefined()
	funding.allowance = 98n
	await expect(validate()).rejects.toThrow('approval')
	funding.allowance = 99n
	funding.balance = 98n
	await expect(validate()).rejects.toThrow('balance')
	funding.balance = 99n
	funding.fee = 11n
	await expect(validate()).rejects.toThrow('budget')
})
