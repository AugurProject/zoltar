export class LiveBus {
	readonly #clients = new Set<ReadableStreamDefaultController<Uint8Array>>()
	readonly #encoder = new TextEncoder()

	stream(): ReadableStream<Uint8Array> {
		let activeController: ReadableStreamDefaultController<Uint8Array> | undefined
		return new ReadableStream({
			start: (controller) => {
				activeController = controller
				this.#clients.add(controller)
				controller.enqueue(this.#encoder.encode('retry: 5000\n: connected\n\n'))
			},
			cancel: () => {
				if (activeController !== undefined) this.#clients.delete(activeController)
			},
		})
	}

	heartbeat(): void {
		this.#enqueue(this.#encoder.encode(': heartbeat\n\n'))
	}

	publish(event: string, value: unknown): void {
		this.#enqueue(this.#encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`))
	}

	#enqueue(payload: Uint8Array): void {
		for (const controller of this.#clients) {
			try {
				controller.enqueue(payload)
			} catch (error) {
				if (error instanceof TypeError) this.#clients.delete(controller)
				else throw error
			}
		}
	}

	close(): void {
		for (const controller of this.#clients) {
			try {
				controller.close()
			} catch (error) {
				if (!(error instanceof TypeError)) throw error
				// The consumer closed the stream first.
			}
		}
		this.#clients.clear()
	}
}

export const HEARTBEAT_INTERVAL_MS = 15_000

export const startHeartbeat = (target: { heartbeat(): void }): (() => void) => {
	const timer = setInterval(() => target.heartbeat(), HEARTBEAT_INTERVAL_MS)
	return () => clearInterval(timer)
}
