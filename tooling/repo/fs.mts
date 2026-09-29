import { access } from 'node:fs/promises'

export function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Reports whether a path exists; errors other than a missing path (for example permission failures) propagate. */
export async function pathExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath)
		return true
	} catch (error) {
		if (!isMissingPathError(error)) throw error
		return false
	}
}
