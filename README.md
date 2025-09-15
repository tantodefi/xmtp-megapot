# XMTP Smart MegaPot Agent

An AI-powered XMTP agent for MegaPot lottery with natural language understanding, contextual responses, and group pooled ticket purchases. This smart agent uses OpenAI GPT for intelligent message parsing and provides enhanced lottery experiences on Base network.

## 🤖 Smart Features

**AI-Powered Message Understanding**
- Natural language processing with OpenAI GPT-4o-mini
- Context-aware responses using real-time lottery data
- Intent recognition for ticket purchases, stats, help, and more
- Conversational interface - ask questions naturally!

**Enhanced Data Integration**
- Real-time lottery statistics from MegaPot API
- All-time jackpot data ($179M+ total jackpots!)
- Contextual responses with current jackpot and ticket info
- Smart recommendations based on user history

**Group Chat Features**
- Pooled ticket purchases in XMTP group chats
- Collaborative lottery ticket buying with friends
- Automatic contribution tracking and execution
- Fair cost sharing and collective ownership

## 🎰 Core Features

**Smart Lottery Ticket Purchasing**
- "I want to buy 5 lottery tickets" → AI understands and processes
- USDC payments on Base network (user-executed transactions)
- Real-time jackpot and pricing information
- Referrer system integration with automatic rewards

**Intelligent Statistics & Analytics**
- "Show me my lottery stats" → Contextual response with your data
- Track purchases, winnings, and odds
- All-time platform statistics integration
- Smart recommendations and insights

**Interactive Experience**
- Natural conversation flow with AI responses
- Action buttons for quick access to features
- Mini app integration at https://frame.megapot.io
- Real-time updates and notifications

## Setup

1. **Install dependencies:**
   ```bash
   yarn install
   ```

2. **Generate keys:**
   ```bash
   yarn gen:keys
   ```
   This will create a `.env` file with your wallet key and encryption key.

3. **Configure environment (optional):**
   You can edit the generated `.env` file to customize settings like network environment.

4. **Configure OpenAI API:**
   Add your OpenAI API key to the `.env` file:
   ```bash
   OPENAI_API_KEY=your_openai_api_key_here
   ```

5. **Start the agent:**
   ```bash
   yarn dev
   ```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `WALLET_KEY` | Private key for agent's wallet | Yes |
| `ENCRYPTION_KEY` | Database encryption key | Yes |
| `XMTP_ENV` | XMTP environment (dev/production) | Yes |
| `OPENAI_API_KEY` | OpenAI API key for smart features | Yes (for smart agent) |
| `MEGAPOT_CONTRACT_ADDRESS` | MegaPot contract address | Yes |
| `MEGAPOT_USDC_ADDRESS` | USDC contract address | Yes |
| `MEGAPOT_REFERRER_ADDRESS` | Referrer wallet address | Yes |
| `JACKPOT_POOL_CONTRACT_ADDRESS` | JackpotPool contract for group purchases | Yes |
| `MEGAPOT_DATA_API_KEY` | MegaPot API key for enhanced stats | No |
| `BASE_RPC_URL` | Base network RPC URL | No |

### MegaPot Contract Addresses

**Mainnet:**
```bash
MEGAPOT_CONTRACT_ADDRESS=0xbEDd4F2beBE9E3E636161E644759f3cbe3d51B95
MEGAPOT_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
JACKPOT_POOL_CONTRACT_ADDRESS=0xfb324c09c16b5f437ff612a4e8bc95b8fd6e6d5a
```

**Testnet:**
```bash
MEGAPOT_CONTRACT_ADDRESS=0x3368Fc551303aF78543DAA6A7D5Ea978cdB27D0A
MEGAPOT_USDC_ADDRESS=0xA4253E7C13525287C56550b8708100f93E60509f
```

## Usage

The smart agent uses AI-powered natural language understanding combined with XMTP's Agent-SDK for real-time message processing. Simply chat with the agent naturally!

### 🤖 Smart Conversation Examples

**Natural Ticket Purchasing:**
- "I want to buy 5 lottery tickets"
- "Can I purchase ten tickets please?"
- "Buy me some lottery tickets" → Agent asks how many

**Information Requests:**
- "What's the current jackpot?"
- "Show me my lottery history"
- "How much have I spent on tickets?"
- "What are my odds of winning?"

**Group Chat Pooled Purchases:**
- "Let's pool together for 20 tickets"
- "pool 10 tickets" → Starts group purchase
- "contribute $5" → Join the pool
- "I'll chip in $10" → Add to group purchase

### Transaction Flow

The agent uses a secure transaction delegation model:

1. **User Request**: Send "buy X tickets" to the agent
2. **Transaction Preparation**: Agent prepares USDC approval + ticket purchase transactions
3. **User Execution**: User sees inline buttons and executes transactions in their wallet
4. **Confirmation**: Agent confirms successful transaction execution

