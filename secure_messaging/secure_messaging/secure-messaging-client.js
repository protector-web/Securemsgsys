// secure-messaging-client.js (With Session Persistence)
const { SecureMessaging } = require('./secure-messaging-system');
const readline = require('readline');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Server configuration
const SERVER_URL = 'http://localhost:3000';

/**
 * Make an HTTP request to the server
 * @param {string} endpoint - API endpoint
 * @param {Object} data - Data to send
 * @returns {Promise<Object>} Server response
 */
async function makeRequest(endpoint, data = null, method = 'POST') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: endpoint,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const req = http.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(responseData);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsedData);
          } else {
            reject(new Error(parsedData.error || 'Request failed'));
          }
        } catch (error) {
          reject(new Error('Failed to parse response'));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(new Error(`Request error: ${error.message}`));
    });
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

/**
 * SecureMessagingClient - A client interface for the secure messaging system
 */
class SecureMessagingClient {
  constructor(userId) {
    this.userId = userId;
    this.messaging = new SecureMessaging();
    this.activeSessions = new Map();
    this.sessionFilePath = path.join(__dirname, `${userId}-sessions.json`);
  }

  /**
   * Save sessions to a file
   */
  saveSessionsToFile() {
    try {
      // Convert Map to object for serialization
      const sessions = {};
      this.activeSessions.forEach((sessionId, userId) => {
        sessions[userId] = sessionId;
      });
      
      // Get session keys from the messaging instance
      const sessionData = {
        sessions,
        sessionKeys: Array.from(this.messaging.sessionKeys.entries())
      };
      
      fs.writeFileSync(this.sessionFilePath, JSON.stringify(sessionData), 'utf8');
    } catch (error) {
      console.error(`Failed to save sessions: ${error.message}`);
    }
  }

