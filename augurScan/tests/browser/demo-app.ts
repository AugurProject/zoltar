import { startScanner } from '../../browser/app.ts'
import { createDemoApi } from './demo-api.ts'

await startScanner(new URL(location.href).searchParams.get('demo') === '1' ? createDemoApi : undefined)
