
// TOKEN INFO READER
// Reads basic info about any token


const { ethers } = require('ethers');

// Connect to Monad
const MONAD_RPC_URL = 'https://rpc.monad.xyz';
const provider = new ethers.JsonRpcProvider(MONAD_RPC_URL);

// Standard ERC-20 ABI (the "dictionary" to understand token contracts)
// We only need the functions we want to call
const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function totalSupply() view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function owner() view returns (address)",      // Not all tokens have this
    "function balanceOf(address) view returns (uint256)"
];

// Read token information
async function getTokenInfo(tokenAddress) {
    console.log('\nAnalyzing token:', tokenAddress, '\n');
    
    try {
        // Create a contract instance (like opening a phone line to this specific token)
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        
        // Read basic info
        const name = await token.name();
        const symbol = await token.symbol();
        const decimals = await token.decimals();
        const totalSupply = await token.totalSupply();
        
        // Format total supply (divide by decimals)
        const formattedSupply = ethers.formatUnits(totalSupply, decimals);
        
        console.log('Token Info:');
        console.log('  Name:', name);
        console.log('  Symbol:', symbol);
        console.log('  Decimals:', decimals);
        console.log('  Total Supply:', formattedSupply);
        
        // Try to get owner (not all tokens have this)
        try {
            const owner = await token.owner();
            console.log('  Owner:', owner);
            
            // Check if ownership is renounced (owner is zero address)
            if (owner === '0x0000000000000000000000000000000000000000') {
                console.log('  Status: Ownership renounced');
            } else {
                console.log('  Status: Has active owner');
            }
        } catch (e) {
            console.log('  Owner: No owner function found');
        }
        
        return { name, symbol, decimals, totalSupply: formattedSupply };
        
    } catch (error) {
        console.log('Error reading token:', error.message);
        return null;
    }
}

// Test with a token address

// You can change this to any token address on Monad
const TEST_TOKEN = process.argv[2] || '0x0000000000000000000000000000000000000000';

if (TEST_TOKEN === '0x0000000000000000000000000000000000000000') {
    console.log('Usage: node src/tokenInfo.js <TOKEN_ADDRESS>');
    console.log('Example: node src/tokenInfo.js 0x123...');
} else {
    getTokenInfo(TEST_TOKEN);
}

