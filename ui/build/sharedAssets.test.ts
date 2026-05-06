import { expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(directoryOfThisFile, '..', '..')
const uiContractsPath = path.join(repositoryRootPath, 'ui', 'ts', 'contracts.ts')
const uiDeploymentHelpersPath = path.join(repositoryRootPath, 'ui', 'ts', 'contracts', 'deploymentHelpers.ts')
const sharedBrowserArtifacts = [
	path.join(repositoryRootPath, 'ui', 'js', 'shared', 'addressDerivation.js'),
	path.join(repositoryRootPath, 'ui', 'js', 'shared', 'bigInt.js'),
	path.join(repositoryRootPath, 'ui', 'js', 'shared', 'deploymentAddresses.js'),
	path.join(repositoryRootPath, 'ui', 'ts', 'shared', 'addressDerivation.js'),
	path.join(repositoryRootPath, 'ui', 'ts', 'shared', 'bigInt.js'),
	path.join(repositoryRootPath, 'ui', 'ts', 'shared', 'deploymentAddresses.js'),
	path.join(repositoryRootPath, 'ui', 'ts', 'shared', 'addressDerivation.d.ts'),
	path.join(repositoryRootPath, 'ui', 'ts', 'shared', 'bigInt.d.ts'),
	path.join(repositoryRootPath, 'ui', 'ts', 'shared', 'deploymentAddresses.d.ts'),
]

test('shared helper assets are mirrored into deployable ui paths', () => {
	const contractsSource = fs.readFileSync(uiContractsPath, 'utf8')
	const deploymentHelpersSource = fs.readFileSync(uiDeploymentHelpersPath, 'utf8')

	expect(contractsSource).toContain("from './contracts/helpers.js'")
	expect(contractsSource).toContain("from './contracts/deploymentHelpers.js'")
	expect(contractsSource).not.toContain('../../shared/js/')
	expect(deploymentHelpersSource).toContain("from '../shared/deploymentAddresses.js'")
	expect(deploymentHelpersSource).not.toContain('../../../shared/js/')

	for (const artifactPath of sharedBrowserArtifacts) {
		expect(fs.existsSync(artifactPath)).toBe(true)
	}
})
