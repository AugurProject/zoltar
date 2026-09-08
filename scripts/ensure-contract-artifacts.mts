// Temporary compatibility entrypoint for workflows and callers migrating to tooling/.
import { runEnsureContractArtifactsCommand } from '../tooling/contracts/ensure-contract-artifacts.mts'

await runEnsureContractArtifactsCommand(process.argv.slice(2))
