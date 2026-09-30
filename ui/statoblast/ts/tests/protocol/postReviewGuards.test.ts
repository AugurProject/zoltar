import { afterEach, expect, mock, test } from 'bun:test'
import { createWalletClient, custom, publicActions, getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { createBlockWithTimestamp, createReadContractStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { registerTransactionPreparationScope } from '@zoltar/ui-core-shared/transactions/transactionReviewScope.js'
import { transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { createReviewedClient } from '@zoltar/ui-statoblast-shared/protocol/reviewedClient.js'
import { createCompleteSetInSecurityPool } from '@zoltar/ui-statoblast-shared/protocol/trading.js'
import { submitTruthAuctionBid } from '@zoltar/ui-statoblast-shared/protocol/truthAuctionActions.js'
import { reportOutcomeInSecurityPool } from '@zoltar/ui-statoblast-shared/protocol/reporting.js'

const address = getAddress('0x0000000000000000000000000000000000000001')
const hash = `0x${'1'.repeat(64)}` as const

afterEach(() => transactionSteps.value?.cancel())

for (const change of [
	'mint expiry',
	'mint escalation',
	'auction expiry',
	'auction finalized',
	'report expiry',
	'report continuation',
	'mint capacity',
	'mint remaining capacity',
	'mint balance',
	'auction balance',
	'report balance',
	'report allowance',
	'report pool inactive',
	'report amount',
	'report vault backing',
	'mint unchanged',
	'auction unchanged',
	'report unchanged',
] as const) {
	test(`blocks ${change} after the actual application review`, async () => {
		let changed = false
		const scope = new AbortController()
		const unregister = registerTransactionPreparationScope(scope.signal)
		const sendTransaction = mock(async () => hash)
		const wallet = createWalletClient({
			account: address,
			chain: MAINNET_NETWORK_PROFILE.chain,
			transport: custom({
				request: async () => {
					throw new Error('Unexpected RPC')
				},
			}),
		}).extend(publicActions)
		const reviewed = createReviewedClient(
			{
				...wallet,
				sendTransaction,
				waitForTransactionReceipt: async () => ({ blockHash: hash, blockNumber: 1n, cumulativeGasUsed: 21000n, from: address, gasUsed: 21000n, logs: [], status: 'success', transactionHash: hash, transactionIndex: 0n }),
				readContract: createReadContractStub(request => {
					switch (request.functionName) {
						case 'universeId':
							return 1n
						case 'escalationGame':
							return change.startsWith('report') || (changed && change === 'mint escalation') ? address : zeroAddress
						case 'priceOracleManagerAndOperatorQueuer':
							return address
						case 'lastSettlementTimestamp':
							return 1n
						case 'auctionStarted':
							return 1n
						case 'finalized':
							return changed && change === 'auction finalized'
						case 'forkContinuation':
							return changed && change === 'report continuation'
						case 'getEscalationGameEndDate':
							return 1000n
						case 'repToken':
							return address
						case 'systemState':
							return changed && change === 'report pool inactive' ? 1 : 0
						case 'previewDepositOnOutcome':
							return [changed && change === 'report amount' ? 0n : 1n, 10n]
						case 'securityVaults':
							return [1n, 0n, 0n, 0n]
						case 'backingUnitsToAttoRep':
							return changed && change === 'report vault backing' ? 0n : 1000n
						case 'getCurrentMintingCapacityAttoEth':
							return changed && change === 'mint capacity' ? 0n : 1000n
						case 'balanceOf':
							return changed && change === 'report balance' ? 0n : 1000n
						case 'allowance':
							return changed && change === 'report allowance' ? 0n : 1000n
						default:
							throw new Error(`Unexpected read ${request.functionName}`)
					}
				}),
				estimateGas: async () => {
					if (changed && change === 'mint remaining capacity') throw new Error('Over capacity')
					return 100000n
				},
				getBalance: async () => (changed && change.endsWith('balance') ? 0n : 1000n),
				getBlock: async () => {
					if (!changed) return createBlockWithTimestamp(1n)
					if (change === 'mint expiry') return createBlockWithTimestamp(3541n)
					if (change === 'auction expiry') return createBlockWithTimestamp(604_741n)
					if (change === 'report expiry') return createBlockWithTimestamp(941n)
					return createBlockWithTimestamp(1n)
				},
			},
			undefined,
			scope.signal,
		)
		try {
			const execute = () => {
				if (change.startsWith('mint')) return createCompleteSetInSecurityPool(reviewed, address, 1n)
				if (change.startsWith('auction')) return submitTruthAuctionBid(reviewed, address, 1n, address, 1n, 1n)
				return reportOutcomeInSecurityPool(reviewed, address, 'yes', 1n, 1n, change === 'report vault backing' ? 'vault' : 'wallet')
			}
			const action = execute().catch(error => error)
			for (let attempt = 0; attempt < 100 && transactionSteps.value?.steps.at(-1)?.phase !== 'review'; attempt += 1) await new Promise(resolve => setTimeout(resolve, 1))
			expect(transactionSteps.value?.steps.at(-1)?.phase).toBe('review')
			changed = true
			transactionSteps.value?.confirm()
			const result = await action
			if (change.endsWith('unchanged')) {
				expect(result).toHaveProperty('hash', hash)
				expect(sendTransaction).toHaveBeenCalledTimes(1)
			} else {
				expect(result).toBeInstanceOf(Error)
				expect(sendTransaction).not.toHaveBeenCalled()
			}
		} finally {
			scope.abort()
			unregister()
		}
	})
}
