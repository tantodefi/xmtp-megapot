import { Agent, f, withFilter } from "@xmtp/agent-sdk";
import {
  ContentTypeReaction,
  ReactionCodec,
} from "@xmtp/content-type-reaction";
import { RemoteAttachmentCodec } from "@xmtp/content-type-remote-attachment";
import {
  ContentTypeWalletSendCalls,
  WalletSendCallsCodec,
  type WalletSendCallsParams,
} from "@xmtp/content-type-wallet-send-calls";
import { Group, Signer } from "@xmtp/node-sdk";
import { createWalletClient, http, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { MegaPotManager } from "./managers/MegaPotManager.js";
import {
  ActionsCodec,
  ContentTypeActions,
  type ActionsContent,
} from "./types/ActionsContent.js";
import {
  ContentTypeIntent,
  IntentCodec,
  type IntentContent,
} from "./types/IntentContent.js";

// Environment variables
const WALLET_KEY = process.env.WALLET_KEY as `0x${string}`;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const XMTP_ENV = process.env.XMTP_ENV || "dev";
const MEGAPOT_DATA_API_KEY = process.env.MEGAPOT_DATA_API_KEY;
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://sepolia.base.org";

// State tracking for users waiting for ticket amounts
const ticketAmountRequests = new Map<string, boolean>();

// MegaPot Contract Configuration
const MEGAPOT_CONTRACT_ADDRESS = process.env
  .MEGAPOT_CONTRACT_ADDRESS as `0x${string}`;
const MEGAPOT_USDC_ADDRESS = process.env.MEGAPOT_USDC_ADDRESS as `0x${string}`;
const MEGAPOT_REFERRER_ADDRESS = process.env
  .MEGAPOT_REFERRER_ADDRESS as `0x${string}`;

// Validate environment variables
console.log("🔍 Checking environment variables...");
console.log(
  "📝 WALLET_KEY:",
  WALLET_KEY ? `${WALLET_KEY.substring(0, 10)}...` : "NOT SET",
);
console.log("🔐 ENCRYPTION_KEY:", ENCRYPTION_KEY ? "SET" : "NOT SET");
console.log("🌍 XMTP_ENV:", XMTP_ENV);
console.log("🎰 MEGAPOT_CONTRACT:", MEGAPOT_CONTRACT_ADDRESS || "NOT SET");
console.log("💰 MEGAPOT_USDC:", MEGAPOT_USDC_ADDRESS || "NOT SET");
console.log("👥 MEGAPOT_REFERRER:", MEGAPOT_REFERRER_ADDRESS || "NOT SET");

if (!WALLET_KEY) {
  console.error("❌ WALLET_KEY environment variable is required");
  process.exit(1);
}

if (!ENCRYPTION_KEY) {
  console.error("❌ ENCRYPTION_KEY environment variable is required");
  process.exit(1);
}
if (!MEGAPOT_CONTRACT_ADDRESS) {
  console.error("❌ MEGAPOT_CONTRACT_ADDRESS environment variable is required");
  process.exit(1);
}
if (!MEGAPOT_USDC_ADDRESS) {
  console.error("❌ MEGAPOT_USDC_ADDRESS environment variable is required");
  process.exit(1);
}
if (!MEGAPOT_REFERRER_ADDRESS) {
  console.error("❌ MEGAPOT_REFERRER_ADDRESS environment variable is required");
  process.exit(1);
}

// MegaPot contract configuration using environment variables
const MEGAPOT_CONFIG = {
  contractAddress: MEGAPOT_CONTRACT_ADDRESS,
  usdcAddress: MEGAPOT_USDC_ADDRESS,
  referrerAddress: MEGAPOT_REFERRER_ADDRESS,
};

// Create a signer for XMTP
function createSigner(privateKey: `0x${string}`): Signer {
  console.log("🔧 Creating signer with private key...");

  try {
    const account = privateKeyToAccount(privateKey);
    console.log("✅ Account created:", account.address);

    const wallet = createWalletClient({
      account,
      chain: base,
      transport: http(),
    });
    console.log("✅ Wallet client created");

    const signer = {
      type: "EOA" as const,
      getIdentifier: () => ({
        identifierKind: 0, // IdentifierKind.Ethereum
        identifier: account.address.toLowerCase(),
      }),
      signMessage: async (message: string) => {
        console.log("🔏 Signing message:", message.substring(0, 50) + "...");
        const signature = await wallet.signMessage({
          message,
          account,
        });
        console.log("✅ Message signed successfully");
        return toBytes(signature);
      },
    };

    console.log("✅ Signer object created");
    return signer;
  } catch (error) {
    console.error("❌ Error creating signer:", error);
    throw error;
  }
}

async function main() {
  console.log("🎰 Starting MegaPot Agent...");

  // Initialize MegaPot manager with environment variables
  const megaPotManager = new MegaPotManager(
    BASE_RPC_URL,
    WALLET_KEY,
    MEGAPOT_CONFIG,
  );

  console.log("🎰 MegaPot Agent initialized");
  console.log(`📊 Using Mainnet Contract: ${MEGAPOT_CONTRACT_ADDRESS}`);
  console.log(`💰 Using USDC: ${MEGAPOT_USDC_ADDRESS}`);
  console.log(`🔑 Wallet: ${WALLET_KEY.substring(0, 10)}...`);

  // Create the agent with codecs
  console.log("🔧 Creating XMTP Agent...");
  console.log("🔑 Creating signer with wallet key...");
  const signer = createSigner(WALLET_KEY);
  console.log("✅ Signer created successfully");
  console.log("🔗 Signer identifier:", signer.getIdentifier());

  // Use in-memory database for testing (simpler)
  console.log("💾 Using in-memory database for testing...");

  const agent = await Agent.create(signer, {
    env: XMTP_ENV as "dev" | "production",
    dbPath: null, // Use in-memory database
    codecs: [
      new ReactionCodec(),
      new RemoteAttachmentCodec(),
      new WalletSendCallsCodec(),
      new ActionsCodec(),
      new IntentCodec(),
    ],
  });

  console.log("✅ Agent created successfully!");
  console.log(`🔗 Agent inbox: ${agent.client.inboxId}`);
  console.log("\n💬 MegaPot Agent is running!");
  console.log(
    `📝 Send messages to: http://xmtp.chat/dm/${agent.client.inboxId}`,
  );
  console.log("\n🎰 Available commands:");
  console.log("• 'ping' - Test response");
  console.log("• 'buy 5 tickets' - Purchase lottery tickets");
  console.log("• 'stats' - View your statistics");
  console.log("• 'jackpot' - View jackpot information");
  console.log("• 'claim' - Claim winnings");
  console.log("• 'help' - Show this help");
  console.log("• 'gm' or 'hello' - Welcome message");
  console.log("\n💰 The agent will react with 💰 to ALL messages!");

  // Set up message streaming properly using the client directly
  console.log("🎧 Setting up message streaming...");

  try {
    // Sync conversations first
    console.log("🔄 Syncing conversations...");
    await agent.client.conversations.sync();
    console.log("✅ Conversations synced successfully!");

    // Start the message stream
    console.log("📡 Starting message stream...");
    const stream = await agent.client.conversations.streamAllMessages();

    console.log("🎧 Message stream started successfully!");

    // Handle messages from the stream
    (async () => {
      for await (const message of stream) {
        try {
          console.log(
            `🔍 NEW MESSAGE: "${message.content || "undefined"}" from ${message.senderInboxId} (type: ${message.contentType?.typeId || "unknown"})`,
          );

          // Skip if it's from ourselves
          if (message.senderInboxId === agent.client.inboxId) {
            console.log("🚫 Skipping message from self");
            continue;
          }

          // Get the conversation for responding first
          const conversation =
            await agent.client.conversations.getConversationById(
              message.conversationId,
            );
          if (!conversation) {
            console.log("🚫 Could not find conversation for message");
            continue;
          }

          // Handle different content types
          if (message.contentType?.typeId === "text") {
            console.log("📝 Processing text message");
          } else if (message.contentType?.typeId === "intent") {
            console.log("🎯 Processing intent message");
            try {
              const intentContent = message.content as IntentContent;
              console.log(
                `🎯 Intent: ${intentContent.actionId} from actions: ${intentContent.id}`,
              );
              await handleIntentMessage(
                message,
                intentContent,
                conversation,
                megaPotManager,
                agent,
              );
              continue;
            } catch (error) {
              console.error("❌ Error processing intent:", error);
            }
          } else {
            console.log(
              `🚫 Skipping unsupported message type: ${message.contentType?.typeId}`,
            );
            continue;
          }

          if (!message.content) {
            console.log("🚫 Skipping message without content");
            continue;
          }

          const content = message.content as string;
          const lowerContent = content.toLowerCase();

          console.log(`🎯 Processing message: "${content}"`);

          // Check if this is a group chat (not a DM)
          const conversationType =
            conversation instanceof Group ? "group" : "dm";
          const isGroupChat = conversation instanceof Group;

          // In group chats, only respond to @megapot mentions
          if (isGroupChat && !lowerContent.includes("@megapot")) {
            console.log("🚫 Skipping group message without @megapot mention");
            continue;
          }

          // Send money bag reaction to ALL messages
          try {
            await conversation.send(
              {
                reference: message.id,
                action: "added",
                content: "💰",
                schema: "unicode",
              },
              ContentTypeReaction,
            );
            console.log("✅ Money bag reaction sent to message");
          } catch (reactionError) {
            console.error("Error: send reaction:", reactionError);
          }

          // Check if user is responding to ticket amount request (inline action flow)
          if (ticketAmountRequests.has(message.senderInboxId)) {
            const numTickets = parseInt(content.trim());
            ticketAmountRequests.delete(message.senderInboxId); // Clear state

            if (isNaN(numTickets) || numTickets < 1 || numTickets > 100) {
              await conversation.send(
                "Sorry, that's not a valid number. Please enter a number between 1 and 100.",
              );
              return;
            }

            // Get user's address and process purchase
            try {
              const inboxState =
                await agent.client.preferences.inboxStateFromInboxIds([
                  message.senderInboxId,
                ]);

              if (!inboxState || !inboxState[0]?.identifiers) {
                await conversation.send(
                  "Could not retrieve your wallet address. Please try again.",
                );
                return;
              }

              const userIdentifier = inboxState[0].identifiers.find(
                (id: any) => id.identifierKind === 0,
              );

              if (!userIdentifier) {
                await conversation.send(
                  "Could not find your wallet address. Please try again.",
                );
                return;
              }

              const userAddress = userIdentifier.identifier as `0x${string}`;
              await handleTicketPurchaseIntent(
                numTickets,
                userAddress,
                conversation,
                megaPotManager,
                agent,
              );
            } catch (error) {
              console.error("❌ Error processing ticket amount:", error);
              await conversation.send(
                "Error processing your request. Please try again.",
              );
            }
            return; // Exit early, don't process as regular command
          }

          // Check for direct ticket purchase commands (e.g., "buy 5 tickets", "@megapot buy 10 tickets")
          const buyTicketMatch = lowerContent.match(/buy\s+(\d+)\s+tickets?/i);
          if (buyTicketMatch) {
            const numTickets = parseInt(buyTicketMatch[1]);

            if (numTickets < 1 || numTickets > 100) {
              await conversation.send(
                "Please specify a valid number of tickets (1-100). For example: 'buy 5 tickets'",
              );
              return;
            }

            // Get user's address and process purchase directly
            try {
              const inboxState =
                await agent.client.preferences.inboxStateFromInboxIds([
                  message.senderInboxId,
                ]);

              if (!inboxState || !inboxState[0]?.identifiers) {
                await conversation.send(
                  "Could not retrieve your wallet address. Please try again.",
                );
                return;
              }

              const userIdentifier = inboxState[0].identifiers.find(
                (id: any) => id.identifierKind === 0,
              );

              if (!userIdentifier) {
                await conversation.send(
                  "Could not find your wallet address. Please try again.",
                );
                return;
              }

              const userAddress = userIdentifier.identifier as `0x${string}`;
              await handleTicketPurchaseIntent(
                numTickets,
                userAddress,
                conversation,
                megaPotManager,
                agent,
              );
            } catch (error) {
              console.error(
                "❌ Error processing direct ticket purchase:",
                error,
              );
              await conversation.send(
                "Error processing your request. Please try again.",
              );
            }
            return; // Exit early, don't process as regular command
          }

          // Handle specific commands
          try {
            if (lowerContent === "ping") {
              await handlePingRequestStream(message, conversation);
            } else if (
              lowerContent === "gm" ||
              lowerContent === "hello" ||
              lowerContent === "hi" ||
              lowerContent === "hey" ||
              lowerContent.includes("gm") ||
              lowerContent.includes("hello") ||
              lowerContent.includes("hi") ||
              lowerContent.includes("hey")
            ) {
              await handleWelcomeMessageStream(message, conversation);
              // Ticket purchase commands are now handled above with specific parsing
            } else if (
              lowerContent.includes("stats") ||
              lowerContent.includes("status") ||
              lowerContent.includes("my stats")
            ) {
              await handleStatsRequestStream(
                message,
                conversation,
                megaPotManager,
                agent,
              );
            } else if (
              lowerContent.includes("jackpot") ||
              lowerContent.includes("prize") ||
              lowerContent.includes("pot")
            ) {
              await handleJackpotInfoStream(
                message,
                conversation,
                megaPotManager,
              );
            } else if (
              lowerContent.includes("claim") ||
              lowerContent.includes("winnings") ||
              lowerContent.includes("withdraw")
            ) {
              await handleWinningsClaimStream(
                message,
                conversation,
                megaPotManager,
              );
            } else if (
              lowerContent.includes("help") ||
              lowerContent.includes("commands") ||
              lowerContent.includes("what") ||
              lowerContent === "menu" ||
              lowerContent.includes("actions")
            ) {
              await handleHelpRequestStream(message, conversation);
            } else if (
              lowerContent.includes("miniapp") ||
              lowerContent.includes("app") ||
              lowerContent.includes("web")
            ) {
              await handleMiniAppRequestStream(message, conversation);
            } else {
              console.log("📝 Message handled (no specific command matched)");
            }
          } catch (handlerError) {
            console.error("❌ Error in message handler:", handlerError);
            try {
              await conversation.send(
                `Sorry, I encountered an error: ${handlerError instanceof Error ? handlerError.message : "Unknown error"}`,
              );
            } catch (sendError) {
              console.error("Error: send error message:", sendError);
            }
          }
        } catch (error) {
          console.error("❌ Error processing message:", error);
        }
      }
    })().catch((error) => {
      console.error("❌ Message stream error:", error);
    });
  } catch (streamError) {
    console.error("Error: set up message stream:", streamError);
    throw streamError;
  }

  // Message handlers are set up via streaming approach above

  // Stop event handler removed - using streaming approach

  // Start the agent
  console.log("🚀 Starting XMTP message stream...");
  try {
    console.log("⏳ Starting agent...");
    await agent.start();
    console.log("✅ Agent started successfully! Listening for messages...");
    console.log("🎧 Message handlers are active and ready to receive messages");
    console.log("💡 Try sending 'ping' or 'gm' to test the agent");
    console.log("💰 Agent will react with 💰 to ALL messages!");

    // Keep the process alive
    console.log("🔄 Agent is now running and will stay active...");
    console.log("📡 Waiting for messages...");

    // Prevent the process from exiting with heartbeat
    setInterval(() => {
      console.log("💓 Agent heartbeat - still running and listening...");
    }, 60000); // Every minute
  } catch (error) {
    console.error("Error: start agent:", error);
    console.error(
      "❌ Error details:",
      error instanceof Error ? error.stack : String(error),
    );
    process.exit(1);
  }

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n🛑 Shutting down MegaPot Agent...");
    try {
      megaPotManager.cleanup();
      await agent.stop();
    } catch (error) {
      console.error("❌ Error during shutdown:", error);
    }
    process.exit(0);
  });

  process.on("uncaughtException", (error) => {
    console.error("❌ Uncaught exception:", error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("❌ Unhandled rejection at:", promise, "reason:", reason);
    process.exit(1);
  });
}

