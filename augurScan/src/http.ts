import type { IndexerOwnershipStatus } from './indexer.ts'

type RequestTimeoutServer = {
	readonly timeout: (request: Request, seconds: number) => void
}

export const STATIC_ASSET_CACHE_CONTROL = 'no-cache'

export const staticAssetResponse = (body: BodyInit, securityHeaders: Readonly<Record<string, string>>, contentType: string) =>
	new Response(body, { headers: { ...securityHeaders, 'cache-control': STATIC_ASSET_CACHE_CONTROL, 'content-type': contentType } })

export const indexerHealthUnavailableResponse = (ownership: readonly IndexerOwnershipStatus[]): Response =>
	Response.json({ status: 'unknown', ownership }, { status: 503 })

export const liveStreamResponse = (
	stream: ReadableStream<Uint8Array>,
	request: Request,
	server: RequestTimeoutServer,
	baseHeaders: Readonly<Record<string, string>> = {},
): Response => {
	server.timeout(request, 0)
	return new Response(stream, {
		headers: {
			...baseHeaders,
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'content-type': 'text/event-stream',
			'x-accel-buffering': 'no',
		},
	})
}
