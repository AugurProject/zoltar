import { afterEach, describe, expect, test } from 'bun:test'
import { eip191Signer } from 'micro-eth-signer'
import { keccak256, privateKeyToAccount, recoverTransactionAddress, type Hex } from '#ethereum'
import {
	checkConnectivity,
	checkPrivateTransactionSubmissionEndpoints,
	checkPublicTransactionSubmissionEndpoints,
	checkSubmissionEndpoints,
	endpointLabel,
	readRpcChainId,
	sendRawTransactionToRpc,
	TRANSACTION_SUBMISSION_CAPABILITY_PROBE,
	updateConnectivityEndpointChecks,
	updateSubmissionEndpointChecks,
	validateConnectivitySettings,
	validateConnectivitySettingsForQuorum,
	validateIndependentReadRpcUrls,
	validateReadRpcUrls,
	withConnectivityChecks,
	withSubmissionChecks,
	type EndpointCheck,
} from '#monitoring/connectivity'
import { validateSubmissionSettings } from '#execution/transaction-submission'

const servers: Bun.Server<unknown>[] = []
const relayAuthenticationSignature = `0x${'22'.repeat(65)}` as const
const relayAuthentication = {
	address: '0x0000000000000000000000000000000000000001' as const,
	signMessage: async () => relayAuthenticationSignature,
}
const validRelayAuthenticationHeader = `${relayAuthentication.address}:${relayAuthenticationSignature}`

function invalidRelayAuthenticationResponse() {
	return Response.json({ error: { code: -32_025, message: 'invalid flashbots signature' }, id: null, jsonrpc: '2.0' }, { status: 403 })
}

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true)
})

function rpc(handler: (method: string, params: readonly unknown[], request: Request) => unknown | Promise<unknown>) {
	const server = Bun.serve({
		fetch: async request => {
			const value: unknown = JSON.parse(await request.text())
			if (typeof value !== 'object' || value === null || !('id' in value) || !('jsonrpc' in value) || !('method' in value) || !('params' in value) || typeof value['id'] !== 'number' || typeof value['jsonrpc'] !== 'string' || typeof value['method'] !== 'string' || !Array.isArray(value['params']))
				throw new Error('Invalid test RPC request')
			const response = await handler(value['method'], value['params'], request)
			return response instanceof Response ? response : Response.json({ id: value['id'], jsonrpc: value['jsonrpc'], result: response })
		},
		hostname: '127.0.0.1',
		port: 0,
	})
	servers.push(server)
	if (server.port === undefined) throw new Error('RPC test server did not expose a port')
	return `http://127.0.0.1:${server.port.toString()}`
}

function privateTransactionRelayWithAuthenticationControls(responses: { invalidAuthentication?: () => Response; missingAuthentication?: () => Response } = {}) {
	return rpc((method, _params, request) => {
		if (method === 'eth_chainId') return '0x1'
		if (method === 'eth_sendPrivateTransaction') {
			const authenticationHeader = request.headers.get('x-flashbots-signature')
			if (authenticationHeader === null) return responses.missingAuthentication?.() ?? Response.json({ error: { code: -32_600, message: 'x-flashbots-signature is required' }, id: null, jsonrpc: '2.0' }, { status: 401 })
			if (authenticationHeader === validRelayAuthenticationHeader) return Response.json({ error: { code: -32_602, message: 'failed to recover the signer' }, id: 1, jsonrpc: '2.0' })
			return responses.invalidAuthentication?.() ?? invalidRelayAuthenticationResponse()
		}
		throw new Error(`Unexpected method: ${method}`)
	})
}

