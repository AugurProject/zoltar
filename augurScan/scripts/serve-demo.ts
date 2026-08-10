import path from 'node:path'

const root = path.resolve(import.meta.dir, '../public')
const server = Bun.serve({
	port: Number(process.env['PORT'] ?? '3001'),
	async fetch(request) {
		const url = new URL(request.url)
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
