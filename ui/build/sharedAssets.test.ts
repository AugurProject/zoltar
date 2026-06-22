import { expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(directoryOfThisFile, '..', '..')
const uiContractsPath = path.join(repositoryRootPath, 'ui', 'ts', 'contracts.ts')
const uiDeploymentHelpersPath = path.join(repositoryRootPath, 'ui', 'ts', 'contracts', 'deploymentHelpers.ts')
const uiSimulationBootstrapPath = path.join(repositoryRootPath, 'ui', 'ts', 'simulation', 'bootstrap.ts')
const uiIndexHtmlPath = path.join(repositoryRootPath, 'ui', 'index.html')
const sharedBrowserArtifacts = [path.join(repositoryRootPath, 'shared', 'js', 'bigInt.js'), path.join(repositoryRootPath, 'shared', 'js', 'constants.js'), path.join(repositoryRootPath, 'shared', 'js', 'deploymentAddresses.js')]

test('shared helper package imports resolve to browser-served shared outputs', () => {
	const contractsSource = fs.readFileSync(uiContractsPath, 'utf8')
	const deploymentHelpersSource = fs.readFileSync(uiDeploymentHelpersPath, 'utf8')
	const simulationBootstrapSource = fs.readFileSync(uiSimulationBootstrapPath, 'utf8')
	const uiIndexHtml = fs.readFileSync(uiIndexHtmlPath, 'utf8')

	expect(contractsSource).toContain("from './contracts/helpers.js'")
	expect(contractsSource).toContain("from './contracts/deploymentHelpers.js'")
	expect(contractsSource).toContain("from '@zoltar/shared/bigInt'")
	expect(simulationBootstrapSource).toContain("from '@zoltar/shared/constants'")
	expect(deploymentHelpersSource).toContain("from '@zoltar/shared/deploymentAddresses'")
	expect(contractsSource).not.toContain('./shared/bigInt.js')
	expect(simulationBootstrapSource).not.toContain('../shared/constants.js')
	expect(deploymentHelpersSource).not.toContain('../shared/deploymentAddresses.js')
	expect(uiIndexHtml).toContain('"@zoltar/shared/bigInt": "../shared/js/bigInt.js"')
	expect(uiIndexHtml).toContain('"@zoltar/shared/constants": "../shared/js/constants.js"')
	expect(uiIndexHtml).toContain('"@zoltar/shared/deploymentAddresses": "../shared/js/deploymentAddresses.js"')

	for (const artifactPath of sharedBrowserArtifacts) {
		expect(fs.existsSync(artifactPath)).toBe(true)
	}
})
