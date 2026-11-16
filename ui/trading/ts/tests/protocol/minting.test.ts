import { expect, test } from 'bun:test'
import { createPublicClient, custom, isHex } from '@zoltar/core-shared/evm/ethereum'
import { loadBudgetMint } from '../../protocol/minting.js'
import { feeAccountingRpcResult } from '../support/feeAccountingRpc.js'
import { smallReserveMarketFixture } from '../support/liveMarketFixture.js'

test('cash-only mint submission rechecks recovery REP in the current central state', async () => {
 const cached = smallReserveMarketFixture({ settlementRecoveryAttoRep: 0n })
 const current = { ...cached, settlementRecoveryAttoRep: 1n }
 const client = createPublicClient({ transport: custom({ async request({method,params}) {
  if (method !== 'eth_call' || !Array.isArray(params)) throw new Error(`Unexpected RPC ${method}`)
  const call: unknown = params[0]
  if (typeof call !== 'object' || call === null || !('data' in call) || !isHex(call.data)) throw new Error('Missing call data')
  const result = feeAccountingRpcResult(call.data, current, 1n)
  if (result === undefined) throw new Error('Unexpected contract call')
  return result
 } }) })
 await expect(loadBudgetMint(client,cached,10n,1n)).rejects.toThrow('New complete sets require recovery REP. Use portfolio purchases.')
})
