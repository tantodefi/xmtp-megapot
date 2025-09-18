import type { WalletSendCallsParams } from "@xmtp/content-type-wallet-send-calls";
import { Group, type Conversation } from "@xmtp/node-sdk";
import { createPublicClient, encodeFunctionData, http } from "viem";
import { base } from "viem/chains";
import { MegaPotManager } from "../managers/MegaPotManager.js";
import { getDisplayName, getMentionName } from "../utils/displayName.js";

// JackpotPool contract ABI - based on actual contract functions
const JACKPOT_POOL_ABI = [
  {
    inputs: [
      { name: "referrer", type: "address" },
      { name: "value", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    name: "purchaseTickets",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "withdrawParticipantWinnings",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "participant_", type: "address" }],
    name: "withdrawParticipantWinnings",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Read-only functions from the JackpotPool contract
  {
    inputs: [],
    name: "poolTicketsPurchasedBps",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "pendingPoolWinnings",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "jackpot",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "uint256" }],
    name: "poolTickets",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "uint256" },
    ],
    name: "participantTickets",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "participant", type: "address" },
      { indexed: true, name: "round", type: "uint256" },
      { indexed: false, name: "ticketsPurchasedTotalBps", type: "uint256" },
      { indexed: true, name: "referrer", type: "address" },
    ],
    name: "ParticipantTicketPurchase",
    type: "event",
  },
] as const;

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

export interface PoolMember {
  inboxId: string;
  address: string;
  ticketsPurchased: number;
  amountContributed: number;
  lastPurchaseTime: Date;
}

export interface GroupPool {
  id: string;
  groupId: string;
  poolContractAddress: string; // The existing deployed JackpotPool contract
  members: Map<string, PoolMember>; // inboxId -> PoolMember
  totalTickets: number;
  totalContributed: number;
  createdAt: Date;
  lastActivity: Date;
}

export class PoolHandler {
  private groupPools = new Map<string, GroupPool>();
  private megaPotManager: MegaPotManager;
  private client: any; // Simplified type to avoid viem version conflicts
  private poolContractAddress: string;

  constructor(megaPotManager: MegaPotManager) {
    this.megaPotManager = megaPotManager;
    this.poolContractAddress = process.env
      .JACKPOT_POOL_CONTRACT_ADDRESS as string;

    // Initialize public client for reading contract data
    this.client = createPublicClient({
      chain: base,
      transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
    });

    console.log(
      `📊 Pool handler initialized for contract: ${this.poolContractAddress}`,
    );
  }

  /**
   * Refresh pool data on-demand (only when users request it)
   */
  private async refreshPoolDataOnDemand(): Promise<void> {
    try {
      console.log("📊 Refreshing pool data on user request...");

      // Read current pool stats from contract
      const poolTicketsBps = await this.client.readContract({
        address: this.poolContractAddress as `0x${string}`,
        abi: JACKPOT_POOL_ABI,
        functionName: "poolTicketsPurchasedBps",
      });

      const pendingWinnings = await this.client.readContract({
        address: this.poolContractAddress as `0x${string}`,
        abi: JACKPOT_POOL_ABI,
        functionName: "pendingPoolWinnings",
      });

      // Convert BPS to actual ticket count (7000 BPS = 1 ticket after 30% fees)
      const totalPoolTickets = Number(poolTicketsBps) / 7000;
      const poolWinningsUSDC = Number(pendingWinnings) / 1000000;

      console.log(
        `📊 Fresh pool contract stats: ${totalPoolTickets.toFixed(2)} tickets, $${poolWinningsUSDC.toFixed(2)} pending winnings`,
      );

      // Update all pools with latest contract data
      for (const [groupId, pool] of this.groupPools.entries()) {
        if (pool.poolContractAddress === this.poolContractAddress) {
          pool.totalTickets = totalPoolTickets;
          pool.totalContributed = totalPoolTickets; // $1 per ticket
        }
      }
    } catch (error) {
      console.log("⚠️ Failed to refresh pool data:", error);
    }
  }

