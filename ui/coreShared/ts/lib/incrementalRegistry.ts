export type RegistryAnchor = Readonly<{ blockHash: `0x${string}`; blockNumber: bigint }>
export type RegistryIndex<T> = {
	snapshot: { key: string; anchor: RegistryAnchor; items: readonly T[] } | undefined
	pending: Promise<unknown> | undefined
}

export function createRegistryIndex<T>(): RegistryIndex<T> {
	return { snapshot: undefined, pending: undefined }
}

/** Append-only contract registries need only their new suffix, provided the cached anchor is still canonical. */
export async function readIncrementalRegistry<T>({
	index,
	key,
	anchor,
	loadCount,
	loadRange,
	isCanonical,
}: {
	index: RegistryIndex<T>
	key: string
	anchor: RegistryAnchor
	loadCount(): Promise<bigint>
	loadRange(start: bigint, count: bigint): Promise<readonly T[]>
	isCanonical(anchor: RegistryAnchor): Promise<boolean>
}) {
	const previous = index.pending
	const pending = (async () => {
		if (previous !== undefined) await previous.catch(() => undefined)
		const count = await loadCount()
		const cached = index.snapshot
		const reuse = cached !== undefined && cached.key === key && cached.anchor.blockNumber <= anchor.blockNumber && BigInt(cached.items.length) <= count && (await isCanonical(cached.anchor))
		const items = reuse ? [...cached.items] : []
		// Four pages at a time bound provider load while avoiding one round trip per page in a cold scan.
		for (let start = BigInt(items.length); start < count; start += 400n) {
			const pages: Promise<readonly T[]>[] = []
			for (let offset = start; offset < count && offset < start + 400n; offset += 100n) {
				const size = count - offset < 100n ? count - offset : 100n
				pages.push(
					loadRange(offset, size).then(page => {
						if (BigInt(page.length) !== size) throw new Error('Registry returned an incomplete page')
						return page
					}),
				)
			}
			items.push(...(await Promise.all(pages)).flat())
		}
		if (!(await isCanonical(anchor))) throw new Error('Registry changed during discovery')
		index.snapshot = { key, anchor, items }
		return items
	})()
	index.pending = pending
	try {
		return await pending
	} finally {
		if (index.pending === pending) index.pending = undefined
	}
}
