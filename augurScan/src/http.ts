type RequestTimeoutServer = {
	readonly timeout: (request: Request, seconds: number) => void
}

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
