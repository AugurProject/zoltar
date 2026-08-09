export class LiveBus {
	readonly #clients = new Set<ReadableStreamDefaultController<Uint8Array>>()
	readonly #encoder = new TextEncoder()

	stream(): ReadableStream<Uint8Array> {
		let activeController: ReadableStreamDefaultController<Uint8Array> | undefined
		return new ReadableStream({
			start: (controller) => {
				activeController = controller
				this.#clients.add(controller)
				controller.enqueue(this.#encoder.encode(': connected\n\n'))
			},
			cancel: () => {
				if (activeController !== undefined) this.#clients.delete(activeController)
			},
		})
	}

	publish(event: string, value: unknown): void {
		const payload = this.#encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)
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
