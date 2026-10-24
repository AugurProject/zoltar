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
		readContract: async parameters => {
			expect(parameters.blockNumber).toBe(52n)
			switch (parameters.functionName) {
				case 'getPool':
					return owner
				case 'capitalLedger':
					return owner
				case 'isPriceValid':
					return true
				case 'availableMintCapacity':
					return 10n * unit
				case 'quoteQuestionMint':
					return unit
				case 'purchaseFee': {
					const fee = fees[quoteIndex++]
					if (fee === undefined) throw new Error('Unexpected quote')
					return fee
				}
				default:
					throw new Error(`Unexpected read ${parameters.functionName}`)
			}
		},
	}
	for (const [index, fee] of fees.entries()) {
		const request = await prepareSeededPortfolioMint(client, owner, portfolio, BigInt(index + 1))
		expect(request.value).toBe(unit + fee)
		expect(decodeFunctionData({ abi: parseAbi(['function createCompleteSet(uint248 universeId,uint256 questionId,uint256 mintAttoEth,address recipient,uint256 minimumShares) payable']), data: request.data }).args).toEqual([0n, BigInt(index + 1), unit, owner, 0n])
	}
	expect(quoteIndex).toBe(2)
})
