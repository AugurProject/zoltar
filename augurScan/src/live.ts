import type { LiveEvent } from './database.ts'

type LiveEventStore = {
	readonly latestEventId: () => Promise<number>
	readonly eventsAfter: (id: number, limit?: number) => Promise<readonly LiveEvent[]>
}

type Client = {
	readonly controller: ReadableStreamDefaultController<Uint8Array>
	readonly release: () => void
	readonly admittedAt: number
	cursor: number
	backpressuredAt?: number | undefined
}

type LiveBusOptions = {
	/** Concurrent streams across every client. */
	readonly maxClients?: number
	/** Concurrent streams for one client key, so one client cannot hold every slot. */
	readonly maxClientsPerKey?: number
	/** Age after which a stream is closed; the browser reconnects with Last-Event-ID and replay covers the gap. */
	readonly maxLifetimeMs?: number
	/** How long a client may make no write progress before its stream is closed. */
	readonly backpressureTimeoutMs?: number
	readonly now?: () => number
}

const HEARTBEAT_INTERVAL_MS = 15_000
const EVENT_POLL_INTERVAL_MS = 1_000
const MAX_CURSOR_COHORTS_PER_POLL = 4
const DEFAULT_MAX_LIVE_CLIENTS = 256
const DEFAULT_MAX_LIVE_CLIENTS_PER_KEY = 16
const DEFAULT_MAX_LIVE_STREAM_LIFETIME_MS = 30 * 60 * 1_000
const DEFAULT_LIVE_BACKPRESSURE_TIMEOUT_MS = 60_000

