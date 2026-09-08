// Temporary compatibility entrypoint for workflows and callers migrating to tooling/.
import { runComponentCiCommand } from '../tooling/ci/run-component-ci.mts'

await runComponentCiCommand(process.argv.slice(2))
