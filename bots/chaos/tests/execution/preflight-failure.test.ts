import { expect, test } from 'bun:test'
import { recordPreflightFailure } from '../../src/execution/preflight-failure.ts'
import type { RuntimeState } from '../../src/state/operator-state.ts'

function preflightFailureActivity(error: unknown) {
	const state: Pick<RuntimeState, 'activities'> = { activities: [] }
	recordPreflightFailure(state, { definitionId: 'trading.genesis-uniswap.create-pool', ecosystem: 'trading' }, error, 'Operation preflight stopped: Create pool')
	const activity = state.activities[0]
	if (activity === undefined) throw new Error('Expected the failure to be recorded')
	return { summary: activity.summary, ...(activity.details === undefined ? {} : { details: activity.details }) }
}

test('publishes the failed check and its nested revert reason', () => {
	expect(preflightFailureActivity(new Error('Create pool simulation failed', { cause: new Error('execution reverted: pool already exists') }))).toEqual({
		summary: 'Create pool simulation failed',
		details: 'execution reverted: pool already exists',
	})
})

test('withholds sensitive causes without hiding the safe failed check', () => {
	expect(preflightFailureActivity(new Error('Create pool simulation failed', { cause: new Error('RPC failed at https://user:password@example.com') }))).toEqual({
		summary: 'Create pool simulation failed',
		details: 'Error detail withheld because it may contain sensitive data.',
	})
})

test('filters sensitive suffixes before visibly truncating long messages', () => {
	const message = 'a'.repeat(1_100)
	expect(preflightFailureActivity(new Error(message)).summary).toEndWith('… (truncated)')
	expect(preflightFailureActivity(new Error(message)).summary).toHaveLength(1_000)
	expect(preflightFailureActivity(new Error(`${message} privateKey=secret`)).summary).toBe('Error detail withheld because it may contain sensitive data.')
})

test('handles thrown strings, empty messages, and cyclic causes', () => {
	expect(preflightFailureActivity('Insufficient ETH')).toEqual({ summary: 'Insufficient ETH' })
	expect(preflightFailureActivity(new Error(''))).toEqual({ summary: 'No error message was provided.' })
	const error = new Error('Changed anchor')
	error.cause = error
	expect(preflightFailureActivity(error)).toEqual({ summary: 'Changed anchor' })
})
