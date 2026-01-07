
import { create } from 'zustand';
import { GameState, Entity, Hex, EntityType, UserProfile, UIState, WinCondition } from './types.ts';
import { 
  INITIAL_MOVES, UPGRADE_LOCK_QUEUE_SIZE, EXCHANGE_RATE_COINS_PER_MOVE, 
  BOT_ACTION_INTERVAL_MS, SECONDS_PER_LEVEL_UNIT 
} from './constants.ts';
import { 
  getHexKey, getNeighbors, checkGrowthCondition, getSecondsToGrow, 
  calculateReward, calculateBotMove, findPath 
} from './services/hexUtils.ts';

// --- MOCK DATABASE (In-Memory) ---
const MOCK_USER_DB: Record<string, { password: string; avatarColor: string; avatarIcon: string }> = {};

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
    toast: null
  };
};

export const useGameStore = create<GameStore>((set, get) => {
  const initialGameData = generateInitialGameData(null);

  return {
    uiState: 'MENU',
    user: null, 
    hasActiveSession: false,
    ...initialGameData,
    
    setUIState: (uiState) => set({ uiState }),

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
      const freshState = generateInitialGameData(null);
      set({ ...freshState, user: null, uiState: 'MENU', hasActiveSession: false, gameStatus: 'GAME_OVER' });
    },

    startNewGame: (winCondition) => set((state) => ({
      ...generateInitialGameData(winCondition),
      user: state.user,
      hasActiveSession: true,
      uiState: 'GAME'
    })),

    abandonSession: () => set((state) => ({
      ...generateInitialGameData(null),
      user: state.user,
      uiState: 'MENU',
      hasActiveSession: false, 
      gameStatus: 'GAME_OVER'
    })),

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
                if (updatedEntity.recentUpgrades.length < UPGRADE_LOCK_QUEUE_SIZE) {
                  updatedEntity.recentUpgrades = [...updatedEntity.recentUpgrades, hex.id];
                  currentLogs.push(`Sector L1 Acquired.`);
                }
              } else {
                updatedEntity.recentUpgrades = [];
                finalCoins = targetLevel * targetLevel;
                currentLogs.push(`RECORD BREAK L${targetLevel}! +${finalCoins}©`);
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
      logs = [...bRes.logs, ...logs];

      if (!isBotGrowing && now - lastBotActionTime > BOT_ACTION_INTERVAL_MS) {
        const bKey = getHexKey(newBot.q, newBot.r);
        const bHex = newGrid[bKey];
        if (bHex && checkGrowthCondition(bHex, newBot).canGrow) {
           isBotGrowing = true;
           lastBotActionTime = now;
        } else {
           const target = calculateBotMove(newBot, newGrid, { q: newPlayer.q, r: newPlayer.r });
           if (target) {
              const targetHex = newGrid[getHexKey(target.q, target.r)];
              const moveCost = (targetHex && targetHex.maxLevel >= 2) ? targetHex.maxLevel : 1;
              
              if (newBot.moves >= moveCost) {
                if (bHex) newGrid[bKey] = { ...bHex, currentLevel: 0, progress: 0 };
                newBot.q = target.q; 
                newBot.r = target.r; 
                newBot.moves -= moveCost;
                getNeighbors(target.q, target.r).concat(target).forEach(n => {
                  const k = getHexKey(n.q, n.r);
                  if (!newGrid[k]) newGrid[k] = createInitialHex(n.q, n.r, 0);
                });
              } else if (newBot.coins >= EXCHANGE_RATE_COINS_PER_MOVE * moveCost) {
                newBot.coins -= EXCHANGE_RATE_COINS_PER_MOVE * moveCost;
                newBot.moves += moveCost;
              }
           }
           lastBotActionTime = now;
        }
      }

      if (state.winCondition) {
        if ((state.winCondition.type === 'WEALTH' && newPlayer.totalCoinsEarned >= state.winCondition.target) || 
            (state.winCondition.type === 'DOMINATION' && newPlayer.playerLevel >= state.winCondition.target)) {
           newGameStatus = 'VICTORY';
        }
      }

      return { grid: newGrid, player: newPlayer, bot: newBot, messageLog: logs.slice(0, 50), isPlayerGrowing, isBotGrowing, lastBotActionTime, gameStatus: newGameStatus };
    })
  };
});
