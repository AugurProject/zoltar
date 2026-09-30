const repositorySourceUrlPrefix = 'https://github.com/AugurProject/zoltar/blob/main/'
const repositoryDirectoryUrlPrefix = 'https://github.com/AugurProject/zoltar/tree/main/'

// Published documentation links repository files through GitHub so browsers render source instead of downloading it.
export function repositorySourceUrl(repositoryPath: string): string {
	if (repositoryPath.startsWith('/') || repositoryPath.startsWith('.')) throw new Error(`Repository source paths must be repository-root relative: ${repositoryPath}`)
	return `${repositorySourceUrlPrefix}${repositoryPath}`
}

export type RepositorySourceTarget = { readonly kind: 'directory' | 'file'; readonly path: string }

/** Repository path and expected entry kind for a GitHub file (`/blob/main/`) or directory (`/tree/main/`) link. */
export function repositorySourceTarget(href: string): RepositorySourceTarget | undefined {
	const [prefix, kind] = href.startsWith(repositorySourceUrlPrefix) ? [repositorySourceUrlPrefix, 'file' as const] : href.startsWith(repositoryDirectoryUrlPrefix) ? [repositoryDirectoryUrlPrefix, 'directory' as const] : [undefined, undefined]
	if (prefix === undefined) return undefined
	const hashIndex = href.indexOf('#')
	const repositoryPath = decodeURIComponent(hashIndex === -1 ? href.slice(prefix.length) : href.slice(prefix.length, hashIndex))
	return repositoryPath.length === 0 ? undefined : { kind, path: repositoryPath }
}
