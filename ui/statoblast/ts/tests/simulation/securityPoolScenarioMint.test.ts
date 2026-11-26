import { expect, test } from 'bun:test'
import { createPublicClient, custom, encodeAbiParameters, decodeFunctionData, parseAbi, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { SecurityPoolReadClient } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { prepareSeededSecurityPoolMint } from '@zoltar/ui-statoblast-shared/simulation/securityPoolScenarioMint.js'

const owner: Address = '0x0000000000000000000000000000000000000001'
const securityPool: Address = '0x0000000000000000000000000000000000000002'
const hash: Hex = `0x${'ab'.repeat(32)}`

test('security pool simulation mints use each funded purchase quote, including fees above the old budget', async () => {
	const unit = 10n ** 18n
	const fees = [(3n * unit) / 10n, unit / 1000n]
	let quoteIndex = 0
	const client = {
		multicall: createPublicClient({
			transport: custom({
				request: async () =>
					encodeAbiParameters(
						[{ type: 'tuple[]', components: [{ type: 'bool' }, { type: 'bytes' }] }],
						[
							[
								[true, '0x'],
								[true, encodeAbiParameters([{ type: 'uint256' }], [unit])],
							],
						],
					),
			}),
		}).multicall,
		getBlock: async () => ({ number: 52n, hash, timestamp: 1_735_690_127n }),
		getChainId: async () => 1,
		readContract: async (parameters: Parameters<SecurityPoolReadClient['readContract']>[0]) => {
			expect(parameters.blockNumber).toBe(52n)
			switch (parameters.functionName) {
				case 'questionOriginIds':
					return hash
				case 'getQuestionLedger':
					return owner
				case 'capitalLedger':
					return owner
				case 'isPriceValid':
					return true
				case 'availableMintCapacity':
					return 10n * unit
				case 'quoteQuestionMint':
					return unit
				case 'quoteMintRecoveryRep':
					return 0n
				case 'purchaseQuote': {
					expect(parameters.args).toEqual([0n, BigInt(quoteIndex + 1), unit])
					const fee = fees[quoteIndex++]
					if (fee === undefined) throw new Error('Unexpected quote')
					return [fee, fee / 2n]
				}
				default:
					throw new Error(`Unexpected read ${parameters.functionName}`)
			}
		},
	}
	for (const [index, fee] of fees.entries()) {
		const request = await prepareSeededSecurityPoolMint(client, owner, securityPool, BigInt(index + 1))
		expect(request.value).toBe(0n)
		expect(decodeFunctionData({ abi: parseAbi(['function createCompleteSet(uint248 universeId,uint256 questionId,uint256 mintAttoEth,address recipient,uint256 minimumShares,uint256 maximumPurchaseFeeAttoEth)']), data: request.data }).args).toEqual([0n, BigInt(index + 1), unit, owner, 0n, fee])
	}
	expect(quoteIndex).toBe(2)
})
