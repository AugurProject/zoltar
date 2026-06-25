import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assertGeneratedArtifactsClean, type GitRunner } from './check-generated-artifacts.mts'

const cleanGit: GitRunner = () => ({
	status: 0,
	stderr: '',
	stdout: '',
})

const generatedFixtureFiles = [
	'shared/js/.freshness-hash',
	'shared/js/foo.js',
	'shared/js/foo.d.ts',
	'solidity/artifacts/Contracts.json',
	'solidity/artifacts/.freshness-hash',
	'solidity/.contract-hash.json',
	'solidity/ts/types/contractArtifact.ts',
	'solidity/types/contractArtifact.ts',
	'ui/ts/abis.ts',
	'ui/ts/contractArtifact.ts',
	'ui/vendor/isows/native.js',
]

async function writeFixtureFile(repositoryRoot: string, relativePath: string, contents: string) {
	const fullPath = path.join(repositoryRoot, relativePath)
	await mkdir(path.dirname(fullPath), { recursive: true })
	await writeFile(fullPath, contents)
}

async function createGeneratedArtifactFixture() {
	const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'zoltar-generated-artifacts-'))
	await writeFixtureFile(repositoryRoot, 'shared/package.json', `${JSON.stringify({ exports: { './foo': { default: './js/foo.js' } } }, undefined, '\t')}\n`)
	await writeFixtureFile(
		repositoryRoot,
		'ui/index.html',
		`<script type='importmap'>
{
	"imports": {
		"@zoltar/shared/foo": "../shared/js/foo.js",
		"isows": "./vendor/isows/native.js"
	}
}
</script>`,
	)

	for (const relativePath of generatedFixtureFiles) {
		const contents = relativePath.endsWith('.json') ? '{}\n' : ''
		await writeFixtureFile(repositoryRoot, relativePath, contents)
	}
	return repositoryRoot
}

test('generated artifact checker fails when import-map generated outputs are missing', async () => {
	const repositoryRoot = await createGeneratedArtifactFixture()
	try {
		await rm(path.join(repositoryRoot, 'ui/vendor/isows/native.js'))
		await expect(assertGeneratedArtifactsClean({ repositoryRoot, runGit: cleanGit })).rejects.toThrow('Generated artifact is missing after generation: ui/vendor/isows/native.js')
	} finally {
		await rm(repositoryRoot, { force: true, recursive: true })
	}
})

test('generated artifact checker fails when ignored generated outputs are tracked', async () => {
	const repositoryRoot = await createGeneratedArtifactFixture()
	const trackedGeneratedPathGit: GitRunner = () => ({
		status: 0,
		stderr: '',
		stdout: 'ui/vendor/isows/native.js\n',
	})

	try {
		await expect(assertGeneratedArtifactsClean({ repositoryRoot, runGit: trackedGeneratedPathGit })).rejects.toThrow('Generated artifacts must remain untracked')
	} finally {
		await rm(repositoryRoot, { force: true, recursive: true })
	}
})
