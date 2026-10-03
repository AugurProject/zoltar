import { metricRoute } from './http.ts'

export const apiFailureLog = (request: Request, error: unknown, startedAt: number, stage: 'request' | 'transaction'): string => {
	const url = new URL(request.url)
	const code = typeof error === 'object' && error !== null && 'errno' in error && typeof error.errno === 'string' && /^[A-Z0-9]{5}$/u.test(error.errno) ? error.errno : undefined
	const chainId = url.searchParams.get('chainId')
	return JSON.stringify({
		event: `augurScan API ${stage} failed`,
		route: url.pathname === '/api/v1/state/integrity' ? url.pathname : metricRoute(url.pathname),
		...(chainId !== null && /^\d{1,16}$/u.test(chainId) ? { chainId } : {}),
		elapsedMs: Math.round(performance.now() - startedAt),
		error: error instanceof Error ? error.name : typeof error,
		...(code === undefined ? {} : { postgresCode: code }),
	})
}
