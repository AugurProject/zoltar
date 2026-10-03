import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { previewVaultOperations } from '@zoltar/ui-statoblast-shared/features/vault-operations/lib/preview.js'
import { emptyVaultOperationsDraft, parseVaultOperationsDraft, getVaultOperationsPrice } from '@zoltar/ui-statoblast-shared/features/vault-operations/lib/draft.js'
import { createSelectedPool, createSecurityVaultDetails, createSecurityPoolVaultSummary } from '../security-pools/workflow/builders.js'

const unit = 10n ** 18n
const owner = getAddress('0x0000000000000000000000000000000000000001')
const targetAddress = getAddress('0x0000000000000000000000000000000000000002')
const owned = createSecurityVaultDetails({ vaultAddress: owner, vaultAttoRepBacking: 1000n * unit, underwritingLimitAttoEth: 0n })
const target = createSecurityPoolVaultSummary({ vaultAddress: targetAddress, vaultAttoRepBacking: 190n * unit, underwritingLimitAttoEth: 100n * unit, disputeStakedAttoRep: 0n })
const pool = createSelectedPool({ statoblastSecurityMultiplierBps: 20_000n, totalUnderwritingLimitAttoEth: 100n * unit, settlementCollateralAttoEth: 0n })
const input = parseVaultOperationsDraft({ ...emptyVaultOperationsDraft(), liquidations: [{ address: targetAddress, amount: '100' }], withdraw: '10' }, owner)

describe('vault bundle preview guards', () => {
	test('rejects a target inside the coordinator minimum price distance', () => {
		expect(() => previewVaultOperations(pool, owned, [target], input, unit, 1000n)).toThrow('10%')
	})
	test('rejects a target without backing even if it retains commitment', () => {
		expect(() => previewVaultOperations(pool, owned, [{ ...target, vaultAttoRepBacking: 0n }], input, unit, 0n)).toThrow('backing')
	})
	test('previews liquidation followed by withdrawal for a sufficiently distant target', () => {
		const preview = previewVaultOperations(pool, owned, [{ ...target, vaultAttoRepBacking: 100n * unit }], input, unit, 1000n)
		expect(preview.commitment).toBe(100n * unit)
		expect(preview.backing).toBeGreaterThan(owned.vaultAttoRepBacking - 10n * unit)
	})
	test('rejects an increased commitment without sufficient backing', () => {
		const receiver = { ...owned, vaultAttoRepBacking: 100n * unit, underwritingLimitAttoEth: 50n * unit }
		const changing = parseVaultOperationsDraft({ ...emptyVaultOperationsDraft(), commitment: '100' }, owner)
		expect(() => previewVaultOperations(pool, receiver, [], changing, unit)).toThrow('Deposit more REP')
	})
	test('rejects reductions below outstanding settlement collateral', () => {
		const changing = parseVaultOperationsDraft({ ...emptyVaultOperationsDraft(), commitment: '0' }, owner)
		expect(() => previewVaultOperations({ ...pool, settlementCollateralAttoEth: 100n * unit }, { ...owned, underwritingLimitAttoEth: 50n * unit }, [], changing, unit)).toThrow('Total commitments')
	})
	test('rejects withdrawals of backing required by the final commitment', () => {
		const receiver = { ...owned, vaultAttoRepBacking: 100n * unit, underwritingLimitAttoEth: 50n * unit, minimumVaultRepDepositAttoRep: unit }
		const withdrawing = parseVaultOperationsDraft({ ...emptyVaultOperationsDraft(), withdraw: '1' }, owner)
		expect(() => previewVaultOperations(pool, receiver, [], withdrawing, unit)).toThrow('withdrawal')
	})
	test('rejects withdrawals while escalation deposits remain unsettled', () => {
		const withdrawing = parseVaultOperationsDraft({ ...emptyVaultOperationsDraft(), withdraw: '1' }, owner)
		expect(() => previewVaultOperations(pool, { ...owned, disputeStakedAttoRep: unit }, [], withdrawing, unit)).toThrow('Settle escalation')
	})
	test('uses a field label rather than an instruction for malformed proposed prices', () => {
		expect(() => getVaultOperationsPrice('invalid', unit, false)).toThrow('Initial oracle report price must be a decimal number')
	})
})
