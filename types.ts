
export type HexCoord = { q: number; r: number; upgrade?: boolean };

export interface Hex {
  id: string;
  q: number;
  r: number;
  currentLevel: number; // Resets to 0 on exit
  maxLevel: number;     // Permanent peak level
  progress: number;     // Seconds accumulated towards next level
  revealed: boolean;
}

export enum EntityType {
  PLAYER = 'PLAYER',
  BOT = 'BOT'
}

export interface BotMemory {
  lastPlayerPos: HexCoord | null;
  chokePoints: string[]; // IDs of hexes considered strategic
  aggressionFactor: number; // 0.0 to 1.0
}

export interface Entity {
  id: string;
  type: EntityType;
  q: number;
  r: number;
  playerLevel: number; // Highest maxLevel achieved by this entity
  coins: number;
  totalCoinsEarned: number;
  moves: number;
  recentUpgrades: string[]; // Queue of Hex IDs where maxLevel was increased
  movementQueue: HexCoord[]; // For animated steps
  memory?: BotMemory; // AI Specific memory
  avatarColor?: string; // Visual identifier
}

export interface ToastMessage {
  message: string;
  type: 'error' | 'success' | 'info';
  timestamp: number;
}

export type UIState = 'MENU' | 'GAME' | 'LEADERBOARD';

export interface UserProfile {
  isAuthenticated: boolean;
  isGuest: boolean;
  nickname: string;
  avatarColor: string;
  avatarIcon: string;
}

export interface PendingConfirmation {
  type: 'MOVE_WITH_COINS';
  data: {
    path: HexCoord[];
    costMoves: number;
    costCoins: number;
  };
}

export type WinType = 'WEALTH' | 'DOMINATION';

export interface WinCondition {
  type: WinType;
  target: number;
  label: string;
  botCount: number; // Added bot count to win condition/config
}

export interface LeaderboardEntry {
  nickname: string;
  avatarColor: string;
  avatarIcon: string;
  maxCoins: number;
  maxLevel: number;
  timestamp: number;
}

export interface GameState {
  // UI State
  uiState: UIState;
  user: UserProfile | null;
  pendingConfirmation: PendingConfirmation | null;
  
  // Game Session Data
  sessionId: string; // Unique ID for the current game session
  winCondition: WinCondition | null;
  grid: Record<string, Hex>; // Key format: "q,r"
  player: Entity;
  bots: Entity[]; // Changed from single bot to array
  currentTurn: number;
  gameStatus: 'PLAYING' | 'GAME_OVER' | 'VICTORY' | 'DEFEAT';
  messageLog: string[];
  lastBotActionTime: number; // Tracks general bot tick cadence
  isPlayerGrowing: boolean;
  growingBotIds: string[]; // Tracks which bots are currently growing
  toast: ToastMessage | null;
  
  // Global Data
  leaderboard: LeaderboardEntry[];
  hasActiveSession: boolean;
}
