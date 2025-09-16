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
import { PoolHandler } from "./handlers/poolHandler.js";
import { SmartHandler, type MessageIntent } from "./handlers/smartHandler.js";
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
const WALLET_KEY = process.env.WALLET_KEY as string;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const XMTP_ENV = process.env.XMTP_ENV || "dev";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string;
const MEGAPOT_DATA_API_KEY = process.env.MEGAPOT_DATA_API_KEY;
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://sepolia.base.org";

// MegaPot Contract Configuration
const MEGAPOT_CONTRACT_ADDRESS = process.env.MEGAPOT_CONTRACT_ADDRESS as string;
const MEGAPOT_USDC_ADDRESS = process.env.MEGAPOT_USDC_ADDRESS as string;
const MEGAPOT_REFERRER_ADDRESS = process.env.MEGAPOT_REFERRER_ADDRESS as string;
const JACKPOT_POOL_CONTRACT_ADDRESS = process.env
  .JACKPOT_POOL_CONTRACT_ADDRESS as string;

// Validate environment variables
console.log("🔍 Checking environment variables...");
console.log(
  "📝 WALLET_KEY:",
  WALLET_KEY ? `${WALLET_KEY.substring(0, 10)}...` : "NOT SET",
);
console.log("🔐 ENCRYPTION_KEY:", ENCRYPTION_KEY ? "SET" : "NOT SET");
console.log(
  "🤖 OPENAI_API_KEY:",
  OPENAI_API_KEY ? `${OPENAI_API_KEY.substring(0, 10)}...` : "NOT SET",
);
console.log("🌍 XMTP_ENV:", XMTP_ENV);
console.log("🎰 MEGAPOT_CONTRACT:", MEGAPOT_CONTRACT_ADDRESS || "NOT SET");
console.log("💰 MEGAPOT_USDC:", MEGAPOT_USDC_ADDRESS || "NOT SET");
console.log("👥 MEGAPOT_REFERRER:", MEGAPOT_REFERRER_ADDRESS || "NOT SET");
console.log("🎯 JACKPOT_POOL:", JACKPOT_POOL_CONTRACT_ADDRESS || "NOT SET");

if (!WALLET_KEY) {
  console.error("❌ WALLET_KEY environment variable is required");
  process.exit(1);
}

