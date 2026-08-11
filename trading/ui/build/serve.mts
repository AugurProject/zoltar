import path from 'node:path'

const root = path.resolve(import.meta.dir, '../dist')
const files = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/app.js.map': 'app.js.map', '/app.css': 'app.css', '/deployment.json': 'deployment.json' } as const
Bun.serve({
	port: 12346,
	async fetch(request) {
		const pathname = new URL(request.url).pathname
		const file = files[pathname as keyof typeof files]
		if (file === undefined) return new Response('Not found', { status: 404 })
		return new Response(Bun.file(path.join(root, file)))
	},
})
console.log('Trading UI: http://localhost:12346/?demo=1#/markets')