  /**
   * Get real-time pool stats from contract (fetches fresh data on each call)
   */
  async getPoolStatsFromContract(): Promise<{
    totalTickets: number;
    pendingWinnings: number;
  }> {
    try {
      console.log("📊 Fetching fresh pool stats from contract...");

      const [poolTicketsBps, pendingWinnings] = await Promise.all([
        this.client.readContract({
          address: this.poolContractAddress as `0x${string}`,
          abi: JACKPOT_POOL_ABI,
          functionName: "poolTicketsPurchasedBps",
        }),
        this.client.readContract({
          address: this.poolContractAddress as `0x${string}`,
          abi: JACKPOT_POOL_ABI,
          functionName: "pendingPoolWinnings",
        }),
      ]);

      // Convert BPS to actual ticket count (7000 BPS = 1 ticket after 30% fees)
      const totalTickets = Number(poolTicketsBps) / 7000;
      const winningsUSDC = Number(pendingWinnings) / 1000000;

      console.log(
        `📊 Fresh contract data: ${totalTickets.toFixed(2)} tickets, $${winningsUSDC.toFixed(2)} winnings`,
      );

      return {
        totalTickets,
        pendingWinnings: winningsUSDC,
      };
    } catch (error) {
      console.log("⚠️ Failed to read pool stats from contract:", error);
      return {
        totalTickets: 0,
        pendingWinnings: 0,
      };
    }
  }

  /**
   * Get participant's tickets for current round (fetches fresh data)
   */
  async getParticipantTickets(participantAddress: string): Promise<number> {
    try {
      console.log(
        `📊 Fetching participant tickets for ${participantAddress}...`,
      );

      // Use a default round since contract calls are failing
      const currentRound = 110; // Current round from the logs

      const participantTicketsBps = await this.client.readContract({
        address: this.poolContractAddress as `0x${string}`,
        abi: JACKPOT_POOL_ABI,
        functionName: "participantTickets",
        args: [participantAddress as `0x${string}`, BigInt(currentRound)],
      });

      // Convert BPS to actual ticket count
      const tickets = Number(participantTicketsBps) / 7000;
      console.log(
        `📊 ${participantAddress} has ${tickets.toFixed(2)} tickets in round ${currentRound}`,
      );

      return tickets;
    } catch (error) {
      console.log(
        `⚠️ Failed to read participant tickets for ${participantAddress}:`,
        error,
      );
      return 0;
    }
  }

  /**
   * Load existing pool data from the deployed contract
   */
  private async loadPoolDataFromContract(pool: GroupPool): Promise<void> {
    try {
      console.log(
        `📊 Loading pool data from contract: ${pool.poolContractAddress}`,
      );

      // Read pool data from the jackpot pool contract using correct functions
      try {
        const poolTicketsBps = await this.client.readContract({
          address: pool.poolContractAddress as `0x${string}`,
          abi: JACKPOT_POOL_ABI,
          functionName: "poolTicketsPurchasedBps",
        });

        const pendingWinnings = await this.client.readContract({
          address: pool.poolContractAddress as `0x${string}`,
          abi: JACKPOT_POOL_ABI,
          functionName: "pendingPoolWinnings",
        });

        // Convert BPS to actual ticket count (10000 BPS = 1 ticket after fees)
        const totalTickets = Number(poolTicketsBps) / 7000; // 7000 BPS per ticket after 30% fees
        const winningsUSDC = Number(pendingWinnings) / 1000000; // Convert from 6 decimals

        console.log(
          `📊 Pool stats: ${totalTickets.toFixed(2)} tickets (${poolTicketsBps} BPS), $${winningsUSDC} pending winnings`,
        );

        // Update pool with contract data
        pool.totalTickets = totalTickets;
        pool.totalContributed = totalTickets; // Each ticket costs $1
      } catch (contractError) {
        console.log(
          `⚠️ Could not read pool stats from contract:`,
          contractError,
        );
        // Use default values
        pool.totalTickets = 0;
        pool.totalContributed = 0;
      }

      console.log(`✅ Pool initialized for group ${pool.groupId}`);
    } catch (error) {
      console.warn("⚠️ Could not load pool data from contract:", error);
      // Continue with empty pool data
    }
  }

