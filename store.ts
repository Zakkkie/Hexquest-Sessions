
import { create } from 'zustand';
import { GameState, Entity, Hex, EntityType, UserProfile, UIState, WinCondition, LeaderboardEntry } from './types.ts';
import { 
  INITIAL_MOVES, UPGRADE_LOCK_QUEUE_SIZE, EXCHANGE_RATE_COINS_PER_MOVE, 
  BOT_ACTION_INTERVAL_MS, SECONDS_PER_LEVEL_UNIT 
} from './constants.ts';
import { 
  getHexKey, getNeighbors, checkGrowthCondition, getSecondsToGrow, 
  calculateReward, calculateBotMove, findPath 
} from './services/hexUtils.ts';

// --- MOCK DATABASE (In-Memory, persists while app is open) ---
const MOCK_USER_DB: Record<string, { password: string; avatarColor: string; avatarIcon: string }> = {};

// Initial seeded leaderboard
let MOCK_LEADERBOARD: LeaderboardEntry[] = [
  { nickname: 'SENTINEL_AI', avatarColor: '#ef4444', avatarIcon: 'bot', maxCoins: 2500, maxLevel: 12, timestamp: Date.now() - 100000 },
  { nickname: 'Vanguard', avatarColor: '#3b82f6', avatarIcon: 'shield', maxCoins: 1200, maxLevel: 8, timestamp: Date.now() - 200000 },
];

const updateLeaderboard = (nickname: string, avatarColor: string, avatarIcon: string, coins: number, level: number) => {
  const existingIndex = MOCK_LEADERBOARD.findIndex(e => e.nickname === nickname);
  
  if (existingIndex >= 0) {
    // Only update if score is better (using Coins as primary metric for now, or just max both)
    const entry = MOCK_LEADERBOARD[existingIndex];
    if (coins >= entry.maxCoins || level >= entry.maxLevel) {
      MOCK_LEADERBOARD[existingIndex] = {
        ...entry,
        maxCoins: Math.max(entry.maxCoins, coins),
        maxLevel: Math.max(entry.maxLevel, level),
        avatarColor, // Update visual in case they changed it
        avatarIcon,
        timestamp: Date.now()
      };
    }
  } else {
    MOCK_LEADERBOARD.push({
      nickname,
      avatarColor,
      avatarIcon,
      maxCoins: coins,
      maxLevel: level,
      timestamp: Date.now()
    });
  }
  // Sort by Coins descending
  MOCK_LEADERBOARD.sort((a, b) => b.maxCoins - a.maxCoins);
};

interface AuthResponse {
  success: boolean;
  message?: string;
}

interface GameActions {
  setUIState: (state: UIState) => void;
  loginAsGuest: (nickname: string, avatarColor: string, avatarIcon: string) => void;
  registerUser: (nickname: string, password: string, avatarColor: string, avatarIcon: string) => AuthResponse;
  loginUser: (nickname: string, password: string) => AuthResponse;
  logout: () => void;
  startNewGame: (winCondition: WinCondition) => void;
  abandonSession: () => void;
  togglePlayerGrowth: () => void;
  rechargeMove: () => void;
  movePlayer: (q: number, r: number) => void;
  confirmPendingAction: () => void;
  cancelPendingAction: () => void;
  processMovementStep: () => void;
  tick: () => void;
  showToast: (message: string, type: 'error' | 'success' | 'info') => void;
  hideToast: () => void;
}

type GameStore = GameState & GameActions;

const createInitialHex = (q: number, r: number, startLevel = 0): Hex => ({
  id: getHexKey(q, r),
  q, r,
  currentLevel: 0,
  maxLevel: startLevel,
  progress: 0,
  revealed: true
});

