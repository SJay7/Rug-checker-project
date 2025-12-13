
// ================================================================
// CHAIN CONFIGURATION - Multi-Chain EVM Support
// ================================================================

const CHAINS = {
    eth: {
        name: 'Ethereum',
        shortName: 'ETH',
        chainId: 1,
        
        // RPC
        rpc: 'https://ethereum-rpc.publicnode.com',
        
        // Block Explorer
        explorer: {
            name: 'Etherscan',
            url: 'https://etherscan.io',
            api: 'https://api.etherscan.io/v2/api',
            apiKey: 'K6K49AIR8VNA9WWMWZ1M9CZTV6BNRYETZ5'
        },
        
        // DEX
        dex: {
            name: 'Uniswap V2',
            factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
            router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
        },
        
        // Native Token
        native: {
            symbol: 'ETH',
            name: 'Ethereum',
            wrapped: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            decimals: 18,
            coingeckoId: 'ethereum'
        },
        
        // API Chain IDs
        apis: {
            goplus: '1',
            dexscreener: 'ethereum',
            moralis: 'eth'
        },
        
        // Known Lockers
        lockers: [
            '0x663A5C229c09b049E36dCc11a9B0d4a8Eb9db214', // Unicrypt
            '0x71B5759d73262FBb223956913ecF4ecC51057641', // PinkLock
            '0xE2fE530C047f2d85298b07D9333C05737f1435fB', // Team.Finance
            '0xDba68f07d1b7Ca219f78ae8582C213d975c25cAf', // Mudra Locker
            '0x407993575c91ce7643a4d4cCACc9A98c36eE1BBE', // PinkLock V2
            '0x5E5b9bE5fd939c578ABE5800a90C566eeEbA44a5', // Gempad
        ]
    },
    
    bsc: {
        name: 'BNB Smart Chain',
        shortName: 'BSC',
        chainId: 56,
        
        rpc: 'https://bsc-rpc.publicnode.com',
        
        explorer: {
            name: 'BscScan',
            url: 'https://bscscan.com',
            api: 'https://api.bscscan.com/api',
            apiKey: '' // Uses same key format, user can add
        },
        
        dex: {
            name: 'PancakeSwap V2',
            factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
            router: '0x10ED43C718714eb63d5aA57B78B54704E256024E'
        },
        
        native: {
            symbol: 'BNB',
            name: 'BNB',
            wrapped: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
            decimals: 18,
            coingeckoId: 'binancecoin'
        },
        
        apis: {
            goplus: '56',
            dexscreener: 'bsc',
            moralis: 'bsc'
        },
        
        lockers: [
            '0xc765bddB93b0D1c1A88282BA0fa6B2d00E3e0c83', // PinkLock BSC
            '0x407993575c91ce7643a4d4cCACc9A98c36eE1BBE', // PinkLock V2
            '0xeaEd594B5926A7D5FBBC61985390BaAf936a6b8d', // Mudra BSC
        ]
    },
    
    base: {
        name: 'Base',
        shortName: 'BASE',
        chainId: 8453,
        
        rpc: 'https://base-rpc.publicnode.com',
        
        explorer: {
            name: 'BaseScan',
            url: 'https://basescan.org',
            api: 'https://api.basescan.org/api',
            apiKey: ''
        },
        
        dex: {
            name: 'BaseSwap',
            factory: '0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB', // BaseSwap
            router: '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86'
        },
        
        native: {
            symbol: 'ETH',
            name: 'Ethereum',
            wrapped: '0x4200000000000000000000000000000000000006',
            decimals: 18,
            coingeckoId: 'ethereum'
        },
        
        apis: {
            goplus: '8453',
            dexscreener: 'base',
            moralis: 'base'
        },
        
        lockers: []
    },
    
    polygon: {
        name: 'Polygon',
        shortName: 'MATIC',
        chainId: 137,
        
        rpc: 'https://polygon-bor-rpc.publicnode.com',
        
        explorer: {
            name: 'PolygonScan',
            url: 'https://polygonscan.com',
            api: 'https://api.polygonscan.com/api',
            apiKey: ''
        },
        
        dex: {
            name: 'QuickSwap',
            factory: '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32',
            router: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff'
        },
        
        native: {
            symbol: 'MATIC',
            name: 'Polygon',
            wrapped: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
            decimals: 18,
            coingeckoId: 'matic-network'
        },
        
        apis: {
            goplus: '137',
            dexscreener: 'polygon',
            moralis: 'polygon'
        },
        
        lockers: [
            '0xAf07aC755b6fE82dFDbA3b601e9Ef68aC36C0D2C', // PinkLock Polygon
        ]
    },
    
    arbitrum: {
        name: 'Arbitrum One',
        shortName: 'ARB',
        chainId: 42161,
        
        rpc: 'https://arbitrum-one-rpc.publicnode.com',
        
        explorer: {
            name: 'Arbiscan',
            url: 'https://arbiscan.io',
            api: 'https://api.arbiscan.io/api',
            apiKey: ''
        },
        
        dex: {
            name: 'Camelot',
            factory: '0x6EcCab422D763aC031210895C81787E87B43A652', // Camelot
            router: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d'
        },
        
        native: {
            symbol: 'ETH',
            name: 'Ethereum',
            wrapped: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
            decimals: 18,
            coingeckoId: 'ethereum'
        },
        
        apis: {
            goplus: '42161',
            dexscreener: 'arbitrum',
            moralis: 'arbitrum'
        },
        
        lockers: []
    },
    
    avalanche: {
        name: 'Avalanche C-Chain',
        shortName: 'AVAX',
        chainId: 43114,
        
        rpc: 'https://avalanche-c-chain-rpc.publicnode.com',
        
        explorer: {
            name: 'SnowTrace',
            url: 'https://snowtrace.io',
            api: 'https://api.snowtrace.io/api',
            apiKey: ''
        },
        
        dex: {
            name: 'Trader Joe',
            factory: '0x9Ad6C38BE94206cA50bb0d90783181c1A50Ae23e',
            router: '0x60aE616a2155Ee3d9A68541Ba4544862310933d4'
        },
        
        native: {
            symbol: 'AVAX',
            name: 'Avalanche',
            wrapped: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
            decimals: 18,
            coingeckoId: 'avalanche-2'
        },
        
        apis: {
            goplus: '43114',
            dexscreener: 'avalanche',
            moralis: 'avalanche'
        },
        
        lockers: []
    },
    
    optimism: {
        name: 'Optimism',
        shortName: 'OP',
        chainId: 10,
        
        rpc: 'https://optimism-rpc.publicnode.com',
        
        explorer: {
            name: 'Optimistic Etherscan',
            url: 'https://optimistic.etherscan.io',
            api: 'https://api-optimistic.etherscan.io/api',
            apiKey: ''
        },
        
        dex: {
            name: 'Velodrome',
            factory: '0x25CbdDb98b35ab1FF77413456B31EC81A6B6B746', // Velodrome V2
            router: '0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858'
        },
        
        native: {
            symbol: 'ETH',
            name: 'Ethereum',
            wrapped: '0x4200000000000000000000000000000000000006',
            decimals: 18,
            coingeckoId: 'ethereum'
        },
        
        apis: {
            goplus: '10',
            dexscreener: 'optimism',
            moralis: 'optimism'
        },
        
        lockers: []
    },
    
    fantom: {
        name: 'Fantom',
        shortName: 'FTM',
        chainId: 250,
        
        rpc: 'https://fantom-rpc.publicnode.com',
        
        explorer: {
            name: 'FTMScan',
            url: 'https://ftmscan.com',
            api: 'https://api.ftmscan.com/api',
            apiKey: ''
        },
        
        dex: {
            name: 'SpookySwap',
            factory: '0x152eE697f2E276fA89E96742e9bB9aB1F2E61bE3',
            router: '0xF491e7B69E4244ad4002BC14e878a34207E38c29'
        },
        
        native: {
            symbol: 'FTM',
            name: 'Fantom',
            wrapped: '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83',
            decimals: 18,
            coingeckoId: 'fantom'
        },
        
        apis: {
            goplus: '250',
            dexscreener: 'fantom',
            moralis: 'fantom'
        },
        
        lockers: []
    },
    
    cronos: {
        name: 'Cronos',
        shortName: 'CRO',
        chainId: 25,
        
        rpc: 'https://cronos-evm-rpc.publicnode.com',
        
        explorer: {
            name: 'CronoScan',
            url: 'https://cronoscan.com',
            api: 'https://api.cronoscan.com/api',
            apiKey: ''
        },
        
        dex: {
            name: 'VVS Finance',
            factory: '0x3B44B2a187a7b3824131F8db5a74194D0a42Fc15',
            router: '0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae'
        },
        
        native: {
            symbol: 'CRO',
            name: 'Cronos',
            wrapped: '0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23',
            decimals: 18,
            coingeckoId: 'crypto-com-chain'
        },
        
        apis: {
            goplus: '25',
            dexscreener: 'cronos',
            moralis: 'cronos'
        },
        
        lockers: []
    },
    
    linea: {
        name: 'Linea',
        shortName: 'LINEA',
        chainId: 59144,
        
        rpc: 'https://linea-rpc.publicnode.com',
        
        explorer: {
            name: 'LineaScan',
            url: 'https://lineascan.build',
            api: 'https://api.lineascan.build/api',
            apiKey: ''
        },
        
        dex: {
            name: 'SyncSwap',
            factory: '0x37BAc764494c8db4e54BDE72f6965beA9fa0AC2d',
            router: '0x80e38291e06339d10AAB483C65695D004dBD5C69'
        },
        
        native: {
            symbol: 'ETH',
            name: 'Ethereum',
            wrapped: '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f',
            decimals: 18,
            coingeckoId: 'ethereum'
        },
        
        apis: {
            goplus: '59144',
            dexscreener: 'linea',
            moralis: 'linea'
        },
        
        lockers: []
    },
    
    monad: {
        name: 'Monad',
        shortName: 'MONAD',
        chainId: 143,
        
        rpc: 'https://monad-mainnet.drpc.org',
        rpcBackup: ['https://rpc2.monad.xyz'],
        
        explorer: {
            name: 'Monadscan',
            url: 'https://monadscan.com',
            api: 'https://api.monadscan.com/api',
            apiKey: ''
        },
        
        dex: {
            name: 'Pinot Finance',
            factory: '0x6B7dD9D985BB9Cc42D01E6D9d1E6Ea3c082E61C4', // Primary V2 Factory
            router: '0x0000000000000000000000000000000000000000'
        },
        
        // Additional DEX factories to check (multi-DEX support)
        additionalDexes: [
            { name: 'Nad.fun', factory: '0x39314025E1f0E2D430b65fb7d2A4a2D4Fd740576' }
        ],
        
        native: {
            symbol: 'MON',
            name: 'Monad',
            wrapped: '0xB744F5CDb792d8187640214C4A1c9aCE29af7777', // WMON
            decimals: 18,
            coingeckoId: 'monad'
        },
        
        apis: {
            goplus: '143',
            dexscreener: 'monad',
            moralis: 'monad'
        },
        
        lockers: []
    },
    
    abstract: {
        name: 'Abstract',
        shortName: 'ABS',
        chainId: 2741,
        
        rpc: 'https://api.mainnet.abs.xyz',
        
        explorer: {
            name: 'Abstract Explorer',
            url: 'https://explorer.abs.xyz',
            api: 'https://api.abscan.org/api',
            apiKey: ''
        },
        
        dex: {
            name: 'Abstract DEX',
            factory: '0x0000000000000000000000000000000000000000', // TBD - check for main DEX
            router: '0x0000000000000000000000000000000000000000'
        },
        
        native: {
            symbol: 'ETH',
            name: 'Ethereum',
            wrapped: '0x0000000000000000000000000000000000000000', // TBD
            decimals: 18,
            coingeckoId: 'ethereum'
        },
        
        apis: {
            goplus: '2741',
            dexscreener: 'abstract',
            moralis: 'abstract'
        },
        
        lockers: []
    }
};

