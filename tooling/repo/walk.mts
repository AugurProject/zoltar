import { readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'

type WalkOptions = {
	include?: (filePath: string, entry: Dirent) => boolean
	descend?: (directoryPath: string, entry: Dirent) => boolean
	includeNonFiles?: boolean
	includeDirectories?: boolean
}

/** Depth-first traversal; symlink directories are never followed. */
export async function walkFiles(directory: string, options: WalkOptions = {}): Promise<string[]> {
	const files: string[] = []
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name)
		if (entry.isDirectory()) {
			if (options.includeDirectories && options.include?.(entryPath, entry) !== false) files.push(entryPath)
			if (options.descend?.(entryPath, entry) !== false) files.push(...(await walkFiles(entryPath, options)))
		} else if ((entry.isFile() || options.includeNonFiles) && options.include?.(entryPath, entry) !== false) files.push(entryPath)
	}
	return files
}
