import path from 'node:path'

const root = path.resolve(import.meta.dir, '../public')
const server = Bun.serve({
	port: Number(process.env['PORT'] ?? '3001'),
	async fetch(request) {
		const url = new URL(request.url)
		if (url.pathname === '/api/v1/stream') {
			const emitReorg = url.searchParams.get('reorg') === '1'
			let timer: ReturnType<typeof setInterval> | undefined
			let sequence = 0
			const stream = new ReadableStream({
				start(controller) {
					const send = () => {
						sequence++
						controller.enqueue(
							new TextEncoder().encode(
								emitReorg && sequence === 1
									? `id: ${sequence}\nevent: reorg\ndata: ${JSON.stringify({ chainId: 1, depth: 1, sequence })}\n\n`
									: `id: ${sequence}\nevent: block\ndata: ${JSON.stringify({ chainId: 1, blockNumber: 23_184_712 + sequence, sequence })}\n\n`,
							),
						)
					}
					timer = setInterval(send, 2_500)
				},
				cancel() {
					if (timer !== undefined) clearInterval(timer)
				},
			})
			return new Response(stream, {
				headers: {
					'cache-control': 'no-cache',
					connection: 'keep-alive',
					'content-type': 'text/event-stream',
				},
			})
		}
		const name =
			url.pathname === '/' || url.pathname === '/system' || url.pathname === '/richlist' || url.pathname === '/address' ? 'index.html' : url.pathname.slice(1)
		const file = Bun.file(path.join(root, name))
		if (!(await file.exists())) return new Response('Not found', { status: 404 })
		const type = name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html'
		return new Response(file, {
			headers: {
				'content-security-policy':
					"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
				'content-type': `${type}; charset=utf-8`,
			},
		})
	},
})

console.log(`augurScan demo fixture listening on http://localhost:${server.port}/?demo=1`)
