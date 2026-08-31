import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export type ContractSources = Record<string, { content: string }>

const collectSources = async (directory: string, relativeRoot: string): Promise<ContractSources> => {
	const sources: ContractSources = {}
	const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))
	for (const entry of entries) {
		const absolute = path.join(directory, entry.name)
		if (entry.isDirectory()) {
			if (entry.name === 'test') continue
			Object.assign(sources, await collectSources(absolute, relativeRoot))
			continue
		}
		if (!entry.name.endsWith('.sol')) continue
		const relative = path.relative(relativeRoot, absolute).replaceAll(path.sep, '/')
		const content = (await readFile(absolute, 'utf8')).replace('pragma solidity 0.8.28;', 'pragma solidity >=0.8.28;')
		sources[relative] = { content }
	}
	return sources
}

export const contractSources = async (projectRoot: string): Promise<ContractSources> =>
	await collectSources(path.join(projectRoot, 'solidity/contracts'), path.join(projectRoot, 'solidity'))

export const contractSourceHash = (sources: Readonly<ContractSources>): string =>
	createHash('sha256')
		.update(
			Object.entries(sources)
				.filter(([name]) => !name.startsWith('@openzeppelin/'))
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([name, source]) => `${name}\0${source.content}`)
				.join('\0'),
		)
		.digest('hex')
