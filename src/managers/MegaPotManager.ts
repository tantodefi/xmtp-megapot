import fs from "fs";
import path from "path";
import type { AgentContext } from "@xmtp/agent-sdk";
import type { WalletSendCallsParams } from "@xmtp/content-type-wallet-send-calls";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  getContract,
  http,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// Function for encoding function data
function encodeFunctionDataCall(
  abi: any[],
  functionName: string,
  args: any[] = [],
) {
  return encodeFunctionData({
    abi,
    functionName,
    args,
  });
}

// MegaPot contract ABI - simplified for ticket purchasing with USDC
const MEGAPOT_ABI = [
  {
    inputs: [
      { name: "numTickets", type: "uint256" },
      { name: "paymentToken", type: "address" },
    ],
    name: "buyTickets",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "referrer", type: "address" },
      { name: "numTickets", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    name: "purchaseTickets",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [],
    name: "usdcToken",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getCurrentDraw",
    outputs: [
      { name: "drawId", type: "uint256" },
      { name: "jackpot", type: "uint256" },
      { name: "ticketPrice", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "winner", type: "address" },
      { name: "isActive", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserTickets",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getUserWins",
    outputs: [
      {
        components: [
          { name: "drawId", type: "uint256" },
          { name: "amount", type: "uint256" },
          { name: "claimed", type: "bool" },
        ],
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  // Contract info
  {
    inputs: [],
    name: "ticketPrice",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "feeBps",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "referralFeeBps",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Fee claiming
  {
    inputs: [],
    name: "withdrawReferralFee",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "withdrawWinnings",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // LP functions
  {
    inputs: [{ name: "_amount", type: "uint256" }],
    name: "lpDeposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "withdrawAllLp",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// MegaPot contract configurations
const MEGAPOT_CONFIGS = {
  mainnet: {
    prod: "0xbEDd4F2beBE9E3E636161E644759f3cbe3d51B95" as Hex,
    test: "0x3368Fc551303aF78543DAA6A7D5Ea978cdB27D0A" as Hex,
  },
  testnet: {
    prod: "0x6f03c7BCaDAdBf5E6F5900DA3d56AdD8FbDac5De" as Hex,
    test: "0x6f03c7BCaDAdBf5E6F5900DA3d56AdD8FbDac5De" as Hex, // Same as prod for testnet
  },
} as const;

// USDC contract addresses
const USDC_ADDRESSES = {
  mainnet: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex,
  testnet: "0xA4253E7C13525287C56550b8708100f93E60509f" as Hex, // MPUSDC
} as const;

// USDC ABI for approval
const USDC_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export interface MegaPotConfig {
  minTicketPurchase: number; // Minimum number of tickets to buy per purchase
  percentageOfSales: number; // Percentage of sales to allocate to MegaPot (0-100)
  autoPurchaseEnabled: boolean;
  groupShareWinnings: boolean; // Share winnings with group
  scheduledPurchases: ScheduledPurchase[];
}

export interface ScheduledPurchase {
  id: string;
  tickets: number;
  frequency: "daily" | "weekly" | "monthly";
  duration: number; // Number of periods
  nextPurchase: Date;
  active: boolean;
}

export interface GroupTicketPurchase {
  id: string;
  groupId: string;
  groupName: string;
  contractAddress: string;
  tickets: number;
  cost: string;
  purchaseDate: Date;
  purchaserInboxId: string;
  source: "manual" | "auto_sale" | "nft_purchase" | "scheduled";
}

export interface MegaPotStats {
  totalTicketsPurchased: number;
  individualTicketsPurchased: number; // Individual tickets (user as recipient)
  groupTicketsPurchased: number; // Group tickets (agent as recipient)
  totalSpent: string; // USDC amount
  totalWinnings: string; // USDC amount
  userOdds?: string | null; // User's odds to win (1 in X)
  ticketsSoldRound?: number; // Total tickets sold in current round
  userTicketsInCurrentRound?: number; // User's tickets in current round
  activePlayers?: number; // Number of active players
  jackpotPool?: string; // Current jackpot pool in USD
  ticketPrice?: string; // Ticket price in USDC
  endTime?: Date; // When the current round ends
  isActive?: boolean; // Whether the round is active
  lastPurchaseTime?: Date | null; // Last ticket purchase time
  groupPurchases: GroupTicketPurchase[];
  ticketHistory?: any[]; // User's ticket purchase history from API
  currentDraw: {
    drawId: number;
    jackpot: string;
    ticketPrice: string;
    endTime: Date;
    isActive: boolean;
  };
}

export interface MegaPotContractConfig {
  contractAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  referrerAddress: `0x${string}`;
}

export class MegaPotManager {
  private client: ReturnType<typeof createPublicClient>;
  private wallet: ReturnType<typeof createWalletClient>;
  private db: any; // We'll use a simple file-based storage
  private lotteryConfig: MegaPotConfig;
  private contractConfig: MegaPotContractConfig;
  private scheduledPurchaseTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private rpcUrl: string,
    private walletKey: `0x${string}`,
    contractConfig: MegaPotContractConfig,
  ) {
    this.contractConfig = contractConfig;

    this.client = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    } as any);

    const account = privateKeyToAccount(walletKey);
    try {
      this.wallet = createWalletClient({
        account,
        chain: base,
        transport: http(rpcUrl),
      });
      console.log(
        `✅ MegaPotManager wallet initialized with address: ${this.wallet.account?.address}`,
      );
    } catch (walletError) {
      console.error(
        `❌ Failed to initialize MegaPotManager wallet:`,
        walletError,
      );
      throw walletError;
    }

    // Load or initialize lottery configuration
    this.lotteryConfig = this.loadConfig();

    // Start scheduled purchases
    this.initializeScheduledPurchases();
  }

  /**
   * Get current MegaPot contract address
   */
  private getContractAddress(): Hex {
    return this.contractConfig.contractAddress;
  }

  /**
   * Get current USDC contract address
   */
  private getUsdcAddress(): Hex {
    return this.contractConfig.usdcAddress;
  }

  /**
   * Get current referrer address
   */
  private getReferrerAddress(): `0x${string}` {
    return this.contractConfig.referrerAddress;
  }

  /**
   * Load MegaPot configuration from database
   */
  private loadConfig(): MegaPotConfig {
    try {
      // Use a simple file-based storage for MegaPot data
      const configPath = path.join(".data", "megapot-config.json");

      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, "utf-8");
        return JSON.parse(configData);
      }
    } catch (error) {
      console.error("Error loading MegaPot config:", error);
    }

    // Default lottery configuration
    const defaultConfig: MegaPotConfig = {
      minTicketPurchase: 1,
      percentageOfSales: 5, // 5% of sales
      autoPurchaseEnabled: false,
      groupShareWinnings: true,
      scheduledPurchases: [],
    };

    this.saveConfig(defaultConfig);
    return defaultConfig;
  }

  /**
   * Save lottery configuration to database
   */
  private saveConfig(config?: MegaPotConfig): void {
    try {
      // Ensure .data directory exists
      const dataDir = ".data";
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const configPath = path.join(dataDir, "megapot-config.json");
      const configToSave = config || this.lotteryConfig;
      fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2));
    } catch (error) {
      console.error("Error saving MegaPot config:", error);
    }
  }

  /**
   * Initialize scheduled purchases on startup
   */
  private initializeScheduledPurchases(): void {
    for (const purchase of this.lotteryConfig.scheduledPurchases) {
      if (purchase.active && purchase.nextPurchase > new Date()) {
        this.scheduleNextPurchase(purchase);
      }
    }
  }

  /**
   * Schedule the next purchase for a scheduled purchase
   */
  private scheduleNextPurchase(purchase: ScheduledPurchase): void {
    const now = new Date();
    const timeUntilNext = purchase.nextPurchase.getTime() - now.getTime();

    if (timeUntilNext > 0) {
      const timeout = setTimeout(async () => {
        await this.executeScheduledPurchase(purchase);
      }, timeUntilNext);

      this.scheduledPurchaseTimeouts.set(purchase.id, timeout);
    }
  }

  /**
   * Execute a scheduled purchase
   */
  private async executeScheduledPurchase(
    purchase: ScheduledPurchase,
  ): Promise<void> {
    try {
      console.log(`🎫 Executing scheduled MegaPot purchase: ${purchase.id}`);
      await this.buyTickets(purchase.tickets);

      // Update next purchase time
      const nextPurchase = new Date(purchase.nextPurchase);
      switch (purchase.frequency) {
        case "daily":
          nextPurchase.setDate(nextPurchase.getDate() + 1);
          break;
        case "weekly":
          nextPurchase.setDate(nextPurchase.getDate() + 7);
          break;
        case "monthly":
          nextPurchase.setMonth(nextPurchase.getMonth() + 1);
          break;
      }

      purchase.nextPurchase = nextPurchase;
      purchase.duration--;

      // Deactivate if duration is complete
      if (purchase.duration <= 0) {
        purchase.active = false;
      }

      this.saveConfig();

      // Reschedule if still active
      if (purchase.active) {
        this.scheduleNextPurchase(purchase);
      }
    } catch (error) {
      console.error(
        `❌ Failed to execute scheduled purchase ${purchase.id}:`,
        error,
      );
    }
  }

  /**
   * Configure MegaPot lottery settings
   */
  configure(config: Partial<MegaPotConfig>): void {
    this.lotteryConfig = { ...this.lotteryConfig, ...config };
    this.saveConfig();
  }

  /**
   * Get current MegaPot lottery configuration
   */
  getConfig(): MegaPotConfig {
    return { ...this.lotteryConfig };
  }

  /**
   * Update MegaPot configuration
   */
  updateConfig(updates: Partial<MegaPotConfig>): void {
    this.lotteryConfig = { ...this.lotteryConfig, ...updates };
    this.saveConfig();
  }

  /**
   * Buy MegaPot tickets with USDC using purchaseTickets function with referrer
   */
  async buyTickets(
    numTickets: number,
  ): Promise<{ txHash: string; cost: string; referenceId: string }> {
    try {
      const contractAddress = this.getContractAddress();
      const usdcAddress = this.getUsdcAddress();

      // Get current ticket price from MegaPot contract
      console.log(`🔍 Using contract address: ${contractAddress}`);
      console.log(`🔍 Contract config:`, {
        contractAddress: this.contractConfig.contractAddress,
        usdcAddress: this.contractConfig.usdcAddress,
        referrerAddress: this.contractConfig.referrerAddress,
      });

      const contract = getContract({
        address: contractAddress,
        abi: MEGAPOT_ABI,
        client: this.client,
      });

      let ticketPrice: bigint;
      // First try the simpler ticketPrice function (more reliable)
      try {
        ticketPrice = await contract.read.ticketPrice();
        console.log(
          `✅ Got ticket price from ticketPrice function: ${ticketPrice.toString()}`,
        );
      } catch (error) {
        console.warn(
          "⚠️ ticketPrice() failed, trying getCurrentDraw() fallback:",
          error instanceof Error ? error.message : String(error),
        );
        // Try fallback to getCurrentDraw function
        try {
          const drawData = await contract.read.getCurrentDraw();
          console.log(`📊 Draw data:`, drawData);
          const [, , ticketPriceFromContract] = drawData;
          ticketPrice = ticketPriceFromContract;
          console.log(
            `✅ Got ticket price from getCurrentDraw fallback: ${ticketPrice.toString()}`,
          );
        } catch (fallbackError) {
          console.error(
            "❌ Both ticket price functions failed:",
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
          );
          console.log("⚠️ Using reasonable fallback ticket price (1 USDC)");
          ticketPrice = 1000000n; // 1 USDC in 6 decimals
        }
      }

      // Ticket price is already in 6 decimals (USDC)
      const ticketPriceUSDC = ticketPrice; // No conversion needed
      const totalCostUSDC = BigInt(numTickets) * ticketPriceUSDC;

      console.log(`💰 Ticket price: ${ticketPrice.toString()} (6 decimals)`);
      console.log(
        `💰 Ticket price USDC: ${(Number(ticketPriceUSDC) / 1000000).toFixed(2)} USDC`,
      );
      console.log(
        `💰 Total cost: ${(Number(totalCostUSDC) / 1000000).toFixed(2)} USDC`,
      );
      console.log(`🎫 Number of tickets: ${numTickets}`);

      if (ticketPriceUSDC === BigInt(0)) {
        throw new Error("Ticket price is 0. Cannot proceed with purchase.");
      }

      // First, approve USDC spending
      const usdcContract = getContract({
        address: usdcAddress,
        abi: USDC_ABI as unknown as any[],
        client: this.client,
      });

      console.log(
        `🔄 Approving USDC spending: ${totalCostUSDC.toString()} USDC`,
      );

      const approveData = encodeFunctionDataCall(
        USDC_ABI as unknown as any[],
        "approve",
        [contractAddress, totalCostUSDC],
      );

      const approveHash = await this.wallet.sendTransaction({
        account: this.wallet.account!,
        chain: base,
        to: usdcAddress,
        data: approveData,
      });

      console.log(`✅ USDC approval transaction: ${approveHash}`);

      // Wait a moment for approval to be mined
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Calculate cost before attempting purchase
      const costInUSDC = Number(totalCostUSDC) / 1000000; // USDC has 6 decimals

      // Execute MegaPot ticket purchase with USDC
      console.log(
        `🎫 Attempting to buy ${numTickets} tickets for ${costInUSDC} USDC`,
      );

      let purchaseHash: string;
      let referenceId: string;

      try {
        // Use purchaseTickets function with referrer
        // purchaseTickets(referrer, value, recipient)
        // value = total USDC amount (not number of tickets)
        console.log(`🎫 Calling purchaseTickets with:`);
        console.log(`   • Referrer: ${this.contractConfig.referrerAddress}`);
        console.log(
          `   • Value: ${totalCostUSDC.toString()} (6 decimals) = $${(Number(totalCostUSDC) / 1000000).toFixed(2)}`,
        );
        console.log(`   • Recipient: ${this.wallet.account!.address}`);

        const purchaseData = encodeFunctionDataCall(
          [...MEGAPOT_ABI],
          "purchaseTickets",
          [
            this.contractConfig.referrerAddress, // referrer address from env
            totalCostUSDC, // total amount in USDC (6 decimals)
            this.wallet.account!.address, // recipient (user) address
          ],
        );

        const purchaseTx = await this.wallet.sendTransaction({
          account: this.wallet.account!,
          chain: base,
          to: contractAddress,
          data: purchaseData,
        });
        purchaseHash = purchaseTx;
        referenceId = `megapot_purchase_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`✅ Purchase transaction sent: ${purchaseHash}`);
        console.log(`📋 Reference ID: ${referenceId}`);
      } catch (error) {
        console.error(`❌ Purchase transaction failed:`, error);
        throw new Error(
          `MegaPot contract transaction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }

      // Cost already calculated above

      // Skip stats update for direct purchases to avoid unnecessary API calls
      // Stats will be updated when explicitly requested by user
      console.log(`✅ Ticket purchase completed successfully`);

      console.log(
        `🎫 Purchased ${numTickets} MegaPot tickets for ${costInUSDC.toFixed(2)} USDC`,
      );

      return {
        txHash: purchaseHash,
        cost: costInUSDC.toFixed(6),
        referenceId: referenceId,
      };
    } catch (error) {
      console.error("❌ Failed to buy MegaPot tickets:", error);
      throw new Error(
        `Failed to purchase tickets: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Prepare MegaPot ticket purchase transactions for user execution
   */
  async prepareTicketPurchase(
    numTickets: number,
    userAddress: string,
  ): Promise<{
    approveCall: {
      to: string;
      data: string;
      value: string;
    };
    purchaseCall: {
      to: string;
      data: string;
      value: string;
    };
    totalCostUSDC: string;
    ticketPriceUSDC: string;
    referenceId: string;
  }> {
    try {
      const contractAddress = this.getContractAddress();
      const usdcAddress = this.getUsdcAddress();

      console.log(`🔍 Using contract address: ${contractAddress}`);
      console.log(`🔍 Using USDC address: ${usdcAddress}`);
      console.log(
        `🔍 Using referrer address: ${this.contractConfig.referrerAddress}`,
      );
      console.log(`🔍 User address: ${userAddress}`);

      const contract = getContract({
        address: contractAddress,
        abi: MEGAPOT_ABI,
        client: this.client,
      });

      let ticketPrice: bigint;
      // First try the simpler ticketPrice function (more reliable)
      try {
        ticketPrice = await contract.read.ticketPrice();
        console.log(
          `✅ Got ticket price from ticketPrice function: ${ticketPrice.toString()}`,
        );
      } catch (error) {
        console.warn(
          "⚠️ ticketPrice() failed, trying getCurrentDraw() fallback:",
          error instanceof Error ? error.message : String(error),
        );
        // Try fallback to getCurrentDraw function
        try {
          const drawData = await contract.read.getCurrentDraw();
          console.log(`📊 Draw data:`, drawData);
          const [, , ticketPriceFromContract] = drawData;
          ticketPrice = ticketPriceFromContract;
          console.log(
            `✅ Got ticket price from getCurrentDraw fallback: ${ticketPrice.toString()}`,
          );
        } catch (fallbackError) {
          console.error(
            "❌ Both ticket price functions failed:",
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
          );
          console.log("⚠️ Using reasonable fallback ticket price (1 USDC)");
          ticketPrice = 1000000n; // 1 USDC in 6 decimals
        }
      }

      // Ticket price is already in 6 decimals (USDC)
      const ticketPriceUSDC = ticketPrice; // No conversion needed
      const totalCostUSDC = BigInt(numTickets) * ticketPriceUSDC;

      console.log(`🎫 Purchase details:`);
      console.log(`   • Number of tickets: ${numTickets}`);
      console.log(
        `   • Ticket price (6 decimals): ${ticketPriceUSDC.toString()}`,
      );
      console.log(
        `   • Ticket price (USDC): $${(Number(ticketPriceUSDC) / 1000000).toFixed(6)}`,
      );
      console.log(`   • Total cost (6 decimals): ${totalCostUSDC.toString()}`);
      console.log(
        `   • Total cost (USDC): $${(Number(totalCostUSDC) / 1000000).toFixed(6)}`,
      );

      if (ticketPriceUSDC === BigInt(0)) {
        throw new Error("Ticket price is 0. Cannot proceed with purchase.");
      }

      // Prepare USDC approval transaction
      console.log(
        `🔄 Preparing USDC approval: ${totalCostUSDC.toString()} USDC`,
      );

      const approveData = encodeFunctionDataCall(
        USDC_ABI as unknown as any[],
        "approve",
        [contractAddress, totalCostUSDC],
      );

      const approveCall = {
        to: usdcAddress,
        data: approveData,
        value: "0x0",
      };

      // Prepare MegaPot ticket purchase transaction
      console.log(
        `🎫 Preparing ticket purchase: ${numTickets} tickets for user ${userAddress}`,
      );

      const purchaseData = encodeFunctionDataCall(
        [...MEGAPOT_ABI],
        "purchaseTickets",
        [
          this.contractConfig.referrerAddress, // referrer address from env
          totalCostUSDC, // total amount in USDC (6 decimals)
          userAddress, // recipient (user) address
        ],
      );

      const purchaseCall = {
        to: contractAddress,
        data: purchaseData,
        value: "0x0",
      };

      const referenceId = `megapot_purchase_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      console.log(`✅ Transaction data prepared successfully`);
      console.log(`📋 Reference ID: ${referenceId}`);

      return {
        approveCall,
        purchaseCall,
        totalCostUSDC: totalCostUSDC.toString(),
        ticketPriceUSDC: ticketPriceUSDC.toString(),
        referenceId,
      };
    } catch (error) {
      console.error("❌ Failed to prepare MegaPot ticket purchase:", error);
      throw new Error(
        `Failed to prepare ticket purchase: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Create a scheduled ticket purchase
   */
  createScheduledPurchase(
    tickets: number,
    frequency: "daily" | "weekly" | "monthly",
    duration: number,
  ): ScheduledPurchase {
    const purchase: ScheduledPurchase = {
      id: `scheduled_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      tickets,
      frequency,
      duration,
      nextPurchase: new Date(),
      active: true,
    };

    this.lotteryConfig.scheduledPurchases.push(purchase);
    this.saveConfig();
    this.scheduleNextPurchase(purchase);

    return purchase;
  }

  /**
   * Cancel a scheduled purchase
   */
  cancelScheduledPurchase(id: string): boolean {
    const purchaseIndex = this.lotteryConfig.scheduledPurchases.findIndex(
      (p) => p.id === id,
    );
    if (purchaseIndex === -1) return false;

    const purchase = this.lotteryConfig.scheduledPurchases[purchaseIndex];

    // Clear timeout
    const timeout = this.scheduledPurchaseTimeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.scheduledPurchaseTimeouts.delete(id);
    }

    // Remove from config
    this.lotteryConfig.scheduledPurchases.splice(purchaseIndex, 1);
    this.saveConfig();

    return true;
  }

  /**
   * Get MegaPot statistics
   */
  async getStats(userAddress?: string): Promise<MegaPotStats> {
    try {
      // First, load local stats to combine with API data
      const statsPath = path.join(".data", "megapot-stats.json");
      let localStats: any = null;
      let localGroupPurchases: any[] = [];

      if (fs.existsSync(statsPath)) {
        const statsData = fs.readFileSync(statsPath, "utf-8");
        localStats = JSON.parse(statsData);

        // Ensure groupPurchases array exists for backward compatibility
        if (!localStats.groupPurchases) {
          localStats.groupPurchases = [];
        }
        localGroupPurchases = localStats.groupPurchases;

        // Convert date strings back to Date objects
        if (localStats.currentDraw && localStats.currentDraw.endTime) {
          localStats.currentDraw.endTime = new Date(
            localStats.currentDraw.endTime,
          );
        }
        console.log(
          `📊 Loaded local stats: ${localGroupPurchases.length} group purchases`,
        );
      }

      // Try to fetch real data from MegaPot API
      const apiKey = process.env.MEGAPOT_DATA_API_KEY;
      let userTicketHistory: any[] = [];
      let userTotalTickets = 0;
      let userIndividualTickets = 0;
      let userGroupTickets = 0;
      let userTotalSpent = 0;
      let apiData: any = null;

      // Check if API key is set and valid
      if (
        !apiKey ||
        apiKey === "your_megapot_data_api_key_here" ||
        apiKey === "YOUR_API_KEY_HERE" ||
        apiKey.trim() === ""
      ) {
        console.log(
          "⚠️ MEGAPOT_DATA_API_KEY not set or invalid, skipping API calls",
        );
        console.log(`📝 Current API key status: ${apiKey ? "SET" : "NOT SET"}`);
      } else if (apiKey && userAddress) {
        try {
          console.log(
            `🎫 Fetching ticket history for: ${userAddress} with API key: ${apiKey.substring(0, 8)}... (full key length: ${apiKey.length})`,
          );
          const ticketHistoryResponse = await fetch(
            `https://api.megapot.io/api/v1/ticket-purchases/${userAddress}?apikey=${apiKey}`,
            {
              headers: {
                Accept: "application/json",
              },
            },
          );

          console.log(
            `🎫 Ticket history response status: ${ticketHistoryResponse.status}`,
          );

          if (!ticketHistoryResponse.ok) {
            const errorText = await ticketHistoryResponse.text();
            console.warn(`⚠️ Ticket history API error: ${errorText}`);
          }

          if (ticketHistoryResponse.ok) {
            userTicketHistory = await ticketHistoryResponse.json();
            console.log(
              `✅ Fetched ${userTicketHistory.length} ticket purchases for user`,
            );

            // Calculate user's total tickets and categorize purchases
            for (const purchase of userTicketHistory) {
              const tickets = purchase.ticketsPurchased || 0;

              // Check if this is a group purchase (recipient is agent's address)
              const isGroupPurchase =
                purchase.recipient === this.wallet.account?.address;

              if (isGroupPurchase) {
                userGroupTickets += tickets;
                // Add to group purchases for tracking
                const groupPurchase: GroupTicketPurchase = {
                  id: `api_group_purchase_${purchase.jackpotRoundId}_${Date.now()}`,
                  groupId: `group_${purchase.recipient}`,
                  groupName: "Group Purchase (via API)",
                  contractAddress: this.getContractAddress(),
                  tickets: tickets,
                  cost: "0", // We'll calculate this when we have ticket price
                  purchaseDate: new Date(),
                  purchaserInboxId: "unknown", // We don't have inbox ID from API
                  source: "manual",
                };
                localGroupPurchases.push(groupPurchase);
              } else {
                userIndividualTickets += tickets;
              }

              userTotalTickets += tickets;
            }

            console.log(
              `📊 Purchase categorization: ${userIndividualTickets} individual + ${userGroupTickets} group = ${userTotalTickets} total tickets`,
            );
          } else {
            console.warn(
              `⚠️ Ticket history API returned status: ${ticketHistoryResponse.status}`,
            );
            const errorText = await ticketHistoryResponse.text();
            console.warn(`⚠️ Error response: ${errorText}`);
          }
        } catch (userApiError) {
          console.warn("⚠️ Failed to fetch user ticket history:", userApiError);
        }
      }

      if (
        apiKey &&
        apiKey !== "your_megapot_data_api_key_here" &&
        apiKey.trim() !== ""
      ) {
        try {
          // Fetch active jackpot stats
          console.log(
            `🎰 Fetching jackpot stats with API key: ${apiKey.substring(0, 8)}...`,
          );
          const response = await fetch(
            `https://api.megapot.io/api/v1/jackpot-round-stats/active?apikey=${apiKey}`,
            {
              headers: {
                Accept: "application/json",
              },
            },
          );

          console.log(`🎰 Jackpot stats response status: ${response.status}`);

          if (response.ok) {
            apiData = await response.json();
            console.log("✅ Fetched real MegaPot jackpot data from API");

            // Calculate spending now that we have ticket price and update group purchase costs
            if (userTicketHistory && userTicketHistory.length > 0) {
              const rawTicketPrice = apiData.ticketPrice || 1000000; // Default to 1 USDC in 6 decimals
              const ticketPrice = rawTicketPrice / 1000000; // Convert from 6 decimals to USDC
              console.log(
                `💰 DEBUG: Raw ticket price from API: ${rawTicketPrice}`,
              );
              console.log(`💰 DEBUG: Converted ticket price: $${ticketPrice}`);
              console.log(
                `💰 DEBUG: apiData.ticketPrice type: ${typeof apiData.ticketPrice}`,
              );
              console.log(
                `💰 DEBUG: apiData structure:`,
                JSON.stringify(apiData, null, 2),
              );

              for (const purchase of userTicketHistory) {
                const tickets = purchase.ticketsPurchased || 0;
                const purchaseCost = tickets * ticketPrice;
                userTotalSpent += purchaseCost;
                console.log(
                  `💰 DEBUG: Purchase ${purchase.jackpotRoundId}: ${tickets} tickets × $${ticketPrice} = $${purchaseCost}`,
                );

                // Update group purchase cost if this was a group purchase
                const isGroupPurchase =
                  purchase.recipient === this.wallet.account?.address;
                if (isGroupPurchase) {
                  const groupPurchase = localGroupPurchases.find((gp) =>
                    gp.id.includes(
                      `api_group_purchase_${purchase.jackpotRoundId}`,
                    ),
                  );
                  if (groupPurchase) {
                    groupPurchase.cost = purchaseCost.toString();
                  }
                }
              }
              console.log(
                `💰 Calculated spending: ${userTotalTickets} tickets × $${ticketPrice} = $${userTotalSpent}`,
              );
            }

            // Calculate user's tickets in current round
            let userTicketsInCurrentRound = 0;
            if (userTicketHistory && userTicketHistory.length > 0) {
              // Get current round ID from API data or use a default
              const currentRoundId = apiData.drawId || 110; // Default to 110 if not provided
              console.log(`🎯 Current round ID: ${currentRoundId}`);

              // Count user's tickets in current round
              for (const purchase of userTicketHistory) {
                if (purchase.jackpotRoundId === currentRoundId) {
                  userTicketsInCurrentRound += purchase.ticketsPurchased || 0;
                }
              }
              console.log(
                `🎫 User has ${userTicketsInCurrentRound} tickets in current round (${currentRoundId})`,
              );
            }

            // Calculate odds for user if they have tickets
            let userOdds = null;
            if (userTotalTickets > 0 && apiData.oddsPerTicket) {
              userOdds = (
                apiData.oddsPerTicket / userTotalTickets
              ).toLocaleString();
            }

            // Load local stats to combine with API data
            const statsPath = path.join(".data", "megapot-stats.json");
            let localStats: any = null;

            if (fs.existsSync(statsPath)) {
              const statsData = fs.readFileSync(statsPath, "utf-8");
              localStats = JSON.parse(statsData);
              if (!localStats.groupPurchases) {
                localStats.groupPurchases = [];
              }
              if (localStats.currentDraw && localStats.currentDraw.endTime) {
                localStats.currentDraw.endTime = new Date(
                  localStats.currentDraw.endTime,
                );
              }
            }

            // Combine API data with local group purchases
            const combinedStats: MegaPotStats = {
              totalTicketsPurchased:
                userTotalTickets || localStats?.totalTicketsPurchased || 0,
              individualTicketsPurchased: userIndividualTickets,
              groupTicketsPurchased: localStats?.groupTicketsPurchased || 0,
              totalSpent:
                userTotalSpent > 0
                  ? userTotalSpent.toString()
                  : localStats?.totalSpent || "0",
              totalWinnings: localStats?.totalWinnings || "0",
              userOdds: userOdds,
              ticketsSoldRound: apiData.ticketsSoldCount || 0,
              userTicketsInCurrentRound: userTicketsInCurrentRound,
              activePlayers: apiData.activePlayers || 0,
              jackpotPool: apiData.prizeUsd || "0",
              ticketPrice: (
                (apiData.ticketPrice || 1000000) / 1000000
              ).toString(),
              endTime: new Date(
                parseInt(apiData.endTimestamp) ||
                  Date.now() + 24 * 60 * 60 * 1000,
              ),
              isActive: true,
              lastPurchaseTime: apiData.lastTicketPurchaseTimestamp
                ? new Date(parseInt(apiData.lastTicketPurchaseTimestamp))
                : null,
              currentDraw: {
                drawId: 110, // API doesn't provide draw ID in this endpoint
                jackpot: (apiData.prizeUsd || "0").toString(),
                ticketPrice: (
                  (apiData.ticketPrice || 1000000) / 1000000
                ).toString(),
                endTime: new Date(
                  parseInt(apiData.endTimestamp) ||
                    Date.now() + 24 * 60 * 60 * 1000,
                ),
                isActive: true,
              },
              groupPurchases: localStats?.groupPurchases || [],
              ticketHistory: userTicketHistory,
            };

            console.log(
              `📊 Combined stats: ${combinedStats.totalTicketsPurchased} API tickets + ${combinedStats.groupPurchases.length} group purchases`,
            );
            // Store API data for final combination
            apiData = combinedStats;
          } else {
            console.warn(
              `⚠️ Jackpot stats API returned status: ${response.status}`,
            );
            const errorText = await response.text();
            console.warn(`⚠️ Error response: ${errorText}`);
          }
        } catch (apiError) {
          console.warn(
            "⚠️ Failed to fetch MegaPot API data, falling back to local:",
            apiError,
          );
        }
      }

      // Create default fallback stats
      const defaultStats: MegaPotStats = {
        totalTicketsPurchased: 0,
        individualTicketsPurchased: 0,
        groupTicketsPurchased: 0,
        totalSpent: "0",
        totalWinnings: "0",
        ticketsSoldRound: 0,
        userTicketsInCurrentRound: 0,
        groupPurchases: localStats?.groupPurchases || [],
        currentDraw: {
          drawId: 0,
          jackpot: "0",
          ticketPrice: "1",
          endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
          isActive: false,
        },
      };

      // If we have local stats, use them as base
      if (localStats) {
        // Combine API data with local group purchases
        const combinedStats: MegaPotStats = {
          totalTicketsPurchased:
            userTotalTickets || localStats.totalTicketsPurchased || 0,
          individualTicketsPurchased: userIndividualTickets,
          groupTicketsPurchased: localStats.groupTicketsPurchased || 0,
          totalSpent:
            userTotalSpent > 0
              ? userTotalSpent.toString()
              : localStats.totalSpent || "0",
          totalWinnings: localStats.totalWinnings || "0",
          userOdds: null, // Will be calculated below if we have API data
          ticketsSoldRound: 0, // Will be set from API if available
          userTicketsInCurrentRound: 0, // Will be set from API if available
          activePlayers: 0, // Will be set from API if available
          jackpotPool: "0", // Will be set from API if available
          ticketPrice: "1", // Will be set from API if available
          endTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // Will be set from API if available
          isActive: true,
          lastPurchaseTime: null,
          groupPurchases: localStats.groupPurchases || [],
          ticketHistory: userTicketHistory,
          currentDraw: localStats.currentDraw || defaultStats.currentDraw,
        };

        // Will combine at the end
      }

      // Final combination of API and local data
      console.log(
        `📊 Checking final combination: apiData=${!!apiData}, localGroupPurchases=${localGroupPurchases.length}`,
      );

      if (apiData) {
        console.log(`📊 API data available:`, JSON.stringify(apiData, null, 2));
        // Use API data as base, combine with local group purchases
        const finalStats: MegaPotStats = {
          ...apiData,
          individualTicketsPurchased: userIndividualTickets,
          groupTicketsPurchased: userGroupTickets,
          groupPurchases: localGroupPurchases,
          totalTicketsPurchased: userTotalTickets,
          totalWinnings:
            localStats?.totalWinnings || apiData.totalWinnings || "0",
        };
        console.log(
          `📊 Final combined stats: ${finalStats.totalTicketsPurchased} total tickets (${apiData.totalTicketsPurchased || 0} API + ${localGroupPurchases.length} group)`,
        );
        return finalStats;
      } else {
        // No API data, use local data with defaults
        const finalStats: MegaPotStats = {
          ...defaultStats,
          individualTicketsPurchased: 0,
          groupTicketsPurchased: localGroupPurchases.reduce(
            (sum, gp) => sum + gp.tickets,
            0,
          ),
          groupPurchases: localGroupPurchases,
          totalTicketsPurchased: localGroupPurchases.reduce(
            (sum, gp) => sum + gp.tickets,
            0,
          ),
          totalWinnings: localStats?.totalWinnings || "0",
        };
        console.log(
          `📊 Final local stats: ${finalStats.totalTicketsPurchased} group tickets (no API data)`,
        );
        return finalStats;
      }
    } catch (error) {
      console.error("Error loading MegaPot stats:", error);
    }

    // Return default stats on error
    return {
      totalTicketsPurchased: 0,
      individualTicketsPurchased: 0,
      groupTicketsPurchased: 0,
      totalSpent: "0",
      totalWinnings: "0",
      groupPurchases: [],
      currentDraw: {
        drawId: 0,
        jackpot: "0",
        ticketPrice: "0",
        endTime: new Date(),
        isActive: false,
      },
    };
  }

  /**
   * Check for winnings and update stats
   */
  async checkWinnings(): Promise<{ winnings: string; claimed: boolean }> {
    try {
      const contract = getContract({
        address: this.getContractAddress(),
        abi: MEGAPOT_ABI,
        client: this.client,
      });

      const wins = await contract.read.getUserWins();
      let totalWinnings: bigint = BigInt(0);

      for (const win of wins) {
        if (!win.claimed) {
          totalWinnings += win.amount;
        }
      }

      if (totalWinnings > 0n) {
        // Update stats
        const stats = await this.getStats();
        const winningsEth = formatEther(totalWinnings);
        stats.totalWinnings = (
          parseFloat(stats.totalWinnings) + parseFloat(winningsEth)
        ).toString();

        // Save updated stats
        try {
          const statsPath = path.join(".data", "megapot-stats.json");
          fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
        } catch (error) {
          console.error("Error saving MegaPot stats:", error);
        }

        console.log(`🎉 MegaPot winnings detected: ${winningsEth} ETH`);
      }

      return {
        winnings: formatEther(totalWinnings),
        claimed: totalWinnings === BigInt(0),
      };
    } catch (error) {
      console.error("❌ Failed to check winnings:", error);
      return { winnings: "0", claimed: false };
    }
  }

  /**
   * Claim lottery winnings
   */
  /**
   * Prepare claim winnings transaction for user's wallet
   */
  async prepareClaimWinnings(userAddress: string): Promise<any> {
    try {
      console.log(`🎉 Preparing claim winnings transaction for ${userAddress}`);
      const contractAddress = this.getContractAddress();

      // Prepare the withdrawWinnings call data
      const claimData = encodeFunctionDataCall(
        MEGAPOT_ABI as unknown as any[],
        "withdrawWinnings",
        [],
      );

      const walletSendCalls: any = {
        version: "1.0",
        chainId: `0x${base.id.toString(16)}`,
        from: userAddress as `0x${string}`,
        capabilities: {
          reference: `megapot_claim_${Date.now()}`,
          app: "MegaPot",
          icon: "https://megapot.io/favicon.ico",
          domain: "megapot.io",
          name: "MegaPot Winnings",
          description: "Claim your lottery winnings",
          hostname: "megapot.io",
          faviconUrl: "https://megapot.io/favicon.ico",
          title: "MegaPot Lottery Claim",
        },
        calls: [
          {
            to: contractAddress as `0x${string}`,
            data: claimData as `0x${string}`,
            value: "0x0",
            gas: "0x15F90", // ~90,000 gas
            metadata: {
              description: "Claim your lottery winnings",
              transactionType: "claim_winnings",
              appName: "MegaPot",
              appIcon: "https://megapot.io/favicon.ico",
              appDomain: "megapot.io",
              hostname: "megapot.io",
              faviconUrl: "https://megapot.io/favicon.ico",
              title: "MegaPot Lottery Claim",
            },
          },
        ],
      };

      return walletSendCalls;
    } catch (error) {
      console.error("❌ Failed to prepare claim transaction:", error);
      throw new Error(
        `Failed to prepare claim transaction: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Legacy method - keeping for backward compatibility but now throws error
   */
  async claimWinnings(): Promise<{ txHash: string; distributed?: boolean }> {
    throw new Error(
      "Use prepareClaimWinnings() instead - agent cannot claim winnings for users",
    );
  }

  /**
   * Check if user has winnings to claim
   * Note: getUserWins() doesn't take parameters - it returns wins for the calling wallet
   */
  async hasWinningsToClaim(userAddress?: string): Promise<boolean> {
    try {
      // getUserWins() returns wins for the caller, so we need to use the user's wallet context
      // For now, we'll always return true and let the actual claim attempt determine if there are winnings
      console.log(
        `🎰 Checking winnings availability for user: ${userAddress || "agent"}`,
      );

      // Since getUserWins() doesn't take parameters and only works for the calling wallet,
      // we can't pre-check winnings for other users. We'll return true and let the claim attempt handle it.
      return true;
    } catch (error) {
      console.error("Error checking winnings:", error);
      return false;
    }
  }

  /**
   * Get claimable winnings amount (simplified - gets balance after claim)
   */
  private async getClaimableWinnings(): Promise<number> {
    try {
      // This is a simplified approach - in production you'd check contract balance
      // For now, we'll estimate based on recent wins
      const contract = getContract({
        address: this.getContractAddress(),
        abi: MEGAPOT_ABI,
        client: this.client,
      });

      const wins = await contract.read.getUserWins();

      let totalWinnings: bigint = BigInt(0);
      for (const win of wins) {
        totalWinnings += win.amount;
      }

      // Convert from wei to ETH
      return Number(totalWinnings) / 1e18;
    } catch (error) {
      console.error("❌ Failed to get claimable winnings:", error);
      return 0;
    }
  }

  /**
   * Get contract information
   */
  async getContractInfo(): Promise<{
    ticketPrice: string;
    feeBps: number;
    referralFeeBps: number;
    tokenAddress: string;
  }> {
    try {
      const contractAddress = this.getContractAddress();
      const contract = getContract({
        address: contractAddress,
        abi: MEGAPOT_ABI,
        client: this.client,
      });

      const ticketPrice = await contract.read.ticketPrice();
      const feeBps = await contract.read.feeBps();
      const referralFeeBps = await contract.read.referralFeeBps();
      const tokenAddress = await contract.read.token();

      return {
        ticketPrice: (Number(ticketPrice) / 10 ** 6).toString(), // Convert to USDC
        feeBps: Number(feeBps),
        referralFeeBps: Number(referralFeeBps),
        tokenAddress,
      };
    } catch (error) {
      console.error("❌ Failed to get contract info:", error);
      throw new Error(
        `Failed to get contract info: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Add liquidity to the jackpot (LP)
   */
  async addLiquidity(amount: string): Promise<{ txHash: string }> {
    try {
      const contractAddress = this.getContractAddress();
      const usdcAddress = this.getUsdcAddress();

      // Convert amount to USDC units (6 decimals)
      const amountUSDC = BigInt(Math.floor(parseFloat(amount) * 10 ** 6));

      // First approve USDC spending for LP deposit
      const approveData = encodeFunctionDataCall(
        USDC_ABI as unknown as any[],
        "approve",
        [contractAddress, amountUSDC],
      );

      const approveHash = await this.wallet.sendTransaction({
        account: this.wallet.account!,
        chain: base,
        to: usdcAddress,
        data: approveData,
      });

      console.log(`🔄 LP deposit approval: ${approveHash}`);

      // Wait for approval
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Add liquidity
      const depositData = encodeFunctionDataCall(
        [...MEGAPOT_ABI],
        "lpDeposit",
        [amountUSDC],
      );

      const depositHash = await this.wallet.sendTransaction({
        account: this.wallet.account!,
        chain: base,
        to: contractAddress,
        data: depositData,
      });

      console.log(`💧 Liquidity added: ${depositHash}`);
      return { txHash: depositHash };
    } catch (error) {
      console.error("❌ Failed to add liquidity:", error);
      throw new Error(
        `Failed to add liquidity: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Withdraw all LP liquidity
   */
  async withdrawLiquidity(): Promise<{ txHash: string }> {
    try {
      const contractAddress = this.getContractAddress();

      const withdrawData = encodeFunctionDataCall(
        [...MEGAPOT_ABI],
        "withdrawAllLp",
        [],
      );

      const hash = await this.wallet.sendTransaction({
        account: this.wallet.account!,
        chain: base,
        to: contractAddress,
        data: withdrawData,
      });

      console.log(`💰 LP liquidity withdrawn: ${hash}`);
      return { txHash: hash };
    } catch (error) {
      console.error("❌ Failed to withdraw liquidity:", error);
      throw new Error(
        `Failed to withdraw liquidity: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Format amount for display
   */
  formatAmount(amount: string): string {
    const num = parseFloat(amount);
    if (num === 0) return "0 USDC";
    if (num < 0.01) return `${num.toFixed(4)} USDC`;
    return `${num.toFixed(2)} USDC`;
  }

  /**
   * Clean up timeouts on shutdown
   */
  cleanup(): void {
    for (const timeout of this.scheduledPurchaseTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.scheduledPurchaseTimeouts.clear();
  }
}
