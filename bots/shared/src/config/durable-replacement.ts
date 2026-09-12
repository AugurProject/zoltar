import { dirname } from 'node:path'

type DirectoryFilesystem = {
	rename: (oldPath: string, newPath: string) => Promise<unknown>
	open: (path: string, flags: 'r') => Promise<{ sync: () => Promise<unknown>; close: () => Promise<unknown> }>
}

// Revision checks, temporary-file ownership and failure cleanup belong to the caller.
// A failure after rename does not mean the destination was left unchanged.
export async function renameAndSyncDirectory(temporaryPath: string, path: string, filesystem: DirectoryFilesystem) {
	await filesystem.rename(temporaryPath, path)
	const directoryHandle = await filesystem.open(dirname(path), 'r')
	try {
		await directoryHandle.sync()
	} finally {
		await directoryHandle.close()
	}
}
