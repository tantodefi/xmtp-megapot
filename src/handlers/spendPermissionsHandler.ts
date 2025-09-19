import { ContentTypeWalletSendCalls } from "@xmtp/content-type-wallet-send-calls";
import type { Conversation } from "@xmtp/node-sdk";

export interface SpendPermission {
  account: string;
  spender: string;
  token: string;
  chainId: number;
  allowance: bigint;
  periodInDays: number;
  signature?: string;
  extraData?: string;
}

export interface SpendConfig {
  dailyLimit: number; // USD amount
  ticketsPerDay: number;
  purchaseType: "solo" | "pool" | "both" | "alternating";
  duration: number; // days
  soloTicketsPerDay?: number; // For both (combined) purchases
  poolTicketsPerDay?: number; // For both (combined) purchases
}

export const USDC_BASE_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export class SpendPermissionsHandler {
  private userPermissions = new Map<string, SpendPermission[]>();
  private userConfigs = new Map<string, SpendConfig>();
  private automatedBuying = new Map<string, NodeJS.Timeout>();

  constructor(private spenderAddress: string) {}

  /**
   * Execute spend calls via Base Account spend permissions
   */
  private async executeSpendCalls(
    existingTransaction: any,
    conversation: Conversation,
    userAddress: string,
    purchaseType: string,
    ticketCount: number,
  ): Promise<boolean> {
    try {
      // Use the existing transaction format from MegaPot/Pool handlers
      // but update the metadata to indicate it's automated
      // Build paymaster capabilities based on TBA chat example format
      const paymasterCapabilities = process.env.PAYMASTER_URL
        ? {
            paymasterService: {
              url: process.env.PAYMASTER_URL,
              optional: true, // Graceful fallback if paymaster fails
            },
          }
        : undefined;

      const automatedTransaction = {
        ...existingTransaction,
        capabilities: {
          ...existingTransaction.capabilities,
          reference: `megapot_automated_${purchaseType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          app: "MegaPot Automated Purchase",
          name: `🤖 Automated ${purchaseType.charAt(0).toUpperCase() + purchaseType.slice(1)} Purchase`,
          description: `Automated purchase: ${ticketCount} ${purchaseType} tickets via spend permission`,
          // Add paymaster service for gas sponsorship (TBA chat example format)
          ...paymasterCapabilities,
        },
      };

      // Update individual call metadata to indicate automation
      if (automatedTransaction.calls) {
        automatedTransaction.calls = automatedTransaction.calls.map(
          (call: any, index: number) => ({
            ...call,
            // Remove gas field for paymaster-sponsored transactions
            gas: undefined,
            metadata: {
              ...call.metadata,
              automatedPurchase: true,
              spendPermissionUser: userAddress,
              purchaseType: purchaseType,
              ticketCount: ticketCount,
              gasSponsored: process.env.PAYMASTER_URL ? true : false,
              paymasterUrl: process.env.PAYMASTER_URL,
              description: call.metadata?.description
                ? `🤖 Gas-Free Automated: ${call.metadata.description}`
                : `🤖 Gas-Free Automated ${purchaseType} purchase step ${index + 1}`,
            },
          }),
        );
      }

      const gasMessage = process.env.PAYMASTER_URL
        ? "⛽ Gas-free transaction (sponsored)"
        : "⚠️ Gas fees apply (no paymaster configured)";

      await conversation.send(
        `🤖 Automated ${purchaseType} purchase transaction ready:\n\n💰 ${ticketCount} ${purchaseType} tickets for $${ticketCount}\n🔐 Executed via spend permission\n${gasMessage}\n\n✅ Open your wallet to approve this automated transaction.`,
      );
      await conversation.send(automatedTransaction, ContentTypeWalletSendCalls);

      console.log(
        `📡 Gas-sponsored automated transaction sent for ${userAddress}: ${ticketCount} ${purchaseType} tickets`,
      );
      return true;
    } catch (error) {
      console.error("Failed to execute automated spend calls:", error);
      return false;
    }
  }

  /**
   * Request spend permission from user for MegaPot purchases
   * This is a demo implementation showing the concept
   */
  async requestMegaPotSpendPermission(
    userAddress: string,
    config: SpendConfig,
  ): Promise<SpendPermission> {
    try {
      // Convert USD to USDC (6 decimals)
      const allowanceUSDC = BigInt(config.dailyLimit * 1_000_000);

      // Demo implementation - in real implementation this would use Base Account SDK
      const spendPermission: SpendPermission = {
        account: userAddress,
        spender: this.spenderAddress,
        token: USDC_BASE_ADDRESS,
        chainId: 8453,
        allowance: allowanceUSDC,
        periodInDays: 1,
        signature: `demo_signature_${Date.now()}`,
        extraData: JSON.stringify(config),
      };

      // Store permission and config
      const userPermissions = this.userPermissions.get(userAddress) || [];
      userPermissions.push(spendPermission);
      this.userPermissions.set(userAddress, userPermissions);
      this.userConfigs.set(userAddress, config);

      // Prepare the spend permission transaction
      const spendTx = {
        version: "1.0",
        chainId: "0x2105", // Base mainnet
        from: userAddress as `0x${string}`,
        capabilities: {
          reference: `megapot_spend_permission_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          app: "MegaPot",
          icon: "https://megapot.io/favicon.ico",
          domain: "megapot.io",
          name: "MegaPot Lottery",
          description: "MegaPot Lottery Assistant",
          hostname: "megapot.io",
          faviconUrl: "https://megapot.io/favicon.ico",
          title: "MegaPot Lottery",
        },
        calls: [
          {
            to: USDC_BASE_ADDRESS as `0x${string}`,
            data: "0x095ea7b3000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
            value: "0x0",
            gas: "0xC350",
            metadata: {
              description: `Approve USDC spending for $${config.dailyLimit}/day`,
              transactionType: "erc20_approve",
              source: "MegaPot",
              origin: "megapot.io",
              hostname: "megapot.io",
              faviconUrl: "https://megapot.io/favicon.ico",
              title: "MegaPot Lottery",
            },
          },
          {
            to: this.spenderAddress as `0x${string}`,
            data: "0x0000000000000000000000000000000000000000000000000000000000000000",
            value: "0x0",
            gas: "0x30D40",
            metadata: {
              description: `Set spend permission for $${config.dailyLimit}/day for ${config.duration} days`,
              transactionType: "spend_permission",
              appName: "MegaPot",
              appIcon: "https://megapot.io/favicon.ico",
              appDomain: "megapot.io",
              hostname: "megapot.io",
              faviconUrl: "https://megapot.io/favicon.ico",
              title: "MegaPot Lottery",
            },
          },
        ],
      };

      console.log(
        `✅ Spend permission created for ${userAddress}: $${config.dailyLimit}/day`,
      );
      return spendPermission;
    } catch (error) {
      console.error("Failed to create spend permission:", error);
      throw new Error("Failed to create spend permission");
    }
  }

  /**
   * Get active spend permissions for a user
   */
  async getUserSpendPermissions(
    userAddress: string,
  ): Promise<SpendPermission[]> {
    try {
      // Demo implementation - return stored permissions
      return this.userPermissions.get(userAddress) || [];
    } catch (error) {
      console.error("Failed to fetch spend permissions:", error);
      return [];
    }
  }

  /**
   * Check if user has active spend permission with remaining allowance
   */
  async hasActiveSpendPermission(
    userAddress: string,
    requiredAmount: number,
  ): Promise<{
    hasPermission: boolean;
    permission?: SpendPermission;
    remainingSpend?: number;
  }> {
    try {
      const permissions = await this.getUserSpendPermissions(userAddress);

      for (const permission of permissions) {
        // Demo implementation - assume permission is active with full allowance
        const remainingUSD = Number(permission.allowance) / 1_000_000; // Convert from USDC to USD

        if (remainingUSD >= requiredAmount) {
          return {
            hasPermission: true,
            permission,
            remainingSpend: remainingUSD,
          };
        }
      }

      return { hasPermission: false };
    } catch (error) {
      console.error("Failed to check spend permission status:", error);
      return { hasPermission: false };
    }
  }

  /**
   * Prepare spend calls for MegaPot ticket purchase
   */
  async prepareMegaPotSpendCalls(
    permission: SpendPermission,
    ticketCount: number,
    purchaseType: "solo" | "pool",
    ticketPrice: number = 1,
  ) {
    try {
      const totalAmount = ticketCount * ticketPrice;

      // Demo implementation - return mock spend calls
      const spendCalls = [
        {
          to: USDC_BASE_ADDRESS,
          data: "0x095ea7b3000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        },
        {
          to:
            purchaseType === "solo"
              ? "0xMegaPotContract"
              : "0xJackpotPoolContract",
          data: "0x0000000000000000000000000000000000000000000000000000000000000000",
        },
      ];

      return {
        spendCalls,
        totalAmount,
        ticketCount,
        purchaseType,
      };
    } catch (error) {
      console.error("Failed to prepare spend calls:", error);
      throw new Error("Failed to prepare spend calls");
    }
  }

  /**
   * Start automated ticket buying for a user
   */
  async startAutomatedBuying(
    userAddress: string,
    conversation: Conversation,
    megaPotManager?: any,
    poolHandler?: any,
    agent?: any,
  ): Promise<boolean> {
    const config = this.userConfigs.get(userAddress);
    if (!config) {
      await conversation.send(
        "❌ No spend configuration found. Please set up spend permissions first.",
      );
      return false;
    }

    // Stop existing automation if any
    this.stopAutomatedBuying(userAddress);

    const intervalMs = 24 * 60 * 60 * 1000; // 24 hours

    const automatedPurchase = async () => {
      try {
        const { hasPermission, permission, remainingSpend } =
          await this.hasActiveSpendPermission(
            userAddress,
            config.ticketsPerDay,
          );

        if (!hasPermission || !permission || !remainingSpend) {
          await conversation.send(
            `⚠️ Automated buying paused - insufficient spend permission. Remaining: $${remainingSpend || 0}`,
          );
          return;
        }

        // Handle different purchase types
        if (config.purchaseType === "both") {
          // Buy both solo AND pool tickets (2 separate transactions)
          const soloTickets = config.soloTicketsPerDay || 0;
          const poolTickets = config.poolTicketsPerDay || 0;

          if (soloTickets > 0 && megaPotManager && agent) {
            await conversation.send(
              `🤖 Automated Purchase (Solo): Buying ${soloTickets} solo tickets for $${soloTickets}`,
            );

            try {
              // Execute real solo purchase through MegaPotManager
              const soloTx = await megaPotManager.preparePurchaseTransaction(
                userAddress,
                soloTickets,
                conversation,
                agent.client,
              );

              // Execute via spend permission with real transaction
              await this.executeSpendCalls(
                soloTx,
                conversation,
                userAddress,
                "solo",
                soloTickets,
              );

              console.log(
                `🎫 Solo purchase executed: ${soloTickets} tickets for ${userAddress}`,
              );
            } catch (error) {
              console.error("Solo purchase failed:", error);
              await conversation.send(
                `❌ Solo purchase failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              );
            }
          }

          if (poolTickets > 0 && poolHandler) {
            await conversation.send(
              `🤖 Automated Purchase (Pool): Buying ${poolTickets} pool tickets for $${poolTickets}`,
            );

            try {
              // Execute real pool purchase through PoolHandler
              const poolResult = await poolHandler.processPooledTicketPurchase(
                userAddress,
                poolTickets,
                conversation,
              );

              // Execute via spend permission with real transaction
              if (poolResult.transaction) {
                await this.executeSpendCalls(
                  poolResult.transaction,
                  conversation,
                  userAddress,
                  "pool",
                  poolTickets,
                );
              }

              console.log(
                `🏊 Pool purchase executed: ${poolTickets} tickets for ${userAddress}`,
              );
            } catch (error) {
              console.error("Pool purchase failed:", error);
              await conversation.send(
                `❌ Pool purchase failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              );
            }
          }
        } else {
          // Single purchase type (solo, pool, or alternating)
          let purchaseType: "solo" | "pool";
          if (config.purchaseType === "alternating") {
            // Alternate between solo and pool
            const dayOfYear = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
            purchaseType = dayOfYear % 2 === 0 ? "solo" : "pool";
          } else {
            purchaseType = config.purchaseType as "solo" | "pool";
          }

          const spendData = await this.prepareMegaPotSpendCalls(
            permission,
            config.ticketsPerDay,
            purchaseType,
          );

          await conversation.send(
            `🤖 Automated Purchase: Buying ${config.ticketsPerDay} ${purchaseType} tickets for $${spendData.totalAmount}`,
          );

          try {
            // Execute the actual purchase through MegaPot contracts
            if (purchaseType === "solo" && megaPotManager && agent) {
              const soloTx = await megaPotManager.preparePurchaseTransaction(
                userAddress,
                config.ticketsPerDay,
                conversation,
                agent.client,
              );

              // Execute via spend permission with real transaction
              await this.executeSpendCalls(
                soloTx,
                conversation,
                userAddress,
                "solo",
                config.ticketsPerDay,
              );
            } else if (purchaseType === "pool" && poolHandler) {
              const poolResult = await poolHandler.processPooledTicketPurchase(
                userAddress,
                config.ticketsPerDay,
                conversation,
              );

              // Execute via spend permission with real transaction
              if (poolResult.transaction) {
                await this.executeSpendCalls(
                  poolResult.transaction,
                  conversation,
                  userAddress,
                  "pool",
                  config.ticketsPerDay,
                );
              }
            }

            console.log(
              `🤖 Automated purchase executed for ${userAddress}: ${config.ticketsPerDay} ${purchaseType} tickets`,
            );
          } catch (error) {
            console.error("Automated purchase failed:", error);
            await conversation.send(
              `❌ Purchase failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          }
        }
      } catch (error) {
        console.error("Automated purchase failed:", error);
        await conversation.send(
          `❌ Automated purchase failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    };

    // Execute first purchase immediately, then set interval
    await automatedPurchase();
    const interval = setInterval(automatedPurchase, intervalMs);
    this.automatedBuying.set(userAddress, interval);

    await conversation.send(
      `🤖 Automated buying started! I'll buy ${config.ticketsPerDay} ${config.purchaseType} tickets daily for ${config.duration} days.\n\n⚙️ Settings:\n• Daily limit: $${config.dailyLimit}\n• Purchase type: ${config.purchaseType}\n• Duration: ${config.duration} days\n\nSay "stop automation" to pause anytime.`,
    );

    return true;
  }

  /**
   * Stop automated buying for a user
   */
  stopAutomatedBuying(userAddress: string): void {
    const interval = this.automatedBuying.get(userAddress);
    if (interval) {
      clearInterval(interval);
      this.automatedBuying.delete(userAddress);
      console.log(`🛑 Automated buying stopped for ${userAddress}`);
    }
  }

  /**
   * Get spend permission status for user
   */
  async getSpendPermissionStatus(userAddress: string): Promise<string> {
    try {
      const permissions = await this.getUserSpendPermissions(userAddress);
      const config = this.userConfigs.get(userAddress);
      const isAutomated = this.automatedBuying.has(userAddress);

      if (permissions.length === 0) {
        return `📋 Spend Permissions Status

❌ No active spend permissions found.

💡 Set up spend permissions to enable:
• Automated daily ticket purchases
• Instant transactions without wallet popups
• Flexible spending limits

Use "setup spend permission" to get started!`;
      }

      let statusMessage = `📋 Spend Permissions Status\n\n`;

      for (const permission of permissions) {
        try {
          const dailyLimit = Number(permission.allowance) / 1_000_000;
          // Demo implementation - assume full allowance remaining
          const remainingSpend = dailyLimit;

          statusMessage += `✅ Active Permission:
• Daily limit: $${dailyLimit.toFixed(2)} USDC
• Remaining today: $${remainingSpend.toFixed(2)} USDC
• Status: Active (Demo)

`;
        } catch (statusError) {
          statusMessage += `⚠️ Permission Status Check Failed\n\n`;
        }
      }

      if (config) {
        statusMessage += `⚙️ Configuration:
• Tickets per day: ${config.ticketsPerDay}
• Purchase type: ${config.purchaseType}
• Duration: ${config.duration} days

`;
      }

      if (isAutomated) {
        statusMessage += `🤖 Automated Buying: ACTIVE
• Next purchase: Within 24 hours
• Say "stop automation" to pause

`;
      } else {
        statusMessage += `⏸️ Automated Buying: PAUSED
• Say "start automation" to begin

`;
      }

      statusMessage += `🛠️ Commands:
• "setup spend permission" - Create new permission
• "start automation" - Begin automated purchases
• "stop automation" - Pause automated purchases
• "revoke permissions" - Remove all permissions`;

      return statusMessage;
    } catch (error) {
      console.error("Failed to get spend permission status:", error);
      return `❌ Failed to check spend permission status: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  }

  /**
   * Revoke all spend permissions for a user
   */
  async revokeAllPermissions(userAddress: string): Promise<boolean> {
    try {
      // Demo implementation - just clear stored data
      this.stopAutomatedBuying(userAddress);
      this.userPermissions.delete(userAddress);
      this.userConfigs.delete(userAddress);

      console.log(`✅ All spend permissions revoked for ${userAddress}`);
      return true;
    } catch (error) {
      console.error("Failed to revoke spend permissions:", error);
      return false;
    }
  }
}
