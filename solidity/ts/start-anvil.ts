import { spawn } from 'node:child_process'
import { TEST_CHAIN_START_TIMESTAMP } from './testsuite/simulator/useIsolatedAnvilNode'

const anvil = spawn('anvil', ['--chain-id', '1', '--timestamp', TEST_CHAIN_START_TIMESTAMP.toString(), '--block-base-fee-per-gas', '0', '--gas-price', '0', '--no-priority-fee'], { stdio: 'inherit' })

anvil.on('exit', code => process.exit(code ?? 0))
