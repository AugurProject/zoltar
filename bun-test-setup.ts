import { setDefaultTimeout } from 'bun:test'
import { ensureContractArtifactsAreCurrent } from './scripts/ensure-contract-artifacts.mts'

setDefaultTimeout(300000)

await ensureContractArtifactsAreCurrent()
