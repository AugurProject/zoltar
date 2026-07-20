/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { formatSecurityPoolPageSummary, formatSecurityVaultPreviewDeferred, getSecurityPoolLifecycleLabel, getSecurityPoolStatusBadgeLabel, getVaultLauncherOwnershipReason, getVaultLauncherWalletReason } from '../../../features/security-pools/lib/securityPoolLabels.js'

void describe('security pool lifecycle label', () => {
	void test('maps each known lifecycle state and undefined', () => {
		expect(getSecurityPoolLifecycleLabel(undefined)).toBe('Unknown')
		expect(getSecurityPoolLifecycleLabel('operational')).toBe('Operational')
		expect(getSecurityPoolLifecycleLabel('ended')).toBe('Ended')
		expect(getSecurityPoolLifecycleLabel('poolForked')).toBe('Pool Forked')
		expect(getSecurityPoolLifecycleLabel('forkMigration')).toBe('Fork Migration')
		expect(getSecurityPoolLifecycleLabel('forkTruthAuction')).toBe('Truth Auction')
	})

	void test('derives fork-aware status badge labels', () => {
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: false, lifecycleState: undefined })).toBe('Unknown')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: false, lifecycleState: 'operational' })).toBe('Operational')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: true, lifecycleState: 'operational' })).toBe('Fork Finalized')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: true, lifecycleState: 'poolForked' })).toBe('Fork Migration')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: true, lifecycleState: 'forkMigration' })).toBe('Fork Migration')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: true, lifecycleState: 'forkTruthAuction' })).toBe('Truth Auction')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: false, lifecycleState: 'ended', questionOutcome: 'yes' })).toBe('Finalized as Yes')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: false, lifecycleState: 'ended' })).toBe('Finalized')
	})

	void test('selects vault launcher blocker copy outside the copy layer', () => {
		expect(getVaultLauncherWalletReason('claim-fees', 'withdraw')).toBe('Connect a wallet before claiming fees.')
		expect(getVaultLauncherWalletReason('deposit-rep', 'withdraw')).toBe('Connect a wallet before depositing REP.')
		expect(getVaultLauncherWalletReason('rep-exit', 'redeem')).toBe('Connect a wallet before redeeming REP.')
		expect(getVaultLauncherWalletReason('rep-exit', 'withdraw')).toBe('Connect a wallet before withdrawing REP.')
		expect(getVaultLauncherWalletReason('set-bond-allowance', 'withdraw')).toBe('Connect a wallet before setting the security bond allowance.')
		expect(getVaultLauncherOwnershipReason('claim-fees', 'withdraw')).toBe('Select your own vault to claim fees.')
		expect(getVaultLauncherOwnershipReason('deposit-rep', 'withdraw')).toBe('Select your own vault to deposit REP.')
		expect(getVaultLauncherOwnershipReason('rep-exit', 'redeem')).toBe('Select your own vault to redeem REP.')
		expect(getVaultLauncherOwnershipReason('rep-exit', 'withdraw')).toBe('Select your own vault to withdraw REP.')
		expect(getVaultLauncherOwnershipReason('set-bond-allowance', 'withdraw')).toBe('Select your own vault to set the security bond allowance.')
	})

	void test('selects count grammar outside the copy layer', () => {
		expect(formatSecurityPoolPageSummary(5, 12)).toBe('5 of 12 pools match.')
		expect(formatSecurityPoolPageSummary(0, 2)).toBe('0 of 2 pools match.')
		expect(formatSecurityPoolPageSummary(1, 2)).toBe('1 of 2 pools matches.')
		expect(formatSecurityPoolPageSummary(2, 2)).toBe('2 of 2 pools match.')
		expect(formatSecurityPoolPageSummary(1, 1)).toBe('1 of 1 pool matches.')
		expect(formatSecurityVaultPreviewDeferred(1n)).toBe('1 vault is registered. Open the pool to load individual vault details.')
		expect(formatSecurityVaultPreviewDeferred(2n)).toBe('2 vaults are registered. Open the pool to load individual vault details.')
	})
})
