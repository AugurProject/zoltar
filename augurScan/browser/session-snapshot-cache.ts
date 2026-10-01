export interface SessionSnapshotStorage {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
	removeItem(key: string): void
}

export const availableSessionSnapshotStorage = (getStorage: () => SessionSnapshotStorage): SessionSnapshotStorage | undefined => {
	try {
		return getStorage()
	} catch (error) {
		void error
		return undefined
	}
}

export const createSessionSnapshotCache = <T>(storage: SessionSnapshotStorage | undefined, key: string, decode: (value: unknown) => T) => ({
	read: (): T | undefined => {
		if (storage === undefined) return undefined
		try {
			const serialized = storage.getItem(key)
			return serialized === null ? undefined : decode(JSON.parse(serialized))
		} catch (error) {
			void error
			try {
				storage.removeItem(key)
			} catch (removeError) {
				void removeError
			}
			return undefined
		}
	},
	write: (value: T): void => {
		if (storage === undefined) return
		try {
			const serialized = JSON.stringify(value)
			if (serialized !== undefined) storage.setItem(key, serialized)
		} catch (error) {
			void error
		}
	},
})
