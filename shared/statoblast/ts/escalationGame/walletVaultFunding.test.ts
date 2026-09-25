import { describe, expect, test } from 'bun:test'
import { getWalletVaultFundingQuote } from './walletVaultFunding.js'

describe('wallet-funded vault reporting', () => {
	test('funds both a below-minimum report and the required remaining backing', () => {
		expect(getWalletVaultFundingQuote({ minimumVaultRepDepositAttoRep: 10n, vaultRepBackingUnits: 0n, totalRepBackingUnits: 0n, totalPoolHeldRepAttoRep: 0n }, 5n)).toEqual({ depositAmount: 15n, remainingVaultRepAttoRep: 10n })
	})
	test('allows an exact deposit to leave a truly empty vault', () => {
		expect(getWalletVaultFundingQuote({ minimumVaultRepDepositAttoRep: 10n, vaultRepBackingUnits: 0n, totalRepBackingUnits: 0n, totalPoolHeldRepAttoRep: 0n }, 10n)).toEqual({ depositAmount: 10n, remainingVaultRepAttoRep: 0n })
	})
	test('preserves existing minimum backing without requiring another minimum deposit', () => {
		expect(getWalletVaultFundingQuote({ minimumVaultRepDepositAttoRep: 10n, vaultRepBackingUnits: 10n, totalRepBackingUnits: 100n, totalPoolHeldRepAttoRep: 100n }, 5n)).toEqual({ depositAmount: 5n, remainingVaultRepAttoRep: 10n })
	})
	test('accounts for rounded mint and escrow while preserving minimum backing', () => {
		expect(getWalletVaultFundingQuote({ minimumVaultRepDepositAttoRep: 2n, vaultRepBackingUnits: 0n, totalRepBackingUnits: 2n, totalPoolHeldRepAttoRep: 3n }, 1n)).toEqual({ depositAmount: 4n, remainingVaultRepAttoRep: 2n })
	})
	test('does not require retained backing when a rounded deposit can empty the vault', () => {
		expect(getWalletVaultFundingQuote({ minimumVaultRepDepositAttoRep: 1n, vaultRepBackingUnits: 0n, totalRepBackingUnits: 2n, totalPoolHeldRepAttoRep: 3n }, 1n)).toEqual({ depositAmount: 2n, remainingVaultRepAttoRep: 0n })
	})
	test('does not quote an impossible uint256 deposit', () => {
		expect(getWalletVaultFundingQuote({ minimumVaultRepDepositAttoRep: (1n << 256n) - 1n, vaultRepBackingUnits: 0n, totalRepBackingUnits: 0n, totalPoolHeldRepAttoRep: 0n }, 1n)).toBeUndefined()
	})
})