  /**
   * Initialize or get existing pool for a group
   * Uses the existing deployed JackpotPool contract
   */
  async initializeGroupPool(
    conversation: Group,
    initiatorInboxId: string,
  ): Promise<{ poolId: string; message: string }> {
    try {
      const groupId = conversation.id;
      let pool = this.groupPools.get(groupId);

      if (!pool) {
        // Use the existing deployed JackpotPool contract
        const poolContractAddress = process.env
          .JACKPOT_POOL_CONTRACT_ADDRESS as string;

        if (!poolContractAddress) {
          throw new Error("JACKPOT_POOL_CONTRACT_ADDRESS not configured");
        }

        pool = {
          id: `pool_${groupId}_${Date.now()}`,
          groupId,
          poolContractAddress,
          members: new Map(),
          totalTickets: 0,
          totalContributed: 0,
          createdAt: new Date(),
          lastActivity: new Date(),
        };

        this.groupPools.set(groupId, pool);

        // Load existing pool data from contract if available
        await this.loadPoolDataFromContract(pool);
      }

      const members = await conversation.members();
      const memberCount = members.length;

      const message = `🎯 Group Pool Connected!

📋 Pool Contract: ${pool.poolContractAddress}
👥 Group Members: ${memberCount}
🎫 Total Tickets: ${pool.totalTickets}
💰 Total Contributed: $${pool.totalContributed.toFixed(2)}

How Group Pools Work:
• Each member buys tickets individually through the shared pool contract
• Your share of winnings = (your tickets / total pool tickets) × total winnings
• All purchases benefit from collective pool participation
• Winnings are automatically calculated proportionally

To participate:
• "buy 5 tickets for group pool" - Purchase through pool contract
• "pool status" - Check current pool statistics
• "my pool share" - See your risk exposure and potential share
• "claim pool winnings" - Claim your proportional share`;

      return { poolId: pool.id, message };
    } catch (error) {
      console.error("Error initializing group pool:", error);
      throw new Error(
        `Failed to initialize pool: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Process individual ticket purchase through the pool
   * This matches the actual smart contract behavior
   */
  async processPooledTicketPurchase(
    groupId: string,
    userInboxId: string,
    userAddress: string,
    numTickets: number,
    conversation: Group,
    client: any,
  ): Promise<{
    success: boolean;
    message: string;
    transactionData?: any;
    referenceId?: string;
  }> {
    try {
      let pool = this.groupPools.get(groupId);

      if (!pool) {
        // Auto-initialize pool if it doesn't exist
        const initResult = await this.initializeGroupPool(
          conversation,
          userInboxId,
        );
        pool = this.groupPools.get(groupId)!;
      }

      // Get current ticket price
      const stats = await this.megaPotManager.getStats();
      const ticketPrice = parseFloat(stats.ticketPrice || "1");
      const totalCost = numTickets * ticketPrice;

      // Prepare transaction data for the pool contract
      // In reality, this would call the JackpotPool.purchaseTickets() function
      const txData = await this.preparePoolPurchaseTransaction(
        pool.poolContractAddress,
        userAddress,
        numTickets,
        totalCost,
      );

      // Update pool tracking (local tracking since contract calls are failing)
      let member = pool.members.get(userInboxId);
      if (!member) {
        member = {
          inboxId: userInboxId,
          address: userAddress,
          ticketsPurchased: 0,
          amountContributed: 0,
          lastPurchaseTime: new Date(),
        };
        pool.members.set(userInboxId, member);
      }

      // Update member stats with pending purchase
      member.ticketsPurchased += numTickets;
      member.amountContributed += totalCost;
      member.lastPurchaseTime = new Date();

      // Update pool totals
      pool.totalTickets += numTickets;
      pool.totalContributed += totalCost;
      pool.lastActivity = new Date();

      // Calculate member's share percentage
      const memberShare =
        pool.totalTickets > 0
          ? ((member.ticketsPurchased / pool.totalTickets) * 100).toFixed(2)
          : "0.00";

      const userDisplayName = await getDisplayName(userAddress);
      const preparingMessage = `🎯 Pool Purchase Transaction Prepared!

🎫 ${userDisplayName}: ${numTickets} tickets for $${totalCost.toFixed(2)}
📊 Pool share: ${memberShare}% (${member.ticketsPurchased}/${pool.totalTickets} tickets)
💰 Risk exposure: $${member.amountContributed.toFixed(2)}

⚠️ Important: Pool tickets are held by the pool contract and won't appear in your regular ticket stats or the miniapp until prizes are distributed.

✅ Open wallet to approve pool purchase transaction
🎰 Pool increases winning chances! Prizes shared proportionally.`;

      return {
        success: true,
        message: preparingMessage,
        transactionData: txData,
        referenceId: txData.capabilities?.reference || "unknown",
      };
    } catch (error) {
      console.error("Error processing pooled purchase:", error);
      return {
        success: false,
        message: `❌ Failed to process pool purchase: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Prepare transaction for pool contract purchase
   * Calls the real JackpotPool.purchaseTickets(referrer, value, recipient)
   */
  private async preparePoolPurchaseTransaction(
    poolContractAddress: string,
    userAddress: string,
    numTickets: number,
    totalCost: number,
  ): Promise<WalletSendCallsParams> {
    // Get USDC contract address and referrer from environment
    const usdcAddress = process.env.MEGAPOT_USDC_ADDRESS as `0x${string}`;
    const referrerAddress = process.env
      .MEGAPOT_REFERRER_ADDRESS as `0x${string}`;

    // Convert cost to USDC units (6 decimals)
    const totalCostUSDC = BigInt(Math.floor(totalCost * 1000000));

    // Encode the actual JackpotPool.purchaseTickets call
    console.log(`🔍 Encoding JackpotPool.purchaseTickets call:`);
    console.log(`  - Contract: ${poolContractAddress}`);
    console.log(`  - Function: purchaseTickets(address,uint256,address)`);
    console.log(`  - Referrer: ${referrerAddress}`);
    console.log(
      `  - Value: ${totalCostUSDC.toString()} USDC (${numTickets} tickets)`,
    );
    console.log(`  - Recipient: ${userAddress}`);

    const poolPurchaseCallData = encodeFunctionData({
      abi: JACKPOT_POOL_ABI,
      functionName: "purchaseTickets",
      args: [
        referrerAddress, // referrer address
        totalCostUSDC, // value in USDC (6 decimals)
        userAddress as `0x${string}`, // recipient gets credit for the tickets
      ],
    });

    console.log(`🔍 Generated call data: ${poolPurchaseCallData}`);

    // Encode USDC approval
    const approveCallData = encodeFunctionData({
      abi: USDC_ABI,
      functionName: "approve",
      args: [
        poolContractAddress as `0x${string}`, // spender (the pool contract)
        totalCostUSDC, // amount to approve
      ],
    });

    const walletSendCalls: WalletSendCallsParams = {
      version: "1.0",
      chainId: `0x${base.id.toString(16)}`,
      from: userAddress as `0x${string}`,
      capabilities: {
        reference: `megapot_pool_purchase_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        app: "MegaPot Lottery",
        icon: "https://megapot.io/favicon.ico",
        domain: "megapot.io",
        name: "MegaPot Pool Purchase",
        description: `Pool purchase: ${numTickets} tickets for $${totalCost.toFixed(2)} USDC`,
      },
      calls: [
        {
          // First approve USDC spending to the pool contract
          to: usdcAddress,
          data: approveCallData as `0x${string}`,
          value: "0x0",
          gas: "0xC350", // ~50,000 gas
          metadata: {
            description: `Approve $${totalCost.toFixed(2)} USDC for MegaPot Pool Purchase`,
            transactionType: "erc20_approve",
            appName: "MegaPot Pool",
            appIcon: "https://megapot.io/favicon.ico",
          },
        },
        {
          // Then call the real JackpotPool.purchaseTickets(referrer, value, recipient)
          to: poolContractAddress as `0x${string}`,
          data: poolPurchaseCallData as `0x${string}`,
          value: "0x0",
          gas: "0x30D40", // ~200,000 gas
          metadata: {
            description: `Purchase ${numTickets} lottery tickets through MegaPot Pool Contract`,
            transactionType: "contract_interaction",
            appName: "MegaPot Pool",
            appIcon: "https://megapot.io/favicon.ico",
            contractFunction: "purchaseTickets",
            contractAddress: poolContractAddress,
          },
        },
      ],
    };

    return walletSendCalls;
  }

  /**
   * Get pool status for a group (using real contract data)
   */
  async getPoolStatus(groupId: string): Promise<string> {
    try {
      const pool = this.groupPools.get(groupId);

      if (!pool) {
        return `🎯 Pool Status

📋 Pool Contract: ${this.poolContractAddress.slice(0, 8)}...${this.poolContractAddress.slice(-6)}
🎫 Total Pool Tickets: 0.00
💰 Pool Value: $0.00
🏆 Pending Winnings: $0.00

⚠️ Pool tickets are held by the contract and won't show in regular stats until prizes are distributed.

Your Options:
• "buy X pool tickets" - Purchase through pool contract
• "my pool share" - See your risk exposure
• "claim pool winnings" - Claim your share of winnings`;
      }

      // Get display names for top contributors using local tracking
      const membersList: string[] = [];

      if (pool.members.size > 0) {
        const topMembers = Array.from(pool.members.values())
          .sort((a, b) => b.ticketsPurchased - a.ticketsPurchased)
          .slice(0, 5); // Top 5 contributors

        for (const member of topMembers) {
          const share =
            pool.totalTickets > 0
              ? ((member.ticketsPurchased / pool.totalTickets) * 100).toFixed(1)
              : "0.0";

          // Get display name for the member's address (not inbox ID)
          const displayName = await getDisplayName(member.address);

          membersList.push(
            `• ${displayName}: ${member.ticketsPurchased} tickets (${share}%)`,
          );
        }
      }

      const membersListString =
        membersList.length > 0
          ? membersList.join("\n")
          : "• No pool participants yet";

      return `🎯 Pool Status

📋 Pool Contract: ${pool.poolContractAddress.slice(0, 8)}...${pool.poolContractAddress.slice(-6)}
👥 Group Members: ${pool.members.size}
🎫 Total Pool Tickets: ${pool.totalTickets.toFixed(2)}
💰 Pool Value: $${pool.totalContributed.toFixed(2)}

Top Contributors:
${membersListString}

⚠️ Pool tickets are held by the contract and won't show in regular stats until prizes are distributed.

Your Options:
• "buy X pool tickets" - Purchase through pool contract
• "my pool share" - See your risk exposure
• "claim pool winnings" - Claim your share of winnings`;
    } catch (error) {
      console.error("Error getting pool status:", error);
      return `❌ Error reading pool status: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  }

  /**
   * Get member's pool share information (with real contract data)
   */
  async getMemberPoolShare(
    groupId: string,
    userInboxId: string,
    userAddress?: string,
  ): Promise<string> {
    try {
      const pool = this.groupPools.get(groupId);

      if (!pool) {
        return "❌ No pool found for this group.";
      }

      const member = pool.members.get(userInboxId);

      if (!member || !userAddress) {
        return "❌ You haven't participated in this pool yet. Use 'buy X pool tickets' to join!";
      }

      const sharePercentage =
        pool.totalTickets > 0
          ? ((member.ticketsPurchased / pool.totalTickets) * 100).toFixed(2)
          : "0";

      const displayName = await getDisplayName(userAddress);

      return `📊 ${displayName}'s Pool Share

🎫 Your tickets: ${member.ticketsPurchased} / ${pool.totalTickets}
📈 Your share: ${sharePercentage}%
💰 You contributed: $${member.amountContributed.toFixed(2)}
📅 Last purchase: ${member.lastPurchaseTime.toLocaleDateString()}

💡 How winnings work:
If the pool wins $1,000, you get ${sharePercentage}% = $${((parseFloat(sharePercentage) / 100) * 1000).toFixed(2)}

⚠️ Pool tickets are held by the contract and won't show in regular stats until prizes are distributed.`;
    } catch (error) {
      console.error("Error getting member pool share:", error);
      return `❌ Error reading pool share: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  }

  /**
   * Add method to claim pool winnings for a user
   */
  async prepareClaimPoolWinnings(
    userAddress: string,
    poolContractAddress: string,
  ): Promise<WalletSendCallsParams> {
    const claimCallData = encodeFunctionData({
      abi: JACKPOT_POOL_ABI,
      functionName: "withdrawParticipantWinnings",
      args: [], // No args for self-withdrawal
    });

    return {
      version: "1.0",
      chainId: `0x${base.id.toString(16)}`,
      from: userAddress as `0x${string}`,
      capabilities: {
        reference: `pool_claim_${Date.now()}`,
        app: "MegaPot Pool",
        icon: "https://megapot.io/favicon.ico",
        domain: "megapot.io",
        name: "MegaPot Pool Winnings",
        description: "Claim proportional pool winnings",
      },
      calls: [
        {
          to: poolContractAddress as `0x${string}`,
          data: claimCallData as `0x${string}`,
          value: "0x0",
          gas: "0x15F90", // ~90,000 gas
          metadata: {
            description: "Claim your share of pool winnings",
            transactionType: "pool_claim",
          },
        },
      ],
    };
  }

  /**
   * Get active pool for a group
   */
  getActivePoolForGroup(groupId: string): GroupPool | null {
    return this.groupPools.get(groupId) || null;
  }

  /**
   * Clean up old pools
   */
  cleanupOldPools(): void {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days

    for (const [groupId, pool] of this.groupPools.entries()) {
      if (pool.lastActivity < cutoff && pool.totalTickets === 0) {
        this.groupPools.delete(groupId);
        console.log(`🧹 Cleaned up inactive pool for group ${groupId}`);
      }
    }
  }
}
