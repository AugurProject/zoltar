import { beforeEach, setDefaultTimeout } from 'bun:test'
import { ensureContractArtifactsAreCurrent } from './scripts/ensure-contract-artifacts.mts'
import { afterEach, mock } from 'bun:test'
import { resetActiveEnvironmentForTesting } from './ui/ts/lib/activeEnvironment.js'

setDefaultTimeout(300000)

await ensureContractArtifactsAreCurrent()
beforeEach(() => {
	resetActiveEnvironmentForTesting()
	mock.restore()
})
afterEach(() => {
	resetActiveEnvironmentForTesting()
	mock.restore()
})
