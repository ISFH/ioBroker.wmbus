const END = 0x0C;
const ESC = 0xDB;
const ESC_END = 0xDC;
const ESC_ESC = 0xDD;

/**
 * @param {Buffer<ArrayBuffer>} message
 */
function slipEncode(message) {
    const escapeCount = message.filter(b => b === END || b === ESC).length;
    const encodedMessage = Buffer.alloc(message.length + escapeCount + 2, END);

    let j = 1;
    for (let i = 0; i < message.length; i++) {
        const b = message[i];
        if (b !== END) {
            encodedMessage[j++] = b;
            if (b === ESC) {
                encodedMessage[j++] = ESC_ESC;
            }
        } else {
            encodedMessage[j++] = ESC;
            encodedMessage[j++] = ESC_END;
        }
    }

    return encodedMessage;
}

/**
 * @param {Buffer<ArrayBuffer>} message
 */
function slipDecode(message) {
    const escapeCount = message.filter(b => b === ESC).length;
    const decodedMessage = Buffer.alloc(message.length - escapeCount - 2);

    if (message[0] !== END) {
        throw new Error('Start END marker is missing!');
    }
    if (message[message.length - 1] !== END) {
        throw new Error('Stop END marker is missing!');
    }

    let escape = false;
    let j = 0;
    for (let i = 1; i < message.length - 1; i++) {
        const b = message[i];

        if (escape) {
            if (b === ESC_END) {
                decodedMessage[j++] = END;
            } else if (b === ESC_ESC) {
                decodedMessage[j++] = ESC;
            } else {
                throw new Error(`Found 0x${b.toString(16)} after ESC!`);
            }
            escape = false;
        } else {
            if (b === ESC) {
                escape = true;
            } else {
                decodedMessage[j++] = b;
            }
        }
    }

    return decodedMessage;
}

module.exports = {
    decode: slipDecode,
    encode: slipEncode,
    END: END
};