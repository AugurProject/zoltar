// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ISignatureTransfer
 * @notice Minimal interface for Uniswap's Permit2 SignatureTransfer.
 *         Permit2 singleton is deployed at 0x000000000022D473030F116dDEE9F6B43aC78BA3
 *         on every major chain via CREATE2.
 */
interface ISignatureTransfer {
	struct TokenPermissions {
		address token;
		uint256 amount;
	}

	struct PermitTransferFrom {
		TokenPermissions permitted;
		uint256 nonce;
		uint256 deadline;
	}

	struct SignatureTransferDetails {
		address to;
		uint256 requestedAmount;
	}

	function permitTransferFrom(
		PermitTransferFrom calldata permit,
		SignatureTransferDetails calldata transferDetails,
		address owner,
		bytes calldata signature
	) external;

	function permitWitnessTransferFrom(
		PermitTransferFrom calldata permit,
		SignatureTransferDetails calldata transferDetails,
		address owner,
		bytes32 witness,
		string calldata witnessTypeString,
		bytes calldata signature
	) external;
}
