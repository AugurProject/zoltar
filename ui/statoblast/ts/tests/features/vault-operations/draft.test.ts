import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { emptyVaultOperationsDraft, parseVaultOperationsDraft, getVaultOperationsPrice } from '@zoltar/ui-statoblast-shared/features/vault-operations/lib/draft.js'

import { getMaxLiquidationAmount } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/liquidation.js'
import { validateVaultOperations } from '@zoltar/statoblast-shared/statoblast/vaultOperations'

const owner = getAddress('0x0000000000000000000000000000000000000001')
const target = '0x0000000000000000000000000000000000000002'

describe('pool vault operation draft', () => {
	test('requires receiver health protection only for liquidation bundles', () => {
		const deposit = { ...parseVaultOperationsDraft({ ...emptyVaultOperationsDraft(), deposit: '5' }, owner), minimumReceiverHealthFactorBps: 0n }
		expect(() => validateVaultOperations(deposit, owner)).not.toThrow()
		expect(() => validateVaultOperations({ ...deposit, liquidations: [{ targetVault: getAddress(target), requestedDebtAttoEth: 1n }] }, owner)).toThrow('Receiver health factor')
	})
	test('accepts a configurable queue expiry and rejects values outside 1–5 minutes', () => {
		const draft = { ...emptyVaultOperationsDraft(), deposit: '5', timeoutMinutes: '2' }
		expect(parseVaultOperationsDraft(draft, owner).validForSeconds).toBe(120n)
		expect(() => parseVaultOperationsDraft({ ...draft, timeoutMinutes: '0' }, owner)).toThrow('1–5 whole minutes')
		expect(() => parseVaultOperationsDraft({ ...draft, timeoutMinutes: '6' }, owner)).toThrow('1–5 whole minutes')
	})
	test('blank commitment preserves it, while zero explicitly clears it', () => {
		const draft = { ...emptyVaultOperationsDraft(), deposit: '12.5' }
		expect(parseVaultOperationsDraft(draft, owner).changeCommitment).toBe(false)
		const clearing = parseVaultOperationsDraft({ ...draft, commitment: '0', withdraw: '2' }, owner)
		expect(clearing.changeCommitment).toBe(true)
		expect(clearing.commitmentAttoEth).toBe(0n)
		expect(clearing.depositAttoRep).toBe(12_500_000_000_000_000_000n)
		expect(clearing.withdrawAttoRep).toBe(2n * 10n ** 18n)
	})

	test('rejects self targets and duplicates instead of producing a transaction', () => {
		expect(() => parseVaultOperationsDraft({ ...emptyVaultOperationsDraft(), liquidations: [{ address: owner, amount: '1' }] }, owner)).toThrow('another vault')
		expect(() =>
			parseVaultOperationsDraft(
				{
					...emptyVaultOperationsDraft(),
					liquidations: [
						{ address: target, amount: '1' },
						{ address: target, amount: '2' },
					],
				},
				owner,
			),
		).toThrow('once')
	})

	test('enforces four price actions while deposits use no slot', () => {
		const liquidations = [2, 3, 4, 5].map(id => ({ address: `0x${id.toString(16).padStart(40, '0')}`, amount: '1' }))
		expect(parseVaultOperationsDraft({ ...emptyVaultOperationsDraft(), deposit: '5', liquidations }, owner).liquidations).toHaveLength(4)
		expect(() => parseVaultOperationsDraft({ ...emptyVaultOperationsDraft(), deposit: '5', commitment: '1', liquidations }, owner)).toThrow('at most four')
	})
})

describe('vault operation execution price refresh', () => {
	test('uses the settled price after a stale proposal becomes irrelevant', () => {
		const settled = 3n * 10n ** 18n
		expect(getVaultOperationsPrice('500', settled, false)).toBe(500n * 10n ** 18n)
		const executionPrice = getVaultOperationsPrice('500', settled, true)
		expect(executionPrice).toBe(settled)
		const targetVaultSummary = { vaultAddress: getAddress(target), vaultAttoRepBacking: 10_000n * 10n ** 18n, underwritingLimitAttoEth: 40n * 10n ** 18n, disputeStakedAttoRep: 0n, claimableFeesAttoEth: 0n }
		expect(getMaxLiquidationAmount({ targetVaultSummary, statoblastSecurityMultiplierBps: 10_000n, repPerEthPrice: getVaultOperationsPrice('500', settled, false) })).toBeGreaterThan(0n)
		expect(getMaxLiquidationAmount({ targetVaultSummary, statoblastSecurityMultiplierBps: 10_000n, repPerEthPrice: executionPrice })).toBe(0n)
	})

	test('ignores an invalid hidden proposal after the cache becomes fresh', () => {
		const settled = 3n * 10n ** 18n
		expect(() => getVaultOperationsPrice('invalid', settled, false)).toThrow()
		expect(getVaultOperationsPrice('invalid', settled, true)).toBe(settled)
	})
})
