// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPoolAuctionCapital } from './interfaces/ISecurityPoolAuctionCapital.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';

interface IAuctionVaultCapital {
	function materializeAuctionBid(uint256 bidId) external returns (address vault, uint96 positionId);
	function repToken() external view returns (IERC20);
	function depositAndSetHealthTarget(uint256 amount, uint256 targetHealthFactorBps) external;
}

/// @notice One bid's independently collateralized vault, controlled by its bidder.
/// Every voluntary operation first realizes its funded share of the auction cohort.
/// The account remains usable for child-universe choices and later capital ledgers.
contract SecurityPoolAuctionVault {
	using SafeERC20Ops for IERC20;
	address public immutable owner;
	IAuctionVaultCapital public immutable initialCapital;
	ISecurityPoolAuctionCapital public immutable auction;
	uint256 public immutable bidId;
	bool private entered;

	constructor(address owner_, address capital_, address auction_, uint256 bidId_) {
		require(owner_ != address(0) && capital_ != address(0), 'Auction vault dependencies missing');
		owner = owner_;
		initialCapital = IAuctionVaultCapital(capital_);
		auction = ISecurityPoolAuctionCapital(auction_);
		bidId = bidId_;
	}

	receive() external payable {}

	modifier onlyOwner() {
		require(msg.sender == owner, 'Only the auction vault owner');
		require(!entered, 'Auction vault operation active');
		entered = true;
		if (auction.bidPosition(bidId).filledLots != 0) initialCapital.materializeAuctionBid(bidId);
		_;
		entered = false;
	}

	/// @notice Deposit directly from the controlling wallet in one operation;
	/// the wallet approves this vault and its chosen health target stays explicit.
	function depositPrincipal(IAuctionVaultCapital capital, uint256 amount, uint256 targetHealthFactorBps) external onlyOwner {
		IERC20 token = capital.repToken();
		token.safeTransferFrom(msg.sender, address(this), amount);
		token.safeApprove(address(capital), amount);
		capital.depositAndSetHealthTarget(amount, targetHealthFactorBps);
	}

	function execute(address target, uint256 value, bytes calldata data) external payable onlyOwner returns (bytes memory result) {
		return _execute(target, value, data);
	}

	/// @notice Ledger earnings and execution-reserve withdrawals pay this
	/// account. Forward those assets to the owner-selected recipient atomically.
	function executeAndSweep(address target, uint256 value, bytes calldata data, IERC20 token, address payable recipient) external payable onlyOwner returns (bytes memory result) {
		require(recipient != address(0) && recipient != address(this), 'Auction vault recipient invalid');
		result = _execute(target, value, data);
		uint256 rep = token.balanceOf(address(this));
		if (rep != 0) token.safeTransfer(recipient, rep);
		uint256 eth = address(this).balance;
		if (eth != 0) {
			(bool sent, ) = recipient.call{value: eth}('');
			require(sent, 'Auction vault ETH transfer failed');
		}
	}
	function _execute(address target, uint256 value, bytes calldata data) private returns (bytes memory result) {
		require(target != address(0), 'Auction vault target missing');
		bool success;
		(success, result) = target.call{value: value}(data);
		if (!success) {
			assembly ('memory-safe') {
				revert(add(result, 32), mload(result))
			}
		}
	}
	function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
		return this.onERC1155Received.selector;
	}
	function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
		return this.onERC1155BatchReceived.selector;
	}
}