### Available Commands

The agent responds to natural language commands:

- **"ping"** - Test response ("ok")
- **"buy 5 tickets"** - Purchase lottery tickets (shows inline transaction buttons)
- **"my stats"** - View your lottery statistics
- **"jackpot info"** - Current jackpot information
- **"claim winnings"** - Claim lottery winnings
- **"gm" or "hello"** - Welcome message with mini app link
- **"help"** - Show available commands

### Inline Transaction Buttons

When purchasing tickets, users see interactive buttons in XMTP chat:

```
🎫 Ready to purchase 5 MegaPot tickets!
💰 Ticket Price: 1.00 USDC each
💰 Total Cost: 5.00 USDC

[Approve USDC] [Purchase Tickets]
```

These buttons use the `WalletSendCalls` content type to securely send transaction data to the user's wallet for execution.

### Event-Driven Features

- **Real-time Streaming**: Uses `client.conversations.streamAllMessages()` for live message processing
- **Money Bag Reactions**: Automatically reacts with 💰 to ALL messages
- **Smart Command Detection**: Recognizes commands through natural language processing
- **Secure Transactions**: Users execute transactions directly from their wallets
- **Content Type Support**: Proper `WalletSendCalls` codec for transaction proposals
- **Error Handling**: Comprehensive error handling with user-friendly messages
- **Message Filtering**: Filters out self-messages and non-text content

## Mini App Integration

The agent includes integration with the MegaPot Mini App at https://megapot.io for enhanced features:

- Real-time jackpot updates
- Advanced lottery analytics
- Enhanced purchasing experience
- Social features and leaderboards

### Mini App Link Sharing

The agent sends the mini app URL as a separate message to ensure proper metadata rendering in XMTP chat clients.

## Referrer System

The agent supports MegaPot's referrer system through the `MEGAPOT_REFERRER_ADDRESS` environment variable. When users purchase tickets through the agent, the referrer address is included in the transaction, allowing for proper fee distribution.

## Commands

- `yarn dev` - Start smart AI-powered agent with hot reload
- `yarn start` - Start agent in production
- `yarn build` - Build TypeScript
- `yarn gen:keys` - Generate new wallet and encryption keys
- `yarn lint` - Run linter

## Network Support

- **Testnet**: Base Sepolia
- **Mainnet**: Base Mainnet

Configure via the `XMTP_ENV` environment variable:
- `dev` - Testnet
- `production` - Mainnet

## API Integration

For enhanced statistics, set the `MEGAPOT_DATA_API_KEY`:
1. Visit MegaPot dashboard
2. Generate API key
3. Add to your `.env` file

## Architecture

```
src/
├── index.ts                    # Main smart agent entry point with AI and pooled purchases
├── handlers/
│   ├── smartHandler.ts        # AI-powered message processing with OpenAI
│   └── poolHandler.ts         # Group pooled ticket purchase management
├── managers/
│   └── MegaPotManager.ts      # Lottery management logic and transaction preparation
├── helpers/
│   └── client.ts              # Helper functions for client management
├── types/
│   ├── ActionsContent.ts      # Action button content types
│   └── IntentContent.ts       # Intent message content types
└── generateKeys.ts            # Key generation script
```

### Content Types Supported

- **WalletSendCalls**: For sending transaction proposals to user wallets
- **Reaction**: For emoji reactions to messages
- **RemoteAttachment**: For file attachments
- **Text**: Standard text messages

### Transaction Flow Architecture

```
User Message → Agent Processing → Transaction Preparation → WalletSendCalls → User Approval → Transaction Execution
```

### Security Model

- **No Agent Wallet Execution**: Agent never executes transactions on behalf of users
- **Transaction Delegation**: Users sign and execute all transactions themselves
- **Secure Content Types**: Uses XMTP's secure content type system
- **User Address Resolution**: Agent resolves user addresses from XMTP inbox IDs

## Error Handling

The agent includes comprehensive error handling for:
- Network failures and RPC timeouts
- Contract interaction errors (getCurrentDraw, ticketPrice)
- Insufficient funds (handled at wallet level)
- Transaction preparation failures
- XMTP content type encoding errors
- User address resolution failures
- API timeouts and authentication issues

### Transaction-Specific Error Handling

- **Contract Reverts**: Graceful fallback from `getCurrentDraw()` to `ticketPrice()`
- **User Wallet Errors**: Clear messaging when wallet interactions fail
- **Transaction Preparation**: Validation of ticket counts and amounts
- **Network Issues**: Automatic retry logic for transient failures

### User-Friendly Error Messages

All errors are presented with actionable guidance:
```
❌ Failed to prepare purchase: Contract interaction failed. Please try again later.
```

## Deployment

The agent is designed to run continuously and can be deployed to services like Railway, Render, or any Node.js hosting platform.

## License

MIT
