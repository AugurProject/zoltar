import { expect, test } from 'bun:test'
import { createPublicClient, custom, encodeAbiParameters, isHex, keccak256, stringToHex } from '@zoltar/core-shared/evm/ethereum'
import { loadCentralSecurityPoolQuestion } from '@zoltar/ui-statoblast-shared/protocol/securityPoolState.js'
import { feeAccountingRpcResult } from '../support/feeAccountingRpc.js'
import { liveMarketFixture } from '../support/liveMarketFixture.js'

test('#1764 question mint capacity respects its authoritative local gate', async () => {
	const market = { ...liveMarketFixture(), settlementCollateralAttoEth: 10n, availableMintingCapacityAttoEth: 90n, endTime: 100n }
	const client = createPublicClient({
		transport: custom({
			request: async ({ method, params }) => {
				if (method !== 'eth_call' || !Array.isArray(params)) throw new Error(`Unexpected RPC ${method}`)
				const call = params[0]
				if (typeof call !== 'object' || call === null || !('data' in call) || !isHex(call.data)) throw new Error('Invalid call')
				if (call.data.slice(0, 10) === keccak256(stringToHex('additionalMintCapacityAttoEth()')).slice(0, 10)) return encodeAbiParameters([{ type: 'uint256' }], [0n])
				const response = feeAccountingRpcResult(call.data, market, market.endTime + 1n, undefined, undefined, 0n)
				if (response === undefined) throw new Error(`Unexpected call ${call.data}`)
				return response
			},
		}),
	})
	const snapshot = await loadCentralSecurityPoolQuestion(client, market.pool, market.pool, 1n)
	expect(snapshot.mintingCapacityAttoEth).toBe(10n)
})
