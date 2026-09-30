import { expect, test } from 'bun:test'
import { createWalletClient, custom, publicActions, getAddress, zeroAddress, zeroHash } from '@zoltar/core-shared/evm/ethereum'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { createBlockWithTimestamp, createReadContractStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { registerTransactionPreparationScope } from '@zoltar/ui-core-shared/transactions/transactionReviewScope.js'
import { transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { createReviewedClient } from '@zoltar/ui-statoblast-shared/protocol/reviewedClient.js'
import { executeOracleManagerStagedOperation } from '@zoltar/ui-statoblast-shared/protocol/oracleCoordinator.js'

const address = getAddress('0x0000000000000000000000000000000000000001')
const hash = `0x${'1'.repeat(64)}` as const

for (const change of ['expired', 'unavailable', 'price invalid', 'snapshot changed', 'withdraw empty', 'unchanged'] as const) {
	test(`rechecks staged operation ${change} after application review`, async () => {
		let changed = false
		let submitted = 0
		const wallet = createWalletClient({
			account: address,
			chain: MAINNET_NETWORK_PROFILE.chain,
			transport: custom({
				request: async () => {
					throw new Error('Unexpected RPC')
				},
			}),
		}).extend(publicActions)
		const scope = new AbortController()
		const unregister = registerTransactionPreparationScope(scope.signal)
		const reviewed = createReviewedClient(
			{
				...wallet,
				sendTransaction: async () => {
					submitted += 1
					return hash
				},
				waitForTransactionReceipt: async () => ({ blockHash: hash, blockNumber: 1n, cumulativeGasUsed: 21000n, from: address, gasUsed: 21000n, logs: [], status: 'success', transactionHash: hash, transactionIndex: 0n }),
				getBlock: async () => createBlockWithTimestamp(changed && change === 'expired' ? 202n : 1n),
				readContract: createReadContractStub(request => {
					switch (request.functionName) {
						case 'stagedOperations':
							return {
								operation: change === 'withdraw empty' ? 1n : 0n,
								operator: changed && change === 'unavailable' ? zeroAddress : address,
								receiverVault: address,
								targetVault: address,
								operationValue: 1n,
								queuedAt: 1n,
								validForSeconds: 100n,
								snapshotTargetBackingUnits: 100n,
								snapshotTargetUnderwritingLimitAttoEth: 100n,
								liquidationApprovalId: zeroHash,
								reservedLiquidationDebtAttoEth: 0n,
							}
						case 'settlementTime':
							return 100n
						case 'isPriceValid':
							return !(changed && change === 'price invalid')
						case 'lastSettlementTimestamp':
							return 1n
						case 'securityPool':
							return address
						case 'securityVaults':
							if (changed && change === 'snapshot changed') return [101n, 100n, 0n, 0n]
							if (changed && change === 'withdraw empty') return [0n, 100n, 0n, 0n]
							return [100n, 100n, 0n, 0n]
						case 'attoRepToBackingUnits':
							return 1n
						case 'minimumVaultRepDepositAttoRep':
							return 1n
						case 'backingUnitsToAttoRep':
							return request.args?.[0]
						default:
							throw new Error(`Unexpected read ${request.functionName}`)
					}
				}),
			},
			undefined,
			scope.signal,
		)
		try {
			const action = executeOracleManagerStagedOperation(reviewed, address, 1n).catch(error => error)
			for (let attempt = 0; attempt < 100 && transactionSteps.value?.steps.at(-1)?.phase !== 'review'; attempt += 1) await new Promise(resolve => setTimeout(resolve, 1))
			expect(transactionSteps.value?.steps.at(-1)?.phase).toBe('review')
			changed = true
			transactionSteps.value?.confirm()
			const result = await action
			if (change === 'unchanged') {
				expect(result).toHaveProperty('hash', hash)
				expect(submitted).toBe(1)
			} else {
				expect(result).toBeInstanceOf(Error)
				expect(submitted).toBe(0)
			}
		} finally {
			scope.abort()
			unregister()
			transactionSteps.value?.cancel()
		}
	})
}