  /**
   * Load sessions from a file
   */
  loadSessionsFromFile() {
    try {
      if (fs.existsSync(this.sessionFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.sessionFilePath, 'utf8'));
        
        // Restore sessions
        this.activeSessions = new Map(Object.entries(data.sessions || {}));
        
        // Restore session keys in the messaging instance
        if (data.sessionKeys) {
          this.messaging.sessionKeys = new Map(data.sessionKeys);
        }
        
        console.log('Session data loaded from file');
      }
    } catch (error) {
      console.error(`Failed to load sessions: ${error.message}`);
    }
  }

  /**
   * Initialize the client
   */
  async initialize() {
    await this.messaging.initialize();
    this.loadSessionsFromFile();
    
    const registrationBundle = this.messaging.register(this.userId);
    
    try {
      // Register with the server
      await makeRequest('/register', registrationBundle);
      console.log(`Client ${this.userId} initialized and registered`);
    } catch (error) {
      console.error(`Registration failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * List all registered users
   */
  async listUsers() {
    try {
      const response = await makeRequest('/list-users', null, 'GET');
      return response.users.filter(user => user !== this.userId);
    } catch (error) {
      console.error(`Failed to list users: ${error.message}`);
      return [];
    }
  }

  /**
   * Start a session with another user
   * @param {string} recipientId - ID of the recipient
   * @returns {string} Session ID
   */
  async startSession(recipientId) {
    try {
      // Get recipient's bundle from server
      const recipientBundle = await makeRequest('/get-user', { userId: recipientId });
      
      const sessionId = this.messaging.establishSession(recipientId, recipientBundle);
      this.activeSessions.set(recipientId, sessionId);
      
      // Save the updated session data
      this.saveSessionsToFile();
      
      console.log(`Session established with ${recipientId}`);
      return sessionId;
    } catch (error) {
      console.error(`Failed to start session: ${error.message}`);
      throw new Error(`User ${recipientId} not found`);
    }
  }

  /**
   * Send a message to another user
   * @param {string} recipientId - ID of the recipient
   * @param {string} message - Message to send
   */
  async sendMessage(recipientId, message) {
    let sessionId = this.activeSessions.get(recipientId);
    
    if (!sessionId) {
      // Automatically establish a session if one doesn't exist
      try {
        sessionId = await this.startSession(recipientId);
      } catch (error) {
        throw error;
      }
    }
    
    const encryptedMessage = this.messaging.encryptMessage(sessionId, message);
    
    // Add sender information
    encryptedMessage.sender = this.userId;
    encryptedMessage.recipient = recipientId;
    encryptedMessage.timestamp = Date.now();
    
    try {
      // Send message to server
      await makeRequest('/send-message', encryptedMessage);
      
      // Save the updated session data after encryption
      this.saveSessionsToFile();
      
      console.log(`Message sent to ${recipientId}`);
    } catch (error) {
      console.error(`Failed to send message: ${error.message}`);
      throw error;
    }
  }

  /**
   * Receive and process messages
   */
  async receiveMessages() {
    try {
      // Get messages from server
      const response = await makeRequest('/get-messages', { userId: this.userId });
      const messages = response.messages || [];
      
      if (messages.length === 0) {
        console.log('No new messages');
        return [];
      }
      
      const decryptedMessages = [];
      
      for (const message of messages) {
        try {
          // Start a session if it doesn't exist yet
          if (!this.activeSessions.has(message.sender)) {
            try {
              const senderBundle = await makeRequest('/get-user', { userId: message.sender });
              const sessionId = this.messaging.establishSession(message.sender, senderBundle);
              this.activeSessions.set(message.sender, sessionId);
              
              // Save the updated session data
              this.saveSessionsToFile();
            } catch (error) {
              console.error(`Failed to establish session with ${message.sender}: ${error.message}`);
              continue;
            }
          }
          
          const decryptedMessage = this.messaging.decryptMessage(message);
          decryptedMessages.push({
            from: message.sender,
            content: decryptedMessage,
            timestamp: message.timestamp
          });
          
          // Save the updated session data after decryption
          this.saveSessionsToFile();
        } catch (error) {
          console.error(`Failed to decrypt message from ${message.sender}: ${error.message}`);
        }
      }
      
      return decryptedMessages;
    } catch (error) {
      console.error(`Failed to receive messages: ${error.message}`);
      return [];
    }
  }
}

/**
 * Interactive CLI client for the secure messaging system
 */
async function startInteractiveClient() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  console.log('Secure Messaging System');
  console.log('======================');
  
  rl.question('Enter your user ID: ', async (userId) => {
    try {
      const client = new SecureMessagingClient(userId);
      await client.initialize();
      
      console.log('\nCommands:');
      console.log('  send <userId> <message> - Send a message');
      console.log('  receive - Check for new messages');
      console.log('  users - List all registered users');
      console.log('  exit - Exit the application');
      console.log('');
      
      rl.prompt();
      
      rl.on('line', async (line) => {
        const [command, ...args] = line.trim().split(' ');
        
        try {
          switch (command.toLowerCase()) {
            case 'send': {
              const recipientId = args[0];
              const message = args.slice(1).join(' ');
              
              if (!recipientId || !message) {
                console.log('Usage: send <userId> <message>');
                break;
              }
              
              await client.sendMessage(recipientId, message);
              break;
            }
            
            case 'receive': {
              const messages = await client.receiveMessages();
              
              if (messages.length === 0) {
                console.log('No new messages');
              } else {
                console.log('\nNew Messages:');
                messages.forEach(msg => {
                  const date = new Date(msg.timestamp);
                  console.log(`[${date.toLocaleString()}] ${msg.from}: ${msg.content}`);
                });
              }
              break;
            }
            
            case 'users': {
              const users = await client.listUsers();
              
              if (users.length === 0) {
                console.log('No other users registered');
              } else {
                console.log('\nRegistered Users:');
                users.forEach(user => {
                  console.log(`- ${user}`);
                });
              }
              break;
            }
            
            case 'exit': {
              console.log('Goodbye!');
              rl.close();
              process.exit(0);
              break;
            }
            
            default:
              console.log('Unknown command. Available commands: send, receive, users, exit');
          }
        } catch (error) {
          console.error('Error:', error.message);
        }
        
        rl.prompt();
      });
    } catch (error) {
      console.error('Failed to initialize client:', error.message);
      console.log('Make sure the server is running at http://localhost:3000');
      rl.close();
    }
  });
}

module.exports = {
  SecureMessagingClient,
  startInteractiveClient
};

// Run the interactive client if this file is executed directly
if (require.main === module) {
  startInteractiveClient();
}