const requirePositiveSafeInteger = (value: number, label: string): number => {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`)
	return value
}

export const createLiveBus = (store: LiveEventStore, options: LiveBusOptions = {}) => {
	const maxClients = requirePositiveSafeInteger(options.maxClients ?? DEFAULT_MAX_LIVE_CLIENTS, 'Live stream client limit')
	const maxClientsPerKey = requirePositiveSafeInteger(options.maxClientsPerKey ?? DEFAULT_MAX_LIVE_CLIENTS_PER_KEY, 'Live stream per-client limit')
	const maxLifetimeMs = requirePositiveSafeInteger(options.maxLifetimeMs ?? DEFAULT_MAX_LIVE_STREAM_LIFETIME_MS, 'Live stream maximum lifetime')
	const backpressureTimeoutMs = requirePositiveSafeInteger(options.backpressureTimeoutMs ?? DEFAULT_LIVE_BACKPRESSURE_TIMEOUT_MS, 'Live stream backpressure timeout')
	const now = options.now ?? Date.now
	const clients = new Set<Client>()
	const streamsPerKey = new Map<string, number>()
	const encoder = new TextEncoder()
	let pollPromise: Promise<void> | undefined
	let latestCursorPromise: Promise<number> | undefined
	let admittedClients = 0
	let closed = false
	let cohortOffset = 0

	const initialCursor = async (): Promise<number> => {
		latestCursorPromise ??= store.latestEventId()
		const cursorPromise = latestCursorPromise
		try {
			return await cursorPromise
		} finally {
			if (latestCursorPromise === cursorPromise) latestCursorPromise = undefined
		}
	}

	const enqueueEvents = (client: Client, events: readonly LiveEvent[]): void => {
		client.backpressuredAt = undefined
		for (const event of events) {
			if (event.id <= client.cursor && event.event !== 'reset') continue
			if (client.controller.desiredSize !== null && client.controller.desiredSize <= 0) break
			try {
				client.controller.enqueue(encoder.encode(`id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.payload)}\n\n`))
			} catch (error) {
				if (!(error instanceof TypeError)) throw error
				client.release()
				break
			}
			client.cursor = event.id
		}
	}

	const evictStaleClients = (): void => {
		const current = now()
		for (const client of clients) {
			const expired = current - client.admittedAt > maxLifetimeMs
			if (!expired) {
				if (client.controller.desiredSize === null || client.controller.desiredSize > 0) {
					client.backpressuredAt = undefined
					continue
				}
				client.backpressuredAt ??= current
				if (current - client.backpressuredAt <= backpressureTimeoutMs) continue
			}
			try {
				client.controller.close()
			} catch (error) {
				if (!(error instanceof TypeError)) throw error
			}
			client.release()
		}
	}

	const enqueue = (payload: Uint8Array): void => {
		for (const client of clients) {
			try {
				if (client.controller.desiredSize === null || client.controller.desiredSize > 0) {
					client.controller.enqueue(payload)
					client.backpressuredAt = undefined
				}
			} catch (error) {
				if (error instanceof TypeError) client.release()
				else throw error
			}
		}
	}

	const poll = async (): Promise<void> => {
		if (pollPromise !== undefined) return await pollPromise
		if (closed || clients.size === 0) return
		const run = (async () => {
			try {
				evictStaleClients()
				const readyClients = [...clients].filter(client => client.controller.desiredSize === null || client.controller.desiredSize > 0)
				if (readyClients.length === 0) return
				const cohorts = new Map<number, Client[]>()
				for (const client of readyClients) cohorts.set(client.cursor, [...(cohorts.get(client.cursor) ?? []), client])
				const ordered = [...cohorts].sort(([left], [right]) => right - left)
				const newest = ordered[0]
				const remaining = ordered.slice(1)
				const selected = newest === undefined ? [] : [newest]
				for (let index = 0; index < Math.min(MAX_CURSOR_COHORTS_PER_POLL - 1, remaining.length); index++) {
					const cohort = remaining[(cohortOffset + index) % remaining.length]
					if (cohort !== undefined) selected.push(cohort)
				}
				if (remaining.length > 0) cohortOffset = (cohortOffset + MAX_CURSOR_COHORTS_PER_POLL - 1) % remaining.length
				await Promise.all(
					selected.map(async ([cursor, cohortClients]) => {
						const events = await store.eventsAfter(cursor)
						for (const client of cohortClients) enqueueEvents(client, events)
					}),
				)
			} catch (error) {
				console.error(`Unable to poll durable live events (${error instanceof Error ? error.name : typeof error})`)
			}
		})()
		pollPromise = run
		try {
			await run
		} finally {
			if (pollPromise === run) pollPromise = undefined
		}
	}

	const heartbeat = (): void => {
		evictStaleClients()
		enqueue(encoder.encode(': heartbeat\n\n'))
	}

	const pollTimer = setInterval(() => void poll(), EVENT_POLL_INTERVAL_MS)
	const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS)

	const stream = (lastEventId: number | undefined, clientKey: string): ReadableStream<Uint8Array> | undefined => {
		const keyStreams = streamsPerKey.get(clientKey) ?? 0
		if (closed || admittedClients >= maxClients || keyStreams >= maxClientsPerKey) return undefined
		admittedClients++
		streamsPerKey.set(clientKey, keyStreams + 1)
		const admittedAt = now()
		let client: Client | undefined
		let released = false
		const release = (): void => {
			if (released) return
			released = true
			admittedClients--
			const remaining = (streamsPerKey.get(clientKey) ?? 1) - 1
			if (remaining > 0) streamsPerKey.set(clientKey, remaining)
			else streamsPerKey.delete(clientKey)
			if (client !== undefined) clients.delete(client)
		}
		return new ReadableStream({
			start: async controller => {
				try {
					const cursor = lastEventId ?? (await initialCursor())
					if (released) return
					if (closed) {
						controller.close()
						release()
						return
					}
					client = { admittedAt, controller, cursor, release }
					clients.add(client)
					controller.enqueue(encoder.encode('retry: 5000\n: connected\n\n'))
					await poll()
				} catch (error) {
					release()
					controller.error(error)
				}
			},
			cancel: release,
		})
	}

	const close = async (): Promise<void> => {
		closed = true
		clearInterval(pollTimer)
		clearInterval(heartbeatTimer)
		await pollPromise
		for (const client of clients) {
			try {
				client.controller.close()
			} catch (error) {
				if (!(error instanceof TypeError)) throw error
			}
			client.release()
		}
		clients.clear()
	}

	return { close, heartbeat, poll, stream }
}

export type LiveBus = ReturnType<typeof createLiveBus>
