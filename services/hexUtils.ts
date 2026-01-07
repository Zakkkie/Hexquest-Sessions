
import { Coordinates, Hex, Entity, EntityType, WinCondition } from '../types';
import { SECONDS_PER_LEVEL_UNIT, UPGRADE_LOCK_QUEUE_SIZE, HEX_SIZE, EXCHANGE_RATE_COINS_PER_MOVE } from '../constants';

// --- Coordinate Math ---

export const getHexKey = (q: number, r: number): string => `${q},${r}`;

export const getCoordinatesFromKey = (key: string): Coordinates => {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
};

export const hexToPixel = (q: number, r: number): { x: number, y: number } => {
  const x = HEX_SIZE * (3/2 * q);
  const y = HEX_SIZE * Math.sqrt(3) * (r + q / 2);
  return { x, y };
};

export const cubeDistance = (a: Coordinates, b: Coordinates): number => {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
};

export const getDistanceToCenter = (q: number, r: number): number => {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
};

export const getNeighbors = (q: number, r: number): Coordinates[] => {
  const directions = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
  ];
  return directions.map(d => ({ q: q + d.q, r: r + d.r }));
};

// --- Game Rule Calculations ---

export const calculateReward = (newHexLevel: number): { coins: number, moves: number } => {
  return {
    coins: newHexLevel,
    moves: 1
  };
};

export const getSecondsToGrow = (targetLevel: number): number => {
  return targetLevel * SECONDS_PER_LEVEL_UNIT;
};

export const checkGrowthCondition = (
  hex: Hex, 
  entity: Entity
): { canGrow: boolean; reason?: string } => {
  const targetLevel = Number(hex.currentLevel) + 1;

  if (targetLevel > hex.maxLevel) {
    if (targetLevel === 1) return { canGrow: true };

    if (entity.recentUpgrades.length < UPGRADE_LOCK_QUEUE_SIZE) {
      return { 
        canGrow: false, 
        reason: `CYCLE INCOMPLETE (${entity.recentUpgrades.length}/${UPGRADE_LOCK_QUEUE_SIZE}) - CAPTURE 3 SECTORS FIRST` 
      };
    }

    if (entity.playerLevel < targetLevel - 1) {
      return { 
        canGrow: false, 
        reason: `COMMANDER RANK TOO LOW (NEED L${targetLevel - 1} GLOBALLY)` 
      };
    }
  }

  return { canGrow: true };
};

// --- Pathfinding & Bot Logic ---

/**
 * Dijkstra's algorithm to find the CHEAPEST path (by movement cost)
 */
export const findPath = (
  start: Coordinates, 
  end: Coordinates, 
  grid: Record<string, Hex>,
  playerRank: number,
  obstacles: Coordinates[]
): Coordinates[] | null => {
  const startKey = getHexKey(start.q, start.r);
  const endKey = getHexKey(end.q, end.r);
  
  if (startKey === endKey) return null;

  const obstacleKeys = new Set(obstacles.map(o => getHexKey(o.q, o.r)));
  const distances: Record<string, number> = { [startKey]: 0 };
  const previous: Record<string, Coordinates | null> = { [startKey]: null };
  const priorityQueue: { key: string, priority: number }[] = [{ key: startKey, priority: 0 }];

  while (priorityQueue.length > 0) {
    priorityQueue.sort((a, b) => a.priority - b.priority);
    const { key } = priorityQueue.shift()!;
    
    if (key === endKey) {
      const path: Coordinates[] = [];
      let current: Coordinates | null = end;
      while (current && getHexKey(current.q, current.r) !== startKey) {
        path.unshift(current);
        current = previous[getHexKey(current.q, current.r)];
      }
      return path;
    }

    const currentCoord = getCoordinatesFromKey(key);
    const neighbors = getNeighbors(currentCoord.q, currentCoord.r);

    for (const neighbor of neighbors) {
      const nKey = getHexKey(neighbor.q, neighbor.r);
      if (obstacleKeys.has(nKey)) continue;

      const hex = grid[nKey];
      // Check for Rank Lock
      if (hex && hex.maxLevel > playerRank) continue;

      // Unexplored hexes are allowed but treated as L1
      const stepCost = (hex && hex.maxLevel >= 2) ? hex.maxLevel : 1;
      const newDist = distances[key] + stepCost;

      if (!(nKey in distances) || newDist < distances[nKey]) {
        distances[nKey] = newDist;
        previous[nKey] = currentCoord;
        priorityQueue.push({ key: nKey, priority: newDist });
      }
    }
  }

  // Fallback for immediate neighbor exploration
  if (cubeDistance(start, end) === 1 && !obstacleKeys.has(endKey)) {
    return [end];
  }

  return null;
};

