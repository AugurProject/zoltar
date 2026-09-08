import { resolve } from 'node:path'
import { checkContractSafety, loadContractArtifact } from './contract-safety'
import { contractSafetyPolicy } from './contract-safety-policy'

const artifactPath = resolve(process.cwd(), process.argv[2] ?? 'solidity/artifacts/Contracts.json')
const result = checkContractSafety(loadContractArtifact(artifactPath))

console.log('Deployable contract sizes (bytes)')
console.log('runtime  creation  min initcode  runtime headroom  initcode headroom  contract')
for (const size of result.sizes) {
	console.log(
		`${size.runtimeBytes.toString().padStart(7)}  ${size.creationBytes.toString().padStart(8)}  ${size.initcodeBytes.toString().padStart(12)}  ${(contractSafetyPolicy.runtimeLimitBytes - size.runtimeBytes).toString().padStart(16)}  ${(contractSafetyPolicy.initcodeLimitBytes - size.initcodeBytes).toString().padStart(17)}  ${size.sourcePath}:${size.contractName}`,
	)
}

console.log(`Checked ${result.sizes.length} production-deployable contracts, ${contractSafetyPolicy.exactLayoutPairs.length} exact delegate layouts, and ${contractSafetyPolicy.anchoredLayouts.reduce((total, layout) => total + layout.anchors.length, 0)} assembly storage anchors.`)
if (result.errors.length > 0) {
	console.error('\nContract safety check failed:')
	for (const error of result.errors) console.error(`- ${error}`)
	process.exitCode = 1
} else {
	console.log('Contract size and delegate storage-layout checks passed.')
}
