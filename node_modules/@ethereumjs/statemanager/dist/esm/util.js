import { Account, bytesToHex } from '@ethereumjs/util';
export async function modifyAccountFields(stateManager, address, accountFields) {
    const account = (await stateManager.getAccount(address)) ?? new Account();
    account.nonce = accountFields.nonce ?? account.nonce;
    account.balance = accountFields.balance ?? account.balance;
    account.storageRoot = accountFields.storageRoot ?? account.storageRoot;
    account.codeHash = accountFields.codeHash ?? account.codeHash;
    account.codeSize = accountFields.codeSize ?? account.codeSize;
    //@ts-expect-error -- Checking for an instantiated property that is not part of the interface
    if (stateManager['_debug'] !== undefined) {
        for (const [field, value] of Object.entries(accountFields)) {
            //@ts-expect-error -- Accessing an instantiated property that is not part of the interface
            stateManager['_debug'](`modifyAccountFields address=${address.toString()} ${field}=${value instanceof Uint8Array ? bytesToHex(value) : value} `);
        }
    }
    await stateManager.putAccount(address, account);
}
//# sourceMappingURL=util.js.map