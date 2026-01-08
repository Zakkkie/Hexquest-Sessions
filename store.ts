
import { create } from 'zustand';
import { GameState, Entity, Hex, EntityType, UIState, WinCondition, LeaderboardEntry, HexCoord } from './types.ts';
import { 
  INITIAL_MOVES, UPGRADE_LOCK_QUEUE_SIZE, EXCHANGE_RATE_COINS_PER_MOVE, BOT_ACTION_INTERVAL_MS, INITIAL_COINS
} from './constants.ts';
import { 
  getHexKey, getCoordinatesFromKey, getNeighbors, findPath 
} from './services/hexUtils.ts';
import { checkGrowthCondition, calculateReward, getSecondsToGrow } from './gameEngine/rules.ts';
import { calculateBotMove } from './gameEngine/ai.ts';

// --- MOCK DATABASE ---
const MOCK_USER_DB: Record<string, { password: string; avatarColor: string; avatarIcon: string }> = {};

const BOT_PALETTE = ['#ef4444', '#f97316', '#a855f7', '#ec4899']; // Red, Orange, Purple, Pink

let MOCK_LEADERBOARD: LeaderboardEntry[] = [
  { nickname: 'SENTINEL_AI', avatarColor: '#ef4444', avatarIcon: 'bot', maxCoins: 2500, maxLevel: 12, timestamp: Date.now() - 100000 },
  { nickname: 'Vanguard', avatarColor: '#3b82f6', avatarIcon: 'shield', maxCoins: 1200, maxLevel: 8, timestamp: Date.now() - 200000 },
];

const updateLeaderboard = (nickname: string, avatarColor: string, avatarIcon: string, coins: number, level: number) => {
  const existingIndex = MOCK_LEADERBOARD.findIndex(e => e.nickname === nickname);
  if (existingIndex >= 0) {
    const entry = MOCK_LEADERBOARD[existingIndex];
    if (coins >= entry.maxCoins || level >= entry.maxLevel) {
      MOCK_LEADERBOARD[existingIndex] = {
        ...entry,
        maxCoins: Math.max(entry.maxCoins, coins),
        maxLevel: Math.max(entry.maxLevel, level),
        avatarColor,
        avatarIcon,
        timestamp: Date.now()
      };
    }
  } else {
    MOCK_LEADERBOARD.push({ nickname, avatarColor, avatarIcon, maxCoins: coins, maxLevel: level, timestamp: Date.now() });
  }
  MOCK_LEADERBOARD.sort((a, b) => b.maxCoins - a.maxCoins);
};

interface AuthResponse { success: boolean; message?: string; }

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
  
  // Bot Spawning Config
  const botCount = winCondition?.botCount || 1;
  const bots: Entity[] = [];
  const spawnPoints = [
    { q: 1, r: -1 }, // Top Right
    { q: -1, r: 1 }, // Bottom Left
    { q: 1, r: 0 },  // Right
    { q: -1, r: 0 }  // Left
  ];

  for (let i = 0; i < Math.min(botCount, spawnPoints.length); i++) {
    const sp = spawnPoints[i];
    
    // Ensure hex exists at spawn
    if (!initialGrid[getHexKey(sp.q, sp.r)]) {
        initialGrid[getHexKey(sp.q, sp.r)] = createInitialHex(sp.q, sp.r, 0);
        getNeighbors(sp.q, sp.r).forEach(n => {
            const k = getHexKey(n.q, n.r);
            if (!initialGrid[k]) initialGrid[k] = createInitialHex(n.q, n.r, 0);
        });
    }

    bots.push({
      id: `bot-${i+1}`,
      type: EntityType.BOT,
      q: sp.q, 
      r: sp.r,
      playerLevel: 0,
      coins: INITIAL_COINS,
      moves: INITIAL_MOVES,
      totalCoinsEarned: 0,
      recentUpgrades: [],
      movementQueue: [],
      memory: {
        lastPlayerPos: null,
        chokePoints: [],
        aggressionFactor: 0.5
      },
      avatarColor: BOT_PALETTE[i % BOT_PALETTE.length]
    });
  }
  
  return {
    sessionId: Math.random().toString(36).substring(2, 15),
    winCondition,
    grid: initialGrid,
    player: {
      id: 'player-1',
      type: EntityType.PLAYER,
      q: 0, r: 0,
      playerLevel: 0,
      coins: INITIAL_COINS,
      moves: INITIAL_MOVES,
      totalCoinsEarned: 0,
      recentUpgrades: [],
      movementQueue: []
    } as Entity,
    bots,
    currentTurn: 0,
    messageLog: [
      'Operational.',
      winCondition ? `Objective: ${winCondition.label}` : 'Objective: Survive.',
      `Threats detected: ${botCount}`
    ],
    gameStatus: 'PLAYING' as const,
    pendingConfirmation: null,
    isPlayerGrowing: false,
    growingBotIds: [],
    lastBotActionTime: Date.now(),
    toast: null,
    leaderboard: [...MOCK_LEADERBOARD],
    hasActiveSession: false
  };
};

