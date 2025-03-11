// secure-messaging-system.js
const crypto = require('crypto');

/**
 * SecureMessaging - A simple implementation of a secure messaging system
 * incorporating concepts from Signal Protocol and Noise Framework
 */
class SecureMessaging {
  constructor() {
    // User's key pairs
    this.identityKeyPair = null;
    this.preKeyPair = null;
    this.oneTimePreKeys = [];
    
    // Session keys
    this.sessionKeys = new Map();
    
    // Message counter for preventing replay attacks
    this.messageCounter = 0;
  }

  /**
   * Generate a new key pair using RSA (more compatible than x25519)
   * @returns {Object} Object containing public and private keys
   */
  generateKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });
    
    return { publicKey, privateKey };
  }

  /**
   * Initialize the client with necessary key pairs
   */
  async initialize() {
    // Generate long-term identity key
    this.identityKeyPair = this.generateKeyPair();
    
    // Generate medium-term pre key
    this.preKeyPair = this.generateKeyPair();
    
    // Generate one-time pre keys (usually 100, using 5 for demonstration)
    for (let i = 0; i < 5; i++) {
      this.oneTimePreKeys.push(this.generateKeyPair());
    }
    
    console.log('Client initialized with keys');
  }

  /**
   * Register with the server
   * @param {string} userId - User identifier
   * @returns {Object} Registration bundle
   */
  register(userId) {
    if (!this.identityKeyPair) {
      throw new Error('Client not initialized');
    }
    
    // Create a bundle to send to the server
    const registrationBundle = {
      userId,
      identityKey: this.identityKeyPair.publicKey,
      preKey: this.preKeyPair.publicKey,
      oneTimePreKeys: this.oneTimePreKeys.map(key => key.publicKey),
      signature: this.sign(this.preKeyPair.publicKey, this.identityKeyPair.privateKey)
    };
    
    return registrationBundle;
  }

  /**
   * Sign data with a private key
   * @param {string} data - Data to sign
   * @param {string} privateKey - Private key for signing
   * @returns {string} Signature
   */
  sign(data, privateKey) {
    const sign = crypto.createSign('SHA256');
    sign.update(typeof data === 'string' ? data : JSON.stringify(data));
    sign.end();
    return sign.sign(privateKey, 'base64');
  }

  /**
   * Verify a signature
   * @param {string} data - Original data
   * @param {string} signature - Signature to verify
   * @param {string} publicKey - Public key for verification
   * @returns {boolean} True if signature is valid
   */
  verify(data, signature, publicKey) {
    const verify = crypto.createVerify('SHA256');
    verify.update(typeof data === 'string' ? data : JSON.stringify(data));
    verify.end();
    try {
      return verify.verify(publicKey, signature, 'base64');
    } catch (error) {
      console.error('Verification error:', error.message);
      return false;
    }
  }

  /**
   * Establish a session with another user
   * @param {string} recipientId - Recipient user ID
   * @param {Object} recipientBundle - Recipient's key bundle
   * @returns {string} Session ID
   */
  establishSession(recipientId, recipientBundle) {
    // Verify the signature of the preKey using the identity key
    const isValid = this.verify(
      recipientBundle.preKey,
      recipientBundle.signature,
      recipientBundle.identityKey
    );
    
    if (!isValid) {
      throw new Error('Invalid signature on recipient bundle');
    }
    
    // Select one of the one-time pre-keys
    const selectedOneTimePreKey = recipientBundle.oneTimePreKeys[0];
    
    // Generate a shared secret (simplified for compatibility)
    const sharedSecret = crypto.randomBytes(32);
    
    // Create a unique session ID
    const sessionId = `${this.generateRandomId()}-${recipientId}`;
    
    // Derive keys from the shared secret
    const { encryptionKey, macKey, chainKey } = this.deriveKeys(sharedSecret);
    
    // Store the session
    this.sessionKeys.set(sessionId, {
      recipientId,
      encryptionKey,
      macKey,
      chainKey,
      messageCounter: 0
    });
    
    return sessionId;
  }

  /**
   * Generate a random ID
   * @returns {string} Random ID
   */
  generateRandomId() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Derive keys from a master secret using a simple KDF
   * @param {Buffer} masterSecret - Master secret
   * @returns {Object} Derived keys
   */
  deriveKeys(masterSecret) {
    const hash1 = crypto.createHash('sha256').update(Buffer.concat([masterSecret, Buffer.from('encryption')])).digest();
    const hash2 = crypto.createHash('sha256').update(Buffer.concat([masterSecret, Buffer.from('mac')])).digest();
    const hash3 = crypto.createHash('sha256').update(Buffer.concat([masterSecret, Buffer.from('chain')])).digest();
    
    return {
      encryptionKey: hash1.slice(0, 16),
      macKey: hash2.slice(0, 16),
      chainKey: hash3.slice(0, 16)
    };
  }

  /**
   * Encrypt a message
   * @param {string} sessionId - Session ID
   * @param {string} message - Message to encrypt
   * @returns {Object} Encrypted message package
   */
  encryptMessage(sessionId, message) {
    const session = this.sessionKeys.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    // Increment message counter
    session.messageCounter += 1;
    
    // Create initialization vector
    const iv = crypto.randomBytes(16);
    
    // Encrypt the message
    const cipher = crypto.createCipheriv('aes-128-cbc', session.encryptionKey, iv);
    let encrypted = cipher.update(message, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    // Create the message package
    const messagePackage = {
      sessionId,
      counter: session.messageCounter,
      iv: iv.toString('base64'),
      ciphertext: encrypted
    };
    
    // Calculate MAC for the message package
    const mac = this.calculateMAC(messagePackage, session.macKey);
    messagePackage.mac = mac;
    
    // Update the chain key
    this.updateChainKey(sessionId);
    
    return messagePackage;
  }

  /**
   * Decrypt a message
   * @param {Object} messagePackage - Encrypted message package
   * @returns {string} Decrypted message
   */
  decryptMessage(messagePackage) {
    const session = this.sessionKeys.get(messagePackage.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    // Verify the message counter to prevent replay attacks
    if (messagePackage.counter <= session.messageCounter) {
      throw new Error('Potential replay attack detected');
    }
    
    // Verify the message authentication code
    const providedMac = messagePackage.mac;
    const calculatedMac = this.calculateMAC({ ...messagePackage, mac: undefined }, session.macKey);
    
    if (providedMac !== calculatedMac) {
      throw new Error('Message authentication failed');
    }
    
    // Decrypt the message
    const iv = Buffer.from(messagePackage.iv, 'base64');
    
    const decipher = crypto.createDecipheriv('aes-128-cbc', session.encryptionKey, iv);
    let decrypted = decipher.update(messagePackage.ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    // Update session message counter
    session.messageCounter = messagePackage.counter;
    
    // Update the chain key
    this.updateChainKey(messagePackage.sessionId);
    
    return decrypted;
  }

  /**
   * Calculate MAC for a message package
   * @param {Object} messagePackage - Message package to authenticate
   * @param {Buffer} macKey - Key for MAC calculation
   * @returns {string} MAC in base64
   */
  calculateMAC(messagePackage, macKey) {
    const hmac = crypto.createHmac('sha256', macKey);
    hmac.update(JSON.stringify(messagePackage));
    return hmac.digest('base64');
  }

  /**
   * Update the chain key
   * @param {string} sessionId - Session ID
   */
  updateChainKey(sessionId) {
    const session = this.sessionKeys.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    // Derive new keys from the current chain key
    const hmac = crypto.createHmac('sha256', Buffer.from('RatchetStep'));
    hmac.update(session.chainKey);
    const newKeyMaterial = hmac.digest();
    
    // Update session keys
    session.encryptionKey = newKeyMaterial.slice(0, 16);
    session.macKey = newKeyMaterial.slice(16, 32);
    session.chainKey = newKeyMaterial.slice(0, 16); // Reuse part of the key material
    
    // Update the session
    this.sessionKeys.set(sessionId, session);
  }
}

module.exports = {
  SecureMessaging
};