// Stream-based message handler functions
async function handlePingRequestStream(message: any, conversation: any) {
  try {
    console.log("🏓 Handling ping request from:", message.senderInboxId);
    await conversation.send("ok");
    console.log("✅ Ping response sent successfully");
  } catch (error) {
    console.error("❌ Error handling ping:", error);
    try {
      await conversation.send("error");
    } catch (sendError) {
      console.error("Error: send error response:", sendError);
    }
  }
}

async function handleWelcomeMessageStream(message: any, conversation: any) {
  try {
    console.log(
      "🤝 Processing welcome message for user:",
      message.senderInboxId,
    );

    // Send welcome message
    await conversation.send(
      "MegaPot lottery assistant. Choose an action below:",
    );

    // Send inline action buttons
    await sendMegaPotActions(conversation);

    console.log("✅ Welcome message with actions sent successfully");
  } catch (error) {
    console.error("❌ Error in handleWelcomeMessage:", error);
    console.error(
      "❌ Error details:",
      error instanceof Error ? error.stack : String(error),
    );

    try {
      await conversation.send(
        "Sorry, I encountered an error sending the welcome message. Please try again.",
      );
    } catch (sendError) {
      console.error("Error: send error message:", sendError);
    }
  }
}

async function handleTicketPurchaseStream(
  message: any,
  conversation: any,
  megaPotManager: MegaPotManager,
  agent: any,
) {
  try {
    // Extract number of tickets from message
    const content = message.content as string;
    const ticketMatch = content.match(/(\d+)/);
    const numTickets = ticketMatch ? parseInt(ticketMatch[1]) : 1;

    if (numTickets < 1 || numTickets > 100) {
      await conversation.send(
        "Please specify a valid number of tickets (1-100). For example: 'buy 5 tickets'",
      );
      return;
    }

    // Get the user's Ethereum address from their inbox ID
    console.log(`🔍 Getting user address for inbox: ${message.senderInboxId}`);
    const inboxState = await agent.client.preferences.inboxStateFromInboxIds([
      message.senderInboxId,
    ]);

    if (!inboxState || !inboxState[0]?.identifiers) {
      await conversation.send(
        "❌ Could not retrieve your wallet address. Please make sure your XMTP account is properly connected to a wallet.",
      );
      return;
    }

    const userIdentifier = inboxState[0].identifiers.find(
      (id: any) => id.identifierKind === 0, // IdentifierKind.Ethereum
    );

    if (!userIdentifier) {
      await conversation.send(
        "❌ Could not find an Ethereum address associated with your XMTP account. Please connect a wallet to your XMTP account.",
      );
      return;
    }

    const userAddress = userIdentifier.identifier as `0x${string}`;
    console.log(`✅ User address: ${userAddress}`);

    // Prepare the ticket purchase transactions
    console.log(
      `🎫 Preparing ${numTickets} ticket purchase for user ${userAddress}`,
    );
    const txData = await megaPotManager.prepareTicketPurchase(
      numTickets,
      userAddress,
    );

    const totalCostUSDC = Number(txData.totalCostUSDC) / 1000000; // Convert from 6 decimals to readable USDC
    const ticketPriceUSDC = Number(txData.ticketPriceUSDC) / 1000000;

    console.log(`📋 Transaction reference ID: ${txData.referenceId}`); // Keep in logs only

    // Send the transaction directly to user's wallet
    console.log(`💰 Transaction Details:`);
    console.log(`   • User Address: ${userAddress}`);
    console.log(`   • Number of Tickets: ${numTickets}`);
    console.log(
      `   • Total Cost: ${totalCostUSDC.toString()} (6 decimals) = $${totalCostUSDC.toFixed(2)}`,
    );
    console.log(`   • Contract: 0xbEDd4F2beBE9E3E636161E644759f3cbe3d51B95`);
    console.log(`   • USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`);
    console.log(`   • Referrer: 0xa14ce36e7b135b66c3e3cb2584e777f32b15f5dc`);
    console.log(`   • Gas Estimate: ~250k gas total`);
    console.log(`   • Network: Base (Chain ID: 8453)`);

    const walletSendCalls: WalletSendCallsParams = {
      version: "1.0",
      chainId: `0x${base.id.toString(16)}`,
      from: userAddress,
      calls: [
        {
          to: txData.approveCall.to,
          data: txData.approveCall.data as `0x${string}`,
          value: txData.approveCall.value as `0x${string}`,
          gas: "0xC350", // ~50,000 gas for ERC20 approval
          metadata: {
            description: `Approve USDC spending for ${totalCostUSDC.toFixed(2)} USDC`,
            transactionType: "erc20_approve",
          },
        },
        {
          to: txData.purchaseCall.to,
          data: txData.purchaseCall.data as `0x${string}`,
          value: txData.purchaseCall.value as `0x${string}`,
          gas: "0x30D40", // ~200,000 gas for contract call
          metadata: {
            description: `Purchase ${numTickets} MegaPot ticket${numTickets > 1 ? "s" : ""}`,
            transactionType: "purchase_tickets",
          },
        },
      ],
      capabilities: {
        reference: txData.referenceId,
      },
    };

    await conversation.send(`${numTickets} ticket${numTickets > 1 ? "s" : ""} for $${totalCostUSDC.toFixed(2)}

Ready to purchase. Open wallet to approve:
1. USDC approval for $${totalCostUSDC.toFixed(2)}
2. Buy ${numTickets} ticket${numTickets > 1 ? "s" : ""}

Need USDC on Base network.`);

    console.log(`📤 Sending wallet send calls for ${numTickets} tickets`);
    await conversation.send(walletSendCalls, ContentTypeWalletSendCalls);

    console.log(`✅ Transaction sent to user's wallet`);
    console.log(`🎯 User can now approve the transactions in their wallet`);

    console.log(
      `✅ Transaction reference sent successfully with reference ID: ${txData.referenceId}`,
    );
  } catch (error) {
    console.error("❌ Error preparing ticket purchase:", error);

    // Provide more user-friendly error messages
    let errorMessage = "Error: prepare ticket purchase.";

    if (error instanceof Error) {
      if (
        error.message.includes("insufficient funds") ||
        error.message.includes("balance")
      ) {
        errorMessage = `❌ Issue with contract data. Please try again later.`;
      } else if (
        error.message.includes("denied") ||
        error.message.includes("rejected")
      ) {
        errorMessage = "❌ Transaction preparation was cancelled.";
      } else {
        errorMessage = `Error: prepare purchase: ${error.message}`;
      }
    }

    await conversation.send(errorMessage);
  }
}

