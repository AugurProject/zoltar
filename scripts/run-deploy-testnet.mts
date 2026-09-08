// Temporary compatibility entrypoint for workflows and callers migrating to tooling/.
import { runHeadlessTestnetDeployment } from '../tooling/contracts/run-deploy-testnet.mts'

process.exitCode = await runHeadlessTestnetDeployment(process.argv.slice(2))
