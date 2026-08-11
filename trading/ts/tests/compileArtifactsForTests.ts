import { access } from 'node:fs/promises'
import path from 'node:path'
import { compileTradingContracts } from '../compiler/compile.mts'

let compilation: ReturnType<typeof compileTradingContracts> | undefined

export function compileArtifactsForTests() {
	compilation ??= (async () => {
		const artifactPath = path.resolve(import.meta.dir, '../artifacts/contractArtifact.ts')
		const artifactExists = await access(artifactPath).then(
			() => true,
			() => false,
		)
		if (artifactExists) return (await import('../artifacts/contractArtifact.ts')).tradingContracts
		return await compileTradingContracts({ writeArtifacts: false })
	})()
	return compilation
}