const generateInitialGameData = (winCondition: WinCondition | null) => {
  const startHex = createInitialHex(0, 0, 0);
  const initialGrid: Record<string, Hex> = { [getHexKey(0,0)]: startHex };
  getNeighbors(0, 0).forEach(n => {
    initialGrid[getHexKey(n.q, n.r)] = createInitialHex(n.q, n.r, 0);
  });
  
  return {
    sessionId: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
    winCondition,
    grid: initialGrid,
    player: {
      id: 'player-1',
      type: EntityType.PLAYER,
      q: 0, r: 0,
      playerLevel: 0,
      coins: 0,
      moves: INITIAL_MOVES,
      totalCoinsEarned: 0,
      recentUpgrades: [],
      movementQueue: []
    } as Entity,
    bot: {
      id: 'bot-1',
      type: EntityType.BOT,
      q: 1, r: -1,
      playerLevel: 0,
      coins: 0,
      moves: INITIAL_MOVES,
      totalCoinsEarned: 0,
      recentUpgrades: [],
      movementQueue: []
    } as Entity,
    currentTurn: 0,
    messageLog: [
      'Operational.',
      winCondition 
        ? `MISSION OBJECTIVE: ${winCondition.type === 'WEALTH' ? 'Accumulate' : 'Achieve Rank'} ${winCondition.target} ${winCondition.type === 'WEALTH' ? 'Credits' : 'Level'}` 
        : 'Objective: Survive.'
    ],
    gameStatus: 'PLAYING' as const,
    pendingConfirmation: null,
    isPlayerGrowing: false,
    isBotGrowing: false,
    lastBotActionTime: Date.now(),
    toast: null,
    leaderboard: [...MOCK_LEADERBOARD] // Hydrate from DB
  };
};

