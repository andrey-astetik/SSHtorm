const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

function deriveKey(password, salt) {
    return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
}

function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha512').toString('hex');
}

function encrypt(text, password, salt) {
    const key = deriveKey(password, salt);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return {
        iv: iv.toString('hex'),
        data: encrypted,
        tag: tag.toString('hex')
    };
}

function decrypt(encrypted, password, salt) {
    const key = deriveKey(password, salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));
    let decrypted = decipher.update(encrypted.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function generateSalt() {
    return crypto.randomBytes(SALT_LENGTH).toString('hex');
}

module.exports = { encrypt, decrypt, hashPassword, generateSalt };
