// secure-messaging-server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

// Server storage for users and messages
const serverStorage = {
  users: {},
  messages: {}
};

// Simple file-based persistence
const storageFile = path.join(__dirname, 'server-storage.json');

// Load existing data if available
try {
  if (fs.existsSync(storageFile)) {
    const data = JSON.parse(fs.readFileSync(storageFile, 'utf8'));
    serverStorage.users = data.users || {};
    serverStorage.messages = data.messages || {};
    console.log('Loaded existing server storage');
  }
} catch (error) {
  console.error('Error loading storage:', error.message);
}

// Save data periodically
function saveStorage() {
  try {
    fs.writeFileSync(storageFile, JSON.stringify(serverStorage), 'utf8');
    console.log('Server storage saved');
  } catch (error) {
    console.error('Error saving storage:', error.message);
  }
}

// Create HTTP server
const server = http.createServer((req, res) => {
  let body = '';
  
  req.on('data', chunk => {
    body += chunk.toString();
  });
  
  req.on('end', () => {
    try {
      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      // Handle OPTIONS request for CORS
      if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
      }
      
      // Handle different routes
      if (req.url === '/register' && req.method === 'POST') {
        const userData = JSON.parse(body);
        serverStorage.users[userData.userId] = userData;
        console.log(`User registered: ${userData.userId}`);
        
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
        
        saveStorage();
      }
      else if (req.url === '/get-user' && req.method === 'POST') {
        const { userId } = JSON.parse(body);
        const userData = serverStorage.users[userId];
        
        res.statusCode = userData ? 200 : 404;
        res.setHeader('Content-Type', 'application/json');
        
        if (userData) {
          res.end(JSON.stringify(userData));
        } else {
          res.end(JSON.stringify({ error: 'User not found' }));
        }
      }
      else if (req.url === '/send-message' && req.method === 'POST') {
        const message = JSON.parse(body);
        const recipient = message.recipient;
        
        if (!serverStorage.messages[recipient]) {
          serverStorage.messages[recipient] = [];
        }
        
        serverStorage.messages[recipient].push(message);
        console.log(`Message sent to ${recipient}`);
        
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
        
        saveStorage();
      }
      else if (req.url === '/get-messages' && req.method === 'POST') {
        const { userId } = JSON.parse(body);
        const messages = serverStorage.messages[userId] || [];
        
        // Clear the messages after retrieving
        serverStorage.messages[userId] = [];
        
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ messages }));
        
        saveStorage();
      }
      else if (req.url === '/list-users' && req.method === 'GET') {
        const userList = Object.keys(serverStorage.users);
        
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ users: userList }));
      }
      else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      console.error('Server error:', error);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Server error' }));
    }
  });
});

// Start the server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Secure Messaging Server running on port ${PORT}`);
  console.log(`Server URL: http://localhost:${PORT}`);
});
