import { getActiveBackend } from './activeEnvironment.js';
export { normalizeAccount } from './chainBackend.js';
export function createConnectedReadClient() {
    return getActiveBackend().createReadClient();
}
export function createWalletWriteClient(accountAddress, callbacks = {}) {
    return getActiveBackend().createWriteClient(accountAddress, callbacks);
}
//# sourceMappingURL=clients.js.map