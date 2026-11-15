/** A loopback JSON-RPC stand-in that answers every method with the Sepolia chain id, which satisfies the connectivity probes. */
export function serveSepoliaChainIdRpc() {
	return Bun.serve({
		async fetch(request) {
			const body: unknown = await request.json()
			return Response.json({ id: Reflect.get(Object(body), 'id'), jsonrpc: '2.0', result: '0xaa36a7' })
		},
		hostname: '127.0.0.1',
		port: 0,
	})
}
