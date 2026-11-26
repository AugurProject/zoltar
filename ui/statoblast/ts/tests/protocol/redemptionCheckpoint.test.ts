import { expect, test } from 'bun:test'
import { loadCompleteSetRedemptionQuote } from '@zoltar/ui-statoblast-shared/protocol/trading.js'
import { createMockLoaderClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'

const pool = '0x1111111111111111111111111111111111111111'
test('#1633 redemption review includes its own checkpoint before quoting collateral and recovery', async () => {
	const client = createMockLoaderClient({
		getBlock: async () => ({ timestamp: 42n }),
		readContract: async () => 100n,
		multicall: async parameters => {
			expect(parameters.blockNumber).toBe(42n)
			expect(parameters.contracts.map(call => call.functionName)).toEqual(['refreshSecurityPoolFees', 'attoSharesToAttoEth', 'attoSharesToAttoRep'])
			return [undefined, 90n, 3n]
		},
	})
	expect(await loadCompleteSetRedemptionQuote(client, pool, 10n, 42n)).toEqual({ cash: 90n, rep: 3n })
})
