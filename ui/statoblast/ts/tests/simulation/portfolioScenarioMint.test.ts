import { expect, test } from 'bun:test'
import { decodeFunctionData, parseAbi, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioReadClient } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { prepareSeededPortfolioMint } from '@zoltar/ui-statoblast-shared/simulation/portfolioScenarioMint.js'

const owner: Address = '0x0000000000000000000000000000000000000001'
const portfolio: Address = '0x0000000000000000000000000000000000000002'
const hash: Hex = `0x${'ab'.repeat(32)}`

test('portfolio simulation mints use each current quote, including native minimum backing fees above the old budget', async () => {
	const unit = 10n ** 18n
	const fees = [(3n * unit) / 10n, unit / 1000n]
	let quoteIndex = 0
	const client: PortfolioReadClient = {
		getBlock: async () => ({ number: 52n, hash, timestamp: 1_735_690_127n }),
		getChainId: async () => 1,
		getLogs: async () => [],
		readContract: async parameters => {
			expect(parameters.address).toBe(portfolio)
			expect(parameters.functionName).toBe('quoteMint')
			expect(parameters.args).toEqual([BigInt(quoteIndex + 1), unit])
			expect(parameters.blockNumber).toBe(52n)
			const fee = fees[quoteIndex++]
			if (fee === undefined) throw new Error('Unexpected quote')
			return [90n * unit, fee, 5000n * unit]
		},
	}
	for (const [index, fee] of fees.entries()) {
		const request = await prepareSeededPortfolioMint(client, owner, portfolio, BigInt(index + 1))
		expect(request.value).toBe(unit + fee)
		expect(decodeFunctionData({ abi: parseAbi(['function createCompleteSet(uint256 questionId,address recipient,uint256 minimumShares,uint256 mintAttoEth) payable']), data: request.data }).args).toEqual([BigInt(index + 1), owner, 0n, unit])
	}
	expect(quoteIndex).toBe(2)
})
