import path from 'node:path'

const noStoreFiles = new Set(['/index.html', '/mainnet-deployment-addresses.json', '/sepolia-deployment-addresses.json'])

export const createAssetHandler = (root: string) => {
	const resolvedRoot = path.resolve(root)
	return async (request: Request) => {
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
		}

		let pathname: string
		try {
			pathname = decodeURIComponent(new URL(request.url).pathname)
		} catch (error) {
			if (error instanceof URIError) return new Response('Bad request', { status: 400 })
			throw error
		}

		if (pathname === '/') pathname = '/index.html'
		const filePath = path.resolve(resolvedRoot, `.${pathname}`)
		if (!filePath.startsWith(`${resolvedRoot}${path.sep}`)) return new Response('Forbidden', { status: 403 })

		const file = Bun.file(filePath)
		if (!(await file.exists())) return new Response('Not found', { status: 404 })

		return new Response(request.method === 'HEAD' ? undefined : file, {
			headers: { 'cache-control': noStoreFiles.has(pathname) ? 'no-store' : 'public, max-age=3600' },
		})
	}
}

if (import.meta.main) {
	const configuredPort = process.env['PORT'] ?? '8080'
	const port = Number(configuredPort)
	if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid PORT value: ${configuredPort}`)

	Bun.serve({ hostname: '0.0.0.0', port, fetch: createAssetHandler('/app/ui') })
	console.log('Zoltar UI is available at:')
	console.log(`http://localhost:${port}/`)
}
