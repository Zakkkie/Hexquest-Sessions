
export const EXPANSION_K = 3;
export const LEVEL_UP_L = 10;
export const EXCHANGE_RATE_COINS_PER_MOVE = 2;

export const INITIAL_MOVES = 0; 
export const INITIAL_COINS = 0;

// Growth Mechanics
export const SECONDS_PER_LEVEL_UNIT = 5; // Faster growth for better feedback
export const MANUAL_GROWTH_INCREMENT = 5; 
export const UPGRADE_LOCK_QUEUE_SIZE = 3; // The cycle size
export const BOT_ACTION_INTERVAL_MS = 1000; // Faster bot decisions

// Visual constants
export const HEX_SIZE = 35; 
export const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;
export const HEX_HEIGHT = 2 * HEX_SIZE;