export const useGameStore = create<GameStore>((set, get) => {
  const initialData = generateInitialGameData(null);

  return {
    uiState: 'MENU',
    user: null,
    ...initialData,
    
    setUIState: (uiState) => set({ uiState, leaderboard: [...MOCK_LEADERBOARD] }),

    loginAsGuest: (nickname, avatarColor, avatarIcon) => set({
      user: { isAuthenticated: true, isGuest: true, nickname, avatarColor, avatarIcon }
    }),

    registerUser: (nickname, password, avatarColor, avatarIcon) => {
      if (MOCK_USER_DB[nickname]) return { success: false, message: "Nickname taken." };
      MOCK_USER_DB[nickname] = { password, avatarColor, avatarIcon };
      set({ user: { isAuthenticated: true, isGuest: false, nickname, avatarColor, avatarIcon } });
      return { success: true };
    },

    loginUser: (nickname, password) => {
      const record = MOCK_USER_DB[nickname];
      if (!record || record.password !== password) return { success: false, message: "Invalid credentials." };
      set({ user: { isAuthenticated: true, isGuest: false, nickname, avatarColor: record.avatarColor, avatarIcon: record.avatarIcon } });
      return { success: true };
    },

    logout: () => {
      const s = get();
      if (s.hasActiveSession && s.user) {
        updateLeaderboard(s.user.nickname, s.user.avatarColor, s.user.avatarIcon, s.player.totalCoinsEarned, s.player.playerLevel);
      }
      set({ ...generateInitialGameData(null), user: null, uiState: 'MENU', hasActiveSession: false, gameStatus: 'GAME_OVER' });
    },

    startNewGame: (winCondition) => set((state) => ({
      ...generateInitialGameData(winCondition),
      user: state.user,
      hasActiveSession: true,
      uiState: 'GAME'
    })),

    abandonSession: () => set((state) => {
      if (state.user) updateLeaderboard(state.user.nickname, state.user.avatarColor, state.user.avatarIcon, state.player.totalCoinsEarned, state.player.playerLevel);
      return { ...generateInitialGameData(null), user: state.user, uiState: 'MENU', hasActiveSession: false, gameStatus: 'GAME_OVER', leaderboard: [...MOCK_LEADERBOARD] };
    }),

    showToast: (message, type) => set({ toast: { message, type, timestamp: Date.now() } }),
    hideToast: () => set({ toast: null }),

    togglePlayerGrowth: () => set(state => {
      if (state.uiState !== 'GAME' || state.player.movementQueue.length > 0) return state;
      if (!state.isPlayerGrowing) {
        const hex = state.grid[getHexKey(state.player.q, state.player.r)];
        if (hex && !checkGrowthCondition(hex, state.player).canGrow) {
           return { toast: { message: "Growth Denied: Check Rank or Queue", type: 'error', timestamp: Date.now() } };
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
      if (state.player.moves < costMoves || state.player.coins < costCoins) return { pendingConfirmation: null };
      return { player: { ...state.player, moves: state.player.moves - costMoves, coins: state.player.coins - costCoins, movementQueue: path }, pendingConfirmation: null, isPlayerGrowing: false };
    }),

    movePlayer: (tq, tr) => set(state => {
      if (state.uiState !== 'GAME' || state.player.movementQueue.length > 0) return state;
      if (tq === state.player.q && tr === state.player.r) return state; 
      
      const targetHex = state.grid[getHexKey(tq, tr)];
      if (targetHex && targetHex.maxLevel > state.player.playerLevel) return { toast: { message: `Rank L${targetHex.maxLevel} Required`, type: 'error', timestamp: Date.now() } };

      // Build obstacle list (bots)
      const obstacles = state.bots.map(b => ({ q: b.q, r: b.r }));
      const path = findPath({ q: state.player.q, r: state.player.r }, { q: tq, r: tr }, state.grid, state.player.playerLevel, obstacles);
      
      if (!path) return { toast: { message: "Path Blocked", type: 'error', timestamp: Date.now() } };

      let totalMoveCost = 0;
      for (const step of path) {
        const hex = state.grid[getHexKey(step.q, step.r)];
        totalMoveCost += (hex && hex.maxLevel >= 2) ? hex.maxLevel : 1;
      }

      let costMoves = Math.min(state.player.moves, totalMoveCost);
      let deficit = totalMoveCost - costMoves;
      let costCoins = deficit * EXCHANGE_RATE_COINS_PER_MOVE;

      if (state.player.coins < costCoins) return { toast: { message: `Need ${totalMoveCost} moves`, type: 'error', timestamp: Date.now() } };
      if (costCoins > 0) return { pendingConfirmation: { type: 'MOVE_WITH_COINS', data: { path, costMoves, costCoins } } };

      return { player: { ...state.player, moves: state.player.moves - costMoves, movementQueue: path }, isPlayerGrowing: false };
    }),

    processMovementStep: () => set(state => {
      if (state.player.movementQueue.length === 0) return state;
      
      // Peek at next step to check collision
      const nextStep = state.player.movementQueue[0];
      
      // Dynamic Collision Detection: Player hitting ANY Bot
      const hitBot = state.bots.find(b => b.q === nextStep.q && b.r === nextStep.r);
      if (hitBot) {
         return { 
           player: { ...state.player, movementQueue: [] },
           toast: { message: `Path Blocked by Sentinel ${hitBot.id}`, type: 'error', timestamp: Date.now() }
         };
      }

      const newQueue = [...state.player.movementQueue];
      newQueue.shift(); // Consume step
      
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
      const newGrid = { ...state.grid };
      let newPlayer = { ...state.player };
      let logs = [...state.messageLog];
      
      // --- PLAYER GROWTH ---
      let isPlayerGrowing = state.isPlayerGrowing;
      const processEntityGrowth = (ent: Entity, isGrowing: boolean): { ent: Entity, growing: boolean, finishedStep: boolean } => {
        const hasUpgradeCmd = ent.movementQueue.length > 0 && ent.movementQueue[0].upgrade;
        if (!isGrowing || (ent.movementQueue.length > 0 && !hasUpgradeCmd)) {
             return { ent, growing: false, finishedStep: false };
        }
        
        const key = getHexKey(ent.q, ent.r);
        const hex = newGrid[key];
        const condition = hex ? checkGrowthCondition(hex, ent) : { canGrow: false };
        
        if (!hex || !condition.canGrow) return { ent, growing: false, finishedStep: false };

        const targetLevel = hex.currentLevel + 1;
        const needed = getSecondsToGrow(targetLevel);
        
        if (hex.progress + 1 >= needed) {
           // LEVEL UP
           const rewards = calculateReward(targetLevel);
           let finalCoins = rewards.coins;
           let newMaxLevel = hex.maxLevel;
           const prefix = ent.type === EntityType.PLAYER ? "[YOU]" : `[${ent.id}]`;
           
           if (targetLevel > hex.maxLevel) {
              newMaxLevel = targetLevel;
              ent.playerLevel = Math.max(ent.playerLevel, targetLevel);
              if (targetLevel === 1) {
                 const q = [...ent.recentUpgrades, hex.id];
                 if (q.length > UPGRADE_LOCK_QUEUE_SIZE) q.shift();
                 ent.recentUpgrades = q;
                 logs.unshift(`${prefix} Sector L1 Acquired`);
              } else {
                 ent.recentUpgrades = [];
                 finalCoins = Math.pow(targetLevel, 2);
                 logs.unshift(`${prefix} Record L${targetLevel}! +${finalCoins} cr`);
              }
           }
           
           ent.coins += finalCoins;
           ent.totalCoinsEarned += finalCoins;
           ent.moves += 1;
           newGrid[key] = { ...hex, currentLevel: targetLevel, maxLevel: newMaxLevel, progress: 0 };
           return { ent, growing: targetLevel < newMaxLevel, finishedStep: true }; 
        } else {
           newGrid[key] = { ...hex, progress: hex.progress + 1 };
           return { ent, growing: true, finishedStep: false };
        }
      };

      const pResult = processEntityGrowth(newPlayer, isPlayerGrowing);
      newPlayer = pResult.ent;
      isPlayerGrowing = pResult.growing;

      // --- BOTS LOOP (Sequential to prevent collision stacking) ---
      let lastBotActionTime = state.lastBotActionTime;
      const newBots: Entity[] = [];
      const growingBotIds: string[] = [];
      
      // Initialize set of occupied coordinates with Player + All Old Bot Positions
      const occupiedHexKeys = new Set<string>();
      occupiedHexKeys.add(getHexKey(newPlayer.q, newPlayer.r));
      state.bots.forEach(b => occupiedHexKeys.add(getHexKey(b.q, b.r)));

      // Iterate bots SEQUENTIALLY
      for (let i = 0; i < state.bots.length; i++) {
         let b = { ...state.bots[i] };
         if (b.memory) b.memory = { ...state.bots[i].memory };
         b.movementQueue = [...state.bots[i].movementQueue];
         
         if (b.memory) b.memory.lastPlayerPos = { q: newPlayer.q, r: newPlayer.r };

         // Remove current bot's old position from occupancy to allow it to move
         const oldKey = getHexKey(b.q, b.r);
         occupiedHexKeys.delete(oldKey);

         // Growth
         let isBotGrowing = state.growingBotIds.includes(b.id);
         const bResult = processEntityGrowth(b, isBotGrowing);
         b = bResult.ent;
         let stillGrowing = bResult.growing;

         if (bResult.finishedStep) {
             if (b.movementQueue.length > 0 && b.movementQueue[0].upgrade) {
                 b.movementQueue.shift();
                 stillGrowing = false;
                 lastBotActionTime = now;
             }
         }

         // Movement / AI Decision
         // We gate all bots by the same interval for simplicity.
         if (!stillGrowing && (now - lastBotActionTime > BOT_ACTION_INTERVAL_MS)) {
             if (b.movementQueue.length > 0) {
                 const nextStep = b.movementQueue[0];
                 if (nextStep.upgrade) {
                     const bKey = getHexKey(b.q, b.r);
                     const bHex = newGrid[bKey];
                     if (bHex && checkGrowthCondition(bHex, b).canGrow) {
                         stillGrowing = true; 
                     } else {
                         b.movementQueue.shift(); // Skip if blocked
                     }
                 } else {
                     // Check collision with CURRENT Occupied Keys (includes Player + Moved Bots + Not Moved Bots)
                     const targetKey = getHexKey(nextStep.q, nextStep.r);
                     
                     if (occupiedHexKeys.has(targetKey)) {
                         b.movementQueue = []; // Stop if path blocked
                     } else {
                         // Process move
                         b.movementQueue.shift();
                         const costHex = newGrid[targetKey];
                         const cost = (costHex && costHex.maxLevel >= 2) ? costHex.maxLevel : 1;
                         
                         let canAfford = false;
                         if (b.moves >= cost) { b.moves -= cost; canAfford = true; }
                         else {
                            const deficit = cost - b.moves;
                            const coinCost = deficit * EXCHANGE_RATE_COINS_PER_MOVE;
                            if (b.coins >= coinCost) { b.moves = 0; b.coins -= coinCost; canAfford = true; }
                         }

                         if (canAfford) {
                             if (newGrid[oldKey]) newGrid[oldKey] = { ...newGrid[oldKey], currentLevel: 0, progress: 0 };
                             b.q = nextStep.q; b.r = nextStep.r;
                             getNeighbors(b.q, b.r).concat({q: b.q, r: b.r}).forEach(n => {
                                const k = getHexKey(n.q, n.r);
                                if (!newGrid[k]) newGrid[k] = createInitialHex(n.q, n.r, 0);
                             });
                         } else {
                             b.movementQueue = [];
                         }
                     }
                 }
             } else {
                 // AI THINK
                 const obstacles = Array.from(occupiedHexKeys).map(k => getCoordinatesFromKey(k));
                 
                 const path = calculateBotMove(b, newGrid, newPlayer, state.winCondition, obstacles);
                 if (path && path.length > 0) {
                     b.movementQueue = path;
                 } else {
                     if (b.coins >= EXCHANGE_RATE_COINS_PER_MOVE) {
                         b.coins -= EXCHANGE_RATE_COINS_PER_MOVE;
                         b.moves += 1;
                     }
                 }
             }
         }

         if (stillGrowing) growingBotIds.push(b.id);
         
         // Register new position as occupied for subsequent bots
         occupiedHexKeys.add(getHexKey(b.q, b.r));
         newBots.push(b);
      }
      
      // Update timer if any bot acted
      if (now - lastBotActionTime > BOT_ACTION_INTERVAL_MS) {
          lastBotActionTime = now;
      }

      // 4. Victory Check
      let newStatus = state.gameStatus;
      if (state.winCondition) {
        const pWin = (state.winCondition.type === 'WEALTH' && newPlayer.totalCoinsEarned >= state.winCondition.target) ||
                     (state.winCondition.type === 'DOMINATION' && newPlayer.playerLevel >= state.winCondition.target);
        
        const bWin = newBots.some(b => 
            (state.winCondition!.type === 'WEALTH' && b.totalCoinsEarned >= state.winCondition!.target) ||
            (state.winCondition!.type === 'DOMINATION' && b.playerLevel >= state.winCondition!.target)
        );

        if (pWin) {
            newStatus = 'VICTORY';
            if (state.user) updateLeaderboard(state.user.nickname, state.user.avatarColor, state.user.avatarIcon, newPlayer.totalCoinsEarned, newPlayer.playerLevel);
        } else if (bWin) {
            newStatus = 'DEFEAT';
        }
      }

      return {
        grid: newGrid,
        player: newPlayer,
        bots: newBots,
        messageLog: logs.slice(0, 50),
        isPlayerGrowing,
        growingBotIds: growingBotIds,
        lastBotActionTime,
        gameStatus: newStatus,
        leaderboard: [...MOCK_LEADERBOARD]
      };
    })
  };
});
