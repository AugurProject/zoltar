import { assertUniswapDeploymentArtifact } from './uniswap-deployment.mts'

const ARTIFACT_PATH = new URL('./artifacts/uniswap-deployment.json', import.meta.url)
const FORBIDDEN_DEPENDENCIES = ['@uniswap/v3-core', '@uniswap/v3-periphery', '@uniswap/v4-core', '@uniswap/v4-periphery'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

const packageJson: unknown = await Bun.file(new URL('../package.json', import.meta.url)).json()
if (!isRecord(packageJson)) throw new Error('package.json is not an object')
for (const dependencyGroup of ['dependencies', 'devDependencies'] as const) {
	const dependencies = packageJson[dependencyGroup]
	if (!isRecord(dependencies)) throw new Error(`package.json does not contain ${dependencyGroup}`)
	for (const packageName of FORBIDDEN_DEPENDENCIES) {
		if (packageName in dependencies) throw new Error(`${packageName} must not be installed; deploy from the vendored bytecode bundle instead`)
	}
}

const lockfile = await Bun.file(new URL('../bun.lock', import.meta.url)).text()
for (const packageName of FORBIDDEN_DEPENDENCIES) {
	if (lockfile.includes(`"${packageName}"`)) throw new Error(`${packageName} remains in bun.lock`)
}

assertUniswapDeploymentArtifact(await Bun.file(ARTIFACT_PATH).text())

console.log('Uniswap deployment artifact is pinned and no Uniswap packages are installed')
