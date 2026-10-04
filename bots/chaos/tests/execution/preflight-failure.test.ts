import { expect, test } from 'bun:test'
import { publicFailureReason, recordPreflightFailure } from '../../src/execution/preflight-failure.ts'
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

test('redacts credentials without hiding the failed RPC check', () => {
	expect(preflightFailureActivity(new Error('Create pool simulation failed', { cause: new Error('RPC failed at https://user:password@example.com') }))).toEqual({
		summary: 'Create pool simulation failed',
		details: 'RPC failed at [redacted endpoint]',
	})
})

test('filters sensitive suffixes before visibly truncating long messages', () => {
	const message = 'a'.repeat(1_100)
	expect(preflightFailureActivity(new Error(message)).summary).toEndWith('… (truncated)')
	expect(preflightFailureActivity(new Error(message)).summary).toHaveLength(1_000)
	expect(preflightFailureActivity(new Error(`${message} privateKey=secret`)).summary).toEndWith('… (truncated)')
})

test('handles thrown strings, empty messages, and cyclic causes', () => {
	expect(preflightFailureActivity('Insufficient ETH')).toEqual({ summary: 'Insufficient ETH' })
	expect(preflightFailureActivity(new Error(''))).toEqual({ summary: 'No error message was provided.' })
	const error = new Error('Changed anchor')
	error.cause = error
	expect(preflightFailureActivity(error)).toEqual({ summary: 'Changed anchor' })
})

test('preserves diagnostics around sensitive fields and nested RPC request data', () => {
	const failure = new Error('Simulation failed', { cause: new Error('execution reverted: Security pool deployment failed\nURL: https://rpc.example/key\nRequest: {"privateKey":"secret","calldata":"0x1234"}\nFile: /workspace/operator/config.json') })
	const result = preflightFailureActivity(failure)
	expect(result.details).toContain('execution reverted: Security pool deployment failed')
	expect(result.details).toContain('[redacted endpoint]')
	expect(result.details).toContain('[redacted]')
	expect(result.details).not.toContain('secret')
	expect(result.details).not.toContain('/workspace/')
	expect(result.details).not.toContain('0x1234')
})

test('redaction remains stable when persisted errors are published again', () => {
	const message = publicFailureReason('RPC rpcUrl=https://rpc.example/key failed; privateKey="private value"; authorization=Bearer credential; calldata=0x1234; execution reverted: pool exists')
	expect(publicFailureReason(message)).toBe(message)
	expect(message).toContain('execution reverted: pool exists')
	expect(message).not.toContain('private value')
	expect(message).not.toContain('credential')
})

test('keeps the deepest revert reason visible ahead of verbose RPC wrappers', () => {
	const error = new Error('Pool simulation failed', { cause: new Error('RPC request failed: ' + 'a'.repeat(1500), { cause: new Error('execution reverted: Security pool deployment failed') }) })
	expect(preflightFailureActivity(error).details).toStartWith('execution reverted: Security pool deployment failed')
})

test('redacts the complete Basic authorization value while retaining the RPC failure', () => {
	const reason = publicFailureReason('RPC failed: authorization=Basic dXNlcjpwYXNzd29yZA==; execution reverted: pool exists')
	expect(reason).toBe('RPC failed: authorization=[redacted]; execution reverted: pool exists')
})

test('redacts escaped quotes and backslashes in quoted credentials on every publication', () => {
	for (const credential of ['prefix"SECRET_SUFFIX', 'prefix\\SECRET_SUFFIX', 'prefix\\"SECRET_SUFFIX', 'https://rpc.example/prefix"SECRET_SUFFIX', '/workspace/prefix"SECRET_SUFFIX']) {
		const reason = publicFailureReason(JSON.stringify({ password: credential, authorization: credential }))
		expect(reason).toBe('{"password":[redacted],"authorization":[redacted]}')
		expect(publicFailureReason(reason)).toBe(reason)
	}
	const reason = publicFailureReason("password='prefix\\'SECRET_SUFFIX\\\\tail'")
	expect(reason).toBe('password=[redacted]')
	expect(publicFailureReason(reason)).toBe(reason)
})
