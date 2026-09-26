/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import type { LiquidationApprovalDetails, SecurityPoolOverviewActionResult } from '@zoltar/ui-core-shared/types/contracts.js'
import * as liquidationCopy from '@zoltar/ui-statoblast-shared/copy/liquidation.js'
import {
	ZERO_LIQUIDATION_APPROVAL_ID,
	formatHealthFactorBps,
	getApprovalStatus,
	getDelegatedLiquidationApprovalReason,
	getLiquidationBlockers,
	getLiquidationButtonLabels,
	getLiquidationExecutionMode,
	getLiquidationModalTitle,
	getQueuedLiquidationOperation,
	getQueuedLiquidationStatus,
	isDelegatedLiquidationReceiver,
	isLiquidationApprovalNonceInvalidated,
	isLiquidationApprovalRouteMismatch,
	isValidLiquidationApprovalId,
} from '@zoltar/ui-statoblast-shared/features/security-pools/lib/liquidationModalGuards.js'
import { createOracleManagerDetails } from './workflow/builders.js'

const OPERATOR = getAddress('0x1111111111111111111111111111111111111111')
const RECEIVER = getAddress('0x2222222222222222222222222222222222222222')
const TARGET = getAddress('0x3333333333333333333333333333333333333333')
const POOL = getAddress('0x4444444444444444444444444444444444444444')
const APPROVAL_ID = `0x${'ab'.repeat(32)}`
const HASH = '0x00000000000000000000000000000000000000000000000000000000000000a1' as const

function createApprovalDetails(overrides: Partial<LiquidationApprovalDetails> = {}, paramOverrides: Partial<LiquidationApprovalDetails['params']> = {}): LiquidationApprovalDetails {
	return {
		availableDebtAttoEth: 10n,
		consumedDebtAttoEth: 0n,
		minimumValidNonce: 0n,
		registryAddress: zeroAddress,
		reservedDebtAttoEth: 0n,
		revoked: false,
		...overrides,
		params: {
			maxCumulativeDebtAttoEth: 10n,
			maxDebtPerLiquidationAttoEth: 5n,
			minPostLiquidationHealthFactorBps: 12_500n,
			nonce: 1n,
			operator: OPERATOR,
			receiverVault: RECEIVER,
			securityPool: POOL,
			targetVault: zeroAddress,
			validAfter: 100n,
			validUntil: 1_000n,
			...paramOverrides,
		},
	}
}

function createDelegatedApprovalInput(overrides: Partial<Parameters<typeof getDelegatedLiquidationApprovalReason>[0]> = {}): Parameters<typeof getDelegatedLiquidationApprovalReason>[0] {
	return {
		approvalLatestExecutionTimestamp: 500n,
		approvalNonceInvalidated: false,
		approvalRouteMismatch: false,
		currentTimestamp: 200n,
		delegatedReceiver: true,
		liquidationAmountValue: 3n,
		liquidationApprovalDetails: createApprovalDetails(),
		liquidationApprovalError: undefined,
		liquidationApprovalId: APPROVAL_ID,
		loadingLiquidationApproval: false,
		...overrides,
	}
}

function createBlockerInput(overrides: Partial<Parameters<typeof getLiquidationBlockers>[0]> = {}): Parameters<typeof getLiquidationBlockers>[0] {
	return {
		delegatedApprovalReason: undefined,
		delegatedReceiver: false,
		deterministicLiquidationReason: undefined,
		directLiquidationReason: undefined,
		liquidationDebtEthAmount: '1',
		liquidationExecutionMode: 'execute',
		liquidationFundingPreviewError: undefined,
		liquidationFundingPreviewLoaded: true,
		liquidationManagerAddress: zeroAddress,
		liquidationReceiverVaultSummaryError: undefined,
		liquidationReceiverVaultSummaryResolved: true,
		liquidationSecurityPoolAddress: POOL,
		liquidationTimeoutSeconds: 600n,
		loadingLiquidationApproval: false,
		loadingLiquidationFundingPreview: false,
		loadingLiquidationReceiverVaultSummary: false,
		queueLiquidationEthGuardMessage: undefined,
		sameVaultWarning: undefined,
		trimmedLiquidationReceiverVault: RECEIVER,
		trimmedLiquidationTargetVault: TARGET,
		...overrides,
	}
}

