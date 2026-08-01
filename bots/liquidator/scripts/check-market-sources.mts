const [dashboardUrl, ...extra] = process.argv.slice(2)
if (dashboardUrl === undefined || extra.length > 0) throw new Error('Usage: bun run smoke:markets -- http://127.0.0.1:8787')
const origin = new URL(dashboardUrl).origin
const response = await fetch(new URL('/api/test-market-sources', origin), {
	body: '{}',
	headers: { 'content-type': 'application/json', origin },
	method: 'PUT',
})
const result: unknown = await response.json()
if (!response.ok) {
	const error = typeof result === 'object' && result !== null ? Reflect.get(result, 'error') : undefined
	throw new Error(typeof error === 'string' ? error : `Market source smoke test failed with HTTP ${response.status.toString()}`)
}
console.log(JSON.stringify(result, undefined, 2))
if (typeof result !== 'object' || result === null) throw new Error('Market source smoke test returned an invalid response')
const assets = Reflect.get(result, 'assets')
if (!Array.isArray(assets)) throw new Error('Market source smoke test returned no asset results')
const failures = assets.flatMap(asset => {
	if (typeof asset !== 'object' || asset === null) return ['Invalid asset result']
	const sources = Reflect.get(asset, 'sources')
	if (!Array.isArray(sources)) return ['Asset result has no sources']
	return sources.flatMap(source => (typeof source === 'object' && source !== null && Reflect.get(source, 'status') === 'failed' ? [String(Reflect.get(source, 'id'))] : []))
})
if (failures.length > 0) throw new Error(`Market source smoke test failed for: ${failures.join(', ')}`)
