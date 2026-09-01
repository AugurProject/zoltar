import { afterEach, describe, expect, test } from 'bun:test'
import { eip191Signer } from 'micro-eth-signer'
import { keccak256, privateKeyToAccount, recoverTransactionAddress, type Hex } from '#ethereum'
import {
	checkConnectivity,
	checkPrivateTransactionSubmissionEndpoints,
	checkPublicTransactionSubmissionEndpoints,
	checkSubmissionEndpoints,
	endpointLabel,
	flashbotsPrivateTransactionCompatibilityProfileAllowed,
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
const RELAY_AUTHENTICATION_PRIVATE_KEY: Hex = `0x${'44'.repeat(32)}`
const relayAuthentication = privateKeyToAccount(RELAY_AUTHENTICATION_PRIVATE_KEY)

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

function relayAuthenticationHeaderIsValid(value: string | null, method: string, params: readonly unknown[]) {
	if (value === null) return false
	const [address, signature, extra] = value.split(':')
	if (address === undefined || signature === undefined || extra !== undefined || !/^0x[0-9a-fA-F]{40}$/.test(address) || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return false
	return eip191Signer.verify(signature, keccak256(JSON.stringify({ id: 1, jsonrpc: '2.0', method, params })), address)
}

const PRIVATE_TRANSACTION_METHOD_CONTROL = 'zoltar_unsupportedRelayCapabilityProbe_f8b1e7c34d929a650c42bf176f80e2196a7d44ce53239018bd631cc9a4e5702f'

function flashbotsPrivateTransactionRelay() {
	return rpc((method, params, request) => {
		if (method === 'eth_chainId') return '0x1'
		if (method === 'eth_sendPrivateTransaction') {
			if (!relayAuthenticationHeaderIsValid(request.headers.get('x-flashbots-signature'), method, params)) return invalidRelayAuthenticationResponse()
			return Response.json({ error: { code: -32_600, data: null, message: 'incorrect request' }, id: 1, jsonrpc: '2.0' })
		}
		if (method === PRIVATE_TRANSACTION_METHOD_CONTROL) {
			if (!relayAuthenticationHeaderIsValid(request.headers.get('x-flashbots-signature'), method, params)) return invalidRelayAuthenticationResponse()
			return Response.json({ error: { code: -32_601, message: 'rpc method is not whitelisted' }, id: 1, jsonrpc: '2.0' }, { status: 403 })
		}
		if (method === 'eth_cancelPrivateTransaction') {
			const authenticationHeader = request.headers.get('x-flashbots-signature')
			if (authenticationHeader === null) return Response.json({ error: { code: -32_600, message: 'signature is required' }, id: null, jsonrpc: '2.0' })
			if (!relayAuthenticationHeaderIsValid(authenticationHeader, method, params)) return invalidRelayAuthenticationResponse()
			return Response.json({ error: { code: -32_700, data: null, message: 'tx not found' }, id: 1, jsonrpc: '2.0' })
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

	test('rejects a broadcast hash for a different raw transaction', async () => {
		const returnedHash = `0x${'12'.repeat(32)}` as Hex
		const url = rpc(method => {
			if (method === 'eth_sendRawTransaction') return returnedHash
			throw new Error(`Unexpected method: ${method}`)
		})

		await expect(sendRawTransactionToRpc(url, '0x1234')).rejects.toThrow('does not match submitted transaction')
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

	test('accepts the local Reth Docker service over HTTP', () => {
		expect(validateConnectivitySettings({ publicRpcUrls: ['http://reth:8545'], readRpcUrl: 'http://reth:8545' })).toEqual({
			publicRpcUrls: ['http://reth:8545/'],
			readRpcUrl: 'http://reth:8545/',
		})
	})

	test('does not include rejected RPC endpoint secrets in validation errors', () => {
		expect(() => validateReadRpcUrls(['not-a-url?token=RPC_SECRET'])).toThrow(/^Invalid RPC URL$/)
		expect(() => validateReadRpcUrls(['ftp://user:RPC_SECRET@rpc.example/private?key=HIDDEN'])).toThrow(/^RPC URL must use HTTPS or HTTP on loopback, anvil, or reth$/)
	})

	test('checks the configured chain and sends raw transactions', async () => {
		const hash = keccak256('0x1234')
		const uppercaseHash = `0x${hash.slice(2).toUpperCase()}`
		const url = rpc((method, params) => {
			if (method === 'eth_chainId') return '0xaa36a7'
			if (method === 'eth_sendRawTransaction') {
				expect(params).toEqual(['0x1234'])
				return uppercaseHash
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

	test('timestamps successful public submission evidence after capability validation completes', async () => {
		let capabilityCompletedAt: number | undefined
		const capableRpc = rpc(async method => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendRawTransaction') {
				await Bun.sleep(10)
				capabilityCompletedAt = Date.now()
				return Response.json({ error: { code: -32_602, message: 'signature error' }, id: 1, jsonrpc: '2.0' })
			}
			throw new Error(`Unexpected method: ${method}`)
		})

		const checks = await checkPublicTransactionSubmissionEndpoints([capableRpc], 1)
		const completedAt = capabilityCompletedAt
		const check = checks[0]
		if (completedAt === undefined || check === undefined) throw new Error('Public capability completion fixture did not run')
		expect(Date.parse(check.checkedAt)).toBeGreaterThanOrEqual(completedAt)
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
		let unavailableCompletedAt: number | undefined
		const unavailableRpc = rpc(async () => {
			await Bun.sleep(10)
			unavailableCompletedAt = Date.now()
			return new Response('temporarily unavailable', { status: 503 })
		})
		const readOnlyRpc = rpc(method => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendRawTransaction') return Response.json({ error: { code: -32_601, message: 'method not found' }, id: 1, jsonrpc: '2.0' })
			throw new Error(`Unexpected method: ${method}`)
		})

		const degradedChecks = await checkPublicTransactionSubmissionEndpoints([capableRpc, unavailableRpc], 1)
		expect(degradedChecks).toMatchObject([
			{ chainId: 1, status: 'healthy' },
			{ failureDisposition: 'connectivity-degraded', status: 'failed' },
		])
		const failureCompletedAt = unavailableCompletedAt
		const degradedCheck = degradedChecks[1]
		if (failureCompletedAt === undefined || degradedCheck === undefined) throw new Error('Public degradation completion fixture did not run')
		expect(Date.parse(degradedCheck.checkedAt)).toBeGreaterThanOrEqual(failureCompletedAt)
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

	test('rejects a relay that applies configured-account authorization only after transaction parsing', async () => {
		let parsedConfiguredRequests = 0
		const endpoint = rpc((method, params, request) => {
			if (method === 'eth_chainId') return '0x1'
			if (method !== 'eth_sendPrivateTransaction') throw new Error(`Unexpected method: ${method}`)
			const authenticationHeader = request.headers.get('x-flashbots-signature')
			if (authenticationHeader === null) return Response.json({ error: { code: -32_600, message: 'x-flashbots-signature is required' }, id: null, jsonrpc: '2.0' }, { status: 401 })
			if (!relayAuthenticationHeaderIsValid(authenticationHeader, method, params)) return invalidRelayAuthenticationResponse()
			const value = params[0]
			if (typeof value === 'object' && value !== null && 'tx' in value && value.tx === TRANSACTION_SUBMISSION_CAPABILITY_PROBE) {
				return Response.json({ error: { code: -32_602, message: 'failed to recover the signer' }, id: 1, jsonrpc: '2.0' })
			}
			parsedConfiguredRequests += 1
			return Response.json({ error: { code: -32_003, message: 'configured relay account is not authorized' }, id: 1, jsonrpc: '2.0' }, { status: 403 })
		})

		await expect(checkPrivateTransactionSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [endpoint] }), 1, relayAuthentication)).rejects.toThrow('official relay')

		const validTransaction = await relayAuthentication.signTransaction({ chainId: 1, gas: 21_000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, nonce: 0, to: relayAuthentication.address, value: 0n })
		const validBody = JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_sendPrivateTransaction', params: [{ tx: validTransaction }] })
		const validSignature = await relayAuthentication.signMessage(keccak256(validBody))
		const validResponse = await fetch(endpoint, {
			body: validBody,
			headers: { 'content-type': 'application/json', 'x-flashbots-signature': `${relayAuthentication.address}:${validSignature}` },
			method: 'POST',
		})
		expect(validResponse.status).toBe(403)
		expect(parsedConfiguredRequests).toBe(1)
	})

	test('restricts the Flashbots compatibility profile to the official relay for each chain or loopback tests', () => {
		expect(flashbotsPrivateTransactionCompatibilityProfileAllowed('https://relay.flashbots.net', 1)).toBeTrue()
		expect(flashbotsPrivateTransactionCompatibilityProfileAllowed('https://relay-sepolia.flashbots.net', 11_155_111)).toBeTrue()
		expect(flashbotsPrivateTransactionCompatibilityProfileAllowed('https://relay-sepolia.flashbots.net/path', 11_155_111)).toBeTrue()
		expect(flashbotsPrivateTransactionCompatibilityProfileAllowed('https://relay-sepolia.flashbots.net', 1)).toBeFalse()
		expect(flashbotsPrivateTransactionCompatibilityProfileAllowed('https://relay.flashbots.net', 11_155_111)).toBeFalse()
		expect(flashbotsPrivateTransactionCompatibilityProfileAllowed('https://untrusted-private-relay.example', 11_155_111)).toBeFalse()
		expect(flashbotsPrivateTransactionCompatibilityProfileAllowed('http://127.0.0.1:8545', 1)).toBeTrue()
	})

	test('accepts the strict authenticated control sequence used by the official Sepolia Flashbots relay', async () => {
		const unsupportedMethod = PRIVATE_TRANSACTION_METHOD_CONTROL
		const cancellationHash = keccak256(TRANSACTION_SUBMISSION_CAPABILITY_PROBE)
		const signedMessages: (string | Uint8Array)[] = []
		const authentication = {
			...relayAuthentication,
			signMessage: async (message: string | Uint8Array) => {
				signedMessages.push(message)
				return await relayAuthentication.signMessage(message)
			},
		}
		const requestedMethods: string[] = []
		let controlsCompletedAt: number | undefined
		const relay = rpc(async (method, params, request) => {
			requestedMethods.push(method)
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendPrivateTransaction') {
				if (!relayAuthenticationHeaderIsValid(request.headers.get('x-flashbots-signature'), method, params)) return invalidRelayAuthenticationResponse()
				expect(params).toEqual([{ tx: TRANSACTION_SUBMISSION_CAPABILITY_PROBE }])
				return Response.json({ error: { code: -32_600, data: null, message: 'incorrect request' }, id: 1, jsonrpc: '2.0' })
			}
			if (method === unsupportedMethod) {
				expect(relayAuthenticationHeaderIsValid(request.headers.get('x-flashbots-signature'), method, params)).toBeTrue()
				expect(params).toEqual([])
				return Response.json({ error: { code: -32_601, message: 'rpc method is not whitelisted' }, id: 1, jsonrpc: '2.0' }, { status: 403 })
			}
			if (method === 'eth_cancelPrivateTransaction') {
				expect(params).toEqual([{ txHash: cancellationHash }])
				const authenticationHeader = request.headers.get('x-flashbots-signature')
				if (authenticationHeader === null) {
					await Bun.sleep(10)
					controlsCompletedAt = Date.now()
					return Response.json({ error: { code: -32_600, message: 'signature is required' }, id: null, jsonrpc: '2.0' })
				}
				expect(relayAuthenticationHeaderIsValid(authenticationHeader, method, params)).toBeTrue()
				return Response.json({ error: { code: -32_700, data: null, message: 'tx not found' }, id: 1, jsonrpc: '2.0' })
			}
			throw new Error(`Unexpected method: ${method}`)
		})

		const settings = validateSubmissionSettings({ mode: 'private', relayUrls: [relay] })
		const checks = await checkPrivateTransactionSubmissionEndpoints(settings, 1, authentication)
		expect(checks).toMatchObject([{ authenticatedAddress: authentication.address, chainId: 1, status: 'healthy' }])
		const completedAt = controlsCompletedAt
		const check = checks[0]
		if (completedAt === undefined || check === undefined) throw new Error('Private capability controls completion fixture did not run')
		expect(Date.parse(check.checkedAt)).toBeGreaterThanOrEqual(completedAt)
		expect(requestedMethods).toEqual(['eth_chainId', 'eth_sendPrivateTransaction', unsupportedMethod, 'eth_cancelPrivateTransaction', 'eth_cancelPrivateTransaction'])
		const authenticatedBodies = [
			{ id: 1, jsonrpc: '2.0', method: 'eth_sendPrivateTransaction', params: [{ tx: TRANSACTION_SUBMISSION_CAPABILITY_PROBE }] },
			{ id: 1, jsonrpc: '2.0', method: unsupportedMethod, params: [] },
			{ id: 1, jsonrpc: '2.0', method: 'eth_cancelPrivateTransaction', params: [{ txHash: cancellationHash }] },
		]
		expect(signedMessages).toEqual(authenticatedBodies.map(body => keccak256(JSON.stringify(body))))
	})

	test.each(['unsupported-method', 'authenticated-cancellation', 'unauthenticated-cancellation'] as const)('fails closed when the Flashbots private capability %s control is inconclusive', async brokenControl => {
		const unsupportedMethod = PRIVATE_TRANSACTION_METHOD_CONTROL
		const cancellationHash = keccak256(TRANSACTION_SUBMISSION_CAPABILITY_PROBE)
		const relay = rpc((method, params, request) => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_sendPrivateTransaction') {
				if (!relayAuthenticationHeaderIsValid(request.headers.get('x-flashbots-signature'), method, params)) return invalidRelayAuthenticationResponse()
				return Response.json({ error: { code: -32_600, data: null, message: 'incorrect request' }, id: 1, jsonrpc: '2.0' })
			}
			if (method === unsupportedMethod) {
				expect(relayAuthenticationHeaderIsValid(request.headers.get('x-flashbots-signature'), method, params)).toBeTrue()
				return brokenControl === 'unsupported-method' ? Response.json({ error: { code: -32_601, message: 'rpc method is not whitelisted' }, id: 1, jsonrpc: '2.0' }) : Response.json({ error: { code: -32_601, message: 'rpc method is not whitelisted' }, id: 1, jsonrpc: '2.0' }, { status: 403 })
			}
			if (method === 'eth_cancelPrivateTransaction') {
				expect(params).toEqual([{ txHash: cancellationHash }])
				const authenticationHeader = request.headers.get('x-flashbots-signature')
				if (authenticationHeader !== null) {
					expect(relayAuthenticationHeaderIsValid(authenticationHeader, method, params)).toBeTrue()
					return brokenControl === 'authenticated-cancellation' ? Response.json({ error: { code: -32_700, data: null, message: 'tx not found' }, id: 1, jsonrpc: '2.0' }, { status: 201 }) : Response.json({ error: { code: -32_700, data: null, message: 'tx not found' }, id: 1, jsonrpc: '2.0' })
				}
				return brokenControl === 'unauthenticated-cancellation' ? Response.json({ error: { code: -32_600, message: 'signature is required' }, id: null, jsonrpc: '2.0' }, { status: 403 }) : Response.json({ error: { code: -32_600, message: 'signature is required' }, id: null, jsonrpc: '2.0' })
			}
			throw new Error(`Unexpected method: ${method}`)
		})

		await expect(checkPrivateTransactionSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [relay] }), 1, relayAuthentication)).rejects.toThrow('control')
	})

	test('counts healthy distinct relay origins toward private-transaction preflight threshold', async () => {
		const acceptedOrigin = flashbotsPrivateTransactionRelay()
		const rejectedOrigin = rpc(() => Response.json({ error: { code: -32_000, message: 'temporarily unavailable' }, id: 1, jsonrpc: '2.0' }, { status: 503 }))
		const settings = validateSubmissionSettings({
			minimumBundleRelaySuccesses: 2,
			mode: 'private',
			relayUrls: [`${acceptedOrigin}/one`, `${acceptedOrigin}/two`, rejectedOrigin],
		})
		await expect(checkPrivateTransactionSubmissionEndpoints(settings, 1, relayAuthentication)).rejects.toThrow()
	})

	test('tolerates private transport degradation at threshold but fails closed on authentication rejection', async () => {
		const capableRelay = () => flashbotsPrivateTransactionRelay()
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
