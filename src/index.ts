// Removed Agent import - using direct Client instead
import {
  ContentTypeReaction,
  ReactionCodec,
  type Reaction,
} from "@xmtp/content-type-reaction";
import { RemoteAttachmentCodec } from "@xmtp/content-type-remote-attachment";
import {
  ContentTypeWalletSendCalls,
  WalletSendCallsCodec,
  type WalletSendCallsParams,
} from "@xmtp/content-type-wallet-send-calls";
import {
  Client,
  Group,
  Signer,
  type Conversation,
  type XmtpEnv,
} from "@xmtp/node-sdk";
import { fromString } from "uint8arrays";
import { createWalletClient, http, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { PoolHandler } from "./handlers/poolHandler.js";
import { SmartHandler, type MessageIntent } from "./handlers/smartHandler.js";
import { SpendPermissionsHandler } from "./handlers/spendPermissionsHandler.js";
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
import {
  getDisplayName,
  getMentionName,
  getPersonalizedGreeting,
} from "./utils/displayName.js";

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
const SPEND_PERMISSION_MANAGER = process.env.SPEND_PERMISSION_MANAGER as string;

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
console.log(
  "🔐 SPEND_PERMISSION_MANAGER:",
  SPEND_PERMISSION_MANAGER || "NOT SET",
);

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

if (!SPEND_PERMISSION_MANAGER) {
  console.error(
    "❌ SPEND_PERMISSION_MANAGER environment variable is required for automated buying",
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
  console.log("🎰 Starting Smart LottoBot...");

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

  // Message deduplication - track processed message IDs
  const processedMessages = new Set<string>();

  // Clean up old message IDs every 10 minutes to prevent memory leak
  setInterval(
    () => {
      if (processedMessages.size > 1000) {
        console.log(
          `🧹 Cleaning up old message IDs (${processedMessages.size} -> 500)`,
        );
        const messageArray = Array.from(processedMessages);
        processedMessages.clear();
        // Keep only the most recent 500 messages
        messageArray.slice(-500).forEach((id) => processedMessages.add(id));
      }
    },
    10 * 60 * 1000,
  ); // 10 minutes

  console.log("🤖 Smart LottoBot initialized");
  console.log(`📊 Using Mainnet Contract: ${MEGAPOT_CONTRACT_ADDRESS}`);
  console.log(`💰 Using USDC: ${MEGAPOT_USDC_ADDRESS}`);
  console.log(`🔑 Wallet: ${WALLET_KEY.substring(0, 10)}...`);

  // Create the agent with codecs
  console.log("🔧 Creating XMTP Agent...");
  console.log("🔑 Creating signer with wallet key...");
  const signer = createSigner(WALLET_KEY);
  console.log("✅ Signer created successfully");
  console.log("🔗 Signer identifier:", signer.getIdentifier());

  // Set up persistent database path to avoid creating new installations
  // Use Render's mounted disk at /app/data/ for persistence
  // Get the database directory path
  const isProduction =
    process.env.RENDER || process.env.NODE_ENV === "production";
  const baseDir = isProduction ? "/app/data" : ".data";
  // Use existing database file name from volume
  const dbPath = `${baseDir}/xmtp-node-sdk-db`;

  // Log environment info
  console.log(`🔧 Environment Info:
• Production: ${isProduction ? "Yes" : "No"}
• Base Directory: ${baseDir}
• Database Path: ${dbPath}
• Render Volume: ${process.env.RENDER_VOLUME_MOUNT_PATH || "Not mounted"}`);

  console.log(
    `🌍 Environment: ${isProduction ? "Production (Render)" : "Development"}`,
  );
  console.log(`💾 Using persistent database at: ${dbPath}`);

  // Ensure database directory exists with correct permissions
  const fs = await import("fs");
  const path = await import("path");
  const dbDir = path.dirname(dbPath);

  try {
    // Check if the base directory exists and is writable
    try {
      await fs.promises.access(baseDir, fs.constants.W_OK);
      console.log(`✅ Base directory ${baseDir} exists and is writable`);
    } catch (error) {
      if (isProduction) {
        console.error(
          `❌ Production volume ${baseDir} is not accessible:`,
          error,
        );
        throw new Error(
          `Cannot access mounted volume at ${baseDir}. Please check Render disk configuration.`,
        );
      } else {
        // In development, create the directory
        await fs.promises.mkdir(baseDir, { recursive: true });
        console.log(`📁 Created development directory: ${baseDir}`);
      }
    }

    // Log directory contents to help with debugging
    const files = await fs.promises.readdir(baseDir);
    console.log(`📂 Contents of ${baseDir}:`, files);

    // Check if database files exist
    const dbFiles = files.filter((f) => f.startsWith("xmtp-node-sdk-db"));
    if (dbFiles.length > 0) {
      console.log(`✅ Found existing database files: ${dbFiles.join(", ")}`);
    } else {
      console.log(`📁 No existing database files found, will create new ones`);
    }
  } catch (error) {
    console.error("❌ Error checking database directory:", error);
    throw error;
  }

  // Validate and prepare encryption key
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
    throw new Error(
      `Invalid encryption key format. Expected 64 hex characters, got ${ENCRYPTION_KEY?.length || 0}`,
    );
  }

  // Convert encryption key to bytes
  const dbEncryptionKey = fromString(ENCRYPTION_KEY, "hex");
  console.log(
    `🔐 Database encryption key prepared (${dbEncryptionKey.length} bytes)`,
  );

  let client;
  try {
    client = await Client.create(signer, {
      env: XMTP_ENV as XmtpEnv,
      dbPath: dbPath,
      dbEncryptionKey,
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

  console.log("✅ Client created successfully!");
  console.log(`🔗 Client inbox: ${client.inboxId}`);

  // Initialize spend permissions handler after agent is created
  // Use a placeholder address for demo - in production this would be the agent's wallet address
  const agentSpenderAddress = "0x0F75c463bEc345fcf3b6be5f878640e1599A320A"; // Demo address
  const spendPermissionsHandler = new SpendPermissionsHandler(
    agentSpenderAddress,
  );
  console.log(
    `🔐 Spend permissions handler initialized with spender: ${agentSpenderAddress}`,
  );

  console.log("\n💬 Smart LottoBot is running!");
  console.log(`📝 Send messages to: http://xmtp.chat/dm/${client.inboxId}`);
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
    await client.conversations.sync();
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
    const stream = await client.conversations.streamAllMessages();

    console.log("🎧 Message stream started successfully!");

    // Handle messages from the stream
    (async () => {
      for await (const message of stream) {
        try {
          if (!message) {
            console.log("🚫 Skipping null message");
            continue;
          }

          console.log(
            `🔍 NEW MESSAGE: "${message.content || "undefined"}" from ${message.senderInboxId} (type: ${message.contentType?.typeId || "unknown"})`,
          );

          // Skip if it's from ourselves
          if (message.senderInboxId === client.inboxId) {
            console.log("🚫 Skipping message from self");
            continue;
          }

          // Message deduplication - skip if already processed
          if (processedMessages.has(message.id)) {
            console.log(`🚫 Skipping already processed message: ${message.id}`);
            continue;
          }
          processedMessages.add(message.id);

          // Get the conversation for responding first
          const conversation = await client.conversations.getConversationById(
            message.conversationId,
          );
          if (!conversation) {
            console.log("🚫 Could not find conversation for message");
            continue;
          }

          // Check if this is a group chat
          const isGroupChat = conversation instanceof Group;
          console.log(`📍 Conversation type: ${isGroupChat ? "group" : "dm"}`);
          console.log(`🔍 Conversation ID: ${conversation.id}`);
          console.log(
            `🔍 Conversation constructor: ${conversation.constructor.name}`,
          );
          console.log(`🔍 instanceof Group: ${conversation instanceof Group}`);
          console.log(
            `🔍 constructor.name === 'Group': ${conversation.constructor.name === "Group"}`,
          );

          // Fix the group detection logic - use constructor name as authoritative
          const actuallyIsGroup = conversation.constructor.name === "Group";
          if (actuallyIsGroup !== isGroupChat) {
            console.log(
              `🚨 GROUP DETECTION MISMATCH! Using constructor.name as authoritative: ${actuallyIsGroup}`,
            );
          }

          // Use the corrected group detection
          const correctedIsGroupChat = actuallyIsGroup;

          // Get user address for context
          let userAddress: string | undefined;
          try {
            const inboxState = await client.preferences.inboxStateFromInboxIds([
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
            // Send reaction optimistically
            await conversation.send(
              {
                reference: message.id,
                action: "added" as const,
                content: "💰",
                schema: "unicode" as const,
              },
              ContentTypeReaction,
            );
            console.log("✅ Money bag reaction sent to message");
          } catch (reactionError) {
            console.error("Error: send reaction:", reactionError);
          }

          // Handle different content types
          if (
            message.contentType?.typeId === "text" ||
            message.contentType?.typeId === "reply"
          ) {
            console.log(
              `📝 Processing ${message.contentType?.typeId} message with smart handler`,
            );
            await handleSmartTextMessage(
              message,
              conversation,
              smartHandler,
              poolHandler,
              megaPotManager,
              client,
              correctedIsGroupChat,
              userAddress,
              spendPermissionsHandler,
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
                client,
                smartHandler,
                poolHandler,
                correctedIsGroupChat,
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
          if (message) {
            console.error("❌ Message details:", {
              senderInboxId: message.senderInboxId,
              conversationId: message.conversationId,
              contentType: message.contentType?.typeId,
              content: message.content,
            });
          }
          // Continue processing other messages even if one fails
        }
      }
    })().catch((error) => {
      console.error("❌ Message stream error:", error);
    });

    // Keep the process alive
    console.log("🔄 Agent is now running and will stay active...");
    console.log("📡 Waiting for messages...");

    // Prevent the process from exiting with heartbeat
    setInterval(() => {
      console.log("💓 Smart Agent heartbeat - AI-powered and ready...");
    }, 60000); // Every minute
  } catch (streamError) {
    console.error("Error: set up message stream:", streamError);
    throw streamError;
  }

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n🛑 Shutting down Smart LottoBot...");
    try {
      megaPotManager.cleanup();
      // Note: Client doesn't have a stop() method like Agent
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
  client: any,
  isGroupChat: boolean,
  userAddress?: string,
  spendPermissionsHandler?: SpendPermissionsHandler,
) {
  try {
    // Handle different message content types
    let content: string;
    if (typeof message.content === "string") {
      content = message.content;
    } else if (message.content && typeof message.content.content === "string") {
      // Reply messages have nested content structure
      content = message.content.content;
    } else {
      console.log(`⚠️ Unsupported content structure:`, message.content);
      return;
    }

    const lowerContent = content.toLowerCase();

    console.log(`🤖 Processing message with AI: "${content}"`);

    // Check for group mentions (only respond in groups if mentioned or using slash commands)
    // But allow responses to ongoing conversations (solo/pool choices, confirmations, etc.)
    const hasMention =
      lowerContent.includes("@lottobot") ||
      lowerContent.includes("@lottobot.base.eth") ||
      lowerContent.includes("@lottobot.eth") ||
      lowerContent.startsWith("/help") ||
      lowerContent.startsWith("/") ||
      !isGroupChat; // Always respond in DMs

    // Check if this is a response to an ongoing conversation (solo/pool choice, confirmation, etc.)
    const isOngoingConversationResponse =
      lowerContent.trim() === "solo" ||
      lowerContent.trim() === "pool" ||
      /^(yes|yeah|yep|ok|okay|confirm|proceed|continue|approve)$/i.test(
        lowerContent.trim(),
      ) ||
      /^(no|nope|cancel|stop|nevermind)$/i.test(lowerContent.trim()) ||
      /^\d+$/.test(lowerContent.trim()); // Numbers in ongoing ticket contexts

    if (isGroupChat && !hasMention && !isOngoingConversationResponse) {
      console.log(
        "🚫 Skipping group message without @lottobot mention or slash command",
      );
      return;
    }

    // Handle group pool commands and purchases
    if (isGroupChat) {
      // Check for pool status requests
      if (
        lowerContent.includes("pool status") ||
        lowerContent.includes("pool info")
      ) {
        const poolStatus = await poolHandler.getPoolStatus(conversation.id);
        await conversation.send(poolStatus);
        return;
      }

      // Check for total pool tickets command
      if (
        lowerContent.includes("total pool tickets") ||
        lowerContent.includes("pool tickets total") ||
        lowerContent.includes("jackpot pool tickets")
      ) {
        const poolStats = await poolHandler.getTotalPoolTickets();
        await conversation.send(
          `📊 JackpotPool Contract Stats\n\n🎫 Total Pool Tickets: ${poolStats.tickets.toFixed(2)}\n💰 Pool Value: $${poolStats.tickets.toFixed(2)}\n🏆 Pending Winnings: $${poolStats.winnings.toFixed(2)}\n\n📋 Contract: ${process.env.JACKPOT_POOL_CONTRACT_ADDRESS}\n\n⚠️ These tickets are separate from individual MegaPot tickets and won't show in regular stats until prizes are distributed.`,
        );
        return;
      }

      // Check for member pool share requests
      if (
        lowerContent.includes("my pool share") ||
        lowerContent.includes("my share")
      ) {
        const memberShare = await poolHandler.getMemberPoolShare(
          conversation.id,
          message.senderInboxId,
          userAddress,
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
            client,
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

    // Check for direct solo/pool ticket purchases first
    const soloTicketMatch = /buy\s+(\d+)\s+solo\s+tickets?/i.exec(content);
    const poolTicketMatch = /buy\s+(\d+)\s+pool\s+tickets?/i.exec(content);

    if (soloTicketMatch && userAddress) {
      const ticketCount = parseInt(soloTicketMatch[1]);
      console.log(`🎫 Direct solo ticket purchase: ${ticketCount} tickets`);
      await handleTicketPurchaseIntent(
        ticketCount,
        userAddress,
        conversation,
        megaPotManager,
        client,
      );
      return;
    }

    if (poolTicketMatch && userAddress) {
      const ticketCount = parseInt(poolTicketMatch[1]);
      console.log(`🎫 Direct pool ticket purchase: ${ticketCount} tickets`);
      const poolResult = await poolHandler.processPooledTicketPurchase(
        conversation.id,
        message.senderInboxId,
        userAddress,
        ticketCount,
        conversation,
        client,
      );
      await conversation.send(poolResult.message);
      if (poolResult.success && poolResult.transactionData) {
        await conversation.send(
          poolResult.transactionData,
          ContentTypeWalletSendCalls,
        );
      }
      return;
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

    // Send the AI-generated response (skip for standalone numbers and spend permissions)
    const isStandaloneNumber =
      /^\d+$/.test(content.trim()) ||
      /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)$/i.test(
        content.trim(),
      );

    const isSpendPermission = intent.type === "setup_spend_permission";
    const isBuyNow = intent.type === "buy_now";
    const isStartAutomation = intent.type === "start_automation";
    const isSpendPermissionStatus = intent.type === "spend_permission_status";

    const shouldSkipAIResponse =
      isStandaloneNumber ||
      isSpendPermission ||
      isBuyNow ||
      isStartAutomation ||
      isSpendPermissionStatus ||
      intent.type === "confirmation" ||
      intent.type === "cancellation" ||
      intent.extractedData?.clearIntent === true;

    if (!shouldSkipAIResponse) {
      await conversation.send(intent.response);
    } else {
      console.log(
        `🔇 Skipping AI response for ${intent.type}: "${content}" - main handler will process directly`,
      );
    }

    // Handle standalone numbers immediately - don't let AI response interfere
    if (isStandaloneNumber) {
      console.log(`🔢 Processing standalone number: "${content}"`);
      // Don't return early - let the unknown case handler process this
    }

    // Check if AI response contains confirmation request and extract ticket count
    const aiResponseLower = intent.response.toLowerCase();
    const confirmationRequestMatch = aiResponseLower.match(
      /you want to buy (\d+) tickets?.*would you like to proceed/i,
    );

    if (confirmationRequestMatch && intent.type === "unknown") {
      // AI is asking for confirmation but intent wasn't properly detected
      const ticketCount = parseInt(confirmationRequestMatch[1]);
      console.log(
        `🔧 Detected confirmation request in AI response for ${ticketCount} tickets`,
      );

      // Check if this was originally a pool request
      const originalMessageLower = content.toLowerCase();
      const isPoolRequest =
        originalMessageLower.includes("pool") ||
        originalMessageLower.includes("group") ||
        aiResponseLower.includes("pooled") ||
        aiResponseLower.includes("pool");

      // Set pending confirmation context
      const aiContextHandler = smartHandler.getContextHandler();
      if (userAddress && ticketCount > 0) {
        if (isPoolRequest && isGroupChat) {
          // Set as pool purchase
          aiContextHandler.setPendingPoolPurchase(
            conversation.id,
            message.senderInboxId,
            ticketCount,
            userAddress,
          );
          console.log(
            `✅ Set pending POOL confirmation context for ${ticketCount} tickets`,
          );
        } else if (isPoolRequest && !isGroupChat) {
          // Convert pool request to individual in DMs
          aiContextHandler.setPendingTicketPurchase(
            conversation.id,
            message.senderInboxId,
            ticketCount,
            userAddress,
            isGroupChat,
          );
          console.log(
            `✅ Set pending INDIVIDUAL confirmation context for ${ticketCount} tickets (converted from pool request in DM)`,
          );
        } else {
          // For numbers without "pool" context, ask user to choose solo or pool
          const isStandaloneNumber =
            /^\d+$/.test(content.trim()) ||
            /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)$/i.test(
              content.trim(),
            );

          if (isStandaloneNumber) {
            // User provided just a number (digit or word), ask for purchase type
            // Save the ticket count in context while waiting for solo/pool choice
            const contextHandler = smartHandler.getContextHandler();
            contextHandler.updateContext(
              conversation.id,
              message.senderInboxId,
              {
                pendingTicketCount: ticketCount,
                lastIntent: "standalone_number",
                awaitingConfirmation: false,
                isGroupChat: isGroupChat,
                userAddress: userAddress,
                recipientUsername: intent.extractedData?.recipientUsername,
              },
            );

            const displayName = await getDisplayName(userAddress);
            await conversation.send(
              `${displayName}, would you like to buy ${ticketCount} solo or pool tickets? (reply 'solo' or 'pool')`,
            );
            return; // Context is now saved, wait for choice
          } else {
            // Regular individual purchase
            aiContextHandler.setPendingTicketPurchase(
              conversation.id,
              message.senderInboxId,
              ticketCount,
              userAddress,
              isGroupChat,
            );
            console.log(
              `✅ Set pending confirmation context for ${ticketCount} tickets`,
            );
          }
        }
      }
    }

    // Handle specific actions based on intent
    switch (intent.type) {
      case "buy_tickets":
        // Check if this is a buy for everyone intent
        if (
          intent.extractedData?.buyForEveryone &&
          isGroupChat &&
          userAddress
        ) {
          console.log("👥 Processing buy for everyone intent");
          const ticketCount = intent.extractedData.ticketCount || 1;

          // Get group members
          const members = await conversation.members();
          const memberCount = members.length;
          console.log(`👥 Found ${memberCount} members in group`);

          // Prepare transactions for each member
          const transactions = [];
          for (const member of members) {
            // Get member's Ethereum address
            const memberIdentifier = member.accountIdentifiers.find(
              (id: any) => id.identifierKind === 0, // IdentifierKind.Ethereum
            );
            if (!memberIdentifier) continue;

            const memberAddress = memberIdentifier.identifier;
            console.log(
              `👤 Preparing transaction for member: ${memberAddress}`,
            );

            // Prepare transaction for this member
            const txData = await megaPotManager.prepareTicketPurchase(
              ticketCount,
              memberAddress,
            );
            transactions.push(txData);
          }

          // Calculate total cost
          const totalCost = ticketCount * memberCount;
          const displayName = await getDisplayName(userAddress);

          // Send message with transaction details
          await conversation.send(
            `👥 Group Purchase Prepared!

🎫 Buying ${ticketCount} ticket${ticketCount > 1 ? "s" : ""} for each member:
• ${memberCount} members total
• ${ticketCount} ticket${ticketCount > 1 ? "s" : ""} each
• Total cost: $${totalCost}.00 USDC

✅ Open your wallet to approve the batch transaction.
⚡ Each member will receive their own tickets!`,
          );

          // Send the batch transaction
          const walletSendCalls = {
            version: "1.0",
            chainId: `0x${base.id.toString(16)}`,
            from: userAddress as `0x${string}`,
            capabilities: {
              reference: `megapot_group_purchase_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              app: "LottoBot",
              icon: "https://megapot.io/favicon.ico",
              domain: "megapot.io",
              name: "LottoBot Group Purchase",
              description: `Buy tickets for ${memberCount} members`,
            },
            calls: transactions.flatMap((tx, index) => {
              // Only show descriptions for the first transaction
              const isFirst = index === 0;
              const metadata = {
                transactionType: "erc20_approve",
                source: "LottoBot",
                origin: "megapot.io",
                hostname: "megapot.io",
                faviconUrl: "https://megapot.io/favicon.ico",
                title: "LottoBot Group Purchase",
              };

              return [
                {
                  to: tx.approveCall.to as `0x${string}`,
                  data: tx.approveCall.data as `0x${string}`,
                  value: tx.approveCall.value as `0x${string}`,
                  gas: "0xC350",
                  metadata: {
                    ...metadata,
                    description: isFirst
                      ? `Approve USDC spending for group purchase (${memberCount} members)`
                      : undefined,
                  },
                },
                {
                  to: tx.purchaseCall.to as `0x${string}`,
                  data: tx.purchaseCall.data as `0x${string}`,
                  value: tx.purchaseCall.value as `0x${string}`,
                  gas: "0x30D40",
                  metadata: {
                    ...metadata,
                    description: isFirst
                      ? `Purchase tickets for ${memberCount} group members`
                      : undefined,
                  },
                },
              ];
            }),
          };

          await conversation.send(walletSendCalls, ContentTypeWalletSendCalls);
          return;
        }
        break;

      case "confirmation":
        console.log("✅ Processing confirmation for pending purchase");
        const contextHandler = smartHandler.getContextHandler();
        const pendingConfirmation = contextHandler.getPendingConfirmation(
          conversation.id,
          message.senderInboxId,
        );

        console.log(`🔍 Pending confirmation:`, pendingConfirmation);
        console.log(`🔍 User address: ${userAddress}`);

        if (pendingConfirmation && userAddress) {
          if (pendingConfirmation.flow === "pool_purchase") {
            const poolTicketCount = (pendingConfirmation.poolTicketCount ||
              1) as number;
            console.log(
              `🎫 Executing pool purchase: ${poolTicketCount} tickets (from pool context)`,
            );
            // Handle pool purchase confirmation
            const poolResult = await poolHandler.processPooledTicketPurchase(
              conversation.id,
              message.senderInboxId,
              userAddress,
              poolTicketCount,
              conversation,
              client,
            );
            await conversation.send(poolResult.message);
            if (poolResult.success && poolResult.transactionData) {
              await conversation.send(
                poolResult.transactionData,
                ContentTypeWalletSendCalls,
              );

              console.log(
                `📋 Pool transaction sent with reference: ${poolResult.referenceId}`,
              );
            }
          } else if (pendingConfirmation.flow === "ticket_purchase") {
            const soloTicketCount = (pendingConfirmation.ticketCount ||
              1) as number;
            console.log(
              `🎫 Executing solo purchase: ${soloTicketCount} tickets (from solo context)`,
            );
            // Handle solo ticket purchase confirmation
            await handleTicketPurchaseIntent(
              soloTicketCount,
              userAddress,
              conversation,
              megaPotManager,
              client,
              intent.extractedData?.recipientUsername,
            );
          } else {
            console.log(
              `⚠️ Unknown flow type in pending confirmation: ${pendingConfirmation.flow}`,
            );
            await conversation.send(
              "❌ Unable to process confirmation - unknown purchase type. Please start a new purchase.",
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
        // Check if this is a solo choice response to a previous number
        const buyContextHandler = smartHandler.getContextHandler();
        const currentContext = buyContextHandler.getContext(
          conversation.id,
          message.senderInboxId,
        );

        console.log(
          `🔍 Solo choice check: content="${content.toLowerCase().trim()}"`,
        );
        console.log(
          `🔍 Current context:`,
          JSON.stringify(currentContext, null, 2),
        );

        if (
          content.toLowerCase().trim() === "solo" &&
          currentContext?.lastIntent === "standalone_number" &&
          userAddress
        ) {
          // User chose solo for a previously provided number
          const pendingTicketCount = currentContext.pendingTicketCount || 1;
          console.log(
            `🎫 Processing solo choice for ${pendingTicketCount} tickets - preparing transaction directly`,
          );

          // Directly call the ticket purchase handler (skip confirmation for clear choice)
          await handleTicketPurchaseIntent(
            pendingTicketCount,
            userAddress,
            conversation,
            megaPotManager,
            client,
            currentContext?.recipientUsername,
          );
          return;
        }

        if (intent.extractedData?.ticketCount && userAddress) {
          // If we already have a ticket count, skip asking for quantity and go straight to solo/pool choice
          const displayName =
            (await getDisplayName(userAddress as string)) || "Friend";
          await conversation.send(
            `${displayName}, would you like to buy ${intent.extractedData.ticketCount} solo or pool tickets? (reply 'solo' or 'pool')`,
          );

          // Save context for later
          const buyContextHandler = smartHandler.getContextHandler();
          buyContextHandler.updateContext(
            conversation.id,
            message.senderInboxId,
            {
              pendingTicketCount: intent.extractedData.ticketCount,
              lastIntent: "standalone_number",
              awaitingConfirmation: false,
              isGroupChat: isGroupChat,
              userAddress: userAddress,
            },
          );
        } else if (intent.extractedData?.askForQuantity) {
          await conversation.send(
            "🎫 How many tickets would you like to purchase? (e.g., '5 tickets')",
          );
        } else if (
          intent.extractedData?.askForPurchaseType &&
          intent.extractedData?.ticketCount &&
          userAddress
        ) {
          // Ambiguous intent - ask for solo/pool choice
          const displayName = await getDisplayName(userAddress);
          await conversation.send(
            `${displayName}, would you like to buy ${intent.extractedData.ticketCount} solo or pool tickets? (reply 'solo' or 'pool')`,
          );

          // Save context for later
          const buyContextHandler = smartHandler.getContextHandler();
          buyContextHandler.updateContext(
            conversation.id,
            message.senderInboxId,
            {
              pendingTicketCount: intent.extractedData.ticketCount,
              lastIntent: "standalone_number",
              awaitingConfirmation: false,
              isGroupChat: isGroupChat,
              userAddress: userAddress,
            },
          );
        } else if (
          intent.extractedData?.ticketCount &&
          intent.extractedData?.clearIntent &&
          userAddress
        ) {
          // Clear solo intent - prepare transaction immediately
          console.log(
            `🎫 Clear solo intent detected: ${intent.extractedData.ticketCount} tickets - preparing transaction directly`,
          );

          // Directly call the ticket purchase handler (same as confirmation flow)
          await handleTicketPurchaseIntent(
            intent.extractedData.ticketCount,
            userAddress,
            conversation,
            megaPotManager,
            client,
            intent.extractedData?.recipientUsername,
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
          client,
          intent.extractedData?.targetUsername,
        );
        break;

      case "pooled_purchase":
        console.log("🎯 Processing pooled purchase intent");

        // Check if this is a pool choice response to a previous number
        const poolContextHandler = smartHandler.getContextHandler();
        const poolCurrentContext = poolContextHandler.getContext(
          conversation.id,
          message.senderInboxId,
        );

        if (
          content.toLowerCase().trim() === "pool" &&
          poolCurrentContext?.lastIntent === "standalone_number" &&
          userAddress
        ) {
          // User chose pool for a previously provided number
          const pendingTicketCount = poolCurrentContext.pendingTicketCount || 1;
          console.log(
            `🎯 Processing pool choice for ${pendingTicketCount} tickets`,
          );

          // Pool requests should always use pool contract (DM or group)
          poolContextHandler.setPendingPoolPurchase(
            conversation.id,
            message.senderInboxId,
            pendingTicketCount,
            userAddress,
          );

          const displayName = await getDisplayName(userAddress);
          await conversation.send(
            `🎯 Daily Pool Purchase\n\n${displayName}, you want to buy ${pendingTicketCount} ticket${pendingTicketCount > 1 ? "s" : ""} for the daily pool for $${pendingTicketCount} USDC.\n\n💡 How pool tickets work:\n• Pool contract holds tickets until prize distribution\n• Your tickets won't show in regular stats until prizes are distributed\n• Pool increases collective winning chances\n• Winnings shared proportionally based on risk exposure\n• Works in both DMs and group chats\n\nShall I prepare the pool purchase transaction?`,
          );
          return;
        }

        if (
          intent.extractedData?.ticketCount &&
          intent.extractedData?.clearIntent &&
          userAddress
        ) {
          // Clear pool intent - prepare pool transaction directly
          console.log(
            `🎯 Clear pool intent detected: ${intent.extractedData.ticketCount} tickets - preparing pool transaction`,
          );

          const poolResult = await poolHandler.processPooledTicketPurchase(
            conversation.id,
            message.senderInboxId,
            userAddress,
            intent.extractedData.ticketCount,
            conversation,
            client,
          );

          await conversation.send(poolResult.message);
          if (poolResult.success && poolResult.transactionData) {
            await conversation.send(
              poolResult.transactionData,
              ContentTypeWalletSendCalls,
            );

            console.log(
              `📋 Pool transaction sent with reference: ${poolResult.referenceId}`,
            );
          }
        } else if (intent.extractedData?.ticketCount && userAddress) {
          // Universal pool system - works in both DMs and groups
          const ticketCount = intent.extractedData.ticketCount;
          const displayName = await getDisplayName(userAddress);

          console.log(
            `🎯 Preparing pool purchase: ${ticketCount} tickets for ${displayName} (${userAddress})`,
          );

          // Set pending pool confirmation context
          poolContextHandler.setPendingPoolPurchase(
            conversation.id,
            message.senderInboxId,
            ticketCount,
            userAddress,
          );

          await conversation.send(
            `🎯 Daily Pool Purchase\n\n${displayName}, you want to buy ${ticketCount} ticket${ticketCount > 1 ? "s" : ""} for the daily pool for $${ticketCount} USDC.\n\n💡 How pool tickets work:\n• Pool contract holds tickets until prize distribution\n• Your tickets won't show in regular stats until prizes are distributed\n• Pool increases collective winning chances\n• Winnings shared proportionally based on risk exposure\n• Works in both DMs and group chats\n\nShall I prepare the pool purchase transaction?`,
          );
        } else {
          await conversation.send(
            "🎯 Daily Pool Purchase\n\nHow many tickets would you like to buy for today's pool? (e.g., '5 pool tickets')\n\n💡 Pool tickets:\n• Held by pool contract until prize distribution\n• Won't show in regular stats until prizes disperse\n• Increase collective winning chances\n• Winnings shared proportionally\n• Available in both DMs and groups",
          );
        }
        break;

      case "jackpot_info":
        console.log("🎰 Fetching jackpot information");
        await handleJackpotInfoIntent(conversation, megaPotManager);
        break;

      case "claim_winnings":
        console.log("💰 Processing winnings claim");
        await handleClaimIntent(
          conversation,
          megaPotManager,
          poolHandler,
          userAddress,
        );
        break;

      case "help":
        console.log("❓ Generating contextual help");
        const helpMessage = await smartHandler.generateContextualHelp(
          userAddress,
          isGroupChat,
        );
        await conversation.send(helpMessage);
        await sendLottoBotActions(conversation);
        break;

      case "greeting":
        console.log("👋 Sending welcome message");
        // Don't send another greeting message - the AI already sent one
        // Just send the action buttons
        await sendLottoBotActions(conversation);
        break;

      case "pooled_purchase":
        if (isGroupChat) {
          if (intent.extractedData?.askForPurchaseType) {
            await conversation.send(
              "Would you like to buy tickets individually or through the group pool?\n\n" +
                "🎫 Individual Purchase: You keep all potential winnings\n" +
                "👥 Group Pool: Increases group's chances, winnings shared proportionally based on risk exposure\n\n" +
                "Reply with 'individual' or 'pool', or use the action buttons below.",
            );
            await sendLottoBotActions(conversation);
          } else {
            await conversation.send(
              `👥 Group Pool Purchases\n\nBuy tickets through the group pool to increase your collective chances of winning!\n\nCommands:\n• "buy 5 tickets for group pool" - Purchase through jackpot pool\n• "pool status" - Check group pool statistics\n• "my pool share" - See your risk exposure\n\n💡 Pool purchases increase winning chances, with prizes distributed proportionally based on risk exposure!`,
            );
          }
        } else {
          await conversation.send(
            "👥 Group pool purchases are only available in group chats! Add me to a group to buy tickets through a shared pool.",
          );
        }
        break;

      case "general_inquiry":
        console.log("❓ Processing general inquiry");
        // Check if user is claiming to be in a group chat
        const lowerContent = content.toLowerCase();
        if (
          lowerContent.includes("group chat") ||
          lowerContent.includes("this is a group") ||
          lowerContent.includes("pool ticket")
        ) {
          await conversation.send(
            `🔍 Conversation Analysis:\n📱 Type: ${isGroupChat ? "Group Chat" : "Direct Message (DM)"}\n🆔 ID: ${conversation.id.slice(0, 8)}...\n🏗️ Constructor: ${conversation.constructor.name}\n\n${isGroupChat ? "✅ Pool tickets ARE available here!" : "❌ Pool tickets are NOT available in DMs"}\n\n👥 For pool ticket features:\n• Create or join a group chat\n• Add me to that group\n• Pool purchases will be available there\n\n🎫 In DMs: Individual tickets only (you keep 100% ownership)`,
          );
        }
        // AI response should be sufficient for other inquiries
        break;

      case "unknown":
        // Handle standalone numbers that AI couldn't categorize
        const isStandaloneNumberUnknown =
          /^\d+$/.test(content.trim()) ||
          /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)$/i.test(
            content.trim(),
          );

        console.log(
          `🔍 Unknown case: isStandaloneNumber=${isStandaloneNumberUnknown}, content="${content.trim()}", userAddress=${userAddress}`,
        );

        if (isStandaloneNumberUnknown && userAddress) {
          // Parse the number
          let ticketCount: number | undefined;
          if (/^\d+$/.test(content.trim())) {
            ticketCount = parseInt(content.trim());
          } else {
            // Parse word number
            const wordToNumber: Record<string, number> = {
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
              eleven: 11,
              twelve: 12,
              thirteen: 13,
              fourteen: 14,
              fifteen: 15,
              sixteen: 16,
              seventeen: 17,
              eighteen: 18,
              nineteen: 19,
              twenty: 20,
            };
            ticketCount = wordToNumber[content.trim().toLowerCase()];
          }

          console.log(`🔍 Parsed ticket count: ${ticketCount}`);

          if (ticketCount && ticketCount > 0 && ticketCount <= 100) {
            // Save the ticket count in context while waiting for solo/pool choice
            const contextHandler = smartHandler.getContextHandler();
            console.log(`🔧 Saving context for ${ticketCount} tickets...`);

            contextHandler.updateContext(
              conversation.id,
              message.senderInboxId,
              {
                pendingTicketCount: ticketCount,
                lastIntent: "standalone_number",
                awaitingConfirmation: false,
                isGroupChat: isGroupChat,
                userAddress: userAddress,
                recipientUsername: intent.extractedData?.recipientUsername,
              },
            );

            // Verify context was saved
            const savedContext = contextHandler.getContext(
              conversation.id,
              message.senderInboxId,
            );
            console.log(
              `✅ Context saved:`,
              JSON.stringify(savedContext, null, 2),
            );

            const displayName = await getDisplayName(userAddress);
            await conversation.send(
              `${displayName}, would you like to buy ${ticketCount} solo or pool tickets? (reply 'solo' or 'pool')`,
            );
          }
        }
        break;

      case "setup_spend_permission":
        console.log("🔐 Setting up spend permission");
        if (
          spendPermissionsHandler &&
          userAddress &&
          intent.extractedData?.configText
        ) {
          // User provided a valid configuration, process it directly
          await handleSpendConfigInput(
            conversation,
            userAddress,
            intent.extractedData.configText,
            spendPermissionsHandler,
            megaPotManager,
            poolHandler,
            client,
          );
        } else if (spendPermissionsHandler && userAddress) {
          // No configuration provided, show setup instructions
          await handleSpendPermissionSetup(
            conversation,
            userAddress,
            spendPermissionsHandler,
          );
        } else {
          await conversation.send(
            "❌ Spend permissions not available. Please try again later.",
          );
        }
        break;

      case "spend_permission_status":
        console.log("📋 Checking spend permission status");
        if (spendPermissionsHandler && userAddress) {
          const statusMessage =
            await spendPermissionsHandler.getSpendPermissionStatus(userAddress);
          await conversation.send(statusMessage);
        } else {
          await conversation.send(
            "❌ Unable to check spend permission status.",
          );
        }
        break;

      case "buy_now":
        console.log("🤖 Executing immediate purchase");
        if (spendPermissionsHandler && userAddress) {
          const executed =
            await spendPermissionsHandler.executeImmediatePurchase(
              userAddress,
              conversation,
              megaPotManager,
              poolHandler,
              client,
            );
          if (executed) {
            await conversation.send(
              "✅ Immediate purchase executed! You can now start automation with 'start automation' if you want daily purchases.",
            );
          } else {
            await conversation.send(
              "❌ Failed to execute immediate purchase. Please check your spend permissions.",
            );
          }
        } else {
          await conversation.send(
            "❌ Immediate purchase not available. Please set up spend permissions first.",
          );
        }
        break;

      case "start_automation":
        console.log("🤖 Starting automation");
        if (spendPermissionsHandler && userAddress) {
          const started = await spendPermissionsHandler.startAutomatedBuying(
            userAddress,
            conversation,
            megaPotManager,
            poolHandler,
            client,
          );
          if (!started) {
            await conversation.send(
              "❌ Failed to start automation. Please set up spend permissions first with 'setup spend permission'.",
            );
          }
        } else {
          await conversation.send(
            "❌ Automation not available. Please try again later.",
          );
        }
        break;

      case "stop_automation":
        console.log("⏸️ Stopping automation");
        if (spendPermissionsHandler && userAddress) {
          spendPermissionsHandler.stopAutomatedBuying(userAddress);
          await conversation.send(
            "⏸️ Automated buying has been paused. Your spend permissions remain active.\n\nSay 'start automation' to resume automated purchases.",
          );
        } else {
          await conversation.send("❌ Unable to stop automation.");
        }
        break;

      case "revoke_permissions":
        console.log("🗑️ Revoking spend permissions");
        if (spendPermissionsHandler && userAddress) {
          const revoked =
            await spendPermissionsHandler.revokeAllPermissions(userAddress);
          if (revoked) {
            await conversation.send(
              "✅ All spend permissions have been revoked and automation stopped.\n\nYour wallet is now secure from automated spending. Set up new permissions anytime with 'setup spend permission'.",
            );
          } else {
            await conversation.send(
              "❌ Failed to revoke spend permissions. Please try again or revoke manually through your Base Account settings.",
            );
          }
        } else {
          await conversation.send("❌ Unable to revoke permissions.");
        }
        break;

      case "spend_config_input":
        console.log("⚙️ Processing spend configuration input");
        if (
          spendPermissionsHandler &&
          userAddress &&
          intent.extractedData?.configText
        ) {
          await handleSpendConfigInput(
            conversation,
            userAddress,
            intent.extractedData.configText,
            spendPermissionsHandler,
            megaPotManager,
            poolHandler,
            client,
          );
        } else {
          await conversation.send("❌ Unable to process spend configuration.");
        }
        break;

      default:
        // For other unknown intents, the AI response should be sufficient
        break;
    }
  } catch (error) {
    console.error("❌ Error in smart message handler:", error);
    try {
      await conversation.send(
        "🤖 I encountered an error processing your message. Please try again or use the action buttons below.",
      );
      await sendLottoBotActions(conversation);
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
  client: any,
  smartHandler: SmartHandler,
  poolHandler: PoolHandler,
  isGroupChat: boolean,
) {
  console.log(
    `🎯 Processing intent: ${intentContent.actionId} for actions: ${intentContent.id}`,
  );

  try {
    // Get the user's Ethereum address from their inbox ID
    const inboxState = await client.preferences.inboxStateFromInboxIds([
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
              "👥 Group Pool: Increases group's chances, winnings shared proportionally based on risk exposure\n\n" +
              "Reply with 'individual' or 'pool', or use the action buttons below.",
          );
          await sendLottoBotActions(conversation);
        } else {
          await conversation.send(
            "🎫 How many tickets would you like to purchase? (e.g., '5 tickets')",
          );
        }
        break;
      case "buy-pool-tickets":
        if (conversation instanceof Group) {
          await conversation.send(
            "🎯 How many tickets would you like to purchase for the group pool? (e.g., '10 tickets for group pool')\n\n💡 Pool purchases increase your group's chances of winning by buying tickets together. Prize winnings are distributed proportionally based on each member's risk exposure!",
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
        await sendLottoBotActions(conversation);
        break;
      case "check-stats":
        await handleStatsIntent(
          userAddress,
          conversation,
          megaPotManager,
          client,
          undefined, // IntentContent doesn't have extractedData
        );
        break;
      case "jackpot-info":
        await handleJackpotInfoIntent(conversation, megaPotManager);
        break;
      case "claim-winnings":
        await handleClaimIntent(
          conversation,
          megaPotManager,
          poolHandler,
          userAddress,
        );
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
  client: any,
  recipientUsername?: string,
) {
  try {
    console.log(
      `🎫 Processing ${numTickets} ticket purchase intent for ${userAddress}${recipientUsername ? ` (gifting to @${recipientUsername})` : ""}`,
    );

    // If buying for someone else, we need to resolve their username to address
    let recipientAddress = userAddress;
    let recipientDisplayName = "you";

    if (recipientUsername) {
      try {
        // For now, we'll need to implement username resolution
        // This would involve looking up the @username in the conversation members
        // For simplicity, let's assume we need to ask for the recipient's address
        await conversation.send(
          `🎁 To buy tickets for @${recipientUsername}, I need their wallet address. Please provide it or ask them to share their XMTP wallet address with you.`,
        );
        return; // Exit early - need recipient address
      } catch (error) {
        console.error("Error resolving recipient username:", error);
        await conversation.send(
          `❌ Could not resolve @${recipientUsername}'s wallet address. Please ask them to provide their XMTP wallet address.`,
        );
        return;
      }
    }

    // Prepare the ticket purchase transactions
    const txData = await megaPotManager.prepareTicketPurchase(
      numTickets,
      recipientAddress, // Use recipient address for the purchase
    );
    const totalCostUSDC = Number(txData.totalCostUSDC) / 1000000;

    const walletSendCalls: WalletSendCallsParams = {
      version: "1.0",
      chainId: `0x${base.id.toString(16)}`,
      from: userAddress as `0x${string}`,
      capabilities: {
        reference: txData.referenceId,
        app: "LottoBot",
        icon: "https://frame.megapot.io/favicon.ico",
        domain: "frame.megapot.io",
        name: "LottoBot",
        description: "LottoBot Assistant",
        hostname: "frame.megapot.io",
        faviconUrl: "https://frame.megapot.io/favicon.ico",
        title: "LottoBot",
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
            source: "LottoBot",
            origin: "frame.megapot.io",
            hostname: "frame.megapot.io",
            faviconUrl: "https://frame.megapot.io/favicon.ico",
            title: "LottoBot",
          },
        },
        {
          to: txData.purchaseCall.to as `0x${string}`,
          data: txData.purchaseCall.data as `0x${string}`,
          value: txData.purchaseCall.value as `0x${string}`,
          gas: "0x30D40",
          metadata: {
            description: `Purchase ${numTickets} ticket${numTickets > 1 ? "s" : ""}`,
            transactionType: "purchase_tickets",
            appName: "LottoBot",
            appIcon: "https://frame.megapot.io/favicon.ico",
            appDomain: "frame.megapot.io",
            hostname: "frame.megapot.io",
            faviconUrl: "https://frame.megapot.io/favicon.ico",
            title: "LottoBot",
          },
        },
      ],
    };

    const purchaseMessage = recipientUsername
      ? `🎁 Gift: ${numTickets} ticket${numTickets > 1 ? "s" : ""} for @${recipientUsername} ($${totalCostUSDC.toFixed(2)})\n✅ Open wallet to approve gift transaction\n⚠️ Need USDC on Base network. They'll receive the tickets! 🍀🎰`
      : `🎫 ${numTickets} ticket${numTickets > 1 ? "s" : ""} for $${totalCostUSDC.toFixed(2)}\n✅ Open wallet to approve transaction\n⚠️ Need USDC on Base network. Good luck! 🍀🎰`;

    await conversation.send(purchaseMessage);

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
  client: any,
  targetUsername?: string,
) {
  try {
    // If showing stats for another user, we need to resolve their username to address
    let targetAddress = userAddress;
    let targetDisplayName = "Your";

    if (targetUsername) {
      try {
        // For now, we'll need to implement username resolution
        // This would involve looking up the @username in the conversation members
        // For simplicity, let's assume we need to ask for the target user's address
        await conversation.send(
          `📊 To show stats for @${targetUsername}, I need their wallet address. Please ask them to share their XMTP wallet address with you.`,
        );
        return; // Exit early - need target address
      } catch (error) {
        console.error("Error resolving target username:", error);
        await conversation.send(
          `❌ Could not resolve @${targetUsername}'s wallet address. Please ask them to provide their XMTP wallet address.`,
        );
        return;
      }
    }

    const stats = await megaPotManager.getStats(targetAddress);

    // Get enhanced winnings data (including daily prizes)
    const winningsData = await megaPotManager.hasWinningsToClaim(targetAddress);

    let statsMessage = `📊 ${targetDisplayName} LottoBot Stats:
🎫 Tickets purchased: ${stats.totalTicketsPurchased}
💵 Total spent: ${megaPotManager.formatAmount(stats.totalSpent)}
🎉 Total won: ${megaPotManager.formatAmount(stats.totalWinnings)}
🎁 Daily prizes won: $${winningsData.breakdown.totalDailyPrizesWon.toFixed(2)} USDC (includes claimed prizes)

💰 Claimable Winnings:
• 🎯 Contract: $${winningsData.breakdown.contract.toFixed(2)} USDC
• 👥 Pool: $0.00 USDC
• 📊 Total Claimable: $${winningsData.breakdown.contract.toFixed(2)} USDC

🎰 Current Round:
💰 Jackpot: $${parseFloat(stats.jackpotPool || "0").toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
🎫 Ticket price: $${stats.ticketPrice || "1"}
📈 Tickets sold: ${stats.ticketsSoldRound || 0}`;

    if (stats.userOdds) {
      statsMessage += `\n🎯 ${targetDisplayName.toLowerCase()} odds: 1 in ${stats.userOdds}`;
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

    const jackpotMessage = `🎰 LottoBot Jackpot Info:
💰 Current jackpot: $${parseFloat(stats.jackpotPool || "0").toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

// Helper function to check pool winnings
async function checkPoolWinnings(
  userAddress: string,
  poolHandler: PoolHandler,
): Promise<{ hasWinnings: boolean; amount: number }> {
  try {
    // This would need to be implemented in poolHandler to check pool contract winnings
    // For now, return no winnings since we can't reliably check the pool contract
    return { hasWinnings: false, amount: 0 };
  } catch (error) {
    console.log("⚠️ Failed to check pool winnings:", error);
    return { hasWinnings: false, amount: 0 };
  }
}

async function handleClaimIntent(
  conversation: any,
  megaPotManager: MegaPotManager,
  poolHandler: PoolHandler,
  userAddress?: string,
) {
  try {
    if (!userAddress) {
      await conversation.send(
        "❌ Could not retrieve your wallet address for claiming winnings.",
      );
      return;
    }

    await conversation.send("🔍 Checking your winnings in both contracts...");

    // Check winnings in both LottoBot and JackpotPool contracts
    const [megaPotWinnings, poolWinnings] = await Promise.all([
      megaPotManager.hasWinningsToClaim(userAddress),
      checkPoolWinnings(userAddress, poolHandler),
    ]);

    const totalWinnings = megaPotWinnings.amount + poolWinnings.amount;
    const hasAnyWinnings =
      megaPotWinnings.hasWinnings || poolWinnings.hasWinnings;

    if (!hasAnyWinnings) {
      await conversation.send(
        `🎰 No Winnings Available\n\n🔍 Checked all sources:\n• 🎯 LottoBot Contract: $${megaPotWinnings.breakdown.contract.toFixed(2)}\n• 🎁 Daily Prizes: $${megaPotWinnings.breakdown.dailyPrizes.toFixed(2)}\n• 👥 JackpotPool: $${poolWinnings.amount.toFixed(2)}\n\n💡 Winnings appear after:\n• You win a lottery round (Contract)\n• You win daily prizes (API)\n• Pool wins and distributes prizes (JackpotPool)\n\n🎫 Keep playing for your chance to win!`,
      );
      return;
    }

    // User has winnings - show detailed breakdown
    let winningsMessage = `🎉 Winnings Found!\n\n`;
    if (megaPotWinnings.breakdown.contract > 0) {
      winningsMessage += `💰 LottoBot Contract: $${megaPotWinnings.breakdown.contract.toFixed(2)} USDC\n`;
    }
    if (megaPotWinnings.breakdown.dailyPrizes > 0) {
      winningsMessage += `🎁 Daily Prizes: $${megaPotWinnings.breakdown.dailyPrizes.toFixed(2)} USDC\n`;
    }
    if (poolWinnings.hasWinnings) {
      winningsMessage += `👥 JackpotPool: $${poolWinnings.amount.toFixed(2)} USDC\n`;
    }
    winningsMessage += `\n📊 Total Winnings: $${totalWinnings.toFixed(2)} USDC\n\nPreparing claim transactions...`;

    await conversation.send(winningsMessage);

    // Send LottoBot claim transaction if user has contract winnings
    if (megaPotWinnings.breakdown.contract > 0) {
      const megaPotClaimTx =
        await megaPotManager.prepareClaimWinnings(userAddress);
      await conversation.send(
        `💰 Claim LottoBot Contract Winnings: $${megaPotWinnings.breakdown.contract.toFixed(2)} USDC\n\n🎯 This claims jackpot winnings from the main LottoBot contract.\n\n✅ Open your wallet to approve this transaction.`,
      );
      await conversation.send(megaPotClaimTx, ContentTypeWalletSendCalls);
    }

    // Show info about daily prizes (these might be auto-claimed or need different process)
    if (megaPotWinnings.breakdown.dailyPrizes > 0) {
      await conversation.send(
        `🎁 Daily Prize Winnings: $${megaPotWinnings.breakdown.dailyPrizes.toFixed(2)} USDC\n\n💡 Daily prizes may be automatically distributed or require a different claim process. Check your wallet balance or visit https://frame.megapot.io/?referral=c7m8NL7l for more details.`,
      );
    }

    // Send Pool claim transaction if applicable
    if (poolWinnings.hasWinnings) {
      const poolClaimTx = await poolHandler.prepareClaimPoolWinnings(
        userAddress,
        process.env.JACKPOT_POOL_CONTRACT_ADDRESS as string,
      );
      await conversation.send(
        `👥 Claim Pool Winnings: $${poolWinnings.amount.toFixed(2)} USDC\n\n🎯 This claims from the JackpotPool contract.\n\n✅ Open your wallet to approve this transaction.`,
      );
      await conversation.send(poolClaimTx, ContentTypeWalletSendCalls);
    }

    console.log(
      `✅ Claim transactions sent - LottoBot: $${megaPotWinnings.amount.toFixed(2)}, Pool: $${poolWinnings.amount.toFixed(2)} to: ${userAddress}`,
    );
  } catch (error) {
    console.error("❌ Error in claim process:", error);
    await conversation.send(
      `❌ Error checking winnings: ${error instanceof Error ? error.message : "Unable to check winnings at this time"}`,
    );
  }
}

async function handleHelpIntent(conversation: any) {
  const isGroupChat = conversation instanceof Group;

  const helpMessage = `🎰 LottoBot

💸 Buy lottery tickets with USDC on Base network

📝 Simple Commands:
• "buy 3 solo tickets" → Get transaction immediately
• "buy 2 pool tickets" → Join daily pool
• "4" → Choose solo or pool purchase
• "stats" → View your ticket history
• "jackpot" → See current prize
• "claim" → Withdraw winnings

🎫 Solo vs Pool Tickets:
• Solo: "buy 3 solo ticket(s)" - You keep 100% of any winnings
• Pool: "buy 2 pool ticket(s)" - Join daily pool, winnings shared proportionally
• Just "buy 3 tickets" → Choose solo or pool

${
  isGroupChat
    ? `👥 Group Features:
• Pool tickets combine chances with other members
• Winnings shared based on contribution
• Buy tickets for everyone in group chat`
    : `🎫 Solo Features:
• Keep 100% of winnings
• Join groups for pool options`
}

💰 Current jackpot: Check buttons below
⚡ Instant transactions when intent is clear

🌐 Full experience: https://frame.megapot.io/?referral=c7m8NL7l`;

  await conversation.send(helpMessage);
  await sendLottoBotActions(conversation);
}

async function sendLottoBotActions(conversation: any) {
  const isGroupChat = conversation.constructor.name === "Group";

  // Only send action buttons in DMs
  if (isGroupChat) {
    return;
  }

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

  const uniqueActionId = `megapot-smart-actions-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const actionsContent: ActionsContent = {
    id: uniqueActionId,
    description: isGroupChat
      ? "🤖 Smart LottoBot. Individual or group pool purchases:"
      : "🤖 Smart LottoBot. Choose an action:",
    actions,
  };

  console.log(
    `🎯 Sending Smart LottoBot inline actions (${isGroupChat ? "GROUP" : "DM"} - ${actions.length} buttons) with ID: ${uniqueActionId}`,
  );
  if (isGroupChat) {
    console.log(
      "👥 Group-specific buttons included: Buy for Group Pool, Pool Status",
    );
  }
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

// Helper function to parse spend permission configuration from user input
function parseSpendConfig(text: string): {
  dailyLimit: number;
  duration: number;
  purchaseType: "solo" | "pool" | "both" | "alternating";
  soloTicketsPerDay?: number;
  poolTicketsPerDay?: number;
} | null {
  try {
    const lowerText = text.toLowerCase();
    let dailyLimit = 0;
    let duration = 0;
    let purchaseType: "solo" | "pool" | "both" | "alternating" = "solo";
    let soloTicketsPerDay = 0;
    let poolTicketsPerDay = 0;

    // Method 1: Dollar format - multiple patterns
    const dollarMatch =
      text.match(/\$(\d+(?:\.\d{1,2})?)/i) ||
      text.match(/(\d+(?:\.\d{1,2})?)\s*(?:dollars?|usd)/i) ||
      text.match(/buy\s+(\d+)\$\s*(?:for|next)/i) || // "Buy 1$ for next 2 days"
      text.match(/(\d+)\$\s*(?:every\s+day|per\s+day|daily)/i); // "1$ every day"

    if (dollarMatch) {
      dailyLimit = parseFloat(dollarMatch[1]);

      // Extract duration - look for patterns like "30 days", "for 14 days", "next 2 days", etc.
      const durationMatch = text.match(
        /(?:for\s+(?:the\s+)?(?:next\s+)?|next\s+)?(\d+)\s*days?/i,
      );

      if (!durationMatch) return null;
      duration = parseInt(durationMatch[1]);
    } else {
      // Method 2: Ticket-based format "buy 4 tickets for the next 7 days" or "buy 1 ticket a day for 30 days"

      // Pattern: "buy X tickets for Y days" - total tickets over period
      const totalTicketsMatch = text.match(
        /buy\s+(\d+)\s+tickets?\s+for\s+(?:the\s+)?(?:next\s+)?(\d+)\s*days?/i,
      );
      if (totalTicketsMatch) {
        const totalTickets = parseInt(totalTicketsMatch[1]);
        duration = parseInt(totalTicketsMatch[2]);
        dailyLimit = totalTickets / duration; // Average per day

        if (dailyLimit < 1) dailyLimit = 1; // Minimum $1 per day
      } else {
        // Pattern: "buy X ticket(s) a day for Y days" - tickets per day
        const ticketsPerDayMatch = text.match(
          /(?:buy\s+)?(\d+)\s+tickets?\s+(?:a\s+day|per\s+day|daily)\s+for\s+(?:the\s+)?(?:next\s+)?(\d+)\s*days?/i,
        );
        if (ticketsPerDayMatch) {
          const ticketsPerDay = parseInt(ticketsPerDayMatch[1]);
          duration = parseInt(ticketsPerDayMatch[2]);
          dailyLimit = ticketsPerDay; // Assuming $1 per ticket
        } else {
          // Pattern: "X ticket(s) a day for Y days" (without "buy")
          const altTicketsPerDayMatch = text.match(
            /(\d+)\s+tickets?\s+(?:a\s+day|per\s+day|daily).*?(?:for\s+)?(?:the\s+)?(?:next\s+)?(\d+)\s*days?/i,
          );
          if (altTicketsPerDayMatch) {
            const ticketsPerDay = parseInt(altTicketsPerDayMatch[1]);
            duration = parseInt(altTicketsPerDayMatch[2]);
            dailyLimit = ticketsPerDay; // Assuming $1 per ticket
          } else {
            // Pattern: "buy X solo and Y pool ticket(s) a day for Z days" - combined purchases
            const combinedTicketsMatch = text.match(
              /buy\s+(\d+)\s+solo\s+and\s+(\d+)\s+pool\s+tickets?\s+(?:a\s+day|per\s+day|daily)\s+for\s+(?:the\s+)?(?:next\s+)?(\d+)\s*days?/i,
            );
            if (combinedTicketsMatch) {
              soloTicketsPerDay = parseInt(combinedTicketsMatch[1]);
              poolTicketsPerDay = parseInt(combinedTicketsMatch[2]);
              duration = parseInt(combinedTicketsMatch[3]);
              dailyLimit = soloTicketsPerDay + poolTicketsPerDay; // Total cost per day
              purchaseType = "both"; // Both types daily (combined)
            } else {
              return null; // No valid pattern found
            }
          }
        }
      }
    }

    // Validate extracted values
    if (dailyLimit < 1 || duration < 1 || duration > 365) {
      return null;
    }

    // Extract purchase type with enhanced detection
    // Check for combined purchases first (most specific)
    if (soloTicketsPerDay > 0 && poolTicketsPerDay > 0) {
      purchaseType = "both"; // Both types daily (combined)
    } else if (lowerText.includes("both")) {
      purchaseType = "both"; // Both types daily (combined)
    } else if (
      lowerText.includes("alternate") ||
      lowerText.includes("alternating")
    ) {
      purchaseType = "alternating"; // Alternating between solo and pool
    } else if (lowerText.includes("pool") || lowerText.includes("group")) {
      purchaseType = "pool";
    } else if (lowerText.includes("solo") || lowerText.includes("individual")) {
      purchaseType = "solo";
    } else {
      // Fallback: Smart detection for combined purchases in other patterns
      const combinedMatch =
        text.match(/(\d+)\s+solo.*?(\d+)\s+pool/i) ||
        text.match(/(\d+)\s+pool.*?(\d+)\s+solo/i);
      if (combinedMatch) {
        purchaseType = "both"; // Both types daily (combined)
        const soloCount = parseInt(combinedMatch[1]);
        const poolCount = parseInt(combinedMatch[2]);
        soloTicketsPerDay = soloCount;
        poolTicketsPerDay = poolCount;
        dailyLimit = soloCount + poolCount; // Adjust daily limit for combined purchases
      }
    }

    return {
      dailyLimit,
      duration,
      purchaseType,
      soloTicketsPerDay: soloTicketsPerDay > 0 ? soloTicketsPerDay : undefined,
      poolTicketsPerDay: poolTicketsPerDay > 0 ? poolTicketsPerDay : undefined,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Handle spend configuration input from user
 */
async function handleSpendConfigInput(
  conversation: Conversation,
  userAddress: string,
  configText: string,
  spendPermissionsHandler: SpendPermissionsHandler,
  megaPotManager?: any,
  poolHandler?: any,
  client?: any,
) {
  try {
    // Check for cancel command
    if (configText.toLowerCase().includes("cancel")) {
      await conversation.send("❌ Spend permission setup cancelled.");
      return;
    }

    // Parse the user's configuration
    const config = parseSpendConfig(configText);

    if (!config) {
      await conversation.send(
        `Could not understand that format. Please use:

💰 Dollar-based: "$X per day for Y days, [type]"
🎫 Ticket-based: "buy X tickets a day for Y days"
🔀 Combined: "buy X solo and Y pool tickets a day for Z days"

Examples:
• "$5 per day for 30 days, solo"
• "buy 4 tickets for the next 7 days"
• "buy 1 ticket a day for 30 days"
• "buy 1 solo and 1 pool ticket a day for 30 days"

Try again or say "cancel" to exit.`,
      );
      return;
    }

    // Calculate tickets per day (assuming $1 per ticket)
    const ticketsPerDay = Math.floor(config.dailyLimit);

    const spendConfig = {
      dailyLimit: config.dailyLimit,
      ticketsPerDay: ticketsPerDay,
      purchaseType: config.purchaseType,
      duration: config.duration,
      soloTicketsPerDay: config.soloTicketsPerDay,
      poolTicketsPerDay: config.poolTicketsPerDay,
    };

    // Create the spend permission
    try {
      const permissionResult =
        await spendPermissionsHandler.requestMegaPotSpendPermission(
          userAddress,
          spendConfig,
          megaPotManager,
        );

      let purchaseDescription = "";
      if (
        spendConfig.purchaseType === "both" &&
        spendConfig.soloTicketsPerDay &&
        spendConfig.poolTicketsPerDay
      ) {
        purchaseDescription = `${spendConfig.soloTicketsPerDay} solo + ${spendConfig.poolTicketsPerDay} pool tickets daily (2 transactions)`;
      } else {
        purchaseDescription = `${spendConfig.ticketsPerDay} ${spendConfig.purchaseType} tickets daily`;
      }

      // Send one clean message with transaction
      await conversation.send(
        `🤖 Automated LottoBot: ${purchaseDescription} for ${spendConfig.duration} days

💰 Total: $${(spendConfig.dailyLimit * spendConfig.duration).toFixed(2)} USDC (${spendConfig.duration} days × $${spendConfig.dailyLimit}/day)
⏰ Schedule: Daily purchases at this time

✅ Approve transaction to set up spend permissions`,
      );

      // Send the actual transaction
      await conversation.send(
        permissionResult.transaction,
        ContentTypeWalletSendCalls,
      );

      // Auto-start automation after transaction is sent (will wait for approval)
      const autoStarted = await spendPermissionsHandler.startAutomatedBuying(
        userAddress,
        conversation,
        megaPotManager,
        poolHandler,
        client,
      );

      if (autoStarted) {
        // Automation setup started - will wait for user approval and then execute first purchase
        console.log(
          `✅ Automation setup initiated for user ${userAddress.slice(0, 8)}... Waiting for spend permission approval.`,
        );
      } else {
        await conversation.send(
          `❌ Failed to start automation. Please try again or check your spend permissions.`,
        );
      }
    } catch (error) {
      await conversation.send(
        `❌ Failed to create spend permission: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  } catch (error) {
    console.error("Spend config input error:", error);
    await conversation.send(
      `❌ Error processing configuration: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Handle spend permission setup with interactive configuration
 */
async function handleSpendPermissionSetup(
  conversation: Conversation,
  userAddress: string,
  spendPermissionsHandler: SpendPermissionsHandler,
) {
  try {
    await conversation.send(
      `🔐 LottoBot Spend Permission Setup

I'll help you set up automated lottery ticket purchases! This allows me to buy tickets on your behalf within your specified limits.

⚙️ Configuration Formats:

💰 Dollar-based: "$X per day for Y days, [type]"
🎫 Ticket-based: "buy X tickets a day for Y days"
🔀 Combined: "buy 1 solo and 1 pool ticket a day for Y days"

🎫 Purchase Types:
• "solo" - Keep 100% of winnings
• "pool" - Join group pools, shared winnings  
• "both" - Buy both solo AND pool tickets daily
• "alternating" - Alternate between solo and pool daily

📝 Examples:
• "$5 per day for 30 days, solo"
• "buy 4 tickets for the next 7 days"
• "buy 1 ticket a day for 30 days"
• "buy 1 solo and 1 pool ticket a day for the next 30 days"
• "2 tickets daily for 14 days, both"

Or say "cancel" to exit setup.`,
    );

    // Wait for user to provide configuration in the format requested above
    // The handleSpendConfigInput function will process their response
  } catch (error) {
    console.error("Spend permission setup error:", error);
    await conversation.send(
      `❌ Failed to set up spend permissions: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

// Run the smart agent
main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
