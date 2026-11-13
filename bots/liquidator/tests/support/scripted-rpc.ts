import { portfolioSettings } from './portfolio-observation.ts'

/** Serves JSON-RPC results from `respond`, which throws for an unexpected method, and returns portfolio settings that read only from that endpoint. */
export function serveScriptedRpc(respond: (method: unknown, params: unknown) => unknown) {
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			const payload: unknown = await request.json()
			if (typeof payload !== 'object' || payload === null) throw new Error('Invalid RPC request')
			const result = respond(Reflect.get(payload, 'method'), Reflect.get(payload, 'params'))
			return Response.json({ jsonrpc: '2.0', id: Reflect.get(payload, 'id'), result })
		},
	})
	const endpoint = `http://127.0.0.1:${server.port}`
	const settings = portfolioSettings()
	settings.connectivity.readRpcUrl = endpoint
	settings.connectivity.quorumRpcUrls = []
	settings.connectivity.rpcQuorum = 1
	return { endpoint, server, settings }
}
