"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.modifyAccountFields = modifyAccountFields;
const util_1 = require("@ethereumjs/util");
async function modifyAccountFields(stateManager, address, accountFields) {
    const account = (await stateManager.getAccount(address)) ?? new util_1.Account();
    account.nonce = accountFields.nonce ?? account.nonce;
    account.balance = accountFields.balance ?? account.balance;
    account.storageRoot = accountFields.storageRoot ?? account.storageRoot;
    account.codeHash = accountFields.codeHash ?? account.codeHash;
    account.codeSize = accountFields.codeSize ?? account.codeSize;
    //@ts-expect-error -- Checking for an instantiated property that is not part of the interface
    if (stateManager['_debug'] !== undefined) {
        for (const [field, value] of Object.entries(accountFields)) {
            //@ts-expect-error -- Accessing an instantiated property that is not part of the interface
            stateManager['_debug'](`modifyAccountFields address=${address.toString()} ${field}=${value instanceof Uint8Array ? (0, util_1.bytesToHex)(value) : value} `);
        }
    }
    await stateManager.putAccount(address, account);
}
//# sourceMappingURL=util.js.map