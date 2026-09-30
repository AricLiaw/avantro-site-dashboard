// Shared password of the DEMONSTRATION accounts only (never used for real accounts).
// Override it on any shared/public server:  AVANTRO_DEMO_PASSWORD=some-long-random-value
// Demo mode is switched off, and these accounts removed, from Administration > Project data.
export const DEMO_PASSWORD = process.env.AVANTRO_DEMO_PASSWORD || 'Avantro#Demo25';