export const useGameStore = create<GameStore>((set, get) => {
  const initialGameData = generateInitialGameData(null);

  return {
    uiState: 'MENU',
    user: null, 
    hasActiveSession: false,
    ...initialGameData,
    
    setUIState: (uiState) => set({ uiState, leaderboard: [...MOCK_LEADERBOARD] }), // Refresh LB on view switch

    loginAsGuest: (nickname, avatarColor, avatarIcon) => set({
      user: {
        isAuthenticated: true,
        isGuest: true,
        nickname,
        avatarColor,
        avatarIcon
      }
    }),

    registerUser: (nickname, password, avatarColor, avatarIcon) => {
      if (MOCK_USER_DB[nickname]) return { success: false, message: "Nickname already registered." };
      MOCK_USER_DB[nickname] = { password, avatarColor, avatarIcon };
      set({ user: { isAuthenticated: true, isGuest: false, nickname, avatarColor, avatarIcon } });
      return { success: true };
    },

    loginUser: (nickname, password) => {
      const record = MOCK_USER_DB[nickname];
      if (!record || record.password !== password) return { success: false, message: "Auth failed." };
      set({ user: { isAuthenticated: true, isGuest: false, nickname, avatarColor: record.avatarColor, avatarIcon: record.avatarIcon } });
      return { success: true };
    },

    logout: () => {
      // Save progress before logout
      const state = get();
      if (state.hasActiveSession && state.user) {
        updateLeaderboard(state.user.nickname, state.user.avatarColor, state.user.avatarIcon, state.player.totalCoinsEarned, state.player.playerLevel);
      }

      const freshState = generateInitialGameData(null);
      set({ ...freshState, user: null, uiState: 'MENU', hasActiveSession: false, gameStatus: 'GAME_OVER' });
    },

    startNewGame: (winCondition) => set((state) => ({
      ...generateInitialGameData(winCondition),
      user: state.user,
      hasActiveSession: true,
      uiState: 'GAME'
    })),

    abandonSession: () => set((state) => {
      // Save stats on abandon
      if (state.user) {
        updateLeaderboard(state.user.nickname, state.user.avatarColor, state.user.avatarIcon, state.player.totalCoinsEarned, state.player.playerLevel);
      }
      
      return {
        ...generateInitialGameData(null),
        user: state.user,
        uiState: 'MENU',
        hasActiveSession: false, 
        gameStatus: 'GAME_OVER',
        leaderboard: [...MOCK_LEADERBOARD]
      };
    }),

    showToast: (message, type) => set({ toast: { message, type, timestamp: Date.now() } }),
    hideToast: () => set({ toast: null }),

    togglePlayerGrowth: () => set(state => {
      if (state.uiState !== 'GAME' || state.player.movementQueue.length > 0) return state;
      if (!state.isPlayerGrowing) {
        const hex = state.grid[getHexKey(state.player.q, state.player.r)];
        if (hex) {
          const condition = checkGrowthCondition(hex, state.player);
          if (!condition.canGrow) return { toast: { message: condition.reason || "Growth Denied", type: 'error', timestamp: Date.now() } };
        }
      }
      return { isPlayerGrowing: !state.isPlayerGrowing };
    }),

    rechargeMove: () => set(state => {
      if (state.uiState !== 'GAME' || state.player.coins < EXCHANGE_RATE_COINS_PER_MOVE) return state;
      return { player: { ...state.player, coins: state.player.coins - EXCHANGE_RATE_COINS_PER_MOVE, moves: state.player.moves + 1 } };
    }),

    cancelPendingAction: () => set({ pendingConfirmation: null }),

    confirmPendingAction: () => set(state => {
      if (!state.pendingConfirmation) return state;
      const { path, costMoves, costCoins } = state.pendingConfirmation.data;
      if (state.player.moves < costMoves || state.player.coins < costCoins) return { pendingConfirmation: null, toast: { message: "Action Cancelled.", type: 'error', timestamp: Date.now() } };
      return { player: { ...state.player, moves: state.player.moves - costMoves, coins: state.player.coins - costCoins, movementQueue: path }, pendingConfirmation: null, isPlayerGrowing: false };
    }),

    movePlayer: (tq, tr) => set(state => {
      if (state.uiState !== 'GAME' || state.player.movementQueue.length > 0) return state;
      if (tq === state.player.q && tr === state.player.r) return state; 
      
      const targetHex = state.grid[getHexKey(tq, tr)];
      if (targetHex && targetHex.maxLevel > state.player.playerLevel) return { toast: { message: `RANK L${targetHex.maxLevel} REQUIRED`, type: 'error', timestamp: Date.now() } };

      const path = findPath({ q: state.player.q, r: state.player.r }, { q: tq, r: tr }, state.grid, state.player.playerLevel, [{ q: state.bot.q, r: state.bot.r }]);
      if (!path) return { toast: { message: "PATH BLOCKED", type: 'error', timestamp: Date.now() } };

      let totalMoveCost = 0;
      for (const step of path) {
        const hex = state.grid[getHexKey(step.q, step.r)];
        totalMoveCost += (hex && hex.maxLevel >= 2) ? hex.maxLevel : 1;
      }

      let costMoves = Math.min(state.player.moves, totalMoveCost);
      let deficit = totalMoveCost - costMoves;
      let costCoins = deficit * EXCHANGE_RATE_COINS_PER_MOVE;

      if (state.player.coins < costCoins) return { toast: { message: `NEED ${totalMoveCost} MOVES`, type: 'error', timestamp: Date.now() } };
      if (costCoins > 0) return { pendingConfirmation: { type: 'MOVE_WITH_COINS', data: { path, costMoves, costCoins } } };

      return { player: { ...state.player, moves: state.player.moves - costMoves, movementQueue: path }, isPlayerGrowing: false };
    }),

    processMovementStep: () => set(state => {
      if (state.player.movementQueue.length === 0) return state;
      const newQueue = [...state.player.movementQueue];
      const nextStep = newQueue.shift()!;
      const newGrid = { ...state.grid };
      const oldKey = getHexKey(state.player.q, state.player.r);
      if (newGrid[oldKey]) newGrid[oldKey] = { ...newGrid[oldKey], currentLevel: 0, progress: 0 };
      getNeighbors(nextStep.q, nextStep.r).concat(nextStep).forEach(n => {
        const k = getHexKey(n.q, n.r);
        if (!newGrid[k]) newGrid[k] = createInitialHex(n.q, n.r, 0);
      });
      return { grid: newGrid, player: { ...state.player, q: nextStep.q, r: nextStep.r, movementQueue: newQueue } };
    }),

    tick: () => set(state => {
      if (state.uiState !== 'GAME' || state.gameStatus !== 'PLAYING') return state;
      const now = Date.now();
      let newGrid = { ...state.grid };
      let newPlayer = { ...state.player };
      let newBot = { ...state.bot };
      let logs = [...state.messageLog];
      let isPlayerGrowing = state.isPlayerGrowing;
      let isBotGrowing = state.isBotGrowing;
      let lastBotActionTime = state.lastBotActionTime;
      let newGameStatus: GameState['gameStatus'] = state.gameStatus;

      // 1. Process Growth (Player & Bot)
      const processGrowth = (entity: Entity, isGrowing: boolean): { entity: Entity, isGrowing: boolean, logs: string[] } => {
        if (!isGrowing || entity.movementQueue.length > 0) return { entity, isGrowing: false, logs: [] };
        const key = getHexKey(entity.q, entity.r);
        const hex = newGrid[key];
        if (!hex || !checkGrowthCondition(hex, entity).canGrow) return { entity, isGrowing: false, logs: [] };

        const targetLevel = (hex.currentLevel || 0) + 1;
        const needed = getSecondsToGrow(targetLevel);
        const currentLogs: string[] = [];
        let updatedEntity = { ...entity };

        if (hex.progress + 1 >= needed) {
           const rewards = calculateReward(targetLevel);
           let finalCoins = rewards.coins;
           const newHex = { ...hex, currentLevel: targetLevel, progress: 0 };
           if (targetLevel > hex.maxLevel) {
              if (targetLevel === 1) {
                // Expansion: Add to cycle queue
                if (updatedEntity.recentUpgrades.length < UPGRADE_LOCK_QUEUE_SIZE) {
                  updatedEntity.recentUpgrades = [...updatedEntity.recentUpgrades, hex.id];
                  if (updatedEntity.type === 'PLAYER') currentLogs.push(`Sector L1 Acquired.`);
                } else {
                   // Cycle queue, remove oldest
                   const newQueue = [...updatedEntity.recentUpgrades];
                   newQueue.shift(); 
                   newQueue.push(hex.id);
                   updatedEntity.recentUpgrades = newQueue;
                }
              } else {
                // Major Upgrade: Clear Queue (Reset Cycle)
                updatedEntity.recentUpgrades = [];
                finalCoins = targetLevel * targetLevel;
                if (updatedEntity.type === 'PLAYER') currentLogs.push(`RECORD BREAK L${targetLevel}! +${finalCoins}©`);
              }
              newHex.maxLevel = targetLevel;
              updatedEntity.playerLevel = Math.max(updatedEntity.playerLevel, targetLevel);
           }
           updatedEntity.coins += finalCoins;
           updatedEntity.totalCoinsEarned += finalCoins;
           updatedEntity.moves += 1;
           newGrid[key] = newHex;
           return { entity: updatedEntity, isGrowing: targetLevel < newHex.maxLevel, logs: currentLogs };
        } else {
           newGrid[key] = { ...hex, progress: (hex.progress || 0) + 1 };
           return { entity, isGrowing: true, logs: [] };
        }
      };

      const pRes = processGrowth(newPlayer, isPlayerGrowing);
      newPlayer = pRes.entity;
      isPlayerGrowing = pRes.isGrowing;
      logs = [...pRes.logs, ...logs];

      const bRes = processGrowth(newBot, isBotGrowing);
      newBot = bRes.entity;
      isBotGrowing = bRes.isGrowing;
      
      // 2. Process Bot AI & Movement
      // If bot is not growing, it should be moving or deciding to move.
      if (!isBotGrowing) {
        // Is there a move queue?
        if (newBot.movementQueue.length > 0) {
           // Execute next step in queue (1 step per tick to mimic travel time)
           const nextStep = newBot.movementQueue.shift()!;
           const currentBotKey = getHexKey(newBot.q, newBot.r);
           const nextHexKey = getHexKey(nextStep.q, nextStep.r);
           const nextHex = newGrid[nextHexKey];
           
           // Calculate cost
           const moveCost = (nextHex && nextHex.maxLevel >= 2) ? nextHex.maxLevel : 1;
           
           // Can afford?
           let canMove = false;
           if (newBot.moves >= moveCost) {
             newBot.moves -= moveCost;
             canMove = true;
           } else {
             // Smart spending: Use remaining moves + coins
             const deficit = Math.max(0, moveCost - newBot.moves);
             const coinsNeeded = deficit * EXCHANGE_RATE_COINS_PER_MOVE;
             
             if (newBot.coins >= coinsNeeded) {
               newBot.coins -= coinsNeeded;
               newBot.moves = 0; // Moves exhausted
               canMove = true;
             }
           }

           if (canMove) {
             // Leave current hex (reset currentLevel logic)
             if (newGrid[currentBotKey]) {
                newGrid[currentBotKey] = { ...newGrid[currentBotKey], currentLevel: 0, progress: 0 };
             }
             
             newBot.q = nextStep.q;
             newBot.r = nextStep.r;
             
             // Reveal neighbors
             getNeighbors(nextStep.q, nextStep.r).concat(nextStep).forEach(n => {
                const k = getHexKey(n.q, n.r);
                if (!newGrid[k]) newGrid[k] = createInitialHex(n.q, n.r, 0);
             });
           } else {
             // Stuck? Clear queue and wait (recharge via next growth)
             newBot.movementQueue = [];
           }
        } else {
           // Queue empty. Check if we should grow current tile?
           const bKey = getHexKey(newBot.q, newBot.r);
           const bHex = newGrid[bKey];
           const condition = bHex ? checkGrowthCondition(bHex, newBot) : { canGrow: false };

           if (bHex && condition.canGrow) {
              isBotGrowing = true;
           } else {
              // Can't grow. Find new target.
              const path = calculateBotMove(newBot, newGrid, { q: newPlayer.q, r: newPlayer.r }, state.winCondition);
              if (path && path.length > 0) {
                 newBot.movementQueue = path;
              }
           }
        }
      }

      // --- VICTORY CHECK ---
      if (state.winCondition && newGameStatus === 'PLAYING') {
        let playerWins = false;
        if ((state.winCondition.type === 'WEALTH' && newPlayer.totalCoinsEarned >= state.winCondition.target) || 
            (state.winCondition.type === 'DOMINATION' && newPlayer.playerLevel >= state.winCondition.target)) {
           playerWins = true;
        }

        if (playerWins) {
           newGameStatus = 'VICTORY';
           if (state.user) {
             updateLeaderboard(state.user.nickname, state.user.avatarColor, state.user.avatarIcon, newPlayer.totalCoinsEarned, newPlayer.playerLevel);
           }
           updateLeaderboard('SENTINEL_AI', '#ef4444', 'bot', newBot.totalCoinsEarned, newBot.playerLevel);
        }
      }

      return { 
        grid: newGrid, 
        player: newPlayer, 
        bot: newBot, 
        messageLog: logs.slice(0, 50), 
        isPlayerGrowing, 
        isBotGrowing, 
        lastBotActionTime, 
        gameStatus: newGameStatus,
        leaderboard: [...MOCK_LEADERBOARD] // Sync Store with "DB"
      };
    })
  };
});
