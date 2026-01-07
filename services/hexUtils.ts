
import { Coordinates, Hex, Entity, EntityType } from '../types';
import { SECONDS_PER_LEVEL_UNIT, UPGRADE_LOCK_QUEUE_SIZE, HEX_SIZE } from '../constants';

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

export const calculateBotMove = (
  bot: Entity, 
  grid: Record<string, Hex>,
  opponent: Coordinates
): Coordinates | null => {
  const neighbors = getNeighbors(bot.q, bot.r);
  
  const validNeighbors = neighbors.filter(n => {
    if (n.q === opponent.q && n.r === opponent.r) return false;
    const key = getHexKey(n.q, n.r);
    const hex = grid[key];
    if (hex && hex.maxLevel > bot.playerLevel) return false;
    return true;
  });
  
  const scoredMoves = validNeighbors.map(coord => {
    const key = getHexKey(coord.q, coord.r);
    const hex = grid[key];
    const dist = getDistanceToCenter(coord.q, coord.r);
    const isNew = !hex || hex.maxLevel === 0;
    
    let score = 0;
    if (isNew) score += 100;
    score -= dist * 2; 

    return { coord, score };
  });

  scoredMoves.sort((a, b) => b.score - a.score);
  return scoredMoves.length > 0 ? scoredMoves[0].coord : null;
};
