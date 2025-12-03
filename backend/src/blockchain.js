// BLOCKCHAIN CONNECTION
// This file connects us to the Monad blockchain

const { ethers } = require('ethers');

// Monad Mainnet RPC URL (the "phone number" to call the blockchain)
// From: https://docs.monad.xyz/developer-essentials/network-information
const MONAD_RPC_URL = 'https://rpc.monad.xyz';

// Create a connection to Monad
const provider = new ethers.JsonRpcProvider(MONAD_RPC_URL);

// TEST: Check if we're connected
async function testConnection() {
    try {
        // Get the current block number (proves we're connected)
        const blockNumber = await provider.getBlockNumber();
        console.log('Connected to Monad');
        console.log('Current block number:', blockNumber);
        return true;
    } catch (error) {
        console.log('Failed to connect to Monad');
        console.log('Error:', error.message);
        return false;
    }
}

// Run the test
testConnection();

