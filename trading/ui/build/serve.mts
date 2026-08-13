import path from 'node:path'

const root = path.resolve(import.meta.dir, '../dist')
const files = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/app.js.map': 'app.js.map', '/app.css': 'app.css', '/deployment.json': 'deployment.json' } as const
const securityHeaders = {
	'content-security-policy': "default-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:* https:; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
	'referrer-policy': 'no-referrer',
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
}
export function serveTradingAsset(request: Request) {
	const pathname = new URL(request.url).pathname
	const file = files[pathname as keyof typeof files]
	if (file === undefined) return new Response('Not found', { status: 404, headers: securityHeaders })
	return new Response(Bun.file(path.join(root, file)), { headers: { ...securityHeaders, 'cache-control': file === 'deployment.json' || file === 'index.html' ? 'no-store' : 'no-cache' } })
}

if (import.meta.main) {
	Bun.serve({ port: 4163, fetch: serveTradingAsset })
	console.log('Trading UI: http://localhost:4163/?demo=1#/markets')
}
