import {Buffer} from 'buffer';

// Solana's browser dependencies may access Buffer while their modules evaluate.
globalThis.Buffer=Buffer;
