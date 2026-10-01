/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import type { WalletActionBlocker } from '@zoltar/ui-core-shared/types/components.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/wallet/network.js'
import * as securityPoolCopy from '@zoltar/ui-statoblast-shared/copy/securityPool.js'
import { evaluateSecurityPoolState } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolState.js'
import {
	buildVaultReadinessActions,
	getMaximumWithdrawableAttoRep,
	getVaultWithdrawalRepPerEthPrice,
	getVaultActionDisabledReasonId,
	getVaultActionsLoadBlocker,
	getVaultDepositAmountNotice,
	getVaultLauncherBlocker,
	getVaultLifecycleBlocker,
	getVaultLookupActionLabel,
	getVaultRepExitActionLabel,
	getVaultRepExitAmountLabel,
	type VaultLauncherBlockerContext,
} from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityVaultAvailability.js'

const ACCOUNT = getAddress('0x1111111111111111111111111111111111111111')

function createLauncherContext(overrides: Partial<VaultLauncherBlockerContext> = {}): VaultLauncherBlockerContext {
	return {
		accountAddress: ACCOUNT,
		hasLoadedSelectedVaultDetails: true,
		isOnActiveAppChain: true,
		loadedVaultMissingBlocker: undefined,
		repExitMode: 'withdraw',
		selectedVaultIsOwnedByAccount: true,
		vaultActionsLoadBlocker: undefined,
		vaultExistsOnchain: true,
		walletRepBalanceAttoRep: 1n,
		...overrides,
	}
}

function createReadinessInput(overrides: Partial<Parameters<typeof buildVaultReadinessActions>[0]> = {}): Parameters<typeof buildVaultReadinessActions>[0] {
	return {
		adjustmentBlocker: undefined,
		adjustmentDisabledReasonId: undefined,
		canUseLoadedVaultActions: true,
		claimFeesAvailabilityBlocker: undefined,
		claimFeesDisabledReasonId: undefined,
		claimFeesEnabled: true,
		claimFeesLauncherBlocker: undefined,
		depositDisabledReasonId: undefined,
		depositRepActionLabel: 'Deposit REP',
		depositRepToVaultEnabled: true,
		hasClaimableFees: true,
		onOpenModal: () => undefined,
		repExitActionLabel: 'Withdraw REP',
		repExitDisabledReasonId: undefined,
		repExitEnabled: true,
		repExitMode: 'withdraw',
		showSharedRefreshVaultBlocker: false,
		vaultExistsOnchain: true,
		visibleDepositLauncherBlocker: undefined,
		visibleRepExitLauncherBlocker: undefined,
		walletBlocker: undefined,
		...overrides,
	}
}

