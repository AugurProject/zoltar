export declare const ABIS: {
	readonly mainnet: {
		readonly erc1155: readonly [
			{
				readonly inputs: readonly []
				readonly stateMutability: 'nonpayable'
				readonly type: 'constructor'
			},
			{
				readonly anonymous: false
				readonly inputs: readonly [
					{
						readonly indexed: true
						readonly internalType: 'address'
						readonly name: 'owner'
						readonly type: 'address'
					},
					{
						readonly indexed: true
						readonly internalType: 'address'
						readonly name: 'operator'
						readonly type: 'address'
					},
					{
						readonly indexed: false
						readonly internalType: 'bool'
						readonly name: 'approved'
						readonly type: 'bool'
					},
				]
				readonly name: 'ApprovalForAll'
				readonly type: 'event'
			},
			{
				readonly anonymous: false
				readonly inputs: readonly [
					{
						readonly indexed: true
						readonly internalType: 'address'
						readonly name: 'operator'
						readonly type: 'address'
					},
					{
						readonly indexed: true
						readonly internalType: 'address'
						readonly name: 'from'
						readonly type: 'address'
					},
					{
						readonly indexed: true
						readonly internalType: 'address'
						readonly name: 'to'
						readonly type: 'address'
					},
					{
						readonly indexed: false
						readonly internalType: 'uint256[]'
						readonly name: 'ids'
						readonly type: 'uint256[]'
					},
					{
						readonly indexed: false
						readonly internalType: 'uint256[]'
						readonly name: 'values'
						readonly type: 'uint256[]'
					},
				]
				readonly name: 'TransferBatch'
				readonly type: 'event'
			},
			{
				readonly anonymous: false
				readonly inputs: readonly [
					{
						readonly indexed: true
						readonly internalType: 'address'
						readonly name: 'operator'
						readonly type: 'address'
					},
					{
						readonly indexed: true
						readonly internalType: 'address'
						readonly name: 'from'
						readonly type: 'address'
					},
					{
						readonly indexed: true
						readonly internalType: 'address'
						readonly name: 'to'
						readonly type: 'address'
					},
					{
						readonly indexed: false
						readonly internalType: 'uint256'
						readonly name: 'id'
						readonly type: 'uint256'
					},
					{
						readonly indexed: false
						readonly internalType: 'uint256'
						readonly name: 'value'
						readonly type: 'uint256'
					},
				]
				readonly name: 'TransferSingle'
				readonly type: 'event'
			},
			{
				readonly anonymous: false
				readonly inputs: readonly [
					{
						readonly indexed: false
						readonly internalType: 'string'
						readonly name: 'value'
						readonly type: 'string'
					},
					{
						readonly indexed: true
						readonly internalType: 'uint256'
						readonly name: 'id'
						readonly type: 'uint256'
					},
				]
				readonly name: 'URI'
				readonly type: 'event'
			},
			{
				readonly inputs: readonly [
					{
						readonly internalType: 'uint256'
						readonly name: ''
						readonly type: 'uint256'
					},
					{
						readonly internalType: 'address'
						readonly name: ''
						readonly type: 'address'
					},
				]
				readonly name: '_balances'
				readonly outputs: readonly [
					{
						readonly internalType: 'uint256'
						readonly name: ''
						readonly type: 'uint256'
					},
				]
				readonly stateMutability: 'view'
				readonly type: 'function'
			},
			{
				readonly inputs: readonly [
					{
						readonly internalType: 'address'
						readonly name: ''
						readonly type: 'address'
					},
					{
						readonly internalType: 'address'
						readonly name: ''
						readonly type: 'address'
					},
				]
				readonly name: '_operatorApprovals'
				readonly outputs: readonly [
					{
						readonly internalType: 'bool'
						readonly name: ''
						readonly type: 'bool'
					},
				]
				readonly stateMutability: 'view'
				readonly type: 'function'
			},
			{
				readonly inputs: readonly [
					{
						readonly internalType: 'uint256'
						readonly name: ''
						readonly type: 'uint256'
					},
				]
				readonly name: '_supplies'
				readonly outputs: readonly [
					{
						readonly internalType: 'uint256'
						readonly name: ''
						readonly type: 'uint256'
					},
				]
				readonly stateMutability: 'view'
				readonly type: 'function'
			},
			{
				readonly inputs: readonly [
					{
						readonly internalType: 'address'
						readonly name: 'account'
						readonly type: 'address'
					},
					{
						readonly internalType: 'uint256'
						readonly name: 'id'
						readonly type: 'uint256'
					},
				]
				readonly name: 'balanceOf'
				readonly outputs: readonly [
					{
						readonly internalType: 'uint256'
						readonly name: ''
						readonly type: 'uint256'
					},
				]
				readonly stateMutability: 'view'
				readonly type: 'function'
			},
			{
				readonly inputs: readonly [
					{
						readonly internalType: 'address[]'
						readonly name: 'accounts'
						readonly type: 'address[]'
					},
					{
						readonly internalType: 'uint256[]'
						readonly name: 'ids'
						readonly type: 'uint256[]'
					},
				]
				readonly name: 'balanceOfBatch'
				readonly outputs: readonly [
					{
						readonly internalType: 'uint256[]'
						readonly name: ''
						readonly type: 'uint256[]'
					},
				]
				readonly stateMutability: 'view'
				readonly type: 'function'
			},
			{
				readonly inputs: readonly [
					{
						readonly internalType: 'address'
						readonly name: 'account'
						readonly type: 'address'
					},
					{
						readonly internalType: 'address'
						readonly name: 'operator'
						readonly type: 'address'
					},
				]
				readonly name: 'isApprovedForAll'
				readonly outputs: readonly [
					{
						readonly internalType: 'bool'
						readonly name: ''
						readonly type: 'bool'
					},
				]
				readonly stateMutability: 'view'
				readonly type: 'function'
			},
			{
				readonly inputs: readonly [
					{
						readonly internalType: 'address'
						readonly name: 'from'
						readonly type: 'address'
					},
					{
						readonly internalType: 'address'
						readonly name: 'to'
						readonly type: 'address'
					},
					{
						readonly internalType: 'uint256[]'
						readonly name: 'ids'
						readonly type: 'uint256[]'
					},
					{
						readonly internalType: 'uint256[]'
						readonly name: 'values'
						readonly type: 'uint256[]'
					},
					{
						readonly internalType: 'bytes'
						readonly name: 'data'
						readonly type: 'bytes'
					},
				]
				readonly name: 'safeBatchTransferFrom'
				readonly outputs: readonly []
				readonly stateMutability: 'nonpayable'
				readonly type: 'function'
			},
			{
				readonly inputs: readonly [
					{
						readonly internalType: 'address'
						readonly name: 'from'
						readonly type: 'address'
					},
					{
						readonly internalType: 'address'
						readonly name: 'to'
						readonly type: 'address'
					},
					{
						readonly internalType: 'uint256'
						readonly name: 'id'
						readonly type: 'uint256'
					},
					{
						readonly internalType: 'uint256'
						readonly name: 'value'
						readonly type: 'uint256'
					},
					{
						readonly internalType: 'bytes'
						readonly name: 'data'
						readonly type: 'bytes'
					},
				]
				readonly name: 'safeTransferFrom'
				readonly outputs: readonly []
				readonly stateMutability: 'nonpayable'
				readonly type: 'function'
			},
			{
				readonly inputs: readonly [
					{
						readonly internalType: 'address'
						readonly name: 'operator'
						readonly type: 'address'
					},
					{
						readonly internalType: 'bool'
						readonly name: 'approved'
						readonly type: 'bool'
					},
				]
				readonly name: 'setApprovalForAll'
				readonly outputs: readonly []
				readonly stateMutability: 'nonpayable'
				readonly type: 'function'
			},
			{
				readonly inputs: readonly [
					{
						readonly internalType: 'uint256'
						readonly name: 'id'
						readonly type: 'uint256'
					},
				]
				readonly name: 'totalSupply'
				readonly outputs: readonly [
					{
						readonly internalType: 'uint256'
						readonly name: ''
						readonly type: 'uint256'
					},
				]
				readonly stateMutability: 'view'
				readonly type: 'function'
			},
		]
		readonly erc20: readonly [
			{
				readonly constant: true
				readonly inputs: readonly []
				readonly name: 'name'
				readonly outputs: readonly [
					{
						readonly name: ''
						readonly type: 'string'
					},
				]
				readonly payable: false
				readonly stateMutability: 'view'
				readonly type: 'function'
			},
			{
				readonly constant: false
				readonly inputs: readonly [
					{
						readonly name: '_spender'
						readonly type: 'address'
					},
					{
						readonly name: '_value'
						readonly type: 'uint256'
					},
				]
				readonly name: 'approve'
				readonly outputs: readonly [
					{
						readonly name: ''
						readonly type: 'bool'
					},
				]
				readonly payable: false
				readonly stateMutability: 'nonpayable'
				readonly type: 'function'
			},
			{
				readonly constant: true
				readonly inputs: readonly []
				readonly name: 'totalSupply'
				readonly outputs: readonly [
					{
						readonly name: ''
						readonly type: 'uint256'
					},
				]
				readonly payable: false
				readonly stateMutability: 'view'
				readonly type: 'function'
			},
			{
				readonly constant: false
				readonly inputs: readonly [
					{
						readonly name: '_from'
						readonly type: 'address'
					},
					{
						readonly name: '_to'
						readonly type: 'address'
					},
					{
						readonly name: '_value'
						readonly type: 'uint256'
					},
				]
				readonly name: 'transferFrom'
				readonly outputs: readonly [
					{
						readonly name: ''
						readonly type: 'bool'
					},
				]
				readonly payable: false
				readonly stateMutability: 'nonpayable'
				readonly type: 'function'
			},
			{
				readonly constant: true
				readonly inputs: readonly []
				readonly name: 'decimals'
				readonly outputs: readonly [
					{
						readonly name: ''
						readonly type: 'uint8'
					},
				]
				readonly payable: false
				readonly stateMutability: 'view'
				readonly type: 'function'
			},
			{
				readonly constant: true
				readonly inputs: readonly [
					{
						readonly name: '_owner'
						readonly type: 'address'
					},
				]
				readonly name: 'balanceOf'
				readonly outputs: readonly [
					{
						readonly name: 'balance'
						readonly type: 'uint256'
					},
				]
				readonly payable: false
				readonly stateMutability: 'view'
				readonly type: 'function'
			},
			{
				readonly constant: true
				readonly inputs: readonly []
				readonly name: 'symbol'
				readonly outputs: readonly [
					{
						readonly name: ''
						readonly type: 'string'
					},
				]
				readonly payable: false
				readonly stateMutability: 'view'
				readonly type: 'function'
			},
			{
				readonly constant: false
				readonly inputs: readonly [
					{
						readonly name: '_to'
						readonly type: 'address'
					},
					{
						readonly name: '_value'
						readonly type: 'uint256'
					},
				]
				readonly name: 'transfer'
				readonly outputs: readonly [
					{
						readonly name: ''
						readonly type: 'bool'
					},
				]
				readonly payable: false
				readonly stateMutability: 'nonpayable'
				readonly type: 'function'
			},
			{
				readonly constant: true
				readonly inputs: readonly [
					{
						readonly name: '_owner'
						readonly type: 'address'
					},
					{
						readonly name: '_spender'
						readonly type: 'address'
					},
				]
				readonly name: 'allowance'
				readonly outputs: readonly [
					{
						readonly name: ''
						readonly type: 'uint256'
					},
				]
				readonly payable: false
				readonly stateMutability: 'view'
				readonly type: 'function'
			},
			{
				readonly payable: true
				readonly stateMutability: 'payable'
				readonly type: 'fallback'
			},
			{
				readonly anonymous: false
				readonly inputs: readonly [
					{
						readonly indexed: true
						readonly name: 'owner'
						readonly type: 'address'
					},
					{
						readonly indexed: true
						readonly name: 'spender'
						readonly type: 'address'
					},
					{
						readonly indexed: false
						readonly name: 'value'
						readonly type: 'uint256'
					},
				]
				readonly name: 'Approval'
				readonly type: 'event'
			},
			{
				readonly anonymous: false
				readonly inputs: readonly [
					{
						readonly indexed: true
						readonly name: 'from'
						readonly type: 'address'
					},
					{
						readonly indexed: true
						readonly name: 'to'
						readonly type: 'address'
					},
					{
						readonly indexed: false
						readonly name: 'value'
						readonly type: 'uint256'
					},
				]
				readonly name: 'Transfer'
				readonly type: 'event'
			},
		]
	}
}
//# sourceMappingURL=abis.d.ts.map
