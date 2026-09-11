const repositorySourceUrlPrefix = 'https://github.com/AugurProject/zoltar/blob/main/'

// Published documentation links repository files through GitHub so browsers render source instead of downloading it.
export function repositorySourceUrl(repositoryPath: string): string {
	if (repositoryPath.startsWith('/') || repositoryPath.startsWith('.')) throw new Error(`Repository source paths must be repository-root relative: ${repositoryPath}`)
	return `${repositorySourceUrlPrefix}${repositoryPath}`
}

export function repositorySourcePath(href: string): string | undefined {
	if (!href.startsWith(repositorySourceUrlPrefix)) return undefined
	const hashIndex = href.indexOf('#')
	const repositoryPath = decodeURIComponent(hashIndex === -1 ? href.slice(repositorySourceUrlPrefix.length) : href.slice(repositorySourceUrlPrefix.length, hashIndex))
	return repositoryPath.length === 0 ? undefined : repositoryPath
}
