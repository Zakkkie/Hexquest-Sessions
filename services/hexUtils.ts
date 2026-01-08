
import { Hex, HexCoord } from '../types';
import { HEX_SIZE } from '../constants';

// --- Coordinate Math ---

export const getHexKey = (q: number, r: number): string => `${q},${r}`;

export const getCoordinatesFromKey = (key: string): HexCoord => {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
};

export const hexToPixel = (q: number, r: number): { x: number, y: number } => {
  const x = HEX_SIZE * (3/2 * q);
  const y = HEX_SIZE * Math.sqrt(3) * (r + q / 2);
  return { x, y };
};

export const cubeDistance = (a: HexCoord, b: HexCoord): number => {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
};

export const getNeighbors = (q: number, r: number): HexCoord[] => {
  const directions = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
  ];
  return directions.map(d => ({ q: q + d.q, r: r + d.r }));
};

// Re-export for compatibility with components using these names
export { calculateReward, getSecondsToGrow, checkGrowthCondition } from '../gameEngine/rules';

// --- Pathfinding ---

export const findPath = (
  start: HexCoord, 
  end: HexCoord, 
  grid: Record<string, Hex>,
  playerRank: number,
  obstacles: HexCoord[]
): HexCoord[] | null => {
  const startKey = getHexKey(start.q, start.r);
  const endKey = getHexKey(end.q, end.r);
  
  if (startKey === endKey) return null;

  const obstacleKeys = new Set(obstacles.map(o => getHexKey(o.q, o.r)));

  // CRITICAL FIX: If destination is an obstacle, it is unreachable.
  // Return immediately to prevent infinite search in implicit graph.
  if (obstacleKeys.has(endKey)) return null;

  const distances: Record<string, number> = { [startKey]: 0 };
  const previous: Record<string, HexCoord | null> = { [startKey]: null };
  const priorityQueue: { key: string, priority: number }[] = [{ key: startKey, priority: 0 }];

  // Safety: Limit search to prevent freezes on large/infinite maps
  let iterations = 0;
  const MAX_ITERATIONS = 3000;

  while (priorityQueue.length > 0) {
    iterations++;
    if (iterations > MAX_ITERATIONS) return null; // Path too complex or infinite

    priorityQueue.sort((a, b) => a.priority - b.priority);
    const { key } = priorityQueue.shift()!;
    
    if (key === endKey) {
      const path: HexCoord[] = [];
      let current: HexCoord | null = end;
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

      // Path Cost: High Level = High Cost, Unknown = 1
      const stepCost = (hex && hex.maxLevel >= 2) ? hex.maxLevel : 1;
      const newDist = distances[key] + stepCost;

      if (!(nKey in distances) || newDist < distances[nKey]) {
        distances[nKey] = newDist;
        previous[nKey] = currentCoord;
        priorityQueue.push({ key: nKey, priority: newDist });
      }
    }
  }

  // Fallback: If adjacent and not obstacle, allow move (visual fallback)
  if (cubeDistance(start, end) === 1 && !obstacleKeys.has(endKey)) {
    return [end];
  }

  return null;
};
