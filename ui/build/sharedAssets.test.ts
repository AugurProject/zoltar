import { expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(directoryOfThisFile, '..', '..')
const uiContractsPath = path.join(repositoryRootPath, 'ui', 'ts', 'contracts.ts')
const sharedBrowserArtifacts = [
	path.join(repositoryRootPath, 'ui', 'js', 'shared', 'addressDerivation.js'),
	path.join(repositoryRootPath, 'ui', 'js', 'shared', 'bigInt.js'),
	path.join(repositoryRootPath, 'ui', 'js', 'shared', 'deploymentAddresses.js'),
	path.join(repositoryRootPath, 'ui', 'js', 'shared', 'networkConfig.js'),
	path.join(repositoryRootPath, 'ui', 'ts', 'shared', 'addressDerivation.js'),
	path.join(repositoryRootPath, 'ui', 'ts', 'shared', 'bigInt.js'),
	path.join(repositoryRootPath, 'ui', 'ts', 'shared', 'deploymentAddresses.js'),
	path.join(repositoryRootPath, 'ui', 'ts', 'shared', 'networkConfig.js'),
	path.join(repositoryRootPath, 'ui', 'ts', 'shared', 'addressDerivation.d.ts'),
	path.join(repositoryRootPath, 'ui', 'ts', 'shared', 'bigInt.d.ts'),
	path.join(repositoryRootPath, 'ui', 'ts', 'shared', 'deploymentAddresses.d.ts'),
	path.join(repositoryRootPath, 'ui', 'ts', 'shared', 'networkConfig.d.ts'),
]

test('shared helper assets are mirrored into deployable ui paths', () => {
	const contractsSource = fs.readFileSync(uiContractsPath, 'utf8')

	expect(contractsSource).toContain("from './shared/addressDerivation.js'")
	expect(contractsSource).toContain("from './shared/bigInt.js'")
	expect(contractsSource).toContain("from './shared/deploymentAddresses.js'")
	expect(contractsSource).toContain("from './shared/networkConfig.js'")
	expect(contractsSource).not.toContain('../../shared/js/')

	for (const artifactPath of sharedBrowserArtifacts) {
		expect(fs.existsSync(artifactPath)).toBe(true)
	}
})
