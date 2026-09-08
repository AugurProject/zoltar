// Temporary compatibility entrypoint for workflows and callers migrating to tooling/.
import { runClassifyCiChangeCommand } from '../tooling/ci/classify-ci-change.mts'

runClassifyCiChangeCommand(process.argv.slice(2))
