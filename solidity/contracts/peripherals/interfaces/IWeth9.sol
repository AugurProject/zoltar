// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.30;

interface IWeth9 {
	// ERC-20 metadata
	function name() external view returns (string memory);
	function symbol() external view returns (string memory);
	function decimals() external view returns (uint8);

	// ERC-20 standard events
	event Approval(address indexed src, address indexed guy, uint wad);
	event Transfer(address indexed src, address indexed dst, uint wad);

	// WETH-specific events
	event Deposit(address indexed dst, uint wad);
	event Withdrawal(address indexed src, uint wad);

	// ERC-20 storage mappings
	function balanceOf(address account) external view returns (uint);
	function allowance(address owner, address spender) external view returns (uint);

	// WETH functions
	function deposit() external payable;
	function withdraw(uint wad) external;
	function totalSupply() external view returns (uint);
	function approve(address guy, uint wad) external returns (bool);
	function transfer(address dst, uint wad) external returns (bool);
	function transferFrom(address src, address dst, uint wad) external returns (bool);
}

