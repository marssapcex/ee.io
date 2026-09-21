/**
 * Keccak-256 (the pre-NIST padding variant Ethereum uses) over BigInt lanes.
 *
 * Needed for EIP-55 checksum validation without pulling a crypto dependency
 * into the browser bundle.
 */

const ROUND_CONSTANTS: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const ROTATION_OFFSETS = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

const MASK = (1n << 64n) - 1n;

const rotl = (x: bigint, n: number): bigint => {
  const shift = BigInt(n % 64);
  return ((x << shift) | (x >> (64n - shift))) & MASK;
};

function keccakF(state: bigint[][]): void {
  for (let round = 0; round < 24; round++) {
    // Theta
    const C: bigint[] = new Array(5);
    for (let x = 0; x < 5; x++) {
      C[x] = state[x][0] ^ state[x][1] ^ state[x][2] ^ state[x][3] ^ state[x][4];
    }
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) state[x][y] ^= D;
    }

    // Rho + Pi
    const B: bigint[][] = Array.from({ length: 5 }, () => new Array<bigint>(5).fill(0n));
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y][(2 * x + 3 * y) % 5] = rotl(state[x][y], ROTATION_OFFSETS[x][y]);
      }
    }

    // Chi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x][y] = B[x][y] ^ (~B[(x + 1) % 5][y] & MASK & B[(x + 2) % 5][y]);
      }
    }

    // Iota
    state[0][0] ^= ROUND_CONSTANTS[round];
  }
}

export function keccak_256(input: Uint8Array): Uint8Array {
  const RATE = 136; // 1088 bits for Keccak-256
  const state: bigint[][] = Array.from({ length: 5 }, () => new Array<bigint>(5).fill(0n));

  // Pad: Keccak uses 0x01 as the domain separator (SHA3 would use 0x06).
  const padLength = RATE - (input.length % RATE);
  const padded = new Uint8Array(input.length + padLength);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) {
        lane = (lane << 8n) | BigInt(padded[offset + i * 8 + b]);
      }
      const x = i % 5;
      const y = Math.floor(i / 5);
      state[x][y] ^= lane;
    }
    keccakF(state);
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    const x = i % 5;
    const y = Math.floor(i / 5);
    let lane = state[x][y];
    for (let b = 0; b < 8; b++) {
      out[i * 8 + b] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}
