import { expect, test } from 'bun:test'
import { createPublicClient, custom, isHex, encodeAbiParameters, keccak256, stringToHex } from '@zoltar/core-shared/evm/ethereum'
import { loadBudgetMint } from '../../protocol/minting.js'
import { feeAccountingRpcResult } from '../support/feeAccountingRpc.js'
import { smallReserveMarketFixture } from '../support/liveMarketFixture.js'

function mintClient(current: ReturnType<typeof smallReserveMarketFixture>, requiredRep = 0n) {
	return createPublicClient({
		transport: custom({
			async request({ method, params }) {
				if (method !== 'eth_call' || !Array.isArray(params)) throw new Error(`Unexpected RPC ${method}`)
				const call: unknown = params[0]
				if (typeof call !== 'object' || call === null || !('data' in call) || !isHex(call.data)) throw new Error('Missing call data')
				if (call.data.startsWith(keccak256(stringToHex('quoteMintRecoveryRep(uint248,uint256,uint256)')).slice(0, 10))) return encodeAbiParameters([{ type: 'uint256' }], [requiredRep])
				const result = feeAccountingRpcResult(call.data, current, 1n)
				if (result === undefined) throw new Error('Unexpected contract call')
				return result
			},
		}),
	})
}

test('cash-only mint submission rechecks recovery REP in the current central state', async () => {
	const cached = smallReserveMarketFixture({ settlementRecoveryAttoRep: 0n })
	const current = { ...cached, settlementRecoveryAttoRep: 1n }
	await expect(loadBudgetMint(mintClient(current), cached, 10n, 1n)).rejects.toThrow('New complete sets require recovery REP. Use portfolio purchases.')
})

test('cash-only mint rejects a REP contribution even when the withdrawable REP snapshot rounds to zero', async () => {
	const market = smallReserveMarketFixture({ settlementRecoveryAttoRep: 0n })
	await expect(loadBudgetMint(mintClient(market, 1n), market, 10n, 1n)).rejects.toThrow('New complete sets require recovery REP. Use portfolio purchases.')
})
