
import { create } from 'zustand';
import { GameState, Entity, Hex, EntityType, UIState, WinCondition, LeaderboardEntry, HexCoord } from './types.ts';
import { 
  INITIAL_MOVES, UPGRADE_LOCK_QUEUE_SIZE, EXCHANGE_RATE_COINS_PER_MOVE, BOT_ACTION_INTERVAL_MS, INITIAL_COINS
} from './constants.ts';
import { 
  getHexKey, getNeighbors, findPath 
} from './services/hexUtils.ts';
import { checkGrowthCondition, calculateReward, getSecondsToGrow } from './gameEngine/rules.ts';
import { calculateBotMove } from './gameEngine/ai.ts';

// --- MOCK DATABASE ---
const MOCK_USER_DB: Record<string, { password: string; avatarColor: string; avatarIcon: string }> = {};

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
    bot: {
      id: 'bot-1',
      type: EntityType.BOT,
      q: 1, r: -1,
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
      }
    } as Entity,
    currentTurn: 0,
    messageLog: [
      'Operational.',
      winCondition ? `Objective: ${winCondition.label}` : 'Objective: Survive.'
    ],
    gameStatus: 'PLAYING' as const,
    pendingConfirmation: null,
    isPlayerGrowing: false,
    isBotGrowing: false,
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

      const path = findPath({ q: state.player.q, r: state.player.r }, { q: tq, r: tr }, state.grid, state.player.playerLevel, [{ q: state.bot.q, r: state.bot.r }]);
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
      
      // Dynamic Collision Detection: Player hitting Bot
      if (nextStep.q === state.bot.q && nextStep.r === state.bot.r) {
         return { 
           player: { ...state.player, movementQueue: [] },
           toast: { message: "Path Blocked by Sentinel", type: 'error', timestamp: Date.now() }
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
      
      // CLONE BOT STATE DEEPLY to prevent mutation bugs
      let newBot = { ...state.bot };
      if (newBot.memory) newBot.memory = { ...state.bot.memory }; 
      newBot.movementQueue = [...state.bot.movementQueue]; 

      let logs = [...state.messageLog];
      let isPlayerGrowing = state.isPlayerGrowing;
      let isBotGrowing = state.isBotGrowing;
      let lastBotActionTime = state.lastBotActionTime;
      
      // Update Memory
      if (newBot.memory) {
         newBot.memory.lastPlayerPos = { q: newPlayer.q, r: newPlayer.r };
      }

      // --- HELPER: Process Entity Growth ---
      const processEntityGrowth = (ent: Entity, isGrowing: boolean): { ent: Entity, growing: boolean, finishedStep: boolean } => {
        // Allow growth if queue is empty OR if the first item is an explicit upgrade command
        const hasUpgradeCmd = ent.movementQueue.length > 0 && ent.movementQueue[0].upgrade;
        
        // Block growth if moving (unless upgrading)
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
           const prefix = ent.type === EntityType.PLAYER ? "[YOU]" : "[SENTINEL]";
           
           if (targetLevel > hex.maxLevel) {
              // RECORD BREAKING
              newMaxLevel = targetLevel;
              ent.playerLevel = Math.max(ent.playerLevel, targetLevel);
              
              if (targetLevel === 1) {
                 // Expand Cycle
                 const q = [...ent.recentUpgrades, hex.id];
                 if (q.length > UPGRADE_LOCK_QUEUE_SIZE) q.shift();
                 ent.recentUpgrades = q;
                 logs.unshift(`${prefix} Sector L1 Acquired`);
              } else {
                 // Major Break - Reset Queue
                 ent.recentUpgrades = [];
                 finalCoins = Math.pow(targetLevel, 2);
                 logs.unshift(`${prefix} Record L${targetLevel}! +${finalCoins} credits`);
              }
           }
           
           ent.coins += finalCoins;
           ent.totalCoinsEarned += finalCoins;
           ent.moves += 1;
           newGrid[key] = { ...hex, currentLevel: targetLevel, maxLevel: newMaxLevel, progress: 0 };
           
           return { ent, growing: targetLevel < newMaxLevel, finishedStep: true }; 
        } else {
           // PROGRESS
           newGrid[key] = { ...hex, progress: hex.progress + 1 };
           return { ent, growing: true, finishedStep: false };
        }
      };

      // 1. Player Growth
      const pResult = processEntityGrowth(newPlayer, isPlayerGrowing);
      newPlayer = pResult.ent;
      isPlayerGrowing = pResult.growing;

      // 2. Bot Growth (Unified Logic)
      const bResult = processEntityGrowth(newBot, isBotGrowing);
      newBot = bResult.ent;
      isBotGrowing = bResult.growing;

      // Handle Upgrade Command Completion
      if (bResult.finishedStep) {
          if (newBot.movementQueue.length > 0 && newBot.movementQueue[0].upgrade) {
              newBot.movementQueue.shift();
              // If we leveled up from a command, stop growing to allow re-evaluation (or next command)
              isBotGrowing = false;
              lastBotActionTime = now; // Pause after action
          }
      }

      // 3. Bot Logic (Movement / Decision) - Gated by Interval
      if (!isBotGrowing && (now - lastBotActionTime > BOT_ACTION_INTERVAL_MS)) {
        
        if (newBot.movementQueue.length > 0) {
            const nextStep = newBot.movementQueue[0];
            
            // CHECK FOR UPGRADE COMMAND (Forced Growth)
            if (nextStep.upgrade) {
                const bKey = getHexKey(newBot.q, newBot.r);
                const bHex = newGrid[bKey];
                
                // Double check rules before starting growth
                if (bHex && checkGrowthCondition(bHex, newBot).canGrow) {
                    isBotGrowing = true;
                    lastBotActionTime = now; // Action started
                } else {
                    // Cannot fulfill command (blocked?), skip it to prevent lock
                    newBot.movementQueue.shift();
                    lastBotActionTime = now; // Action used
                }
            } else {
                // STANDARD MOVEMENT
                // Dynamic Collision Detection: Bot hitting Player
                if (nextStep.q === newPlayer.q && nextStep.r === newPlayer.r) {
                     // Abort movement
                     newBot.movementQueue = [];
                     lastBotActionTime = now; // Pause
                } else {
                    newBot.movementQueue.shift();
                    const oldKey = getHexKey(newBot.q, newBot.r);
                    const nextKey = getHexKey(nextStep.q, nextStep.r);
                    
                    // Consume Cost
                    const nextHex = newGrid[nextKey];
                    const cost = (nextHex && nextHex.maxLevel >= 2) ? nextHex.maxLevel : 1;
                    
                    let canAfford = false;
                    if (newBot.moves >= cost) {
                        newBot.moves -= cost;
                        canAfford = true;
                    } else {
                        const deficit = cost - newBot.moves;
                        const coinCost = deficit * EXCHANGE_RATE_COINS_PER_MOVE;
                        if (newBot.coins >= coinCost) {
                            newBot.moves = 0;
                            newBot.coins -= coinCost;
                            canAfford = true;
                        }
                    }

                    if (canAfford) {
                        if (newGrid[oldKey]) newGrid[oldKey] = { ...newGrid[oldKey], currentLevel: 0, progress: 0 };
                        newBot.q = nextStep.q;
                        newBot.r = nextStep.r;
                        
                        getNeighbors(newBot.q, newBot.r).concat({q: newBot.q, r: newBot.r}).forEach(n => {
                            const k = getHexKey(n.q, n.r);
                            if (!newGrid[k]) newGrid[k] = createInitialHex(n.q, n.r, 0);
                        });
                        lastBotActionTime = now; // Action completed
                    } else {
                        newBot.movementQueue = []; // Clear queue if stuck
                        lastBotActionTime = now;
                    }
                }
            }
        } else {
            // DECIDE: Grow or Move?
            const path = calculateBotMove(newBot, newGrid, newPlayer, state.winCondition);
            if (path && path.length > 0) {
                 newBot.movementQueue = path;
                 lastBotActionTime = now; // Wait before acting on new plan
            } else {
                 // Idle / Recharge (if stuck or wealthy)
                 if (newBot.coins >= EXCHANGE_RATE_COINS_PER_MOVE) {
                     newBot.coins -= EXCHANGE_RATE_COINS_PER_MOVE;
                     newBot.moves += 1;
                 }
                 lastBotActionTime = now;
            }
        }
      }

      // 4. Victory Check
      let newStatus = state.gameStatus;
      if (state.winCondition) {
        const pWin = (state.winCondition.type === 'WEALTH' && newPlayer.totalCoinsEarned >= state.winCondition.target) ||
                     (state.winCondition.type === 'DOMINATION' && newPlayer.playerLevel >= state.winCondition.target);
        
        const bWin = (state.winCondition.type === 'WEALTH' && newBot.totalCoinsEarned >= state.winCondition.target) ||
                     (state.winCondition.type === 'DOMINATION' && newBot.playerLevel >= state.winCondition.target);

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
        bot: newBot,
        messageLog: logs.slice(0, 50),
        isPlayerGrowing,
        isBotGrowing,
        lastBotActionTime,
        gameStatus: newStatus,
        leaderboard: [...MOCK_LEADERBOARD]
      };
    })
  };
});
