import { expect, test } from 'bun:test'
import { publicConnectivityError } from '../src/dashboard/connectivity-error.ts'
import { EndpointCheckFailure, type EndpointCheck } from '../src/monitoring/connectivity.ts'

const fallback = 'RPC connectivity checks failed.'

function failedCheck(value: Partial<EndpointCheck> & Pick<EndpointCheck, 'error' | 'kind' | 'target'>): EndpointCheck {
	return {
		chainId: undefined,
		checkedAt: '2026-09-01T00:00:00.000Z',
		status: 'failed',
		...value,
	}
}

test('explains private relay DNS failures without exposing RPC URL credentials', () => {
	const error = new EndpointCheckFailure('private relay unavailable', [
		failedCheck({
			error: 'RPC http://reth:8545 failed while calling eth_sendPrivateTransaction: getaddrinfo ENOTFOUND reth',
			kind: 'private-relay',
			target: 'http://reth:8545',
		}),
	])

	expect(publicConnectivityError(error, { fallback })).toBe('RPC http://reth:8545 failed while calling eth_sendPrivateTransaction: getaddrinfo ENOTFOUND reth The hostname reth must resolve from the bot process; Docker service names like reth only work when the bot shares that container network.')
})

test('reports safe public submission HTTP status while redacting provider text', () => {
	const secret = 'provider-secret'
	const error = new EndpointCheckFailure('submission capability unavailable', [
		failedCheck({
			chainId: 1,
			error: `RPC https://submit.example failed while calling eth_sendRawTransaction: Endpoint did not prove eth_sendRawTransaction support: HTTP 503 RPC -32000: ${secret}`,
			kind: 'public-rpc',
			target: 'https://submit.example',
		}),
	])
	const message = publicConnectivityError(error, { fallback })

	expect(message).toBe('RPC https://submit.example returned HTTP 503 while calling eth_sendRawTransaction')
	expect(message).not.toContain(secret)
})

test('does not expose unrecognized endpoint failure details', () => {
	const secret = 'provider-secret'
	const error = new EndpointCheckFailure('read unavailable', [failedCheck({ error: `RPC https://read.example failed while calling eth_chainId: ${secret}`, kind: 'read-rpc', target: 'https://read.example' })])

	expect(publicConnectivityError(error, { fallback })).toBe('RPC https://read.example failed while calling eth_chainId. Review the endpoint and protected bot logs.')
})

test('normalizes direct and checked endpoint targets to credential-free origins', () => {
	const secret = 'provider-secret'
	const direct = new Error(`RPC https://operator:${secret}@rpc.example/private?key=${secret} failed while calling eth_chainId: connection refused`)
	const checked = new EndpointCheckFailure('read unavailable', [
		failedCheck({
			error: 'connection refused',
			kind: 'read-rpc',
			target: `https://rpc.example/private?key=${secret}`,
		}),
	])
	const mismatch = new Error(`https://rpc.example/private?key=${secret} returned chain 1; expected chain 11155111`)

	expect(publicConnectivityError(direct, { fallback })).toBe('RPC https://rpc.example failed while calling eth_chainId: connection refused')
	expect(publicConnectivityError(checked, { fallback })).toBe('RPC https://rpc.example failed while calling eth_chainId: connection refused')
	expect(publicConnectivityError(mismatch, { fallback })).toBe('https://rpc.example returned chain 1; expected chain 11155111')
})
