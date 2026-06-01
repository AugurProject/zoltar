/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../lib/actionFeedback.js'

const HASH = `0x${'a'.repeat(64)}` as const

describe('action feedback helpers', () => {
	test('creates pending and success feedback with default details', () => {
		expect(createPendingActionFeedback('deploy', 'Deploy pool')).toEqual({
			action: 'deploy',
			status: {
				detail: 'Waiting for confirmation.',
				title: 'Deploy pool',
				tone: 'pending',
			},
		})

		expect(createSuccessActionFeedback('deploy', 'Pool deployed', HASH)).toEqual({
			action: 'deploy',
			status: {
				detail: 'Transaction confirmed.',
				hash: HASH,
				title: 'Pool deployed',
				tone: 'success',
			},
		})
	})

	test('creates pending and success feedback with custom details', () => {
		expect(createPendingActionFeedback('queue', 'Queue operation', 'Queued locally.')).toEqual({
			action: 'queue',
			status: {
				detail: 'Queued locally.',
				title: 'Queue operation',
				tone: 'pending',
			},
		})

		expect(createSuccessActionFeedback('queue', 'Operation queued', HASH, 'Settled immediately.')).toEqual({
			action: 'queue',
			status: {
				detail: 'Settled immediately.',
				hash: HASH,
				title: 'Operation queued',
				tone: 'success',
			},
		})
	})

	test('creates warning feedback with and without a transaction hash', () => {
		expect(createWarningActionFeedback('withdraw', 'Withdrawal queued', 'Queued via oracle manager.')).toEqual({
			action: 'withdraw',
			status: {
				detail: 'Queued via oracle manager.',
				title: 'Withdrawal queued',
				tone: 'warning',
			},
		})

		expect(createWarningActionFeedback('withdraw', 'Withdrawal queued', 'Queued via oracle manager.', HASH)).toEqual({
			action: 'withdraw',
			status: {
				detail: 'Queued via oracle manager.',
				hash: HASH,
				title: 'Withdrawal queued',
				tone: 'warning',
			},
		})
	})

	test('creates error feedback', () => {
		expect(createErrorActionFeedback('settle', 'Settlement failed', 'Price window is still open.')).toEqual({
			action: 'settle',
			status: {
				detail: 'Price window is still open.',
				title: 'Settlement failed',
				tone: 'error',
			},
		})
	})
})
