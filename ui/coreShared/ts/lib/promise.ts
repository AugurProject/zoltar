export async function withTimeout<TResult>(work: Promise<TResult>, timeoutMilliseconds: number, message: string): Promise<TResult> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			work,
			new Promise<TResult>((_resolve, reject) => {
				timeoutId = setTimeout(() => reject(new Error(message)), timeoutMilliseconds)
			}),
		])
	} finally {
		if (timeoutId !== undefined) clearTimeout(timeoutId)
	}
}