function findBlockerReason(input: Parameters<typeof getLiquidationBlockers>[0]) {
	return getLiquidationBlockers(input).find(blocker => blocker.reason !== undefined)
}

describe('liquidation modal guards', () => {
	test('formats health factor basis points with the protocol suffix', () => {
		expect(formatHealthFactorBps(10_000n)).toBe('1× protocol minimum')
		expect(formatHealthFactorBps(12_500n)).toBe('1.25× protocol minimum')
		expect(formatHealthFactorBps(10_001n)).toBe('1.0001× protocol minimum')
	})

	test('derives the approval status from revocation, nonce, and validity window', () => {
		expect(getApprovalStatus(true, false, 100n, 1_000n, 200n)).toBe(liquidationCopy.approvalRevoked)
		expect(getApprovalStatus(false, true, 100n, 1_000n, 200n)).toBe(liquidationCopy.approvalInvalidated)
		expect(getApprovalStatus(false, false, 100n, 1_000n, undefined)).toBe(commonCopy.unavailable)
		expect(getApprovalStatus(false, false, 100n, 1_000n, 50n)).toBe(liquidationCopy.approvalPending)
		expect(getApprovalStatus(false, false, 100n, 1_000n, 1_000n)).toBe(liquidationCopy.approvalExpired)
		expect(getApprovalStatus(false, false, 100n, 1_000n, 200n)).toBe(liquidationCopy.approvalActive)
	})

	test('resolves the execution mode, title, and button labels from oracle price usability', () => {
		const usable = createOracleManagerDetails({ isPriceValid: true, lastSettlementTimestamp: 100n, priceValidUntilTimestamp: 400n })
		expect(getLiquidationExecutionMode(undefined, 200n)).toBe('refreshing')
		expect(getLiquidationExecutionMode(usable, 200n)).toBe('execute')
		expect(getLiquidationExecutionMode(usable, 400n)).toBe('queue')
		expect(getLiquidationModalTitle(undefined, 200n)).toBe(liquidationCopy.liquidateVaultTitle)
		expect(getLiquidationModalTitle(usable, 200n)).toBe(liquidationCopy.executeVaultLiquidationTitle)
		expect(getLiquidationModalTitle(usable, 400n)).toBe(liquidationCopy.queueVaultLiquidation)
		expect(getLiquidationButtonLabels(undefined, 200n)).toEqual({ idle: liquidationCopy.liquidateVault, pending: liquidationCopy.liquidateVaultPendingLabel })
		expect(getLiquidationButtonLabels(usable, 200n)).toEqual({ idle: liquidationCopy.executeVaultLiquidation, pending: liquidationCopy.executingLiquidation })
		expect(getLiquidationButtonLabels(usable, 400n)).toEqual({ idle: liquidationCopy.queueLiquidation, pending: liquidationCopy.queueingLiquidation })
	})

	test('validates approval ids and detects delegated receivers', () => {
		expect(isValidLiquidationApprovalId(ZERO_LIQUIDATION_APPROVAL_ID)).toBe(false)
		expect(isValidLiquidationApprovalId('0x1234')).toBe(false)
		expect(isValidLiquidationApprovalId(APPROVAL_ID)).toBe(true)
		expect(isDelegatedLiquidationReceiver(undefined, RECEIVER)).toBe(false)
		expect(isDelegatedLiquidationReceiver(OPERATOR, '')).toBe(false)
		expect(isDelegatedLiquidationReceiver(OPERATOR, ` ${OPERATOR.toLowerCase()} `)).toBe(false)
		expect(isDelegatedLiquidationReceiver(OPERATOR, RECEIVER)).toBe(true)
	})

	test('detects approval route mismatches and nonce invalidation', () => {
		const matching = { accountAddress: OPERATOR, liquidationApprovalDetails: createApprovalDetails(), liquidationSecurityPoolAddress: POOL, trimmedLiquidationReceiverVault: RECEIVER, trimmedLiquidationTargetVault: TARGET }
		expect(isLiquidationApprovalRouteMismatch(matching)).toBe(false)
		expect(isLiquidationApprovalRouteMismatch({ ...matching, liquidationApprovalDetails: undefined })).toBe(false)
		expect(isLiquidationApprovalRouteMismatch({ ...matching, accountAddress: RECEIVER })).toBe(true)
		expect(isLiquidationApprovalRouteMismatch({ ...matching, liquidationSecurityPoolAddress: TARGET })).toBe(true)
		expect(isLiquidationApprovalRouteMismatch({ ...matching, liquidationApprovalDetails: createApprovalDetails({}, { targetVault: RECEIVER }) })).toBe(true)
		expect(isLiquidationApprovalRouteMismatch({ ...matching, liquidationApprovalDetails: createApprovalDetails({}, { targetVault: TARGET }) })).toBe(false)
		expect(isLiquidationApprovalNonceInvalidated(undefined)).toBe(false)
		expect(isLiquidationApprovalNonceInvalidated(createApprovalDetails({ minimumValidNonce: 2n }))).toBe(true)
		expect(isLiquidationApprovalNonceInvalidated(createApprovalDetails({ minimumValidNonce: 1n }))).toBe(false)
	})

	test('orders delegated approval reasons from input validity to quota', () => {
		expect(getDelegatedLiquidationApprovalReason(createDelegatedApprovalInput({ delegatedReceiver: false, liquidationApprovalId: ZERO_LIQUIDATION_APPROVAL_ID }))).toBeUndefined()
		expect(getDelegatedLiquidationApprovalReason(createDelegatedApprovalInput({ liquidationApprovalId: ZERO_LIQUIDATION_APPROVAL_ID }))).toBe(liquidationCopy.delegatedApprovalRequired)
		expect(getDelegatedLiquidationApprovalReason(createDelegatedApprovalInput({ liquidationApprovalId: '0x12' }))).toBe(liquidationCopy.invalidDelegatedApprovalId)
		expect(getDelegatedLiquidationApprovalReason(createDelegatedApprovalInput({ loadingLiquidationApproval: true }))).toBe(liquidationCopy.loadingBoundedApproval)
		expect(getDelegatedLiquidationApprovalReason(createDelegatedApprovalInput({ liquidationApprovalError: 'boom' }))).toBe('boom')
		expect(getDelegatedLiquidationApprovalReason(createDelegatedApprovalInput({ liquidationApprovalDetails: undefined }))).toBe(liquidationCopy.boundedApprovalRequiredBeforeSubmission)
		expect(getDelegatedLiquidationApprovalReason(createDelegatedApprovalInput({ approvalRouteMismatch: true }))).toBe(liquidationCopy.approvalRouteMismatch)
		expect(getDelegatedLiquidationApprovalReason(createDelegatedApprovalInput({ approvalNonceInvalidated: true }))).toBe(liquidationCopy.approvalNonceInvalidated)
		expect(getDelegatedLiquidationApprovalReason(createDelegatedApprovalInput({ liquidationApprovalDetails: createApprovalDetails({ revoked: true }) }))).toBe(liquidationCopy.approvalUnavailable)
		expect(getDelegatedLiquidationApprovalReason(createDelegatedApprovalInput({ liquidationApprovalDetails: createApprovalDetails({ availableDebtAttoEth: 0n }) }))).toBe(liquidationCopy.approvalUnavailable)
		expect(getDelegatedLiquidationApprovalReason(createDelegatedApprovalInput({ currentTimestamp: 50n }))).toBe(liquidationCopy.approvalNotActive)
		expect(getDelegatedLiquidationApprovalReason(createDelegatedApprovalInput({ approvalLatestExecutionTimestamp: 1_001n }))).toBe(liquidationCopy.approvalExpiresBeforeExecution)
		expect(getDelegatedLiquidationApprovalReason(createDelegatedApprovalInput({ liquidationAmountValue: 6n }))).toBe(liquidationCopy.approvalQuotaTooLow)
		expect(getDelegatedLiquidationApprovalReason(createDelegatedApprovalInput({ liquidationAmountValue: 11n, liquidationApprovalDetails: createApprovalDetails({ availableDebtAttoEth: 10n }, { maxDebtPerLiquidationAttoEth: 20n }) }))).toBe(liquidationCopy.approvalQuotaTooLow)
		expect(getDelegatedLiquidationApprovalReason(createDelegatedApprovalInput())).toBeUndefined()
	})

	test('reports the first liquidation blocker in priority order with its loading flag', () => {
		expect(findBlockerReason(createBlockerInput())).toBeUndefined()
		expect(findBlockerReason(createBlockerInput({ liquidationExecutionMode: 'refreshing' }))).toEqual({ loading: true, reason: liquidationCopy.refreshingPriceValidity })
		expect(findBlockerReason(createBlockerInput({ liquidationManagerAddress: undefined }))).toEqual({ loading: true, reason: liquidationCopy.liquidationPoolReloadRequired })
		expect(findBlockerReason(createBlockerInput({ trimmedLiquidationTargetVault: '' }))).toEqual({ reason: liquidationCopy.targetVaultRequired })
		expect(findBlockerReason(createBlockerInput({ trimmedLiquidationReceiverVault: '' }))).toEqual({ reason: liquidationCopy.receiverVaultRequired })
		expect(findBlockerReason(createBlockerInput({ delegatedApprovalReason: 'approval', delegatedReceiver: true, loadingLiquidationApproval: true }))).toEqual({ loading: true, reason: 'approval' })
		expect(findBlockerReason(createBlockerInput({ delegatedReceiver: true, loadingLiquidationReceiverVaultSummary: true }))).toEqual({ loading: true, reason: liquidationCopy.loadingReceiverVault })
		expect(findBlockerReason(createBlockerInput({ delegatedReceiver: true, liquidationReceiverVaultSummaryError: 'receiver' }))).toEqual({ reason: 'receiver' })
		expect(findBlockerReason(createBlockerInput({ delegatedReceiver: false, liquidationReceiverVaultSummaryError: 'receiver' }))).toBeUndefined()
		expect(findBlockerReason(createBlockerInput({ delegatedReceiver: true, liquidationReceiverVaultSummaryResolved: false }))).toEqual({ reason: liquidationCopy.receiverVaultRequiredBeforeSubmission })
		expect(findBlockerReason(createBlockerInput({ sameVaultWarning: 'same' }))).toEqual({ reason: 'same' })
		expect(findBlockerReason(createBlockerInput({ liquidationDebtEthAmount: ' ' }))).toEqual({ reason: liquidationCopy.liquidationAmountRequired })
		expect(findBlockerReason(createBlockerInput({ liquidationExecutionMode: 'queue', liquidationTimeoutSeconds: undefined }))).toEqual({ reason: liquidationCopy.liquidationTimeoutMinimumReason })
		expect(findBlockerReason(createBlockerInput({ liquidationExecutionMode: 'queue', loadingLiquidationFundingPreview: true }))).toEqual({ loading: true, reason: liquidationCopy.loadingQueueFunding })
		expect(findBlockerReason(createBlockerInput({ liquidationExecutionMode: 'queue', liquidationFundingPreviewError: 'funding' }))).toEqual({ reason: 'funding' })
		expect(findBlockerReason(createBlockerInput({ liquidationExecutionMode: 'queue', liquidationFundingPreviewLoaded: false }))).toEqual({ loading: true, reason: liquidationCopy.loadingQueueFunding })
		expect(findBlockerReason(createBlockerInput({ liquidationExecutionMode: 'execute', liquidationTimeoutSeconds: undefined, liquidationFundingPreviewLoaded: false }))).toBeUndefined()
		expect(findBlockerReason(createBlockerInput({ deterministicLiquidationReason: 'deterministic', directLiquidationReason: 'direct' }))).toEqual({ reason: 'deterministic' })
		expect(findBlockerReason(createBlockerInput({ directLiquidationReason: 'direct', queueLiquidationEthGuardMessage: 'eth' }))).toEqual({ reason: 'direct' })
		expect(findBlockerReason(createBlockerInput({ queueLiquidationEthGuardMessage: 'eth' }))).toEqual({ reason: 'eth' })
	})

	test('derives the queued liquidation operation from the pending slot or the transaction result', () => {
		const queuedResult: SecurityPoolOverviewActionResult = { action: 'queueLiquidation', hash: HASH, queuedOperation: { isPendingSlot: false, operation: 'liquidation', operationId: 7n }, securityPoolAddress: POOL }
		expect(getQueuedLiquidationOperation({ currentPoolOracleManagerDetails: undefined, liquidationTargetVault: TARGET, securityPoolOverviewResult: undefined })).toBeUndefined()
		expect(getQueuedLiquidationOperation({ currentPoolOracleManagerDetails: undefined, liquidationTargetVault: TARGET, securityPoolOverviewResult: queuedResult })).toEqual({ amount: undefined, isPendingSlot: false, operationId: 7n })
		expect(getQueuedLiquidationOperation({ currentPoolOracleManagerDetails: undefined, liquidationTargetVault: TARGET, securityPoolOverviewResult: { action: 'queueLiquidation', hash: HASH, securityPoolAddress: POOL } })).toBeUndefined()
		const pendingSlot = createOracleManagerDetails({ pendingOperation: { amount: 3n, operation: 'liquidation', operationId: 9n, operator: OPERATOR, targetVault: TARGET } })
		expect(getQueuedLiquidationOperation({ currentPoolOracleManagerDetails: pendingSlot, liquidationTargetVault: TARGET, securityPoolOverviewResult: queuedResult })).toEqual({ amount: 3n, isPendingSlot: true, operationId: 9n })
		expect(getQueuedLiquidationOperation({ currentPoolOracleManagerDetails: pendingSlot, liquidationTargetVault: RECEIVER, securityPoolOverviewResult: queuedResult })).toEqual({ amount: undefined, isPendingSlot: false, operationId: 7n })
	})

	test('derives the queued liquidation status from execution, queue slot, and oracle state', () => {
		const result: SecurityPoolOverviewActionResult = { action: 'queueLiquidation', hash: HASH, securityPoolAddress: POOL }
		const usable = createOracleManagerDetails({ isPriceValid: true, lastSettlementTimestamp: 100n, priceValidUntilTimestamp: 400n })
		const base = { currentPoolOracleManagerDetails: usable, currentTimestamp: 200n, loadingPoolOracleManager: false, queuedLiquidationOperation: undefined, securityPoolOverviewResult: result }
		expect(getQueuedLiquidationStatus({ ...base, securityPoolOverviewResult: undefined })).toBeUndefined()
		expect(getQueuedLiquidationStatus({ ...base, securityPoolOverviewResult: { ...result, stagedExecution: { errorMessage: undefined, operation: 'liquidation', operationId: 1n, success: true } } })).toBe('executed')
		expect(getQueuedLiquidationStatus({ ...base, securityPoolOverviewResult: { ...result, stagedExecution: { errorMessage: 'nope', operation: 'liquidation', operationId: 1n, success: false } } })).toBe('failed')
		expect(getQueuedLiquidationStatus({ ...base, queuedLiquidationOperation: { amount: undefined, isPendingSlot: true, operationId: 1n } })).toBe('queued')
		expect(getQueuedLiquidationStatus({ ...base, queuedLiquidationOperation: { amount: undefined, isPendingSlot: false, operationId: 1n } })).toBe('manual-queued')
		expect(getQueuedLiquidationStatus({ ...base, loadingPoolOracleManager: true })).toBe('refreshing')
		expect(getQueuedLiquidationStatus({ ...base, currentPoolOracleManagerDetails: undefined })).toBe('refreshing')
		expect(getQueuedLiquidationStatus(base)).toBe('executed')
		expect(getQueuedLiquidationStatus({ ...base, currentTimestamp: 400n })).toBe('missing')
	})
})
