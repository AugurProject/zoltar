import { watch } from 'node:fs'
import path from 'node:path'

/** Directories the browser bundle compiles from: browser/ entry points and the src/ modules they import, such as src/collateral.ts. */
export const browserBundleSourceDirectories = ['browser', 'src', '../shared/core/ts'] as const

/** Calls `onChange` whenever a browser bundle source changes and returns a function that stops watching. */
export const watchBrowserBundleSources = (projectRoot: string, onChange: () => void): (() => void) => {
	const watchers = browserBundleSourceDirectories.map(directory => watch(path.join(projectRoot, directory), { recursive: true }, onChange))
	return () => {
		for (const watcher of watchers) watcher.close()
	}
}
