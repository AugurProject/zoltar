import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import solc from 'solc'

const projectRoot = path.resolve(import.meta.dir, '../..')
const contractsRoot = path.join(projectRoot, 'solidity/contracts')
const outputPath = path.resolve(import.meta.dir, '../config/abis.json')

const collectSources = async (directory: string): Promise<Record<string, { content: string }>> => {
	const sources: Record<string, { content: string }> = {}
	const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))
	for (const entry of entries) {
		const absolute = path.join(directory, entry.name)
		if (entry.isDirectory()) {
			if (entry.name === 'test') continue
			Object.assign(sources, await collectSources(absolute))
			continue
		}
		if (!entry.name.endsWith('.sol')) continue
		const relative = path.relative(path.join(projectRoot, 'solidity'), absolute).replaceAll(path.sep, '/')
		const content = (await readFile(absolute, 'utf8')).replace('pragma solidity 0.8.28;', 'pragma solidity >=0.8.28;')
		sources[relative] = { content }
	}
	return sources
}

const sources = await collectSources(contractsRoot)
const vendorPrefix = 'contracts/peripherals/openOracle/openzeppelin/contracts/'
for (const [name, source] of Object.entries(sources)) {
	if (name.startsWith(vendorPrefix)) sources[`@openzeppelin/contracts/${name.slice(vendorPrefix.length)}`] = source
}
const input = {
	language: 'Solidity',
	sources,
	settings: {
		outputSelection: {
			'*': {
				'*': ['abi'],
			},
		},
	},
}

const result = JSON.parse(solc.compile(JSON.stringify(input))) as {
	contracts?: Record<string, Record<string, { abi: readonly unknown[] }>>
	errors?: readonly { severity: string; formattedMessage: string }[]
}
const errors = result.errors?.filter((error) => error.severity === 'error') ?? []
if (errors.length > 0) throw new Error(errors.map((error) => error.formattedMessage).join('\n'))
if (result.contracts === undefined) throw new Error('Solidity compiler returned no contracts')

const contracts: Record<string, { source: string; abi: readonly unknown[] }> = {}
for (const source of Object.keys(result.contracts).sort()) {
	const sourceContracts = result.contracts[source]
	if (sourceContracts === undefined) continue
	for (const name of Object.keys(sourceContracts).sort()) {
		const artifact = sourceContracts[name]
		if (artifact === undefined || artifact.abi.length === 0) continue
		const existing = contracts[name]
		if (existing !== undefined && JSON.stringify(existing.abi) !== JSON.stringify(artifact.abi)) {
			contracts[`${source}:${name}`] = { source, abi: artifact.abi }
			continue
		}
		contracts[name] = { source, abi: artifact.abi }
	}
}

const payload = {
	sourceHash: createHash('sha256')
		.update(
			Object.entries(sources)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([name, source]) => `${name}\0${source.content}`)
				.join('\0'),
		)
		.digest('hex'),
	contracts,
}

await Bun.write(outputPath, `${JSON.stringify(payload, undefined, 2)}\n`)
console.log(`Wrote ${Object.keys(contracts).length} ABIs to ${outputPath}`)