async function handleStatsRequestStream(
  message: any,
  conversation: any,
  megaPotManager: MegaPotManager,
  agent: any,
) {
  try {
    // Get the user's Ethereum address from their inbox ID for API stats
    console.log(`🔍 Getting user address for stats: ${message.senderInboxId}`);
    let userAddress: `0x${string}` | undefined;

    try {
      const inboxState = await agent.client.preferences.inboxStateFromInboxIds([
        message.senderInboxId,
      ]);

      if (inboxState && inboxState[0]?.identifiers) {
        const userIdentifier = inboxState[0].identifiers.find(
          (id: any) => id.identifierKind === 0, // IdentifierKind.Ethereum
        );

        if (userIdentifier) {
          userAddress = userIdentifier.identifier as `0x${string}`;
          console.log(`✅ User address for stats: ${userAddress}`);
        }
      }
    } catch (error) {
      console.log(`⚠️ Could not get user address for stats:`, error);
    }

    const stats = await megaPotManager.getStats(userAddress);

    let statsMessage = `Your stats:
Tickets: ${stats.totalTicketsPurchased}
Spent: ${megaPotManager.formatAmount(stats.totalSpent)}
Won: ${megaPotManager.formatAmount(stats.totalWinnings)}

Current round: $${stats.jackpotPool || "0"} jackpot`;

    if (stats.userOdds) {
      statsMessage += `\nYour Odds: 1 in ${stats.userOdds}`;
    }

    if (stats.endTime) {
      const timeLeft = Math.floor(
        (stats.endTime.getTime() - Date.now()) / (1000 * 60 * 60),
      );
      statsMessage += `\nRound ends in: ${timeLeft} hours`;
    }

    await conversation.send(statsMessage);
  } catch (error) {
    console.error("❌ Error fetching stats:", error);
    await conversation.send(
      "Error: fetch your statistics. Please try again later.",
    );
  }
}