if (!ENCRYPTION_KEY) {
  console.error("❌ ENCRYPTION_KEY environment variable is required");
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY environment variable is required");
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

if (!JACKPOT_POOL_CONTRACT_ADDRESS) {
  console.error(
    "❌ JACKPOT_POOL_CONTRACT_ADDRESS environment variable is required",
  );
  process.exit(1);
}

// MegaPot contract configuration using environment variables
const MEGAPOT_CONFIG = {
  contractAddress: MEGAPOT_CONTRACT_ADDRESS as `0x${string}`,
  usdcAddress: MEGAPOT_USDC_ADDRESS as `0x${string}`,
  referrerAddress: MEGAPOT_REFERRER_ADDRESS as `0x${string}`,
};

// Create a signer for XMTP
function createSigner(privateKey: string): Signer {
  console.log("🔧 Creating signer with private key...");

  try {
    const account = privateKeyToAccount(privateKey as `0x${string}`);
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
  console.log("🎰 Starting Smart MegaPot Agent...");

  // Initialize MegaPot manager with environment variables
  const megaPotManager = new MegaPotManager(
    BASE_RPC_URL,
    WALLET_KEY as `0x${string}`,
    MEGAPOT_CONFIG,
  );

  // Initialize smart message handler
  const smartHandler = new SmartHandler(OPENAI_API_KEY, megaPotManager);

  // Initialize pooled purchase handler
  const poolHandler = new PoolHandler(megaPotManager);

  console.log("🤖 Smart MegaPot Agent initialized");
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

  let agent;
  try {
    agent = await Agent.create(signer as any, {
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
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("already registered 10/10 installations")
    ) {
      // Extract inbox ID from error message
      const inboxIdMatch = error.message.match(
        /InboxID (\w+) has already registered/,
      );
      const inboxId = inboxIdMatch ? inboxIdMatch[1] : "UNKNOWN";

      console.log("");
      console.log("❌ XMTP INSTALLATION LIMIT REACHED (10/10)");
      console.log("=".repeat(50));
      console.log(`📋 Inbox ID: ${inboxId}`);
      console.log("");
      console.log("🔧 MANUAL FIX REQUIRED:");
      console.log("1. Run locally with your .env file:");
      console.log(`   node revoke-installations.js ${inboxId}`);
      console.log("");
      console.log("2. OR generate new keys:");
      console.log("   yarn gen:keys");
      console.log(
        "   # Update WALLET_KEY and ENCRYPTION_KEY in Render dashboard",
      );
      console.log("");
      console.log("3. Then redeploy the agent");
      console.log("");
      console.log(
        "🔗 More info: https://docs.xmtp.org/inboxes/installation-management",
      );
      console.log("=".repeat(50));

      throw error; // Re-throw original error
    } else {
      throw error;
    }
  }

  console.log("✅ Agent created successfully!");
  console.log(`🔗 Agent inbox: ${agent.client.inboxId}`);
  console.log("\n💬 Smart MegaPot Agent is running!");
  console.log(
    `📝 Send messages to: http://xmtp.chat/dm/${agent.client.inboxId}`,
  );
  console.log("\n🤖 Smart features enabled:");
  console.log("• AI-powered message understanding");
  console.log("• Contextual lottery information");
  console.log("• Group pool purchases");
  console.log("• Natural language ticket buying");
  console.log("• Real-time lottery data integration");

  // Set up message streaming properly using the client directly
  console.log("🎧 Setting up message streaming...");

  try {
    // Sync conversations first
    console.log("🔄 Syncing conversations...");
    await agent.client.conversations.sync();
    console.log("✅ Conversations synced successfully!");

    // Start cleanup timer for old pools
    setInterval(
      () => {
        poolHandler.cleanupOldPools();
      },
      24 * 60 * 60 * 1000,
    ); // Daily cleanup

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

          // Check if this is a group chat
          const isGroupChat = conversation instanceof Group;
          console.log(`📍 Conversation type: ${isGroupChat ? "group" : "dm"}`);

          // Get user address for context
          let userAddress: string | undefined;
          try {
            const inboxState =
              await agent.client.preferences.inboxStateFromInboxIds([
                message.senderInboxId,
              ]);
            const userIdentifier = inboxState[0]?.identifiers?.find(
              (id: any) => id.identifierKind === 0,
            );
            userAddress = userIdentifier?.identifier;
          } catch (error) {
            console.warn("Could not get user address:", error);
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

          // Handle different content types
          if (message.contentType?.typeId === "text") {
            console.log("📝 Processing text message with smart handler");
            await handleSmartTextMessage(
              message,
              conversation,
              smartHandler,
              poolHandler,
              megaPotManager,
              agent,
              isGroupChat,
              userAddress,
            );
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
                smartHandler,
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
        } catch (error) {
          console.error("❌ Error processing message:", error);
          console.error("❌ Message details:", {
            senderInboxId: message.senderInboxId,
            conversationId: message.conversationId,
            contentType: message.contentType?.typeId,
            content: message.content,
          });
          // Continue processing other messages even if one fails
        }
      }
    })().catch((error) => {
      console.error("❌ Message stream error:", error);
    });
  } catch (streamError) {
    console.error("Error: set up message stream:", streamError);
    throw streamError;
  }

  // Start the agent
  console.log("🚀 Starting XMTP message stream...");
  try {
    console.log("⏳ Starting agent...");
    await agent.start();
    console.log("✅ Agent started successfully! Listening for messages...");
    console.log("🎧 Message handlers are active and ready to receive messages");
    console.log("🤖 Smart AI features are enabled!");
    console.log("💰 Agent will react with 💰 to ALL messages!");

    // Keep the process alive
    console.log("🔄 Agent is now running and will stay active...");
    console.log("📡 Waiting for messages...");

    // Prevent the process from exiting with heartbeat
    setInterval(() => {
      console.log("💓 Smart Agent heartbeat - AI-powered and ready...");
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
    console.log("\n🛑 Shutting down Smart MegaPot Agent...");
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

// Smart message handler that uses LLM for parsing and responses
async function handleSmartTextMessage(
  message: any,
  conversation: any,
  smartHandler: SmartHandler,
  poolHandler: PoolHandler,
  megaPotManager: MegaPotManager,
  agent: any,
  isGroupChat: boolean,
  userAddress?: string,
) {
  try {
    const content = message.content as string;
    const lowerContent = content.toLowerCase();

    console.log(`🤖 Processing message with AI: "${content}"`);

    // Check for group mentions (only respond in groups if mentioned)
    const hasMention =
      lowerContent.includes("@megapot") ||
      lowerContent.includes("@megapot.base.eth") ||
      lowerContent.includes("@megapot.eth") ||
      !isGroupChat; // Always respond in DMs

    if (isGroupChat && !hasMention) {
      console.log("🚫 Skipping group message without @megapot mention");
      return;
    }

    // Handle group pool commands and purchases
    if (isGroupChat) {
      // Check for pool status requests
      if (
        lowerContent.includes("pool status") ||
        lowerContent.includes("pool info")
      ) {
        const poolStatus = poolHandler.getPoolStatus(conversation.id);
        await conversation.send(poolStatus);
        return;
      }

      // Check for member pool share requests
      if (
        lowerContent.includes("my pool share") ||
        lowerContent.includes("my share")
      ) {
        const memberShare = poolHandler.getMemberPoolShare(
          conversation.id,
          message.senderInboxId,
        );
        await conversation.send(memberShare);
        return;
      }

      // Check for pool winnings claim
      if (
        lowerContent.includes("claim pool winnings") ||
        lowerContent.includes("claim pool")
      ) {
        console.log("💰 Processing pool winnings claim");
        if (!userAddress) {
          await conversation.send(
            "❌ Could not retrieve your wallet address for claiming.",
          );
          return;
        }

        const pool = poolHandler.getActivePoolForGroup(conversation.id);
        if (!pool) {
          await conversation.send(
            "❌ No pool found for this group. Initialize a pool first!",
          );
          return;
        }

        try {
          const claimTx = await poolHandler.prepareClaimPoolWinnings(
            userAddress,
            pool.poolContractAddress,
          );

          await conversation.send(
            "💰 Claiming Pool Winnings\n\nPreparing transaction to claim your proportional share of pool winnings...",
          );
          await conversation.send(claimTx, ContentTypeWalletSendCalls);
        } catch (error) {
          await conversation.send(
            `❌ Error preparing winnings claim: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
        return;
      }

      // Check for pool initialization
      if (
        lowerContent.includes("init pool") ||
        lowerContent.includes("create pool")
      ) {
        console.log("🎯 Initializing group pool");
        const poolResult = await poolHandler.initializeGroupPool(
          conversation,
          message.senderInboxId,
        );
        await conversation.send(poolResult.message);
        return;
      }

      // Check for group pool purchase commands
      const groupPoolMatch = content.match(
        /(?:buy|purchase)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:tickets?\s+)?for\s+(?:group\s+)?pool/i,
      );
      if (groupPoolMatch) {
        const numTickets = parseTicketNumber(groupPoolMatch[1]);
        if (numTickets && numTickets > 0 && numTickets <= 100) {
          console.log(
            `🎯 Processing group pool purchase: ${numTickets} tickets`,
          );

          if (!userAddress) {
            await conversation.send(
              "❌ Could not retrieve your wallet address for pool purchase.",
            );
            return;
          }

          const poolResult = await poolHandler.processPooledTicketPurchase(
            conversation.id,
            message.senderInboxId,
            userAddress,
            numTickets,
            conversation,
            agent.client,
          );

          await conversation.send(poolResult.message);

          if (poolResult.success && poolResult.transactionData) {
            // Send the transaction to user's wallet
            await conversation.send(
              poolResult.transactionData,
              ContentTypeWalletSendCalls,
            );
          }
          return;
        }
      }
    }

    // Use AI to parse message intent and generate response
    const intent = await smartHandler.parseMessageIntent(
      content,
      userAddress,
      isGroupChat,
      conversation.id,
      message.senderInboxId,
    );
    console.log(
      `🎯 AI detected intent: ${intent.type} (confidence: ${intent.confidence})`,
    );

    // Send the AI-generated response
    await conversation.send(intent.response);

    // Handle specific actions based on intent
    switch (intent.type) {
      case "confirmation":
        console.log("✅ Processing confirmation for pending purchase");
        const contextHandler = smartHandler.getContextHandler();
        const pendingConfirmation = contextHandler.getPendingConfirmation(
          conversation.id,
          message.senderInboxId,
        );

        if (
          pendingConfirmation &&
          pendingConfirmation.ticketCount &&
          userAddress
        ) {
          if (pendingConfirmation.flow === "pool_purchase") {
            console.log(
              `🎫 Executing pool purchase: ${pendingConfirmation.ticketCount} tickets`,
            );
            // Handle pool purchase confirmation
            const poolResult = await poolHandler.processPooledTicketPurchase(
              conversation.id,
              message.senderInboxId,
              userAddress,
              pendingConfirmation.ticketCount,
              conversation,
              agent.client,
            );
            await conversation.send(poolResult.message);
            if (poolResult.success && poolResult.transactionData) {
              await conversation.send(
                poolResult.transactionData,
                ContentTypeWalletSendCalls,
              );
            }
          } else {
            console.log(
              `🎫 Executing solo purchase: ${pendingConfirmation.ticketCount} tickets`,
            );
            // Handle solo ticket purchase confirmation
            await handleTicketPurchaseIntent(
              pendingConfirmation.ticketCount,
              userAddress,
              conversation,
              megaPotManager,
              agent,
            );
          }
          // Clear the pending confirmation
          contextHandler.clearPendingConfirmation(
            conversation.id,
            message.senderInboxId,
          );
        } else {
          await conversation.send(
            "❌ No pending purchase found to confirm. Please start a new ticket purchase.",
          );
        }
        break;

      case "cancellation":
        console.log("❌ Processing cancellation for pending purchase");
        const cancelContextHandler = smartHandler.getContextHandler();
        cancelContextHandler.clearPendingConfirmation(
          conversation.id,
          message.senderInboxId,
        );
        // Response already sent by the AI
        break;

      case "buy_tickets":
        if (intent.extractedData?.askForQuantity) {
          await conversation.send(
            "🎫 How many tickets would you like to purchase? (e.g., '5 tickets')",
          );
        } else if (intent.extractedData?.ticketCount) {
          console.log(
            `🎫 Processing ticket purchase: ${intent.extractedData.ticketCount} tickets`,
          );

          // Set pending confirmation context
          const buyContextHandler = smartHandler.getContextHandler();
          if (userAddress) {
            buyContextHandler.setPendingTicketPurchase(
              conversation.id,
              message.senderInboxId,
              intent.extractedData.ticketCount,
              userAddress,
              isGroupChat,
            );

            // Ask for confirmation
            await conversation.send(
              `You'd like to buy ${intent.extractedData.ticketCount} ticket${intent.extractedData.ticketCount > 1 ? "s" : ""} for $${intent.extractedData.ticketCount} USDC. Shall I proceed with the purchase?`,
            );
          } else {
            await conversation.send(
              "❌ Could not retrieve your wallet address for the purchase.",
            );
          }
        } else {
          // Check if the original message implies a single ticket
          const lowerContent = content.toLowerCase();
          if (
            /\b(a|me\s+a)\s+ticket\b/i.test(content) ||
            (lowerContent.includes("buy") &&
              lowerContent.includes("ticket") &&
              !lowerContent.includes("tickets"))
          ) {
            console.log(
              "🎫 Processing single ticket purchase (inferred from 'a ticket')",
            );
            const singleContextHandler = smartHandler.getContextHandler();
            if (userAddress) {
              singleContextHandler.setPendingTicketPurchase(
                conversation.id,
                message.senderInboxId,
                1,
                userAddress,
                isGroupChat,
              );

              await conversation.send(
                "You'd like to buy 1 ticket for $1 USDC. Shall I proceed with the purchase?",
              );
            } else {
              await conversation.send(
                "❌ Could not retrieve your wallet address for the purchase.",
              );
            }
          } else {
            await conversation.send(
              "🎫 How many tickets would you like to purchase? (e.g., '5 tickets')",
            );
          }
        }
        break;

      case "check_stats":
        console.log("📊 Fetching user statistics");
        await handleStatsIntent(
          userAddress || "",
          conversation,
          megaPotManager,
          agent,
        );
        break;

      case "pooled_purchase":
        console.log("🎯 Processing pooled purchase intent");
        if (isGroupChat) {
          if (intent.extractedData?.ticketCount) {
            // Set pending pool confirmation context
            const poolContextHandler = smartHandler.getContextHandler();
            if (userAddress) {
              poolContextHandler.setPendingPoolPurchase(
                conversation.id,
                message.senderInboxId,
                intent.extractedData.ticketCount,
                userAddress,
              );

              // Ask for confirmation
              await conversation.send(
                `You'd like to buy ${intent.extractedData.ticketCount} ticket${intent.extractedData.ticketCount > 1 ? "s" : ""} for the group pool for $${intent.extractedData.ticketCount} USDC. This will be a shared purchase where winnings are distributed proportionally. Shall I proceed?`,
              );
            } else {
              await conversation.send(
                "❌ Could not retrieve your wallet address for the pool purchase.",
              );
            }
          } else {
            await conversation.send(
              "🎯 How many tickets would you like to purchase for the group pool? (e.g., '10 tickets for group pool')\n\n💡 Pool purchases benefit from collective winnings - your share is proportional to your contribution!",
            );
          }
        } else {
          await conversation.send(
            "❌ Group pool purchases are only available in group chats! In DMs, you can only buy individual tickets.",
          );
        }
        break;

      case "jackpot_info":
        console.log("🎰 Fetching jackpot information");
        await handleJackpotInfoIntent(conversation, megaPotManager);
        break;

      case "claim_winnings":
        console.log("💰 Processing winnings claim");
        await handleClaimIntent(conversation, megaPotManager);
        break;

      case "help":
        console.log("❓ Generating contextual help");
        const helpMessage = await smartHandler.generateContextualHelp(
          userAddress,
          isGroupChat,
        );
        await conversation.send(helpMessage);
        await sendMegaPotActions(conversation);
        break;

      case "greeting":
        console.log("👋 Sending welcome message");
        await sendMegaPotActions(conversation);
        break;

      case "pooled_purchase":
        if (isGroupChat) {
          if (intent.extractedData?.askForPurchaseType) {
            await conversation.send(
              "Would you like to buy tickets individually or through the group pool?\n\n" +
                "🎫 Individual Purchase: You keep all potential winnings\n" +
                "👥 Group Pool: Share costs and winnings with the group - your share is proportional to your contribution\n\n" +
                "Reply with 'individual' or 'pool', or use the action buttons below.",
            );
            await sendMegaPotActions(conversation);
          } else {
            await conversation.send(
              `👥 Group Pool Purchases\n\nBuy tickets through the group pool to benefit from collective winnings!\n\nCommands:\n• "buy 5 tickets for group pool" - Purchase through pool\n• "pool status" - Check group pool statistics\n• "my pool share" - See your contribution\n\n💡 Your winnings are proportional to your ticket contributions!`,
            );
          }
        } else {
          await conversation.send(
            "👥 Group pool purchases are only available in group chats! Add me to a group to buy tickets through a shared pool.",
          );
        }
        break;

      default:
        // For unknown intents, the AI response should be sufficient
        break;
    }
  } catch (error) {
    console.error("❌ Error in smart message handler:", error);
    try {
      await conversation.send(
        "🤖 I encountered an error processing your message. Please try again or use the action buttons below.",
      );
      await sendMegaPotActions(conversation);
    } catch (sendError) {
      console.error("Error: send error message:", sendError);
    }
  }
}

// Intent handlers (keeping existing functionality)
async function handleIntentMessage(
  message: any,
  intentContent: IntentContent,
  conversation: any,
  megaPotManager: MegaPotManager,
  agent: any,
  smartHandler: SmartHandler,
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

    const userAddress = userIdentifier.identifier;
    console.log(`✅ User address: ${userAddress}`);

    // Handle different action types
    switch (intentContent.actionId) {
      case "buy-tickets":
        if (conversation instanceof Group) {
          await conversation.send(
            "Would you like to buy tickets individually or through the group pool?\n\n" +
              "🎫 Individual Purchase: You keep all potential winnings\n" +
              "👥 Group Pool: Share costs and winnings with the group - your share is proportional to your contribution\n\n" +
              "Reply with 'individual' or 'pool', or use the action buttons below.",
          );
          await sendMegaPotActions(conversation);
        } else {
          await conversation.send(
            "🎫 How many tickets would you like to purchase? (e.g., '5 tickets')",
          );
        }
        break;
      case "buy-pool-tickets":
        if (conversation instanceof Group) {
          await conversation.send(
            "🎯 How many tickets would you like to purchase for the group pool? (e.g., '10 tickets for group pool')\n\n💡 Pool purchases benefit from collective winnings - your share is proportional to your contribution!",
          );
        } else {
          await conversation.send(
            "❌ Group pool purchases are only available in group chats!",
          );
        }
        break;
      case "pool-status":
        if (conversation instanceof Group) {
          // Get pool status from pool handler
          const poolId = conversation.id;
          // This would need to be implemented in the pool handler
          await conversation.send(
            "📊 Group Pool Status:\n\n🎯 Active Pool: Not found\n👥 Members: 0\n🎫 Total Tickets: 0\n💰 Total Contributed: $0\n\n💡 Start a pool purchase to create an active pool!",
          );
        } else {
          await conversation.send(
            "❌ Pool status is only available in group chats!",
          );
        }
        break;
      case "explain-ticket-types":
        // Generate comprehensive explanation of solo vs pool tickets
        const explanation = await smartHandler.generateTicketTypeExplanation(
          userAddress,
          conversation instanceof Group,
        );
        await conversation.send(explanation);
        await sendMegaPotActions(conversation);
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
      case "view-past-results":
        await conversation.send(
          "📈 View past lottery results: https://stats.megapot.io",
        );
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

// Existing intent handlers (updated with enhanced data)
async function handleTicketPurchaseIntent(
  numTickets: number,
  userAddress: string,
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
    const totalCostUSDC = Number(txData.totalCostUSDC) / 1000000;

    const walletSendCalls: WalletSendCallsParams = {
      version: "1.0",
      chainId: `0x${base.id.toString(16)}`,
      from: userAddress as `0x${string}`,
      capabilities: {
        reference: txData.referenceId,
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
          to: txData.approveCall.to as `0x${string}`,
          data: txData.approveCall.data as `0x${string}`,
          value: txData.approveCall.value as `0x${string}`,
          gas: "0xC350",
          metadata: {
            description: `Approve USDC spending for ${totalCostUSDC.toFixed(2)} USDC`,
            transactionType: "erc20_approve",
            source: "MegaPot",
            origin: "megapot.io",
            hostname: "megapot.io",
            faviconUrl: "https://megapot.io/favicon.ico",
            title: "MegaPot Lottery",
          },
        },
        {
          to: txData.purchaseCall.to as `0x${string}`,
          data: txData.purchaseCall.data as `0x${string}`,
          value: txData.purchaseCall.value as `0x${string}`,
          gas: "0x30D40",
          metadata: {
            description: `Purchase ${numTickets} MegaPot ticket${numTickets > 1 ? "s" : ""}`,
            transactionType: "purchase_tickets",
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

    await conversation.send(
      `🎫 ${numTickets} ticket${numTickets > 1 ? "s" : ""} for $${totalCostUSDC.toFixed(2)}\n✅ Open wallet to approve transaction\n⚠️ Need USDC on Base network. Good luck! 🍀🎰`,
    );

    console.log(`📤 Sending wallet send calls for ${numTickets} tickets`);
    await conversation.send(walletSendCalls, ContentTypeWalletSendCalls);

    console.log(`✅ Transaction sent to user's wallet`);
  } catch (error) {
    console.error("❌ Error preparing ticket purchase intent:", error);
    await conversation.send(
      "❌ Error preparing ticket purchase. Please try again.",
    );
  }
}

async function handleStatsIntent(
  userAddress: string,
  conversation: any,
  megaPotManager: MegaPotManager,
  agent: any,
) {
  try {
    const stats = await megaPotManager.getStats(userAddress);

    let statsMessage = `📊 Your MegaPot Stats:
🎫 Tickets purchased: ${stats.totalTicketsPurchased}
💵 Total spent: ${megaPotManager.formatAmount(stats.totalSpent)}
🎉 Total won: ${megaPotManager.formatAmount(stats.totalWinnings)}

🎰 Current Round:
💰 Jackpot: $${stats.jackpotPool || "0"}
🎫 Ticket price: $${stats.ticketPrice || "1"}
📈 Tickets sold: ${stats.ticketsSoldRound || 0}`;

    if (stats.userOdds) {
      statsMessage += `\n🎯 Your odds: 1 in ${stats.userOdds}`;
    }

    if (stats.endTime) {
      const timeLeft = Math.floor(
        (stats.endTime.getTime() - Date.now()) / (1000 * 60 * 60),
      );
      statsMessage += `\n⏰ Round ends in: ${timeLeft} hours`;
    }

    await conversation.send(statsMessage);
  } catch (error) {
    console.error("❌ Error fetching stats:", error);
    await conversation.send(
      "❌ Error fetching your statistics. Please try again later.",
    );
  }
}

async function handleJackpotInfoIntent(
  conversation: any,
  megaPotManager: MegaPotManager,
) {
  try {
    const stats = await megaPotManager.getStats();

    // Fetch all-time stats for enhanced context
    let allTimeStats;
    try {
      const response = await fetch(
        "https://api.megapot.io/api/v1/all-time-stats?apikey=7no84S4VwcXViFPjReUM",
      );
      if (response.ok) {
        const data = await response.json();
        allTimeStats = data.data;
      }
    } catch (error) {
      console.error("Failed to fetch all-time stats:", error);
    }

    const jackpotMessage = `🎰 MegaPot Jackpot Info:
💰 Current jackpot: $${stats.jackpotPool || "0"}
🎫 Ticket price: $${stats.ticketPrice || "1"}
📈 Tickets sold: ${stats.ticketsSoldRound || 0}
👥 Active players: ${stats.activePlayers || 0}

📊 All-Time Stats:
💎 Total jackpots: $${allTimeStats?.JackpotsRunTotal_USD?.toLocaleString() || "179M+"}
🎫 Total tickets: ${allTimeStats?.total_tickets?.toLocaleString() || "282K+"}
👥 Total players: ${allTimeStats?.total_players?.toLocaleString() || "14K+"}
🏆 Winners: ${allTimeStats?.total_won || "19"} lucky players!

${stats.isActive ? "✅ Round is active!" : "❌ Round has ended"}

🌐 Full experience: https://frame.megapot.io`;

    await conversation.send(jackpotMessage);
  } catch (error) {
    console.error("❌ Error fetching jackpot info:", error);
    await conversation.send(
      "❌ Error fetching jackpot information. Please try again later.",
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
      `🎉 Congratulations! Winnings claimed successfully!\n\nTransaction: ${result.txHash}\n\nYour winnings have been transferred to your wallet. Check your balance to confirm the transfer.`,
    );
  } catch (error) {
    console.error("❌ Error claiming winnings:", error);
    await conversation.send(
      `❌ Error claiming winnings: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

async function handleHelpIntent(conversation: any) {
  const isGroupChat = conversation instanceof Group;

  const groupPoolFeatures = isGroupChat
    ? `

👥 Group Pool Features:
• "buy 5 tickets for group pool" - Purchase through shared pool
• "pool status" - Check active group pools
• "explain ticket types" - Learn solo vs pool differences
• Pool purchases share costs and winnings proportionally
• Use "Buy for Group Pool" button for pool purchases`
    : `

🎫 Solo Ticket Features:
• Individual purchases with 100% ownership
• "buy X tickets" - Purchase solo tickets
• Join a group chat to access pool purchase options`;

  const smartFeatures = `

🤖 Enhanced AI Features:
• Natural conversation understanding
• Context-aware responses and confirmations
• Multi-step purchase flow with confirmations
• Intelligent number parsing ("seven", "a ticket", etc.)
• Remembers your intent between messages

💬 Smart Examples:
• "I want to buy some lottery tickets" → AI asks how many
• "Seven" → AI understands you want 7 tickets  
• "Yes" → Confirms pending purchase
• "buy me a ticket" → AI infers 1 ticket
• "Continue with purchase" → Processes confirmation`;

  const helpMessage = `🤖 Smart MegaPot Lottery Agent

🎰 AI-powered lottery assistant with advanced natural language understanding!${smartFeatures}${groupPoolFeatures}

🎯 Quick Commands:
🎫 "buy X tickets" - Purchase individual tickets
📊 "stats" or "my stats" - View your statistics
🎰 "jackpot" or "prize info" - Current round details  
💰 "claim" or "winnings" - Claim any prizes
🎯 "explain ticket types" - Learn about solo vs pool options
❓ "help" - Show this help message

🔄 Transaction Flow:
1. Tell me how many tickets you want
2. I'll ask for confirmation with cost details
3. Say "yes" or "approve" to proceed
4. Open your wallet to complete the transaction

⚠️ Requirements:
• USDC on Base network for purchases
• Connected wallet for transaction approval

🌐 Full web experience: https://frame.megapot.io`;

  await conversation.send(helpMessage);
  await sendMegaPotActions(conversation);
}

async function sendMegaPotActions(conversation: any) {
  const isGroupChat = conversation instanceof Group;

  const actions = [
    {
      id: "buy-tickets",
      label: "🎫 Buy Tickets",
      style: "primary" as const,
    },
    {
      id: "check-stats",
      label: "📊 My Stats",
      style: "secondary" as const,
    },
    {
      id: "jackpot-info",
      label: "🎰 Jackpot Info",
      style: "secondary" as const,
    },
    {
      id: "claim-winnings",
      label: "💰 Claim Winnings",
      style: "primary" as const,
    },
  ];

  // Always show group pool button in group chats
  if (isGroupChat) {
    actions.splice(1, 0, {
      id: "buy-pool-tickets",
      label: "🎯 Buy for Group Pool",
      style: "primary" as const,
    });
  }

  // Add pool status button in group chats
  if (isGroupChat) {
    actions.splice(2, 0, {
      id: "pool-status",
      label: "📊 Pool Status",
      style: "secondary" as const,
    });
  }

  actions.push(
    {
      id: "explain-ticket-types",
      label: "🎯 Solo vs Pool",
      style: "secondary" as const,
    },
    {
      id: "view-past-results",
      label: "📈 Past Results",
      style: "secondary" as const,
    },
    {
      id: "show-help",
      label: "❓ Help",
      style: "secondary" as const,
    },
  );

  const actionsContent: ActionsContent = {
    id: `megapot-smart-actions-${Date.now()}`,
    description: isGroupChat
      ? "🤖 Smart MegaPot lottery assistant. Individual or group pool purchases:"
      : "🤖 Smart MegaPot lottery assistant. Choose an action:",
    actions,
  };

  console.log("🎯 Sending Smart MegaPot inline actions");
  await conversation.send(actionsContent, ContentTypeActions);
}

// Helper function to parse ticket numbers from text
function parseTicketNumber(text: string): number | null {
  const wordToNumber: { [key: string]: number } = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
  };

  const lowerText = text.toLowerCase();
  if (wordToNumber[lowerText]) {
    return wordToNumber[lowerText];
  }

  const parsed = parseInt(text);
  return isNaN(parsed) ? null : parsed;
}

// Run the smart agent
main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
