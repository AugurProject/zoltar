export const createQueryCache = (request: (path: string) => Promise<unknown>, ttlMs: number) => {
	const entries = new Map<string, { expiresAt: number; value: Promise<unknown> }>()
	return {
		get(path: string): Promise<unknown> {
			const current = entries.get(path)
			if (current !== undefined && current.expiresAt > Date.now()) return current.value
			const value = request(path).catch(error => {
				if (entries.get(path)?.value === value) entries.delete(path)
				throw error
			})
			entries.set(path, { expiresAt: Date.now() + ttlMs, value })
			return value
		},
		clear(): void {
			entries.clear()
		},
	}
}