async function handleJackpotInfoStream(
  message: any,
  conversation: any,
  megaPotManager: MegaPotManager,
) {
  try {
    const stats = await megaPotManager.getStats();

    const jackpotMessage = `Jackpot: $${stats.jackpotPool || "0"}
Price: $${stats.ticketPrice || "1"}
Sold: ${stats.ticketsSoldRound || 0}
Players: ${stats.activePlayers || 0}

${stats.isActive ? "Active round" : "Round ended"}`;

    await conversation.send(jackpotMessage);
  } catch (error) {
    console.error("❌ Error fetching jackpot info:", error);
    await conversation.send(
      "Error: fetch jackpot information. Please try again later.",
    );
  }
}

async function handleWinningsClaimStream(
  message: any,
  conversation: any,
  megaPotManager: MegaPotManager,
) {
  try {
    await conversation.send("🎉 Checking for winnings...");

    const hasWinnings = await megaPotManager.hasWinningsToClaim();
    if (!hasWinnings) {
      await conversation.send(
        "😔 No winnings available to claim at this time. Better luck next round!",
      );
      return;
    }

    const result = await megaPotManager.claimWinnings();

    await conversation.send(
      `🎉 Congratulations! Winnings claimed successfully!

Transaction: ${result.txHash}

Your winnings have been transferred to your wallet. Check your balance to confirm the transfer.`,
    );
  } catch (error) {
    console.error("❌ Error claiming winnings:", error);
    await conversation.send(
      `Error: claim winnings: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

async function handleHelpRequestStream(message: any, conversation: any) {
  const helpMessage = `🤖 MegaPot Agent Help

I can help you with lottery tickets on Base network:

🎫 Buying Tickets:
• Use the action buttons below or say "buy 5 tickets"
• I automatically handle USDC approval and purchase

📊 Statistics:
• Say "stats" or use the button to see your lottery history
• View tickets purchased, spending, and winnings

🎰 Jackpot Info:
• Say "jackpot" or use the button for current round details
• See jackpot amount, ticket price, and time remaining

💰 Winnings:
• Use the button or say "claim winnings"
• I check for available winnings and handle the claim process

🌐 Mini App:
• Visit https://megapot.io for enhanced features
• Real-time updates and advanced lottery tools

⚠️ Important: You need USDC on Base network (not Ethereum mainnet)!

Choose an action below:`;

  await conversation.send(helpMessage);
  await sendMegaPotActions(conversation);
}

async function handleMiniAppRequestStream(message: any, conversation: any) {
  console.log("🌐 Processing mini app request");

  const miniAppMessage = `🎰 MegaPot Lottery Mini App

You can access the MegaPot lottery directly through our mini app:

https://megapot.io

The mini app allows you:
• View live lottery draws
• Purchase tickets with USDC
• Track your winnings
• See jackpot amounts

Simply click the link above to open the mini app!`;

  await conversation.send(miniAppMessage);
}

async function handleIntentMessage(
  message: any,
  intentContent: IntentContent,
  conversation: any,
  megaPotManager: MegaPotManager,
  agent: any,
) {
  console.log(
    `🎯 Processing intent: ${intentContent.actionId} for actions: ${intentContent.id}`,
  );

  try {
    // Get the user's Ethereum address from their inbox ID
    const inboxState = await agent.client.preferences.inboxStateFromInboxIds([
      message.senderInboxId,
    ]);

    if (!inboxState || !inboxState[0]?.identifiers) {
      await conversation.send(
        "❌ Could not retrieve your wallet address. Please make sure your XMTP account is properly connected to a wallet.",
      );
      return;
    }

    const userIdentifier = inboxState[0].identifiers.find(
      (id: any) => id.identifierKind === 0, // IdentifierKind.Ethereum
    );

    if (!userIdentifier) {
      await conversation.send(
        "❌ Could not find an Ethereum address associated with your XMTP account. Please connect a wallet to your XMTP account.",
      );
      return;
    }

    const userAddress = userIdentifier.identifier as `0x${string}`;
    console.log(`✅ User address: ${userAddress}`);

    // Handle different action types
    switch (intentContent.actionId) {
      case "buy-tickets":
        // Set state to expect ticket amount response
        ticketAmountRequests.set(message.senderInboxId, true);
        await conversation.send("How many tickets would you like to purchase?");
        break;
      case "check-stats":
        await handleStatsIntent(
          userAddress,
          conversation,
          megaPotManager,
          agent,
        );
        break;
      case "jackpot-info":
        await handleJackpotInfoIntent(conversation, megaPotManager);
        break;
      case "claim-winnings":
        await handleClaimIntent(conversation, megaPotManager);
        break;
      case "show-help":
        await handleHelpIntent(conversation);
        break;
      default:
        await conversation.send(`❌ Unknown action: ${intentContent.actionId}`);
        console.log(`❌ Unknown action ID: ${intentContent.actionId}`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("❌ Error processing intent:", errorMessage);
    await conversation.send(`❌ Error processing action: ${errorMessage}`);
  }
}

async function handleTicketPurchaseIntent(
  numTickets: number,
  userAddress: `0x${string}`,
  conversation: any,
  megaPotManager: MegaPotManager,
  agent: any,
) {
  try {
    console.log(
      `🎫 Processing ${numTickets} ticket purchase intent for ${userAddress}`,
    );

    // Prepare the ticket purchase transactions
    const txData = await megaPotManager.prepareTicketPurchase(
      numTickets,
      userAddress,
    );

    const totalCostUSDC = Number(txData.totalCostUSDC) / 1000000; // Convert from 6 decimals to readable USDC
    const ticketPriceUSDC = Number(txData.ticketPriceUSDC) / 1000000;

    console.log(`📋 Transaction reference ID: ${txData.referenceId}`);

    const walletSendCalls: WalletSendCallsParams = {
      version: "1.0",
      chainId: `0x${base.id.toString(16)}`,
      from: userAddress,
      calls: [
        {
          to: txData.approveCall.to,
          data: txData.approveCall.data as `0x${string}`,
          value: txData.approveCall.value as `0x${string}`,
          gas: "0xC350", // ~50,000 gas for ERC20 approval
          metadata: {
            description: `Approve USDC spending for ${totalCostUSDC.toFixed(2)} USDC`,
            transactionType: "erc20_approve",
          },
        },
        {
          to: txData.purchaseCall.to,
          data: txData.purchaseCall.data as `0x${string}`,
          value: txData.purchaseCall.value as `0x${string}`,
          gas: "0x30D40", // ~200,000 gas for contract call
          metadata: {
            description: `Purchase ${numTickets} MegaPot ticket${numTickets > 1 ? "s" : ""}`,
            transactionType: "purchase_tickets",
          },
        },
      ],
      capabilities: {
        reference: txData.referenceId,
      },
    };

    await conversation.send(`${numTickets} ticket${numTickets > 1 ? "s" : ""} for $${totalCostUSDC.toFixed(2)}

Ready to purchase. Open wallet to approve:
1. USDC approval for $${totalCostUSDC.toFixed(2)}
2. Buy ${numTickets} ticket${numTickets > 1 ? "s" : ""}

Need USDC on Base network.`);

    console.log(`📤 Sending wallet send calls for ${numTickets} tickets`);
    await conversation.send(walletSendCalls, ContentTypeWalletSendCalls);

    console.log(`✅ Transaction sent to user's wallet`);
    console.log(`🎯 User can now approve the transactions in their wallet`);

    console.log(
      `✅ Transaction reference sent successfully with reference ID: ${txData.referenceId}`,
    );
  } catch (error) {
    console.error("❌ Error preparing ticket purchase intent:", error);

    let errorMessage = "Error: prepare ticket purchase.";
    if (error instanceof Error) {
      if (
        error.message.includes("insufficient funds") ||
        error.message.includes("balance")
      ) {
        errorMessage = `❌ Issue with contract data. Please try again later.`;
      } else {
        errorMessage = `Error: prepare purchase: ${error.message}`;
      }
    }

    await conversation.send(errorMessage);
  }
}

async function handleStatsIntent(
  userAddress: `0x${string}`,
  conversation: any,
  megaPotManager: MegaPotManager,
  agent: any,
) {
  try {
    const stats = await megaPotManager.getStats(userAddress);

    let statsMessage = `Your stats:
Tickets: ${stats.totalTicketsPurchased}
Spent: ${megaPotManager.formatAmount(stats.totalSpent)}
Won: ${megaPotManager.formatAmount(stats.totalWinnings)}

Current round: $${stats.jackpotPool || "0"} jackpot`;

    if (stats.userOdds) {
      statsMessage += `\nYour Odds: 1 in ${stats.userOdds}`;
    }

    if (stats.endTime) {
      const timeLeft = Math.floor(
        (stats.endTime.getTime() - Date.now()) / (1000 * 60 * 60),
      );
      statsMessage += `\nRound ends in: ${timeLeft} hours`;
    }

    await conversation.send(statsMessage);
  } catch (error) {
    console.error("❌ Error fetching stats:", error);
    await conversation.send(
      "Error: fetch your statistics. Please try again later.",
    );
  }
}

async function handleJackpotInfoIntent(
  conversation: any,
  megaPotManager: MegaPotManager,
) {
  try {
    const stats = await megaPotManager.getStats();

    const jackpotMessage = `Jackpot: $${stats.jackpotPool || "0"}
Price: $${stats.ticketPrice || "1"}
Sold: ${stats.ticketsSoldRound || 0}
Players: ${stats.activePlayers || 0}

${stats.isActive ? "Active round" : "Round ended"}`;

    await conversation.send(jackpotMessage);
  } catch (error) {
    console.error("❌ Error fetching jackpot info:", error);
    await conversation.send(
      "Error: fetch jackpot information. Please try again later.",
    );
  }
}

async function handleClaimIntent(
  conversation: any,
  megaPotManager: MegaPotManager,
) {
  try {
    await conversation.send("🎉 Checking for winnings...");

    const hasWinnings = await megaPotManager.hasWinningsToClaim();
    if (!hasWinnings) {
      await conversation.send(
        "😔 No winnings available to claim at this time. Better luck next round!",
      );
      return;
    }

    const result = await megaPotManager.claimWinnings();

    await conversation.send(
      `🎉 Congratulations! Winnings claimed successfully!

Transaction: ${result.txHash}

Your winnings have been transferred to your wallet. Check your balance to confirm the transfer.`,
    );
  } catch (error) {
    console.error("❌ Error claiming winnings:", error);
    await conversation.send(
      `Error: claim winnings: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

async function sendMegaPotActions(conversation: any) {
  const actionsContent: ActionsContent = {
    id: `megapot-actions-${Date.now()}`,
    description: "MegaPot lottery assistant. Choose an action:",
    actions: [
      {
        id: "buy-tickets",
        label: "Buy Tickets",
        style: "primary",
      },
      {
        id: "check-stats",
        label: "Check Stats",
        style: "secondary",
      },
      {
        id: "jackpot-info",
        label: "Jackpot Info",
        style: "secondary",
      },
      {
        id: "claim-winnings",
        label: "Claim Winnings",
        style: "primary",
      },
      {
        id: "show-help",
        label: "Help",
        style: "secondary",
      },
    ],
  };

  console.log("🎯 Sending MegaPot inline actions");
  await conversation.send(actionsContent, ContentTypeActions);
}

async function handleHelpIntent(conversation: any) {
  const helpMessage = `MegaPot lottery assistant.

Commands:
• "Buy Tickets" button - Purchase lottery tickets
• "buy X tickets" - Direct purchase (e.g., "buy 5 tickets")
• "Check Stats" - View your lottery history
• "Jackpot Info" - View current round details
• "Claim Winnings" - Claim any lottery prizes

Need USDC on Base network.`;

  await conversation.send(helpMessage);
  await sendMegaPotActions(conversation);
}

// Message handler functions
async function handleWelcomeMessage(ctx: any) {
  try {
    console.log(
      "🤝 Processing welcome message for user:",
      ctx.message?.senderInboxId,
    );

    const welcomeMessage = `MegaPot lottery assistant.

Commands:
• "buy X tickets" - Purchase lottery tickets (e.g., "buy 5 tickets")
• "stats" - View your statistics
• "jackpot" - View jackpot information
• "claim" - Claim winnings
• "help" - Show this help`;

    console.log("📤 Sending welcome message...");
    await ctx.conversation.send(welcomeMessage);
    console.log("✅ Welcome message sent successfully");
  } catch (error) {
    console.error("❌ Error in handleWelcomeMessage:", error);
    console.error(
      "❌ Error details:",
      error instanceof Error ? error.stack : String(error),
    );

    try {
      await ctx.conversation.send(
        "Sorry, I encountered an error sending the welcome message. Please try again.",
      );
    } catch (sendError) {
      console.error("Error: send error message:", sendError);
    }
  }
}

async function handleTicketPurchase(ctx: any, megaPotManager: MegaPotManager) {
  try {
    // Extract number of tickets from message
    const content = ctx.message.content as string;
    const ticketMatch = content.match(/(\d+)/);
    const numTickets = ticketMatch ? parseInt(ticketMatch[1]) : 1;

    if (numTickets < 1 || numTickets > 100) {
      await ctx.conversation.send(
        "Please specify a valid number of tickets (1-100). For example: 'buy 5 tickets'",
      );
      return;
    }

    await ctx.conversation.send(
      `🎫 Purchasing ${numTickets} MegaPot ticket${numTickets > 1 ? "s" : ""}...`,
    );

    const result = await megaPotManager.buyTickets(numTickets);

    await ctx.conversation.send(
      `✅ Successfully purchased ${numTickets} MegaPot ticket${numTickets > 1 ? "s" : ""}!

💰 Cost: ${megaPotManager.formatAmount(result.cost)}
🔗 Transaction: ${result.txHash}
📋 Reference ID: ${result.referenceId}

Good luck! 🍀 Your tickets are now entered into the current lottery round.`,
    );
  } catch (error) {
    console.error("❌ Error purchasing tickets:", error);
    await ctx.conversation.send(
      `Error: purchase tickets: ${error instanceof Error ? error.message : "Unknown error"}

Please try again or contact support if the issue persists.`,
    );
  }
}

async function handleStatsRequest(ctx: any, megaPotManager: MegaPotManager) {
  try {
    const stats = await megaPotManager.getStats();

    let statsMessage = `📊 Your MegaPot Statistics:

🎫 Total Tickets Purchased: ${stats.totalTicketsPurchased}
💰 Total Spent: ${megaPotManager.formatAmount(stats.totalSpent)}
🎉 Total Winnings: ${megaPotManager.formatAmount(stats.totalWinnings)}

🏆 Current Round:
• Jackpot: $${stats.jackpotPool || "0"}
• Ticket Price: $${stats.ticketPrice || "1"}
• Tickets Sold: ${stats.ticketsSoldRound || 0}
• Your Tickets: ${stats.userTicketsInCurrentRound || 0}
• Active Players: ${stats.activePlayers || 0}`;

    if (stats.userOdds) {
      statsMessage += `\n🎯 Your Odds: 1 in ${stats.userOdds}`;
    }

    if (stats.endTime) {
      const timeLeft = Math.floor(
        (stats.endTime.getTime() - Date.now()) / (1000 * 60 * 60),
      );
      statsMessage += `\n⏰ Round ends in: ${timeLeft} hours`;
    }

    await ctx.conversation.send(statsMessage);
  } catch (error) {
    console.error("❌ Error fetching stats:", error);
    await ctx.conversation.send(
      "Error: fetch your statistics. Please try again later.",
    );
  }
}

async function handleJackpotInfo(ctx: any, megaPotManager: MegaPotManager) {
  try {
    const stats = await megaPotManager.getStats();

    const jackpotMessage = `🎰 Current MegaPot Jackpot Information:

💰 Current Jackpot: $${stats.jackpotPool || "0"}
🎫 Ticket Price: $${stats.ticketPrice || "1"}
👥 Tickets Sold: ${stats.ticketsSoldRound || 0}
🎮 Active Players: ${stats.activePlayers || 0}

${stats.endTime ? `⏰ Round ends: ${stats.endTime.toLocaleString()}` : ""}
${stats.isActive ? "✅ Round is active" : "⏸️ Round is not active"}

Try the MegaPot Mini App for real-time updates: https://megapot.io`;

    await ctx.conversation.send(jackpotMessage);
  } catch (error) {
    console.error("❌ Error fetching jackpot info:", error);
    await ctx.conversation.send(
      "Error: fetch jackpot information. Please try again later.",
    );
  }
}

async function handleWinningsClaim(ctx: any, megaPotManager: MegaPotManager) {
  try {
    await ctx.conversation.send("🎉 Checking for winnings...");

    const hasWinnings = await megaPotManager.hasWinningsToClaim();
    if (!hasWinnings) {
      await ctx.conversation.send(
        "😔 No winnings available to claim at this time. Better luck next round!",
      );
      return;
    }

    const result = await megaPotManager.claimWinnings();

    await ctx.conversation.send(
      `🎉 Congratulations! Winnings claimed successfully!

🔗 Transaction: ${result.txHash}

Your winnings have been transferred to your wallet. Check your balance to confirm the transfer.`,
    );
  } catch (error) {
    console.error("❌ Error claiming winnings:", error);
    await ctx.conversation.send(
      `Error: claim winnings: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

async function handleHelpRequest(ctx: any) {
  const helpMessage = `🤖 MegaPot Agent Help

I can help you with lottery tickets on Base network:

🎫 Buying Tickets:
• Say "buy 5 tickets" or "purchase tickets"
• I automatically handle USDC approval and purchase

📊 Statistics:
• Say "stats" or "my stats" to see your lottery history
• View tickets purchased, spending, and winnings

🎰 Jackpot Info:
• Say "jackpot" or "prize" for current round details
• See jackpot amount, ticket price, and time remaining

💰 Winnings:
• Say "claim winnings" to claim any lottery prizes
• I check for available winnings and handle the claim process

🚀 Mini App:
• Visit https://megapot.io for enhanced features
• Real-time updates and advanced lottery tools

What would you like to do?`;

  await ctx.conversation.send(helpMessage);
}

async function handlePingRequest(ctx: any) {
  try {
    console.log("🏓 Handling ping request from:", ctx.message?.senderInboxId);
    await ctx.conversation.send("ok");
    console.log("✅ Ping response sent successfully");
  } catch (error) {
    console.error("❌ Error handling ping:", error);
    try {
      await ctx.conversation.send("error");
    } catch (sendError) {
      console.error("Error: send error response:", sendError);
    }
  }
}

async function handleMiniAppRequest(ctx: any) {
  await ctx.conversation.send(
    `🎰 Launching MegaPot Mini App: https://megapot.io

This will open the full MegaPot experience where you can:
• View live jackpot amounts
• Purchase tickets with USDC
• Track your lottery history
• See real-time odds and statistics`,
  );
}

async function handleUnknownCommand(ctx: any) {
  const unknownMessage = `❓ I'm not sure what you mean. Here are some things I can help you with:

MegaPot Lottery Commands:
• "buy 5 tickets" - Purchase lottery tickets
• "stats" - View your statistics
• "jackpot" - View jackpot information
• "claim" - Claim winnings
• "help" - Show this help

What would you like to do?`;

  await ctx.conversation.send(unknownMessage);
}

// Run the agent
main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