/**
 * Hyper-Aggressive Leveling Strategy
 * The bot's SOLE GOAL is to increase playerLevel.
 */
export const calculateBotMove = (
  bot: Entity, 
  grid: Record<string, Hex>,
  opponent: Coordinates,
  winCondition: WinCondition | null // Ignored, we always play for Rank now
): Coordinates[] | null => {
  const needsToFillQueue = bot.recentUpgrades.length < UPGRADE_LOCK_QUEUE_SIZE;
  const recentlyUpgradedSet = new Set(bot.recentUpgrades);
  const botHexKey = getHexKey(bot.q, bot.r);
  
  let bestTarget: Coordinates | null = null;
  let maxScore = -Infinity;

  const allHexKeys = Object.keys(grid);

  // Calculate total potential range based on Moves + Coins
  const totalPotentialMoves = bot.moves + Math.floor(bot.coins / EXCHANGE_RATE_COINS_PER_MOVE);

  for (const key of allHexKeys) {
    if (key === botHexKey) continue;
    
    const targetHex = grid[key];
    const targetCoord = { q: targetHex.q, r: targetHex.r };
    
    // Safety check: Don't target the player
    if (targetCoord.q === opponent.q && targetCoord.r === opponent.r) continue;

    // Safety check: Cannot enter hexes above rank
    if (targetHex.maxLevel > bot.playerLevel) continue;

    const dist = cubeDistance(bot, targetCoord);
    
    // STRICT CHECK: If we literally cannot afford to get there, ignore it.
    if (dist > totalPotentialMoves + 1) continue; 
    
    // Optimize performance
    if (dist > 10) continue;

    let score = 0;
    
    // Base distance penalty
    score -= dist * 10;

    const isLockedByQueue = recentlyUpgradedSet.has(key);

    // --- STRATEGY CORE ---

    if (needsToFillQueue) {
      // PHASE 1: REFUELING
      // We are blocked from upgrading high level tiles.
      // Goal: Touch 3 unique tiles as fast/cheap as possible.
      
      if (isLockedByQueue) {
        score = -Infinity; // Can't help us
      } else {
        if (targetHex.maxLevel === 0) {
           // Best case: Free L0 land. Very fast.
           score += 5000; 
        } else if (targetHex.maxLevel === 1) {
           // Good case: Cheap L1.
           score += 4000; 
        } else {
           // Bad case: Taking an L5 tile just to fill a queue slot is a massive waste of moves/coins.
           // We punish this heavily.
           score -= 1000; 
        }
      }
    } else {
      // PHASE 2: LIMIT BREAK (The Sole Goal)
      // The queue is full. We are ready to upgrade a Major Hex.
      
      if (targetHex.maxLevel === bot.playerLevel) {
        // [JACKPOT]
        // This tile is at our current max. Growing it pushes it to Level + 1.
        // This immediately increases our global rank.
        score += 1000000; 
      } else if (targetHex.maxLevel === bot.playerLevel - 1) {
        // [STAGING]
        // We can't find a limit breaker, so we prepare a tile to BECOME a limit breaker next cycle.
        score += 500000;
      } else {
        // [NOISE]
        // This tile is too low level to help us rank up. Ignore it.
        score = -Infinity;
      }
    }

    if (score > maxScore) {
      maxScore = score;
      bestTarget = targetCoord;
    }
  }

  if (bestTarget) {
    return findPath(
      { q: bot.q, r: bot.r }, 
      bestTarget, 
      grid, 
      bot.playerLevel, 
      [opponent]
    );
  }

  return null;
};