// Common burn addresses (same across all EVM chains)
const BURN_ADDRESSES = [
    '0x0000000000000000000000000000000000000000',
    '0x000000000000000000000000000000000000dead',
    '0xdead000000000000000042069420694206942069',
    '0x0000000000000000000000000000000000000001',
];

// Get chain by key or alias
function getChain(chainKey) {
    const key = chainKey.toLowerCase();
    
    // Direct match
    if (CHAINS[key]) return CHAINS[key];
    
    // Aliases
    const aliases = {
        'ethereum': 'eth',
        'binance': 'bsc',
        'bnb': 'bsc',
        'poly': 'polygon',
        'matic': 'polygon',
        'arb': 'arbitrum',
        'avax': 'avalanche',
        'op': 'optimism',
        'ftm': 'fantom',
        'cro': 'cronos',
        'mon': 'monad',
        'abs': 'abstract'
    };
    
    if (aliases[key]) return CHAINS[aliases[key]];
    
    return null;
}

// Get list of supported chains
function getSupportedChains() {
    return Object.keys(CHAINS).map(key => ({
        key,
        name: CHAINS[key].name,
        shortName: CHAINS[key].shortName
    }));
}

// Default chain
const DEFAULT_CHAIN = 'eth';

module.exports = {
    CHAINS,
    BURN_ADDRESSES,
    getChain,
    getSupportedChains,
    DEFAULT_CHAIN
};