describe('security vault availability', () => {
	test('derives the lifecycle blocker from the pool state', () => {
		expect(getVaultLifecycleBlocker(undefined)).toBeUndefined()
		expect(getVaultLifecycleBlocker(evaluateSecurityPoolState({ lifecycleState: 'ended', universeHasForked: false }))).toBe(securityPoolCopy.vaultActionsEndedDetail)
		expect(getVaultLifecycleBlocker(evaluateSecurityPoolState({ lifecycleState: 'poolForked', universeHasForked: false }))).toBe(securityPoolCopy.vaultActionsForkMigrationDetail)
		expect(getVaultLifecycleBlocker(evaluateSecurityPoolState({ lifecycleState: 'forkMigration', universeHasForked: true }))).toBe(securityPoolCopy.vaultActionsForkMigrationDetail)
		expect(getVaultLifecycleBlocker(evaluateSecurityPoolState({ lifecycleState: 'forkTruthAuction', universeHasForked: true }))).toBe(securityPoolCopy.vaultActionsTruthAuctionDetail)
		expect(getVaultLifecycleBlocker(evaluateSecurityPoolState({ lifecycleState: 'operational', universeHasForked: false, vaultAdmissionClosed: true }))).toBe(securityPoolCopy.vaultDepositAdmissionClosedDetail)
		expect(getVaultLifecycleBlocker(evaluateSecurityPoolState({ lifecycleState: 'operational', universeHasForked: false }))).toBeUndefined()
	})

	test('labels the REP exit amount and action by mode and oracle validity', () => {
		expect(getVaultRepExitAmountLabel('redeem', false)).toBe(securityPoolCopy.redeemableAttoRep)
		expect(getVaultRepExitAmountLabel('withdraw', true)).toBe(securityPoolCopy.withdrawableAttoRep)
		expect(getVaultRepExitAmountLabel('withdraw', false)).toBe(securityPoolCopy.repAvailableToQueue)
		expect(getVaultRepExitActionLabel('redeem', 'REP')).toBe(securityPoolCopy.formatRedeemRepFromVault('REP'))
		expect(getVaultRepExitActionLabel('withdraw', 'REP')).toBe(securityPoolCopy.formatWithdrawRep('REP'))
		expect(getVaultLookupActionLabel(undefined)).toBe(commonCopy.refresh)
		expect(getVaultLookupActionLabel('boom')).toBe(commonCopy.retry)
	})

	test('caps the withdrawable amount at zero while dispute stake is locked and falls back to backing without a price', () => {
		expect(getMaximumWithdrawableAttoRep({ disputeStakedAttoRep: 1n, withdrawableRepAmountAttoRep: 7n })).toBe(0n)
		expect(getMaximumWithdrawableAttoRep({ disputeStakedAttoRep: 0n, withdrawableRepAmountAttoRep: 7n })).toBe(7n)
		expect(getMaximumWithdrawableAttoRep({ disputeStakedAttoRep: undefined, withdrawableRepAmountAttoRep: undefined })).toBeUndefined()
	})

	test('never falls back to the whole backing when no price can bound a committed withdrawal', () => {
		// Without a price the coverage calculation cannot bound a committed vault, so the maximum stays unknown instead of the whole backing.
		expect(getMaximumWithdrawableAttoRep({ disputeStakedAttoRep: 0n, withdrawableRepAmountAttoRep: undefined })).toBeUndefined()
	})

	test('bounds withdrawals by the execution oracle price before the UI estimate', () => {
		expect(getVaultWithdrawalRepPerEthPrice({ executionRepPerEthPrice: 4n, estimateRepPerEthPrice: 9n })).toEqual({ isEstimate: false, repPerEthPrice: 4n })
		expect(getVaultWithdrawalRepPerEthPrice({ executionRepPerEthPrice: undefined, estimateRepPerEthPrice: 9n })).toEqual({ isEstimate: true, repPerEthPrice: 9n })
		expect(getVaultWithdrawalRepPerEthPrice({ executionRepPerEthPrice: 0n, estimateRepPerEthPrice: undefined })).toEqual({ isEstimate: true, repPerEthPrice: undefined })
	})

	test('prefers the wallet shortfall notice over the minimum deposit notice', () => {
		expect(getVaultDepositAmountNotice({ depositAmount: 1n, isDepositBelowMinimum: true, minimumVaultRepDepositAttoRep: 10n * 10n ** 18n, walletRepShortfallAttoRep: 10n ** 18n })).toBe(securityPoolCopy.formatInsufficientRepBalanceDetail('1'))
		expect(getVaultDepositAmountNotice({ depositAmount: 1n, isDepositBelowMinimum: true, minimumVaultRepDepositAttoRep: 10n * 10n ** 18n, walletRepShortfallAttoRep: 0n })).toBeDefined()
		expect(getVaultDepositAmountNotice({ depositAmount: 1n, isDepositBelowMinimum: false, minimumVaultRepDepositAttoRep: 10n * 10n ** 18n, walletRepShortfallAttoRep: undefined })).toBeUndefined()
	})

	test('asks for a refresh or retry only when the vault is not loaded and not auto-loading', () => {
		expect(getVaultActionsLoadBlocker({ autoLoadVault: false, hasLoadedSelectedVaultDetails: true, loadingSecurityVault: false, securityVaultError: undefined })).toBeUndefined()
		expect(getVaultActionsLoadBlocker({ autoLoadVault: false, hasLoadedSelectedVaultDetails: false, loadingSecurityVault: true, securityVaultError: undefined })).toBeUndefined()
		expect(getVaultActionsLoadBlocker({ autoLoadVault: true, hasLoadedSelectedVaultDetails: false, loadingSecurityVault: false, securityVaultError: undefined })).toBeUndefined()
		expect(getVaultActionsLoadBlocker({ autoLoadVault: false, hasLoadedSelectedVaultDetails: false, loadingSecurityVault: false, securityVaultError: undefined })).toBe(securityPoolCopy.refreshVaultActionsDetail)
		expect(getVaultActionsLoadBlocker({ autoLoadVault: true, hasLoadedSelectedVaultDetails: false, loadingSecurityVault: false, securityVaultError: 'boom' })).toBe(securityPoolCopy.retryVaultActionsDetail)
	})

	test('orders launcher blockers from wallet to ownership to load state to vault existence', () => {
		expect(getVaultLauncherBlocker('deposit-rep', createLauncherContext({ accountAddress: undefined }))).toBe(securityPoolCopy.connectWalletBeforeDepositingRep)
		expect(getVaultLauncherBlocker('rep-exit', createLauncherContext({ isOnActiveAppChain: false }))).toBe(getWrongNetworkReason())
		expect(getVaultLauncherBlocker('claim-fees', createLauncherContext({ selectedVaultIsOwnedByAccount: false }))).toBe(securityPoolCopy.selectOwnVaultToClaimFees)
		expect(getVaultLauncherBlocker('rep-exit', createLauncherContext({ repExitMode: 'redeem', selectedVaultIsOwnedByAccount: false }))).toBe(securityPoolCopy.selectOwnVaultToRedeemRep)
		expect(getVaultLauncherBlocker('deposit-rep', createLauncherContext({ hasLoadedSelectedVaultDetails: false, vaultActionsLoadBlocker: 'load' }))).toBe('load')
		expect(getVaultLauncherBlocker('deposit-rep', createLauncherContext({ vaultExistsOnchain: false, walletRepBalanceAttoRep: 0n }))).toBe(securityPoolCopy.missingVaultRepBalanceReason)
		expect(getVaultLauncherBlocker('deposit-rep', createLauncherContext({ vaultExistsOnchain: false, walletRepBalanceAttoRep: undefined }))).toBeUndefined()
		expect(getVaultLauncherBlocker('deposit-rep', createLauncherContext({ loadedVaultMissingBlocker: 'missing' }))).toBeUndefined()
		expect(getVaultLauncherBlocker('rep-exit', createLauncherContext({ loadedVaultMissingBlocker: 'missing' }))).toBe('missing')
		expect(getVaultLauncherBlocker('claim-fees', createLauncherContext())).toBeUndefined()
	})

	test('points disabled launchers at the lifecycle or shared refresh notice', () => {
		const ids = { refreshVaultActionsDescriptionId: 'refresh-id', vaultLifecycleBlockerId: 'lifecycle-id' }
		expect(getVaultActionDisabledReasonId({ ...ids, lifecycleActionEnabled: false, showSharedRefreshVaultBlocker: true, vaultLifecycleBlocker: 'blocked' })).toBe('lifecycle-id')
		expect(getVaultActionDisabledReasonId({ ...ids, lifecycleActionEnabled: true, showSharedRefreshVaultBlocker: true, vaultLifecycleBlocker: 'blocked' })).toBe('refresh-id')
		expect(getVaultActionDisabledReasonId({ ...ids, lifecycleActionEnabled: false, showSharedRefreshVaultBlocker: false, vaultLifecycleBlocker: undefined })).toBeUndefined()
	})

	test('builds ready launcher actions that open the matching modal', () => {
		const opened: string[] = []
		const actions = buildVaultReadinessActions(createReadinessInput({ onOpenModal: modal => opened.push(modal) }))
		expect(actions.map(action => action.key)).toEqual(['deposit-rep', 'adjust-backing', 'rep-exit', 'claim-fees'])
		expect(actions.every(action => action.readiness === 'ready')).toBe(true)
		for (const action of actions) action.onAction?.()
		expect(opened).toEqual(['deposit-rep', 'adjust-backing', 'withdraw-rep', 'claim-fees'])
		expect(actions.find(action => action.key === 'rep-exit')?.description).toBe(securityPoolCopy.repWithdrawalDescription)
		expect(buildVaultReadinessActions(createReadinessInput({ repExitMode: 'redeem' })).find(action => action.key === 'rep-exit')?.description).toBe(securityPoolCopy.repRedemptionDescription)
	})

	test('blocks launcher actions and surfaces only visible blockers', () => {
		const actions = buildVaultReadinessActions(
			createReadinessInput({
				adjustmentBlocker: 'adjust',
				adjustmentDisabledReasonId: 'adjust-id',
				claimFeesAvailabilityBlocker: 'fees',
				claimFeesLauncherBlocker: 'fees',
				depositDisabledReasonId: 'deposit-id',
				depositRepToVaultEnabled: false,
				hasClaimableFees: false,
				repExitDisabledReasonId: 'exit-id',
				vaultExistsOnchain: false,
				visibleDepositLauncherBlocker: 'deposit',
				visibleRepExitLauncherBlocker: 'exit',
			}),
		)
		expect(actions.every(action => action.readiness === 'blocked' && action.onAction === undefined)).toBe(true)
		expect(actions[0]).toMatchObject({ disabledReasonId: 'deposit-id' })
		expect(actions[0]?.blocker).toBeUndefined()
		expect(actions.find(action => action.key === 'rep-exit')).toMatchObject({ blocker: 'exit', disabledReasonId: 'exit-id' })
		expect(actions.find(action => action.key === 'claim-fees')).toMatchObject({ blocker: 'fees' })
		expect(actions.find(action => action.key === 'adjust-backing')).toMatchObject({ blocker: 'adjust', disabledReasonId: 'adjust-id' })
		const sharedRefresh = buildVaultReadinessActions(createReadinessInput({ adjustmentBlocker: 'adjust', showSharedRefreshVaultBlocker: true }))
		expect(sharedRefresh[3]?.blocker).toBeUndefined()
	})

	test('keeps the fallback withdrawal reason free of wallet recovery', () => {
		const actions = buildVaultReadinessActions(
			createReadinessInput({
				repExitEnabled: false,
				visibleRepExitLauncherBlocker: 'Switch to Sepolia.',
				walletBlocker: { kind: 'wrong-network', targetChainName: 'Sepolia' },
			}),
		)
		expect(actions.find(action => action.key === 'rep-exit')?.blocker).toBe(securityPoolCopy.withdrawalUnavailableReason)
		expect(actions.find(action => action.key === 'rep-exit')?.walletBlocker).toBeUndefined()
		expect(actions.find(action => action.key === 'rep-exit')?.onAction).toBeUndefined()
	})

	test('marks the launchers a wallet prerequisite blocks with the typed wallet blocker', () => {
		const walletBlocker: WalletActionBlocker = { kind: 'wrong-network', targetChainName: 'Sepolia' }
		const actions = buildVaultReadinessActions(
			createReadinessInput({
				adjustmentBlocker: 'Switch to Sepolia.',
				canUseLoadedVaultActions: false,
				claimFeesAvailabilityBlocker: 'Switch to Sepolia.',
				repExitEnabled: false,
				repExitDisabledReasonId: 'pool-state-reason',
				visibleDepositLauncherBlocker: 'Switch to Sepolia.',
				visibleRepExitLauncherBlocker: 'Switch to Sepolia.',
				walletBlocker,
			}),
		)
		expect(actions[0]).toMatchObject({ blocker: 'Switch to Sepolia.', walletBlocker })
		// A lifecycle-disabled launcher keeps its own described reason instead of offering a wallet fix.
		expect(actions.find(action => action.key === 'rep-exit')?.blocker).toBeUndefined()
		expect(actions.find(action => action.key === 'rep-exit')?.walletBlocker).toBeUndefined()
		expect(actions.find(action => action.key === 'claim-fees')).toMatchObject({ blocker: 'Switch to Sepolia.', walletBlocker })
		expect(actions.find(action => action.key === 'adjust-backing')).toMatchObject({ blocker: 'Switch to Sepolia.', walletBlocker })
		expect(buildVaultReadinessActions(createReadinessInput())[0]?.walletBlocker).toBeUndefined()
	})
})
