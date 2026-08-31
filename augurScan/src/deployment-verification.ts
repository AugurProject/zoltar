const record = (value: unknown): Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}

const requiredSourceError = 'Bundled mode requires the resolved app POSTGRES_URL to use augurscan@postgres:5432/augurscan; use external mode otherwise'

export const bundledComposeSourceUrl = (configuration: unknown): string => {
	const services = record(record(configuration)['services'])
	const app = record(services['app'])
	const environment = record(app['environment'])
	const value = environment['POSTGRES_URL']
	if (typeof value !== 'string' || value.length === 0) throw new Error('Resolved Compose app POSTGRES_URL is unavailable')
	let url: URL
	try {
		url = new URL(value)
	} catch (error) {
		throw new Error(requiredSourceError, { cause: error })
	}
	if (
		(url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
		url.username !== 'augurscan' ||
		url.password.length === 0 ||
		url.hostname !== 'postgres' ||
		url.port !== '5432' ||
		url.pathname !== '/augurscan' ||
		url.search !== '' ||
		url.hash !== ''
	)
		throw new Error(requiredSourceError)
	return value
}
