import { describe, expect, test } from 'bun:test'
import { assertOperationEthFunding, assertOperationPlanFresh, assertOperationPrincipalCaps, assertStepSafety, maximumFeePerGas, operationSubmissionLastValidBlock, unsignedQuantity } from '../../src/execution/safety.ts'
import type { OperationStep } from '../../src/operations/types.ts'

const step: OperationStep = {
	data: '0x',
	evidence: [{ kind: 'receipt-success' }],
	gasLimit: '200000',
	id: 'step',
	label: 'Safe call',
	preflightCalls: [],
	to: '0x0000000000000000000000000000000000000001',
	value: '10',
	walletAssetDebits: [{ amount: '10', asset: 'ETH', kind: 'native' }],
}

const strategy = {
	maximumEthPerOperationAttoEth: 20n,
	maximumGasCostAttoEth: 10n ** 18n,
	minimumEthReserveAttoEth: 100n,
}

describe('chaos execution safety gates', () => {
	test('accepts fresh unique workflows and rejects expired workflows', () => {
		const plan = { createdAtBlock: '10', id: 'test', steps: [step] }
		expect(() => assertOperationPlanFresh(plan, 15n, 5n)).not.toThrow()
		expect(() => assertOperationPlanFresh(plan, 16n, 5n)).toThrow('expired before execution')
	})

	test('counts only the remaining continuation segment against the prerequisite horizon', () => {
		const plan = {
			createdAtBlock: '10',
			id: 'two-approval-cleanup',
			steps: [
				{ ...step, id: 'approve-weth' },
				{ ...step, id: 'approve-rep' },
				{ ...step, id: 'revoke-weth' },
				{ ...step, id: 'revoke-rep' },
			],
		}

		expect(() => assertOperationPlanFresh(plan, 15n, 75n, new Set(['approve-weth', 'approve-rep']))).not.toThrow()
	})

	test('enforces block and timestamp deadlines through private next-block submission', () => {
		expect(operationSubmissionLastValidBlock({ id: 'block-clock', lastValidBlockNumber: '102' }, 100n, 1_000n, 'private', 15)).toBe(102n)
		expect(() => operationSubmissionLastValidBlock({ id: 'expired', lastValidBlockNumber: '100' }, 100n, 1_000n, 'private', 15)).toThrow('block deadline expired')
		expect(operationSubmissionLastValidBlock({ deadlineTimestamp: '1200', id: 'timestamp-clock' }, 100n, 1_000n, 'private', 15)).toBe(101n)
		expect(() => operationSubmissionLastValidBlock({ deadlineTimestamp: '1060', id: 'near-expiry' }, 100n, 1_000n, 'private', 15)).toThrow('timestamp deadline is too close')
		expect(() => operationSubmissionLastValidBlock({ deadlineTimestamp: '1080', id: 'slow-chain-near-expiry' }, 100n, 1_000n, 'private', 90)).toThrow('timestamp deadline is too close')
		expect(() => operationSubmissionLastValidBlock({ deadlineTimestamp: '2000', id: 'public-deadline' }, 100n, 1_000n, 'public', 15)).toThrow('requires private submission')
	})

	test('accounts for padded EIP-1559 gas and the post-operation ETH reserve', () => {
		const baseFee = 1_000_000_000n
		const result = assertStepSafety({
			baseFeePerGas: baseFee,
			ethBalanceAttoEth: 10n ** 18n,
			gasEstimate: 100_000n,
			step,
			strategy,
		})
		expect(result.paddedGas).toBe(130_000n)
		expect(result.maximumGasCost).toBe(130_000n * maximumFeePerGas(baseFee))
		expect(() =>
			assertStepSafety({
				baseFeePerGas: baseFee,
				ethBalanceAttoEth: result.maximumGasCost + 109n,
				gasEstimate: 100_000n,
				step,
				strategy,
			}),
		).toThrow('breach the wallet ETH reserve')
	})

	test('reserves every remaining step maximum gas cost before a workflow starts', () => {
		const { value: _value, ...approval } = step
		const plan = {
			id: 'approval-and-action',
			steps: [
				{ ...approval, id: 'approval', walletAssetDebits: [] },
				{ ...step, id: 'action' },
			],
		}
		const fundingStrategy = { maximumGasCostAttoEth: 50n, minimumEthReserveAttoEth: 100n }
		expect(assertOperationEthFunding(plan, 210n, fundingStrategy)).toEqual({ maximumGasCost: 100n, requiredBalance: 210n, transactionValue: 10n })
		expect(() => assertOperationEthFunding(plan, 209n, fundingStrategy)).toThrow('cannot fund all remaining workflow steps')
	})

	test('adds worst-case post-failure cleanup transactions to the workflow gas reserve', () => {
		const { value: _value, ...approval } = step
		const plan = {
			id: 'approval-action-and-cleanup',
			maximumCleanupTransactionCount: 1,
			steps: [
				{ ...approval, id: 'approval', walletAssetDebits: [] },
				{ ...step, id: 'action' },
			],
		}
		const fundingStrategy = { maximumGasCostAttoEth: 50n, minimumEthReserveAttoEth: 100n }
		expect(assertOperationEthFunding(plan, 260n, fundingStrategy)).toEqual({ maximumGasCost: 150n, requiredBalance: 260n, transactionValue: 10n })
		expect(() => assertOperationEthFunding(plan, 259n, fundingStrategy)).toThrow('cannot fund all remaining workflow steps')
		expect(() => assertOperationEthFunding({ ...plan, maximumCleanupTransactionCount: -1 }, 1_000n, fundingStrategy)).toThrow('cleanup transaction count')
	})

	test('rejects unsafe plan caps and malformed quantities', () => {
		expect(() => assertStepSafety({ baseFeePerGas: 1n, ethBalanceAttoEth: 10n ** 18n, gasEstimate: 100_000n, step: { ...step, gasLimit: '129999' }, strategy })).toThrow('gas estimate')
		expect(() => assertStepSafety({ baseFeePerGas: 1n, ethBalanceAttoEth: 10n ** 18n, gasEstimate: 100_000n, step: { ...step, value: '21' }, strategy })).toThrow('maximumEthPerOperation')
		expect(() => unsignedQuantity('-1', 'value')).toThrow('unsigned integer')
	})

	test('enforces principal caps across every step and binds native debits to value', () => {
		const token = '0x0000000000000000000000000000000000000002' as const
		const plan = {
			id: 'multi-step',
			steps: [
				step,
				{
					...step,
					id: 'second',
					value: '11',
					walletAssetDebits: [
						{ amount: '11', asset: 'ETH' as const, kind: 'native' as const },
						{ amount: '6', asset: token, category: 'rep' as const, kind: 'erc20' as const },
					],
				},
			],
		}
		expect(() =>
			assertOperationPrincipalCaps(plan, {
				maximumEthPerOperationAttoEth: 20n,
				maximumRepPerOperationAttoRep: 10n,
			}),
		).toThrow('maximumEthPerOperation')
		expect(() =>
			assertOperationPrincipalCaps(
				{ ...plan, steps: [{ ...step, walletAssetDebits: [] }] },
				{
					maximumEthPerOperationAttoEth: 20n,
					maximumRepPerOperationAttoRep: 10n,
				},
			),
		).toThrow('does not match its transaction value')
	})

	test('counts external and OpenOracle-credit WETH/REP principal against cumulative caps', () => {
		const token = '0x0000000000000000000000000000000000000002' as const
		const oracle = '0x0000000000000000000000000000000000000003' as const
		const { value: _transactionValue, ...stepWithoutValue } = step
		const cappedStep = {
			...stepWithoutValue,
			walletAssetDebits: [
				{ amount: '6', asset: token, category: 'weth' as const, kind: 'erc20' as const },
				{ amount: '5', asset: token, category: 'weth' as const, kind: 'open-oracle-credit' as const, openOracle: oracle },
			],
		}
		expect(() => assertOperationPrincipalCaps({ id: 'weth-credit', steps: [cappedStep] }, { maximumEthPerOperationAttoEth: 10n, maximumRepPerOperationAttoRep: 100n })).toThrow('maximumEthPerOperation')

		const repStep = {
			...cappedStep,
			walletAssetDebits: cappedStep.walletAssetDebits.map(debit => ({ ...debit, category: 'rep' as const })),
		}
		expect(() => assertOperationPrincipalCaps({ id: 'rep-credit', steps: [repStep] }, { maximumEthPerOperationAttoEth: 100n, maximumRepPerOperationAttoRep: 10n })).toThrow('maximumRepPerOperation')

		const vaultRepStep = {
			...stepWithoutValue,
			walletAssetDebits: [{ amount: '11', category: 'rep' as const, kind: 'security-pool-vault-rep' as const, pool: oracle, vault: token }],
		}
		expect(() => assertOperationPrincipalCaps({ id: 'vault-rep', steps: [vaultRepStep] }, { maximumEthPerOperationAttoEth: 100n, maximumRepPerOperationAttoRep: 10n })).toThrow('maximumRepPerOperation')
	})

	test('applies cumulative principal caps independently to each workflow', () => {
		const cappedStep = {
			...step,
			value: '15',
			walletAssetDebits: [{ amount: '15', asset: 'ETH' as const, kind: 'native' as const }],
		}
		const limits = { maximumEthPerOperationAttoEth: 20n, maximumRepPerOperationAttoRep: 20n }
		expect(assertOperationPrincipalCaps({ id: 'first-workflow', steps: [cappedStep] }, limits)).toEqual({ nativeDebit: 15n, repDebit: 0n })
		expect(assertOperationPrincipalCaps({ id: 'later-workflow', steps: [cappedStep] }, limits)).toEqual({ nativeDebit: 15n, repDebit: 0n })
		expect(() => assertOperationPrincipalCaps({ id: 'single-combined-workflow', steps: [cappedStep, { ...cappedStep, id: 'second' }] }, limits)).toThrow('maximumEthPerOperation')
	})
})