describe('operator connectivity', () => {
	test('treats an already-known exact signed transaction as accepted', async () => {
		const server = Bun.serve({
			port: 0,
			fetch: () => Response.json({ error: { code: -32_000, message: 'already known' }, id: 1, jsonrpc: '2.0' }),
		})
		servers.push(server)
		if (server.port === undefined) throw new Error('RPC test server did not expose a port')
		const serialized = '0x1234' as const
		await expect(sendRawTransactionToRpc(`http://127.0.0.1:${server.port.toString()}`, serialized)).resolves.toBe(keccak256(serialized))
	})

	test('does not mistake an unknown transaction type for an accepted transaction', async () => {
		const server = Bun.serve({
			port: 0,
			fetch: () => Response.json({ error: { code: -32_000, message: 'unknown transaction type' }, id: 1, jsonrpc: '2.0' }),
		})
		try {
			if (server.port === undefined) throw new Error('Transaction rejection test server did not expose a port')
			await expect(sendRawTransactionToRpc(`http://127.0.0.1:${server.port.toString()}`, '0x1234')).rejects.toThrow('unknown transaction type')
		} finally {
			server.stop(true)
		}
	})
	test('rejects a quorum that only varies paths on the same RPC origin', () => {
		expect(() => validateIndependentReadRpcUrls('https://rpc.example', ['https://rpc.example'])).toThrow('independent origins')
		expect(() => validateIndependentReadRpcUrls('https://rpc.example/read', ['https://rpc.example/quorum'])).toThrow('independent origins')
		expect(validateIndependentReadRpcUrls('https://one.example', ['https://two.example'])).toEqual(['https://two.example/'])
	})

	test('rejects live connectivity updates that duplicate the deployment quorum origin', () => {
		expect(() => validateConnectivitySettingsForQuorum({ publicRpcUrls: ['https://public.example'], readRpcUrl: 'https://quorum.example/read' }, ['https://quorum.example/independent'])).toThrow('independent origins')
	})

	test('redacts RPC path and query credentials from endpoint labels', () => {
		const settings = validateConnectivitySettings({
			publicRpcUrls: ['https://rpc.example/v1?api-key=secret', 'https://rpc.example/v1?api-key=secret'],
			readRpcUrl: 'https://read.example/key',
		})
		expect(settings.publicRpcUrls).toHaveLength(1)
		expect(endpointLabel(settings.publicRpcUrls[0] ?? '')).toBe('https://rpc.example')
		expect(endpointLabel('https://eth-mainnet.g.alchemy.com/v2/SUPER_SECRET?token=HIDDEN')).toBe('https://eth-mainnet.g.alchemy.com')
		expect(() => validateConnectivitySettings({ publicRpcUrls: [], readRpcUrl: 'https://read.example' })).toThrow('At least one')
		expect(() => validateConnectivitySettings({ publicRpcUrls: ['http://rpc.example'], readRpcUrl: 'https://read.example' })).toThrow('HTTPS')
		expect(() => validateConnectivitySettings({ publicRpcUrls: ['https://rpc.example'], readRpcUrl: 'https://user:secret@read.example' })).toThrow('credentials')
		expect(validateReadRpcUrls(['https://one.example', 'https://one.example/'])).toEqual(['https://one.example/'])
		expect(() => validateReadRpcUrls(['http://unsafe.example'])).toThrow('HTTPS')
	})

	test('does not include rejected RPC endpoint secrets in validation errors', () => {
		expect(() => validateReadRpcUrls(['not-a-url?token=RPC_SECRET'])).toThrow(/^Invalid RPC URL$/)
		expect(() => validateReadRpcUrls(['ftp://user:RPC_SECRET@rpc.example/private?key=HIDDEN'])).toThrow(/^RPC URL must use HTTPS, loopback HTTP, or the local Anvil service$/)
	})

	test('checks the configured chain and sends raw transactions', async () => {
		const hash = `0x${'12'.repeat(32)}` as Hex
		const url = rpc((method, params) => {
			if (method === 'eth_chainId') return '0xaa36a7'
			if (method === 'eth_sendRawTransaction') {
				expect(params).toEqual(['0x1234'])
				return hash
			}
			throw new Error(`Unexpected method: ${method}`)
		})
		expect(await readRpcChainId(url)).toBe(11_155_111)
		expect(await sendRawTransactionToRpc(url, '0x1234')).toBe(hash)
		const checks = await checkConnectivity(validateConnectivitySettings({ publicRpcUrls: [url], readRpcUrl: url }), 11_155_111)
		expect(checks.map(check => check.status)).toEqual(['healthy', 'healthy'])
		await expect(checkConnectivity(validateConnectivitySettings({ publicRpcUrls: [url], readRpcUrl: url }), 1)).rejects.toThrow('Expected chain 1')
		const malformed = rpc(method => {
			if (method === 'eth_chainId') return 'not-a-chain-id'
			throw new Error(`Unexpected method: ${method}`)
		})
		let malformedFailure: unknown
		try {
			await readRpcChainId(malformed)
		} catch (error) {
			malformedFailure = error
		}
		const malformedMessage = malformedFailure instanceof Error ? malformedFailure.message : String(malformedFailure)
		expect(malformedMessage.match(/eth_chainId/g)).toHaveLength(1)
		expect(malformedMessage.match(new RegExp(new URL(malformed).origin.replaceAll('.', '\\.'), 'g'))).toHaveLength(1)
	})

	test('does not mark a read-only public RPC as transaction-submission healthy', async () => {
		const requestedMethods: string[] = []
		const readOnlyRpc = rpc(method => {
			requestedMethods.push(method)
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendRawTransaction') return Response.json({ error: { code: -32_601, message: 'method not found' }, id: 1, jsonrpc: '2.0' })
			throw new Error(`Unexpected method: ${method}`)
		})
		const credentialedPath = `${readOnlyRpc}/private/provider-key?token=query-secret`
		let failure: unknown
		try {
			await checkPublicTransactionSubmissionEndpoints([credentialedPath], 1)
		} catch (error) {
			failure = error
		}

		const message = failure instanceof Error ? failure.message : String(failure)
		expect(message).toContain('eth_sendRawTransaction')
		expect(message).not.toContain('provider-key')
		expect(message).not.toContain('query-secret')
		expect(requestedMethods).toEqual(['eth_chainId', 'eth_sendRawTransaction'])
	})

	test('proves public transaction dispatch with one fixed non-broadcastable envelope', async () => {
		const capableRpc = rpc((method, params) => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendRawTransaction') {
				expect(params).toEqual([TRANSACTION_SUBMISSION_CAPABILITY_PROBE])
				return Response.json({ error: { code: -32_602, message: 'signature error' }, id: 1, jsonrpc: '2.0' })
			}
			throw new Error(`Unexpected method: ${method}`)
		})

		await expect(recoverTransactionAddress({ serializedTransaction: TRANSACTION_SUBMISSION_CAPABILITY_PROBE })).rejects.toThrow()
		await expect(checkPublicTransactionSubmissionEndpoints([capableRpc], 1)).resolves.toMatchObject([{ chainId: 1, kind: 'public-rpc', status: 'healthy' }])
	})

	test.each([
		{ code: -32_000, message: 'invalid signature' },
		{ code: -32_000, message: 'invalid argument' },
		{ code: -32_602, message: 'invalid params' },
	])('rejects generic public write-gateway errors as transaction-submission evidence %#', async ({ code, message }) => {
		const endpoint = rpc(method => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendRawTransaction') return Response.json({ error: { code, message }, id: 1, jsonrpc: '2.0' })
			throw new Error(`Unexpected method: ${method}`)
		})

		await expect(checkPublicTransactionSubmissionEndpoints([endpoint], 1)).rejects.toThrow(message)
	})

	test('tolerates public transport degradation but fails closed on safety evidence', async () => {
		const capableRpc = rpc(method => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendRawTransaction') return Response.json({ error: { code: -32_602, message: 'failed to recover the signer' }, id: 1, jsonrpc: '2.0' })
			throw new Error(`Unexpected method: ${method}`)
		})
		const unavailableRpc = rpc(() => new Response('temporarily unavailable', { status: 503 }))
		const readOnlyRpc = rpc(method => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendRawTransaction') return Response.json({ error: { code: -32_601, message: 'method not found' }, id: 1, jsonrpc: '2.0' })
			throw new Error(`Unexpected method: ${method}`)
		})

		await expect(checkPublicTransactionSubmissionEndpoints([capableRpc, unavailableRpc], 1)).resolves.toMatchObject([
			{ chainId: 1, status: 'healthy' },
			{ failureDisposition: 'connectivity-degraded', status: 'failed' },
		])
		await expect(checkPublicTransactionSubmissionEndpoints([capableRpc, readOnlyRpc], 1)).rejects.toThrow('method not found')
		await expect(checkPublicTransactionSubmissionEndpoints([unavailableRpc], 1)).rejects.toThrow('HTTP 503')
	})

	test('fails closed on wrong-chain private relays and clears checks for public mode', async () => {
		const relay = (chainId: string) =>
			rpc(method => {
				if (method === 'eth_chainId') return chainId
				if (method === 'eth_callBundle' || method === 'eth_sendBundle') return Response.json({ error: { code: -32_600, message: 'signature is required' }, id: null, jsonrpc: '2.0' })
				throw new Error(`Unexpected method: ${method}`)
			})
		const mainnetRelay = relay('0x1')
		const sepoliaRelay = relay('0xaa36a7')
		const healthy = await checkSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [mainnetRelay] }), 1)
		expect(healthy).toMatchObject([{ chainId: 1, kind: 'private-relay', status: 'healthy' }])
		const connectivity = await checkConnectivity(validateConnectivitySettings({ publicRpcUrls: [mainnetRelay], readRpcUrl: mainnetRelay }), 1)
		expect(withConnectivityChecks(healthy, connectivity).map(check => check.kind)).toEqual(['read-rpc', 'public-rpc', 'private-relay'])
		expect(withSubmissionChecks(connectivity, healthy).map(check => check.kind)).toEqual(['read-rpc', 'public-rpc', 'private-relay'])
		let wrongRelayFailure: unknown
		try {
			await checkSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [sepoliaRelay] }), 1)
		} catch (error) {
			wrongRelayFailure = error
		}
		const wrongRelayMessage = wrongRelayFailure instanceof Error ? wrongRelayFailure.message : String(wrongRelayFailure)
		expect(wrongRelayMessage).toContain('Expected chain 1')
		expect(wrongRelayMessage.match(/eth_chainId/g)).toHaveLength(1)
		expect(wrongRelayMessage.match(new RegExp(new URL(sepoliaRelay).origin.replaceAll('.', '\\.'), 'g'))).toHaveLength(1)
		const publicChecks = await checkSubmissionEndpoints(validateSubmissionSettings({ mode: 'public', relayUrls: [mainnetRelay] }), 1)
		expect(publicChecks).toEqual([])
		expect(withSubmissionChecks([...connectivity, ...healthy], publicChecks).map(check => check.kind)).toEqual(['read-rpc', 'public-rpc'])
	})

	test('proves the exact private-transaction method used by single-transaction submission', async () => {
		const signedMessages: (string | Uint8Array)[] = []
		const authentication = {
			...relayAuthentication,
			signMessage: async (message: string | Uint8Array) => {
				signedMessages.push(message)
				return relayAuthenticationSignature
			},
		}
		const relay = (supportsPrivateTransactions: boolean) =>
			rpc((method, params, request) => {
				if (method === 'eth_chainId') return '0x1'
				if (method === 'eth_sendPrivateTransaction') {
					const authenticationHeader = request.headers.get('x-flashbots-signature')
					if (authenticationHeader === null) return Response.json({ error: { code: -32_600, message: 'x-flashbots-signature is required' }, id: null, jsonrpc: '2.0' })
					if (authenticationHeader !== validRelayAuthenticationHeader) return invalidRelayAuthenticationResponse()
					expect(authenticationHeader).toBe(`${authentication.address}:${relayAuthenticationSignature}`)
					expect(params).toEqual([{ tx: TRANSACTION_SUBMISSION_CAPABILITY_PROBE }])
					return Response.json({
						error: supportsPrivateTransactions ? { code: -32_602, message: 'failed to recover the signer' } : { code: -32_601, message: 'method not found' },
						id: 1,
						jsonrpc: '2.0',
					})
				}
				throw new Error(`Unexpected method: ${method}`)
			})
		const settings = (url: string) => validateSubmissionSettings({ mode: 'private', relayUrls: [url] })
		await expect(checkPrivateTransactionSubmissionEndpoints(settings(relay(true)), 1, authentication)).resolves.toMatchObject([{ authenticatedAddress: authentication.address, chainId: 1, status: 'healthy' }])
		await expect(checkPrivateTransactionSubmissionEndpoints(settings(relay(false)), 1, authentication)).rejects.toThrow('did not prove authenticated eth_sendPrivateTransaction support')
		const expectedBody = JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_sendPrivateTransaction', params: [{ tx: TRANSACTION_SUBMISSION_CAPABILITY_PROBE }] })
		expect(signedMessages).toEqual([keccak256(expectedBody), keccak256(expectedBody)])
	})

	test('rejects transaction parsing evidence when the target method does not enforce relay authentication', async () => {
		const requestedAuthenticationHeaders: Array<string | null> = []
		const endpoint = rpc((method, _params, request) => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendPrivateTransaction') {
				requestedAuthenticationHeaders.push(request.headers.get('x-flashbots-signature'))
				return Response.json({ error: { code: -32_602, message: 'failed to recover the signer' }, id: 1, jsonrpc: '2.0' })
			}
			throw new Error(`Unexpected method: ${method}`)
		})

		await expect(checkPrivateTransactionSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [endpoint] }), 1, relayAuthentication)).rejects.toThrow('authentication')
		expect(requestedAuthenticationHeaders).toEqual([expect.any(String), null])
	})

	test('rejects a relay that checks header presence but defers signature validation until after transaction parsing', async () => {
		const requestedAuthenticationHeaders: Array<string | null> = []
		const endpoint = rpc((method, _params, request) => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendPrivateTransaction') {
				const header = request.headers.get('x-flashbots-signature')
				requestedAuthenticationHeaders.push(header)
				return header === null ? Response.json({ error: { code: -32_600, message: 'x-flashbots-signature is required' }, id: null, jsonrpc: '2.0' }, { status: 401 }) : Response.json({ error: { code: -32_602, message: 'failed to recover the signer' }, id: 1, jsonrpc: '2.0' })
			}
			throw new Error(`Unexpected method: ${method}`)
		})

		await expect(checkPrivateTransactionSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [endpoint] }), 1, relayAuthentication)).rejects.toThrow('authentication signature validation')
		expect(requestedAuthenticationHeaders).toEqual([expect.any(String), null, expect.any(String)])
	})

	test('rejects a relay that only checks signature scalar shape before transaction parsing', async () => {
		const cryptographicAuthentication = privateKeyToAccount(`0x${'11'.repeat(32)}`)
		const requestedAuthenticationHeaders: Array<string | null> = []
		const endpoint = rpc((method, _params, request) => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendPrivateTransaction') {
				const header = request.headers.get('x-flashbots-signature')
				requestedAuthenticationHeaders.push(header)
				if (header === null) return Response.json({ error: { code: -32_600, message: 'x-flashbots-signature is required' }, id: null, jsonrpc: '2.0' }, { status: 401 })
				const signature = header.split(':')[1]
				return signature === `0x${'00'.repeat(65)}` ? invalidRelayAuthenticationResponse() : Response.json({ error: { code: -32_602, message: 'failed to recover the signer' }, id: 1, jsonrpc: '2.0' })
			}
			throw new Error(`Unexpected method: ${method}`)
		})

		await expect(checkPrivateTransactionSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [endpoint] }), 1, cryptographicAuthentication)).rejects.toThrow('authentication signature validation')
		expect(requestedAuthenticationHeaders).toHaveLength(3)
		const configuredHeader = requestedAuthenticationHeaders[0]
		const mismatchHeader = requestedAuthenticationHeaders[2]
		if (configuredHeader === undefined || configuredHeader === null || mismatchHeader === undefined || mismatchHeader === null) throw new Error('Capability controls did not send relay authentication')
		const [configuredClaim, configuredSignature] = configuredHeader.split(':')
		const [mismatchClaim, mismatchSignature] = mismatchHeader.split(':')
		if (configuredClaim === undefined || configuredSignature === undefined || mismatchClaim === undefined || mismatchSignature === undefined) throw new Error('Capability control sent malformed relay authentication')
		const capabilityBody = JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_sendPrivateTransaction', params: [{ tx: TRANSACTION_SUBMISSION_CAPABILITY_PROBE }] })
		const signedMessage = keccak256(capabilityBody)
		expect(eip191Signer.recoverPublicKey(configuredSignature, signedMessage).toLowerCase()).toBe(cryptographicAuthentication.address.toLowerCase())
		expect(configuredClaim.toLowerCase()).toBe(cryptographicAuthentication.address.toLowerCase())
		expect(eip191Signer.recoverPublicKey(mismatchSignature, signedMessage).toLowerCase()).not.toBe(mismatchClaim.toLowerCase())
		expect(mismatchClaim.toLowerCase()).not.toBe(cryptographicAuthentication.address.toLowerCase())
		expect(eip191Signer.recoverPublicKey(mismatchSignature, signedMessage).toLowerCase()).not.toBe(cryptographicAuthentication.address.toLowerCase())
		expect(mismatchHeader.endsWith(`0x${'00'.repeat(65)}`)).toBeFalse()
	})

	test.each(['invalid signature', 'x-flashbots-signature is not required', 'authentication header is optional', 'missing signature'])('rejects ambiguous or negative unauthenticated target evidence: %s', async unauthenticatedMessage => {
		const endpoint = rpc((method, _params, request) => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendPrivateTransaction') {
				return request.headers.get('x-flashbots-signature') === null ? Response.json({ error: { code: -32_600, message: unauthenticatedMessage }, id: null, jsonrpc: '2.0' }) : Response.json({ error: { code: -32_602, message: 'failed to recover the signer' }, id: 1, jsonrpc: '2.0' })
			}
			throw new Error(`Unexpected method: ${method}`)
		})

		await expect(checkPrivateTransactionSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [endpoint] }), 1, relayAuthentication)).rejects.toThrow('authentication')
	})

	test.each([
		{ code: -32_602, id: 1, message: 'authentication required', status: 200 },
		{ code: -32_600, id: null, message: 'missing x-flashbots-signature', status: 401 },
		{ code: -32_099, id: 1, message: 'relay authentication is missing', status: 403 },
		{ code: -32_000, id: null, message: 'authorization header required.', status: 403 },
	])('accepts exact missing-authentication control boundary %#', async ({ code, id, message, status }) => {
		const endpoint = privateTransactionRelayWithAuthenticationControls({
			missingAuthentication: () => Response.json({ error: { code, message }, id, jsonrpc: '2.0' }, { status }),
		})

		await expect(checkPrivateTransactionSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [endpoint] }), 1, relayAuthentication)).resolves.toMatchObject([{ status: 'healthy' }])
	})

	test.each([
		{ code: -32_600, id: null, message: 'x-flashbots-signature is required', status: 201 },
		{ code: -32_600, id: null, message: 'x-flashbots-signature is required', status: 400 },
		{ code: -32_600, id: null, message: 'x-flashbots-signature is required', status: 402 },
		{ code: -32_600, id: null, message: 'x-flashbots-signature is required', status: 404 },
		{ code: -32_600, id: 2, message: 'x-flashbots-signature is required', status: 403 },
		{ code: -32_601, id: null, message: 'x-flashbots-signature is required', status: 403 },
		{ code: -32_100, id: null, message: 'x-flashbots-signature is required', status: 403 },
		{ code: -31_999, id: null, message: 'x-flashbots-signature is required', status: 403 },
		{ code: -32_600, id: null, message: 'relay says x-flashbots-signature is required', status: 403 },
		{ code: -32_600, id: null, message: 'x-flashbots-signature is required for this request', status: 403 },
	])('rejects missing-authentication control boundary %#', async ({ code, id, message, status }) => {
		const endpoint = privateTransactionRelayWithAuthenticationControls({
			missingAuthentication: () => Response.json({ error: { code, message }, id, jsonrpc: '2.0' }, { status }),
		})

		await expect(checkPrivateTransactionSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [endpoint] }), 1, relayAuthentication)).rejects.toThrow()
	})

	test.each([
		{ code: -32_602, id: 1, message: 'invalid x-flashbots-signature', status: 401 },
		{ code: -32_600, id: null, message: 'flashbots authentication was rejected', status: 403 },
		{ code: -32_099, id: 1, message: 'relay authentication is invalid.', status: 403 },
		{ code: -32_000, id: null, message: 'rejected authorization header!', status: 401 },
	])('accepts exact invalid-authentication control boundary %#', async ({ code, id, message, status }) => {
		const endpoint = privateTransactionRelayWithAuthenticationControls({
			invalidAuthentication: () => Response.json({ error: { code, message }, id, jsonrpc: '2.0' }, { status }),
		})

		await expect(checkPrivateTransactionSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [endpoint] }), 1, relayAuthentication)).resolves.toMatchObject([{ status: 'healthy' }])
	})

	test.each([
		{ code: -32_600, id: null, message: 'invalid flashbots signature', status: 200 },
		{ code: -32_600, id: null, message: 'invalid flashbots signature', status: 201 },
		{ code: -32_600, id: null, message: 'invalid flashbots signature', status: 400 },
		{ code: -32_600, id: null, message: 'invalid flashbots signature', status: 402 },
		{ code: -32_600, id: null, message: 'invalid flashbots signature', status: 404 },
		{ code: -32_600, id: 2, message: 'invalid flashbots signature', status: 403 },
		{ code: -32_601, id: null, message: 'invalid flashbots signature', status: 403 },
		{ code: -32_100, id: null, message: 'invalid flashbots signature', status: 403 },
		{ code: -31_999, id: null, message: 'invalid flashbots signature', status: 403 },
		{ code: -32_600, id: null, message: 'x-flashbots-signature is not invalid', status: 403 },
		{ code: -32_600, id: null, message: 'authentication header is optional', status: 403 },
		{ code: -32_600, id: null, message: 'invalid signature', status: 403 },
		{ code: -32_600, id: null, message: 'relay says invalid flashbots signature', status: 403 },
		{ code: -32_600, id: null, message: 'invalid flashbots signature for this request', status: 403 },
	])('rejects invalid-authentication control boundary %#', async ({ code, id, message, status }) => {
		const endpoint = privateTransactionRelayWithAuthenticationControls({
			invalidAuthentication: () => Response.json({ error: { code, message }, id, jsonrpc: '2.0' }, { status }),
		})

		await expect(checkPrivateTransactionSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [endpoint] }), 1, relayAuthentication)).rejects.toThrow()
	})

	test('accepts the strict authenticated control sequence used by the official Sepolia Flashbots relay', async () => {
		const unsupportedMethod = 'zoltar_unsupportedRelayCapabilityProbe_f8b1e7c34d929a650c42bf176f80e2196a7d44ce53239018bd631cc9a4e5702f'
		const cancellationHash = keccak256(TRANSACTION_SUBMISSION_CAPABILITY_PROBE)
		const signedMessages: (string | Uint8Array)[] = []
		const authentication = {
			...relayAuthentication,
			signMessage: async (message: string | Uint8Array) => {
				signedMessages.push(message)
				return relayAuthenticationSignature
			},
		}
		const requestedMethods: string[] = []
		const relay = rpc((method, params, request) => {
			requestedMethods.push(method)
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendPrivateTransaction') {
				if (request.headers.get('x-flashbots-signature') !== validRelayAuthenticationHeader) return invalidRelayAuthenticationResponse()
				expect(params).toEqual([{ tx: TRANSACTION_SUBMISSION_CAPABILITY_PROBE }])
				return Response.json({ error: { code: -32_600, data: null, message: 'incorrect request' }, id: 1, jsonrpc: '2.0' })
			}
			if (method === unsupportedMethod) {
				expect(request.headers.get('x-flashbots-signature')).not.toBeNull()
				expect(params).toEqual([])
				return Response.json({ error: { code: -32_601, message: 'rpc method is not whitelisted' }, id: 1, jsonrpc: '2.0' }, { status: 403 })
			}
			if (method === 'eth_cancelPrivateTransaction') {
				expect(params).toEqual([{ txHash: cancellationHash }])
				return request.headers.get('x-flashbots-signature') === null ? Response.json({ error: { code: -32_600, message: 'signature is required' }, id: null, jsonrpc: '2.0' }) : Response.json({ error: { code: -32_700, data: null, message: 'tx not found' }, id: 1, jsonrpc: '2.0' })
			}
			throw new Error(`Unexpected method: ${method}`)
		})

		const settings = validateSubmissionSettings({ mode: 'private', relayUrls: [relay] })
		await expect(checkPrivateTransactionSubmissionEndpoints(settings, 1, authentication)).resolves.toMatchObject([{ authenticatedAddress: authentication.address, chainId: 1, status: 'healthy' }])
		expect(requestedMethods).toEqual(['eth_chainId', 'eth_sendPrivateTransaction', unsupportedMethod, 'eth_cancelPrivateTransaction', 'eth_cancelPrivateTransaction'])
		const authenticatedBodies = [
			{ id: 1, jsonrpc: '2.0', method: 'eth_sendPrivateTransaction', params: [{ tx: TRANSACTION_SUBMISSION_CAPABILITY_PROBE }] },
			{ id: 1, jsonrpc: '2.0', method: unsupportedMethod, params: [] },
			{ id: 1, jsonrpc: '2.0', method: 'eth_cancelPrivateTransaction', params: [{ txHash: cancellationHash }] },
		]
		expect(signedMessages).toEqual(authenticatedBodies.map(body => keccak256(JSON.stringify(body))))
	})

	test.each(['unsupported-method', 'authenticated-cancellation', 'unauthenticated-cancellation'] as const)('fails closed when the Flashbots private capability %s control is inconclusive', async brokenControl => {
		const unsupportedMethod = 'zoltar_unsupportedRelayCapabilityProbe_f8b1e7c34d929a650c42bf176f80e2196a7d44ce53239018bd631cc9a4e5702f'
		const cancellationHash = keccak256(TRANSACTION_SUBMISSION_CAPABILITY_PROBE)
		const relay = rpc((method, params, request) => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendPrivateTransaction') {
				if (request.headers.get('x-flashbots-signature') !== validRelayAuthenticationHeader) return invalidRelayAuthenticationResponse()
				return Response.json({ error: { code: -32_600, data: null, message: 'incorrect request' }, id: 1, jsonrpc: '2.0' })
			}
			if (method === unsupportedMethod) {
				return brokenControl === 'unsupported-method' ? Response.json({ error: { code: -32_601, message: 'rpc method is not whitelisted' }, id: 1, jsonrpc: '2.0' }) : Response.json({ error: { code: -32_601, message: 'rpc method is not whitelisted' }, id: 1, jsonrpc: '2.0' }, { status: 403 })
			}
			if (method === 'eth_cancelPrivateTransaction') {
				expect(params).toEqual([{ txHash: cancellationHash }])
				if (request.headers.get('x-flashbots-signature') !== null) {
					return brokenControl === 'authenticated-cancellation' ? Response.json({ error: { code: -32_700, data: null, message: 'tx not found' }, id: 1, jsonrpc: '2.0' }, { status: 201 }) : Response.json({ error: { code: -32_700, data: null, message: 'tx not found' }, id: 1, jsonrpc: '2.0' })
				}
				return brokenControl === 'unauthenticated-cancellation' ? Response.json({ error: { code: -32_600, message: 'signature is required' }, id: null, jsonrpc: '2.0' }, { status: 403 }) : Response.json({ error: { code: -32_600, message: 'signature is required' }, id: null, jsonrpc: '2.0' })
			}
			throw new Error(`Unexpected method: ${method}`)
		})

		await expect(checkPrivateTransactionSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [relay] }), 1, relayAuthentication)).rejects.toThrow('control')
	})

	test('counts healthy distinct relay origins toward private-transaction preflight threshold', async () => {
		const acceptedOrigin = rpc((method, _params, request) => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendPrivateTransaction') {
				const authenticationHeader = request.headers.get('x-flashbots-signature')
				if (authenticationHeader === null) return Response.json({ error: { code: -32_600, message: 'x-flashbots-signature is required' }, id: null, jsonrpc: '2.0' })
				return authenticationHeader === validRelayAuthenticationHeader ? Response.json({ error: { code: -32_602, message: 'failed to recover the signer' }, id: 1, jsonrpc: '2.0' }) : invalidRelayAuthenticationResponse()
			}
			throw new Error(`Unexpected method: ${method}`)
		})
		const rejectedOrigin = rpc(() => Response.json({ error: { code: -32_000, message: 'temporarily unavailable' }, id: 1, jsonrpc: '2.0' }, { status: 503 }))
		const settings = validateSubmissionSettings({
			minimumBundleRelaySuccesses: 2,
			mode: 'private',
			relayUrls: [`${acceptedOrigin}/one`, `${acceptedOrigin}/two`, rejectedOrigin],
		})
		await expect(checkPrivateTransactionSubmissionEndpoints(settings, 1, relayAuthentication)).rejects.toThrow()
	})

	test('tolerates private transport degradation at threshold but fails closed on authentication rejection', async () => {
		const capableRelay = () =>
			rpc((method, _params, request) => {
				if (method === 'eth_chainId') return '0x1'
				if (method === 'eth_sendPrivateTransaction') {
					const authenticationHeader = request.headers.get('x-flashbots-signature')
					if (authenticationHeader === null) return Response.json({ error: { code: -32_600, message: 'x-flashbots-signature is required' }, id: null, jsonrpc: '2.0' })
					return authenticationHeader === validRelayAuthenticationHeader ? Response.json({ error: { code: -32_602, message: 'failed to recover the signer' }, id: 1, jsonrpc: '2.0' }) : invalidRelayAuthenticationResponse()
				}
				throw new Error(`Unexpected method: ${method}`)
			})
		const firstCapableRelay = capableRelay()
		const secondCapableRelay = capableRelay()
		const unavailableRelay = rpc(() => new Response('temporarily unavailable', { status: 503 }))
		const authenticationRejectingRelay = rpc(method => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendPrivateTransaction') return Response.json({ error: { code: -32_600, message: 'invalid flashbots signature' }, id: 1, jsonrpc: '2.0' })
			throw new Error(`Unexpected method: ${method}`)
		})
		const submissionSettings = (thirdRelay: string) =>
			validateSubmissionSettings({
				minimumBundleRelaySuccesses: 2,
				mode: 'private',
				relayUrls: [firstCapableRelay, secondCapableRelay, thirdRelay],
			})

		await expect(checkPrivateTransactionSubmissionEndpoints(submissionSettings(unavailableRelay), 1, relayAuthentication)).resolves.toMatchObject([{ status: 'healthy' }, { status: 'healthy' }, { failureDisposition: 'connectivity-degraded', status: 'failed' }])
		await expect(checkPrivateTransactionSubmissionEndpoints(submissionSettings(authenticationRejectingRelay), 1, relayAuthentication)).rejects.toThrow('invalid flashbots signature')
	})

	test('counts healthy distinct relay origins toward bundle capability preflight threshold', async () => {
		const acceptedOrigin = rpc(method => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_callBundle' || method === 'eth_sendBundle') return Response.json({ error: { code: -32_602, message: 'invalid params' }, id: 1, jsonrpc: '2.0' })
			throw new Error(`Unexpected method: ${method}`)
		})
		const rejectedOrigin = rpc(() => Response.json({ error: { code: -32_000, message: 'temporarily unavailable' }, id: 1, jsonrpc: '2.0' }, { status: 503 }))
		const settings = validateSubmissionSettings({
			minimumBundleRelaySuccesses: 2,
			mode: 'private',
			relayUrls: [`${acceptedOrigin}/one`, `${acceptedOrigin}/two`, rejectedOrigin],
		})
		await expect(checkSubmissionEndpoints(settings, 1)).rejects.toThrow()
	})

	test('rejects a relay that advertises the method but rejects the configured authentication', async () => {
		const requestedMethods: string[] = []
		const authenticationRejectingRelay = rpc((method, _params, request) => {
			requestedMethods.push(method)
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendPrivateTransaction') {
				expect(request.headers.get('x-flashbots-signature')).not.toBeNull()
				return Response.json({ error: { code: -32_600, message: 'invalid flashbots signature' }, id: 1, jsonrpc: '2.0' })
			}
			expect(request.headers.get('x-flashbots-signature')).toBeNull()
			return Response.json({ error: { code: -32_600, message: 'signature is required' }, id: 1, jsonrpc: '2.0' })
		})
		const settings = validateSubmissionSettings({ mode: 'private', relayUrls: [authenticationRejectingRelay] })
		const state: { endpointChecks: EndpointCheck[] } = { endpointChecks: [] }
		await expect(updateSubmissionEndpointChecks(state, () => checkPrivateTransactionSubmissionEndpoints(settings, 1, relayAuthentication))).rejects.toThrow('authenticated eth_sendPrivateTransaction')
		expect(requestedMethods).toEqual(['eth_chainId', 'eth_sendPrivateTransaction'])
		expect(state.endpointChecks).toMatchObject([{ authenticatedAddress: relayAuthentication.address, chainId: 1, failureDisposition: 'safety-paused', kind: 'private-relay', status: 'failed' }])
		await expect(checkSubmissionEndpoints(settings, 1)).resolves.toMatchObject([{ chainId: 1, status: 'healthy' }])
	})

	test('does not decode a non-success target-method response as capability evidence', async () => {
		const endpoint = rpc(method => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendPrivateTransaction') return Response.json({ error: { code: -32_025, message: 'invalid flashbots signature' }, id: null, jsonrpc: '2.0' }, { status: 403 })
			throw new Error(`Unexpected method: ${method}`)
		})
		await expect(checkPrivateTransactionSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [endpoint] }), 1, relayAuthentication)).rejects.toThrow('RPC returned HTTP 403')
	})

	test.each([
		{ response: () => new Response('<html>forbidden</html>') },
		{ response: () => Response.json({ error: { code: -32_602, message: 'failed to recover the signer' }, id: 2, jsonrpc: '2.0' }) },
		{ response: () => Response.json({ error: { code: -32_601, message: 'method not found' }, id: 1, jsonrpc: '2.0' }) },
		{ response: () => Response.json({ error: { code: -32_602, message: 'invalid params' }, id: 1, jsonrpc: '2.0' }) },
		{ response: () => Response.json({ error: { code: -32_602, message: 'invalid signature' }, id: 1, jsonrpc: '2.0' }) },
		{ response: () => Response.json({ error: { code: -32_602, message: 'access denied: invalid sender' }, id: 1, jsonrpc: '2.0' }) },
		{ response: () => Response.json({ error: { code: -32_602, message: 'invalid argument: X-Flashbots-Signature verification failed' }, id: 1, jsonrpc: '2.0' }) },
		{ response: () => Response.json({ id: 1, jsonrpc: '2.0', result: `0x${'11'.repeat(32)}` }) },
		{ response: () => new Response('x'.repeat(4 * 1024 * 1024 + 1)) },
	])('rejects malformed or inconclusive authenticated capability responses %#', async ({ response }) => {
		const endpoint = rpc(method => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendPrivateTransaction') return response()
			throw new Error(`Unexpected method: ${method}`)
		})
		await expect(checkPrivateTransactionSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [endpoint] }), 1, relayAuthentication)).rejects.toThrow('eth_sendPrivateTransaction')
	})

	test('identifies the RPC origin and method once for a wrong-chain connectivity probe', async () => {
		const wrongChain = rpc(method => {
			if (method === 'eth_chainId') return '0x2'
			throw new Error(`Unexpected method: ${method}`)
		})
		const healthy = rpc(method => {
			if (method === 'eth_chainId') return '0x1'
			throw new Error(`Unexpected method: ${method}`)
		})
		let failure: unknown
		try {
			await checkConnectivity(validateConnectivitySettings({ publicRpcUrls: [healthy], readRpcUrl: wrongChain }), 1)
		} catch (error) {
			failure = error
		}
		const message = failure instanceof Error ? failure.message : String(failure)
		expect(message).toContain('Expected chain 1')
		expect(message.match(/eth_chainId/g)).toHaveLength(1)
		expect(message.match(new RegExp(new URL(wrongChain).origin.replaceAll('.', '\\.'), 'g'))).toHaveLength(1)
	})

	test('rejects a same-chain JSON-RPC endpoint that is not a private transaction relay', async () => {
		for (const error of [
			{ code: -32_601, message: 'fetch failed with HTTP 500' },
			{ code: -32_601, message: 'method not found' },
			{ code: -32_004, message: 'Method not supported' },
			{ code: -32_004, message: 'invalid params' },
			{ code: -32_000, message: 'unsupported method' },
			{ code: -32_000, message: 'upstream unavailable' },
		]) {
			const regularRpc = rpc(method => {
				if (method === 'eth_chainId') return '0x1'
				if (method === 'eth_callBundle' || method === 'eth_sendBundle') return Response.json({ error, id: 1, jsonrpc: '2.0' })
				throw new Error(`Unexpected method: ${method}`)
			})
			const settings = validateSubmissionSettings({ mode: 'private', relayUrls: [regularRpc] })
			const state: { endpointChecks: EndpointCheck[] } = { endpointChecks: [] }
			await expect(updateSubmissionEndpointChecks(state, () => checkSubmissionEndpoints(settings, 1))).rejects.toThrow('did not prove eth_callBundle support')
			expect(state.endpointChecks).toMatchObject([{ chainId: 1, kind: 'private-relay', status: 'failed' }])
			expect(state.endpointChecks[0]?.error).toContain(error.message)
			expect(state.endpointChecks[0]?.failureDisposition).toBe('safety-paused')
		}
	})

	test('keeps coded JSON-RPC failures safety-classified even when their message resembles transport loss', async () => {
		const endpoint = rpc(() => Response.json({ error: { code: -32_000, message: 'fetch failed with HTTP 500' }, id: 1, jsonrpc: '2.0' }))
		const state: { endpointChecks: EndpointCheck[] } = { endpointChecks: [] }
		await expect(updateConnectivityEndpointChecks(state, () => checkConnectivity(validateConnectivitySettings({ publicRpcUrls: [endpoint], readRpcUrl: endpoint }), 1))).rejects.toThrow('fetch failed with HTTP 500')
		expect(state.endpointChecks).toHaveLength(2)
		expect(state.endpointChecks.every(check => check.failureDisposition === 'safety-paused')).toBe(true)
	})

	test('classifies a non-JSON retryable HTTP response as degraded connectivity', async () => {
		const server = Bun.serve({ fetch: () => new Response('temporarily unavailable', { status: 503 }), hostname: '127.0.0.1', port: 0 })
		servers.push(server)
		if (server.port === undefined) throw new Error('Test RPC did not expose a port')
		const endpoint = `http://127.0.0.1:${server.port.toString()}/`
		const state: { endpointChecks: EndpointCheck[] } = { endpointChecks: [] }
		await expect(updateConnectivityEndpointChecks(state, () => checkConnectivity(validateConnectivitySettings({ publicRpcUrls: [endpoint], readRpcUrl: endpoint }), 1))).rejects.toThrow('HTTP 503')
		expect(state.endpointChecks).toHaveLength(2)
		expect(state.endpointChecks.every(check => check.failureDisposition === 'connectivity-degraded')).toBe(true)
	})

	test('identifies the RPC origin and method for unreachable connectivity endpoints without exposing URL secrets', async () => {
		const healthy = rpc(method => {
			if (method === 'eth_chainId') return '0x1'
			throw new Error(`Unexpected method: ${method}`)
		})
		const unavailable = 'http://127.0.0.1:1/private/provider-key?token=query-secret'
		let failure: unknown
		try {
			await checkConnectivity(validateConnectivitySettings({ publicRpcUrls: [healthy], readRpcUrl: unavailable }), 1)
		} catch (error) {
			failure = error
		}
		const message = failure instanceof Error ? failure.message : String(failure)
		expect(message.match(new RegExp(new URL(unavailable).origin.replaceAll('.', '\\.'), 'g'))).toHaveLength(1)
		expect(message.match(/eth_chainId/g)).toHaveLength(1)
		expect(message).not.toContain('provider-key')
		expect(message).not.toContain('query-secret')
	})

	test('accepts structured signature and invalid-parameter errors as positive relay capability evidence', async () => {
		for (const error of [
			{ code: -32_600, message: 'signature is required' },
			{ code: -32_602, message: 'invalid params' },
		]) {
			const privateRelay = rpc(method => {
				if (method === 'eth_chainId') return '0x1'
				if (method === 'eth_callBundle' || method === 'eth_sendBundle') return Response.json({ error, id: 1, jsonrpc: '2.0' })
				throw new Error(`Unexpected method: ${method}`)
			})
			await expect(checkSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [privateRelay] }), 1)).resolves.toMatchObject([{ chainId: 1, status: 'healthy' }])
		}
	})

	test('rejects malformed and successful private transaction probe responses as inconclusive', async () => {
		for (const responseBody of [
			{ id: 1, jsonrpc: '2.0', result: null },
			{ error: { code: -32_602, message: 'invalid params' }, id: 1, jsonrpc: '1.0' },
			{ error: { code: -32_602, message: 'invalid params' }, id: 2, jsonrpc: '2.0' },
			{ error: { code: -32_602, message: 'invalid params' }, id: 1, jsonrpc: '2.0', result: null },
			{ error: { code: -32_602 }, id: 1, jsonrpc: '2.0' },
			{ error: 'invalid params', id: 1, jsonrpc: '2.0' },
		]) {
			const endpoint = rpc(method => {
				if (method === 'eth_chainId') return '0x1'
				if (method === 'eth_callBundle' || method === 'eth_sendBundle') return Response.json(responseBody)
				throw new Error(`Unexpected method: ${method}`)
			})
			await expect(checkSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [endpoint] }), 1)).rejects.toThrow('did not prove eth_callBundle support')
		}
	})

	test('rejects unavailable private relays even when their body resembles capability evidence', async () => {
		const endpoint = rpc(method => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_callBundle' || method === 'eth_sendBundle') return Response.json({ error: { code: -32_600, message: 'signature is required' }, id: 1, jsonrpc: '2.0' }, { status: 503 })
			throw new Error(`Unexpected method: ${method}`)
		})
		let failure: unknown
		try {
			await checkSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [`${endpoint}/private/provider-key`] }), 1)
		} catch (error) {
			failure = error
		}
		const message = failure instanceof Error ? failure.message : String(failure)
		expect(message.match(new RegExp(new URL(endpoint).origin.replaceAll('.', '\\.'), 'g'))).toHaveLength(1)
		expect(message).toContain('HTTP 503')
		expect(message.match(/eth_callBundle/g)).toHaveLength(1)
		expect(message).not.toContain('provider-key')
	})

	test('preserves every endpoint role regardless of concurrent update completion order', async () => {
		const privateRelay = { chainId: 1, checkedAt: new Date().toISOString(), error: undefined, kind: 'private-relay', status: 'healthy', target: 'https://relay.example/' } as const
		const readRpc = { chainId: 1, checkedAt: new Date().toISOString(), error: undefined, kind: 'read-rpc', status: 'healthy', target: 'https://read.example/' } as const
		const publicRpc = { chainId: 1, checkedAt: new Date().toISOString(), error: undefined, kind: 'public-rpc', status: 'healthy', target: 'https://submit.example/' } as const
		for (const completionOrder of ['connectivity-first', 'submission-first'] as const) {
			let releaseConnectivity: ((checks: readonly EndpointCheck[]) => void) | undefined
			let releaseSubmission: ((checks: readonly EndpointCheck[]) => void) | undefined
			const connectivity = new Promise<readonly EndpointCheck[]>(resolve => {
				releaseConnectivity = resolve
			})
			const submission = new Promise<readonly EndpointCheck[]>(resolve => {
				releaseSubmission = resolve
			})
			const state: { endpointChecks: EndpointCheck[] } = { endpointChecks: [] }
			const updates = [updateConnectivityEndpointChecks(state, () => connectivity), updateSubmissionEndpointChecks(state, () => submission)]
			if (releaseConnectivity === undefined || releaseSubmission === undefined) throw new Error('Endpoint check releases were not initialized')
			if (completionOrder === 'connectivity-first') {
				releaseConnectivity([readRpc, publicRpc])
				releaseSubmission([privateRelay])
			} else {
				releaseSubmission([privateRelay])
				releaseConnectivity([readRpc, publicRpc])
			}
			await Promise.all(updates)
			expect(state.endpointChecks.map(check => check.kind)).toEqual(['read-rpc', 'public-rpc', 'private-relay'])
		}
	})
})
