/// <reference types='bun-types' />

import { afterEach, describe, expect, test } from 'bun:test'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import {
	canRequestTransaction,
	createInitialTransactionTrayState,
	getInFlightTransactionCount,
	isTransactionActionLocked,
	isTransactionPromptOpen,
	markTransactionCanceled,
	markTransactionFailed,
	markTransactionFinished,
	markTransactionPrepared,
	markTransactionPresented,
	markTransactionRequested,
	markTransactionSubmitted,
} from '../transactions/transactionTray.js'
import { securityPoolTransactionScope } from '../transactions/transactionScope.js'
import { createFakeBackend, createFakeSimulationProfile } from './testUtils/fakeBackend.js'

const transactionHash = '0x1234000000000000000000000000000000000000000000000000000000000000'

describe('transactionTray', () => {
	afterEach(() => {
		resetActiveEnvironmentForTesting()
	})

	test('tracks a requested transaction through submit, presentation, and finish', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating question',
		})
		const submitted = markTransactionSubmitted(requested, transactionHash)
		const presented = markTransactionPresented(submitted, {
			detail: 'The new question is now on-chain.',
			dismissKey: transactionHash,
			hash: transactionHash,
			title: 'Question created',
			tone: 'success',
		})
		const finished = markTransactionFinished(presented)

		expect(getInFlightTransactionCount(requested)).toBe(1)
		expect(requested.entries[0]?.lifecycle).toEqual({ phase: 'review' })
		expect(requested.active?.tone).toBe('awaiting-wallet')
		expect(requested.active?.title).toBe('Creating question')
		expect(requested.active?.hash).toBeUndefined()
		expect(requested.active?.operationKey).toBe('transaction-request-1')
		expect(requested.entries[0]?.intent.submittedTitle).toBe('Creating question')
		expect(submitted.active?.tone).toBe('pending')
		expect(submitted.active?.hash).toBe(transactionHash)
		expect(submitted.active?.operationKey).toBe(requested.active?.operationKey)
		expect(submitted.active?.title).toBe('Creating question')
		expect(submitted.entries[0]?.lifecycle).toEqual({ phase: 'pending', hash: transactionHash })
		expect(presented.active?.tone).toBe('success')
		expect(presented.active?.operationKey).toBe(requested.active?.operationKey)
		expect(presented.active?.title).toBe('Question created')
		expect(getInFlightTransactionCount(finished)).toBe(0)
	})

	test('locks every action while the prompt is open and only overlapping scopes once the transaction is pending', () => {
		const poolA = securityPoolTransactionScope('0x00000000000000000000000000000000000000AA')
		const poolB = securityPoolTransactionScope('0x00000000000000000000000000000000000000bb')
		const intent = { action: 'depositRepToVault', scope: poolA, source: 'security-vault', submittedTitle: 'Depositing REP' }
		const requested = markTransactionRequested(createInitialTransactionTrayState(), intent)
		const submitted = markTransactionSubmitted(requested, transactionHash)
		const finished = markTransactionFinished(submitted)

		expect(isTransactionPromptOpen(requested)).toBe(true)
		expect(isTransactionActionLocked(requested, poolB)).toBe(true)
		expect(isTransactionActionLocked(requested)).toBe(true)
		expect(canRequestTransaction(requested, { ...intent, scope: poolB })).toBe(false)
		expect(isTransactionPromptOpen(submitted)).toBe(false)
		expect(isTransactionActionLocked(submitted, poolA)).toBe(true)
		expect(isTransactionActionLocked(submitted, poolB)).toBe(false)
		expect(isTransactionActionLocked(submitted)).toBe(false)
		expect(canRequestTransaction(submitted, intent)).toBe(false)
		expect(canRequestTransaction(submitted, { ...intent, scope: poolB })).toBe(true)
		expect(isTransactionActionLocked(finished, poolA)).toBe(false)
		expect(getInFlightTransactionCount(finished)).toBe(0)
	})

	test('routes outcomes to their own request while another transaction is pending', () => {
		const otherHash = '0x9999000000000000000000000000000000000000000000000000000000000000'
		const first = markTransactionSubmitted(markTransactionRequested(createInitialTransactionTrayState(), { action: 'depositRepToVault', scope: securityPoolTransactionScope('0x01'), source: 'security-vault', submittedTitle: 'Depositing REP' }), transactionHash)
		const second = markTransactionRequested(first, { action: 'createSecurityPool', source: 'security-pools', submittedTitle: 'Creating Security Pool', failedTitle: 'Security pool creation' })
		const secondKey = second.entries[1]?.key
		expect(secondKey).toBe('transaction-request-2')
		const secondSubmitted = markTransactionSubmitted(second, otherHash)
		const recovered = markTransactionSubmitted(secondSubmitted, transactionHash, 'uncertain')
		const secondFailed = markTransactionFailed(recovered, { kind: 'reverted', message: 'Transaction reverted' }, secondKey)
		const secondFinished = markTransactionFinished(secondFailed, secondKey)

		expect(secondSubmitted.entries.map(entry => entry.lifecycle)).toEqual([
			{ phase: 'pending', hash: transactionHash },
			{ phase: 'pending', hash: otherHash },
		])
		expect(recovered.entries[1]?.lifecycle).toEqual({ phase: 'pending', hash: otherHash })
		expect(secondFailed.entries[1]?.lifecycle).toEqual({ phase: 'failed', failure: { kind: 'reverted', message: 'Transaction reverted' }, hash: otherHash })
		expect(secondFailed.active?.title).toBe('Security pool creation')
		expect(secondFinished.entries.map(entry => entry.key)).toEqual(['transaction-request-1'])
	})

	test('routes a wallet replacement to the request whose hash it replaced, never to another pending request', () => {
		const otherHash = '0x9999000000000000000000000000000000000000000000000000000000000000'
		const speedUpHash = '0x7777000000000000000000000000000000000000000000000000000000000000'
		const first = markTransactionSubmitted(markTransactionRequested(createInitialTransactionTrayState(), { action: 'depositRepToVault', scope: ['security-pool:0x1'], source: 'security-vault', submittedTitle: 'Depositing REP' }), transactionHash)
		const both = markTransactionSubmitted(markTransactionRequested(first, { action: 'depositRepToVault', scope: ['security-pool:0x2'], source: 'security-vault', submittedTitle: 'Depositing REP' }), otherHash)
		const replaced = markTransactionSubmitted(both, speedUpHash, 'pending', otherHash)
		const unattributed = markTransactionSubmitted(both, speedUpHash)

		expect(replaced.entries.map(entry => entry.lifecycle)).toEqual([
			{ phase: 'pending', hash: transactionHash },
			{ phase: 'pending', hash: speedUpHash },
		])
		// Without the replaced hash a new hash cannot be attributed while two broadcasts are pending.
		expect(unattributed).toBe(both)
	})

	test('ignores outcomes for an unknown request key', () => {
		const finished = markTransactionFinished(createInitialTransactionTrayState())
		const requested = markTransactionRequested(finished, { action: 'createMarket', source: 'zoltar', submittedTitle: 'Creating question' })

		expect(getInFlightTransactionCount(finished)).toBe(0)
		expect(markTransactionFinished(requested, 'transaction-request-9')).toBe(requested)
		expect(markTransactionFailed(requested, { kind: 'error', message: 'x' }, 'transaction-request-9')).toBe(requested)
	})

	test('keeps an uncertain receipt locked and restores its normal detail when tracking recovers', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating question',
		})
		const submitted = markTransactionSubmitted(requested, transactionHash)
		const uncertain = markTransactionSubmitted(submitted, transactionHash, 'uncertain')
		expect(getInFlightTransactionCount(uncertain)).toBe(1)
		expect(uncertain.active?.hash).toBe(transactionHash)
		expect(uncertain.active?.tone).toBe('pending')
		expect(uncertain.active?.detail).toBe('Confirmation unavailable. Checking automatically; do not resubmit.')
		expect(uncertain.active?.operationKey).toBe(submitted.active?.operationKey)
		const recovered = markTransactionSubmitted(uncertain, transactionHash, 'pending')
		expect(recovered.active?.detail).toBe('Question creation transaction submitted.')
		expect(getInFlightTransactionCount(recovered)).toBe(1)
	})

	test('ignores submitted hashes when no pending intent exists', () => {
		const submitted = markTransactionSubmitted(createInitialTransactionTrayState(), transactionHash)

		expect(submitted.active).toBeUndefined()
	})

	test('updates the pending hash when a submitted transaction is repriced', () => {
		const replacementHash = '0x5678000000000000000000000000000000000000000000000000000000000000'
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating question',
		})
		const submitted = markTransactionSubmitted(requested, transactionHash)
		const replaced = markTransactionSubmitted(submitted, replacementHash)

		expect(replaced.active?.tone).toBe('pending')
		expect(replaced.active?.hash).toBe(replacementHash)
		expect(replaced.active?.dismissKey).toBe(replacementHash)
		expect(replaced.active?.title).toBe('Creating question')
	})

	test('adds prepared transaction call details before submission', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating question',
		})
		const prepared = markTransactionPrepared(requested, {
			account: '0x00000000000000000000000000000000000000a1',
			args: [1n, { title: 'Will this resolve?' }, ['yes', 'no']],
			chainName: 'Ethereum',
			contractAddress: '0x00000000000000000000000000000000000000b2',
			functionName: 'createQuestion',
			value: 0n,
		})
		const submitted = markTransactionSubmitted(prepared, transactionHash)
		const presented = markTransactionPresented(submitted, {
			dismissKey: transactionHash,
			hash: transactionHash,
			rows: [{ label: 'Question ID', value: '0x01' }],
			title: 'Question created',
			tone: 'success',
		})

		expect(prepared.active?.tone).toBe('awaiting-wallet')
		expect(prepared.active?.detail).toBe('Review the prepared transaction, then confirm it in your wallet.')
		expect(prepared.active?.rows).toBeUndefined()
		expect(prepared.active?.technicalRows?.some(row => row.label === 'Function' && row.value === 'createQuestion')).toBe(true)
		expect(prepared.active?.technicalRows?.some(row => row.label === 'Arguments' && row.value === '1, {title: Will this resolve?}, [yes, no]')).toBe(true)
		expect(prepared.active?.technicalRows?.some(row => row.label === 'Sender')).toBe(false)
		expect(prepared.active?.technicalRows?.some(row => row.label === 'Chain')).toBe(false)
		expect(prepared.active?.technicalRows?.some(row => String(row.value).includes('[object Object]'))).toBe(false)
		expect(submitted.active?.technicalRows?.some(row => row.label === 'Contract' && row.value === '0x00000000000000000000000000000000000000b2')).toBe(true)
		expect(presented.active?.rows).toEqual([{ label: 'Question ID', value: '0x01' }])
		expect(presented.active?.technicalRows?.some(row => row.label === 'Function' && row.value === 'createQuestion')).toBe(true)
	})

	test('updates technical details for every transaction in a multi-write operation', () => {
		const approvalHash = '0xaaaa000000000000000000000000000000000000000000000000000000000000'
		const requestHash = '0xbbbb000000000000000000000000000000000000000000000000000000000000'
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'requestPrice',
			rows: [{ label: 'Pool', value: '0x0000000000000000000000000000000000000001' }],
			source: 'pool-oracle',
			submittedTitle: 'Requesting New Price',
		})
		const approvalPrepared = markTransactionPrepared(requested, {
			account: '0x0000000000000000000000000000000000000002',
			args: ['0x0000000000000000000000000000000000000003', 10n],
			chainName: 'Ethereum',
			contractAddress: '0x0000000000000000000000000000000000000004',
			functionName: 'approve',
			value: 0n,
		})
		const approvalSubmitted = markTransactionSubmitted(approvalPrepared, approvalHash)
		const requestPrepared = markTransactionPrepared(approvalSubmitted, {
			account: '0x0000000000000000000000000000000000000002',
			args: [3n, 4n],
			chainName: 'Ethereum',
			contractAddress: '0x0000000000000000000000000000000000000001',
			functionName: 'requestPrice',
			value: 5n,
		})
		const requestSubmitted = markTransactionSubmitted(requestPrepared, requestHash)
		const requestFailed = markTransactionFailed(requestSubmitted, { kind: 'reverted', message: 'Transaction reverted' })
		const requestSucceeded = markTransactionPresented(requestSubmitted, {
			dismissKey: requestHash,
			hash: requestHash,
			rows: [{ label: 'Pool', value: '0x0000000000000000000000000000000000000001' }],
			title: 'Price Request Submitted',
			tone: 'success',
		})
		const finished = markTransactionFinished(requestSucceeded)

		expect(approvalSubmitted.active?.hash).toBe(approvalHash)
		expect(approvalSubmitted.active?.technicalRows?.some(row => row.label === 'Function' && row.value === 'approve')).toBe(true)
		expect(requestPrepared.active?.hash).toBeUndefined()
		expect(requestPrepared.active?.technicalRows?.some(row => row.label === 'Function' && row.value === 'requestPrice')).toBe(true)
		for (const state of [requestPrepared, requestSubmitted, requestFailed, requestSucceeded]) {
			expect(state.active?.rows?.map(row => row.label)).toContain('Pool')
			expect(state.active?.technicalRows?.some(row => row.label === 'Function' && row.value === 'requestPrice')).toBe(true)
			expect(state.active?.technicalRows?.some(row => row.label === 'Function' && row.value === 'approve')).toBe(false)
		}
		expect(requestSubmitted.active?.hash).toBe(requestHash)
		expect(requestFailed.active?.hash).toBe(requestHash)
		expect(requestSucceeded.active?.hash).toBe(requestHash)
		expect(requestPrepared.entries[0]?.lifecycle).toEqual({ phase: 'wallet' })
		expect(getInFlightTransactionCount(finished)).toBe(0)
	})

	test('formats self-referential arrays and mixed object-array cycles safely', () => {
		const selfReferentialArray: unknown[] = []
		selfReferentialArray.push(selfReferentialArray)
		const mixedCycle: { values?: unknown[] } = {}
		mixedCycle.values = [mixedCycle]
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating question',
		})

		const prepared = markTransactionPrepared(requested, {
			account: '0x00000000000000000000000000000000000000a1',
			args: [selfReferentialArray, mixedCycle],
			chainName: 'Ethereum',
			contractAddress: '0x00000000000000000000000000000000000000b2',
			functionName: 'createQuestion',
			value: 0n,
		})

		expect(prepared.active?.technicalRows?.some(row => row.label === 'Arguments' && row.value === '[[circular value]], {values: [[circular value]]}')).toBe(true)
	})

	test('uses non-wallet prepared copy for raw broadcasts', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'deploy',
			source: 'deployment',
			submittedDetail: 'Deployment transaction submitted.',
			submittedTitle: 'Deploying Contract',
		})
		const prepared = markTransactionPrepared(requested, {
			account: '0x00000000000000000000000000000000000000c3',
			args: undefined,
			chainName: 'Ethereum',
			data: '0x1234',
			dataLabel: 'Raw transaction',
			functionName: 'Broadcast deterministic proxy deployer transaction',
			requiresWalletConfirmation: false,
			to: '0x00000000000000000000000000000000000000d4',
			toLabel: 'Proxy deployer',
			value: undefined,
		})

		expect(prepared.active?.tone).toBe('preparing')
		expect(prepared.active?.detail).toBe('Review the prepared transaction before it is submitted.')
		expect(prepared.active?.technicalRows?.some(row => row.label === 'Sender')).toBe(false)
		expect(prepared.active?.technicalRows?.some(row => row.label === 'Chain')).toBe(false)
		expect(prepared.active?.technicalRows?.some(row => row.label === 'Raw transaction')).toBe(false)
		expect(prepared.active?.technicalRows?.some(row => row.label === 'To' && row.value === 'Proxy deployer (0x00000000000000000000000000000000000000d4)')).toBe(true)
	})

	test('uses preparing copy for requested simulation transactions', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			requiresWalletConfirmation: false,
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating question',
		})

		expect(requested.active?.tone).toBe('preparing')
		expect(requested.active?.detail).toBe('Submitting in browser simulation. No wallet confirmation is required.')
		expect(requested.entries[0]?.intent.requiresWalletConfirmation).toBe(false)
	})

	test('applies active simulation defaults to undecorated requested transactions', () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: createFakeSimulationProfile() }))
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating question',
		})
		resetEnvironment()

		expect(requested.active?.tone).toBe('preparing')
		expect(requested.active?.detail).toBe('Submitting in browser simulation. No wallet confirmation is required.')
		expect(requested.entries[0]?.intent.requiresWalletConfirmation).toBe(false)
	})

	test('uses the defaulted pending intent when prepared previews omit wallet confirmation requirements', () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: createFakeSimulationProfile() }))
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating question',
		})
		resetEnvironment()

		const prepared = markTransactionPrepared(requested, {
			account: '0x00000000000000000000000000000000000000a1',
			args: [1n, ['yes', 'no']],
			chainName: 'Ethereum',
			contractAddress: '0x00000000000000000000000000000000000000b2',
			functionName: 'createQuestion',
			value: 0n,
		})

		expect(prepared.active?.tone).toBe('preparing')
		expect(prepared.active?.detail).toBe('Review the prepared transaction before it is submitted.')
		expect(prepared.active?.technicalRows?.some(row => row.label === 'Function' && row.value === 'createQuestion')).toBe(true)
	})

	test('turns a requested transaction into a dismissible failure when submission fails', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating question',
			failedTitle: 'Question creation',
		})
		const failed = markTransactionFailed(requested, { kind: 'rejected', message: 'Action canceled in wallet.' })

		expect(failed.active?.tone).toBe('error')
		expect(failed.active?.title).toBe('Question creation')
		expect(failed.active?.detail).toBe('Action canceled in wallet.')
		expect(failed.active?.hash).toBeUndefined()
		expect(failed.active?.dismissKey).toBe('transaction-request-1')
		expect(failed.entries[0]?.lifecycle).toEqual({ phase: 'failed', failure: { kind: 'rejected', message: 'Action canceled in wallet.' }, hash: undefined })
	})

	test('clears requested transaction state when a write is canceled before submission', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating question',
		})
		const canceled = markTransactionCanceled(requested)
		const finished = markTransactionFinished(canceled, 'transaction-request-1')

		expect(canceled.active).toBeUndefined()
		expect(getInFlightTransactionCount(canceled)).toBe(0)
		expect(isTransactionActionLocked(canceled)).toBe(false)
		expect(finished).toBe(canceled)
	})

	test('turns a submitted pending transaction into a failed transaction while preserving the hash', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating question',
			failedTitle: 'Question creation',
		})
		const submitted = markTransactionSubmitted(requested, transactionHash)
		const failed = markTransactionFailed(submitted, { kind: 'reverted', message: 'Transaction reverted' })

		expect(failed.active?.tone).toBe('error')
		expect(failed.active?.title).toBe('Question creation')
		expect(failed.active?.detail).toBe('Transaction reverted')
		expect(failed.active?.hash).toBe(transactionHash)
		expect(failed.active?.dismissKey).toBe(transactionHash)
	})
})
