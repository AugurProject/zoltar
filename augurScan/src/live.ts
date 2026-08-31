import type { LiveEvent } from './database.ts'

type LiveEventStore = {
	readonly latestEventId: () => Promise<number>
	readonly eventsAfter: (id: number, limit?: number) => Promise<readonly LiveEvent[]>
}

type Client = {
	readonly controller: ReadableStreamDefaultController<Uint8Array>
	readonly release: () => void
	cursor: number
}

const HEARTBEAT_INTERVAL_MS = 15_000
const EVENT_POLL_INTERVAL_MS = 1_000
const MAX_CURSOR_COHORTS_PER_POLL = 4
const DEFAULT_MAX_LIVE_CLIENTS = 256

export class LiveBus {
	readonly #clients = new Set<Client>()
	readonly #encoder = new TextEncoder()
	readonly #store: LiveEventStore
	readonly #pollTimer: ReturnType<typeof setInterval>
	readonly #heartbeatTimer: ReturnType<typeof setInterval>
	readonly #maxClients: number
	#pollPromise: Promise<void> | undefined
	#latestCursorPromise: Promise<number> | undefined
	#admittedClients = 0
	#closed = false
	#cohortOffset = 0

	constructor(store: LiveEventStore, maxClients = DEFAULT_MAX_LIVE_CLIENTS) {
		this.#store = store
		this.#maxClients = maxClients
		this.#pollTimer = setInterval(() => void this.poll(), EVENT_POLL_INTERVAL_MS)
		this.#heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS)
	}

	stream(lastEventId?: number): ReadableStream<Uint8Array> | undefined {
		if (this.#closed || this.#admittedClients >= this.#maxClients) return undefined
		this.#admittedClients++
		let client: Client | undefined
		let released = false
		const release = (): void => {
			if (released) return
			released = true
			this.#admittedClients--
			if (client !== undefined) this.#clients.delete(client)
		}
		return new ReadableStream({
			start: async (controller) => {
				try {
					const cursor = lastEventId ?? (await this.#initialCursor())
					if (released) return
					if (this.#closed) {
						controller.close()
						release()
						return
					}
					client = { controller, cursor, release }
					this.#clients.add(client)
					controller.enqueue(this.#encoder.encode('retry: 5000\n: connected\n\n'))
					await this.poll()
				} catch (error) {
					release()
					controller.error(error)
				}
			},
			cancel: release,
		})
	}

	async #initialCursor(): Promise<number> {
		this.#latestCursorPromise ??= this.#store.latestEventId()
		const cursorPromise = this.#latestCursorPromise
		try {
			return await cursorPromise
		} finally {
			if (this.#latestCursorPromise === cursorPromise) this.#latestCursorPromise = undefined
		}
	}

	async poll(): Promise<void> {
		if (this.#pollPromise !== undefined) return await this.#pollPromise
		if (this.#closed || this.#clients.size === 0) return
		const run = (async () => {
			try {
				const readyClients = [...this.#clients].filter((client) => client.controller.desiredSize === null || client.controller.desiredSize > 0)
				if (readyClients.length === 0) return
				const cohorts = new Map<number, Client[]>()
				for (const client of readyClients) cohorts.set(client.cursor, [...(cohorts.get(client.cursor) ?? []), client])
				const ordered = [...cohorts].sort(([left], [right]) => right - left)
				const newest = ordered[0]
				const remaining = ordered.slice(1)
				const selected = newest === undefined ? [] : [newest]
				for (let index = 0; index < Math.min(MAX_CURSOR_COHORTS_PER_POLL - 1, remaining.length); index++) {
					const cohort = remaining[(this.#cohortOffset + index) % remaining.length]
					if (cohort !== undefined) selected.push(cohort)
				}
				if (remaining.length > 0) this.#cohortOffset = (this.#cohortOffset + MAX_CURSOR_COHORTS_PER_POLL - 1) % remaining.length
				await Promise.all(
					selected.map(async ([cursor, clients]) => {
						const events = await this.#store.eventsAfter(cursor)
						for (const client of clients) this.#enqueueEvents(client, events)
					}),
				)
			} catch (error) {
				console.error(`Unable to poll durable live events (${error instanceof Error ? error.name : typeof error})`)
			}
		})()
		this.#pollPromise = run
		try {
			await run
		} finally {
			if (this.#pollPromise === run) this.#pollPromise = undefined
		}
	}

	#enqueueEvents(client: Client, events: readonly LiveEvent[]): void {
		for (const event of events) {
			if (event.id <= client.cursor && event.event !== 'reset') continue
			if (client.controller.desiredSize !== null && client.controller.desiredSize <= 0) break
			try {
				client.controller.enqueue(this.#encoder.encode(`id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.payload)}\n\n`))
			} catch (error) {
				if (!(error instanceof TypeError)) throw error
				client.release()
				break
			}
			client.cursor = event.id
		}
	}

	heartbeat(): void {
		this.#enqueue(this.#encoder.encode(': heartbeat\n\n'))
	}

	#enqueue(payload: Uint8Array): void {
		for (const client of this.#clients) {
			try {
				if (client.controller.desiredSize === null || client.controller.desiredSize > 0) client.controller.enqueue(payload)
			} catch (error) {
				if (error instanceof TypeError) client.release()
				else throw error
			}
		}
	}

	async close(): Promise<void> {
		this.#closed = true
		clearInterval(this.#pollTimer)
		clearInterval(this.#heartbeatTimer)
		await this.#pollPromise
		for (const client of this.#clients) {
			try {
				client.controller.close()
			} catch (error) {
				if (!(error instanceof TypeError)) throw error
			}
			client.release()
		}
		this.#clients.clear()
	}
}
