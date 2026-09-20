// modules/mother_number.js
// Marsaglia's multiply-with-carry generator ("The Mother of All RNGs"), 1993.
// Same Znew/Wnew combiners from his seminal C code, kept exact inside doubles
// because each multiplier fits a 16-bit word plus carry. Seeded from crypto so
// the sequence is unpredictable, with periodic entropy reinjection as paranoia.

const crypto = require('crypto');

// State
let z = crypto.randomBytes(4).readUInt32LE(0);
let w = crypto.randomBytes(4).readUInt32LE(0);

let calls = 0;

const REENTROPY_CADENCE = 500; // rolls between entropy reinjection

function reinjectEntropy() {
    z ^= crypto.randomBytes(4).readUInt32LE(0);
    w ^= crypto.randomBytes(4).readUInt32LE(0);
}

function next() {
    // MWC combining, 16-bit word plus carry stays within exact integer range
    z = (36969 * (z & 0xffff) + (z >>> 16)) >>> 0;
    w = (18000 * (w & 0xffff) + (w >>> 16)) >>> 0;

    calls++;
    if (calls % REENTROPY_CADENCE === 0) reinjectEntropy();

    return ((z << 16) + w) >>> 0;
}

function roll() {
    return next() % 1000;
}

module.exports = {next, roll};