
import { Entity, Hex, HexCoord, WinCondition } from '../types';
import { UPGRADE_LOCK_QUEUE_SIZE, EXCHANGE_RATE_COINS_PER_MOVE } from '../constants';
import { getHexKey, cubeDistance, findPath } from '../services/hexUtils';
import { checkGrowthCondition, getSecondsToGrow } from './rules';

// --- CONFIGURATION (Based on JSON Balance) ---
const WEIGHTS = {
  INCOME: 1.5,      // Value of potential coins/growth
  DISTANCE: 2.0,    // Penalty for travel distance
  RISK: 3.0,        // Penalty for bankruptcy risk
  STRATEGY: 5.0,    // Value of objective completion (Rank up)
  AGGRESSION: 0.5   // Value of moving towards opponent
};

enum BotRole {
  SURVIVAL = 'SURVIVAL',       // Low resources: panic mode, find cheapest valid move
  EXPAND = 'EXPAND',           // Queue not full: fill queue with L0/L1
  EVOLUTION = 'EVOLUTION',     // Queue full: seek Rank Up target
  COMPETITION = 'COMPETITION'  // High resources: move towards player to contest area
}

interface ScoredCandidate {
  coord: HexCoord;
  score: number;
  role: BotRole;
  pathCost: number;
}

/**
 * Determines the current operational role of the Bot based on its state.
 */
const determineRole = (bot: Entity, player: Entity): BotRole => {
  const totalResources = bot.moves + (bot.coins / EXCHANGE_RATE_COINS_PER_MOVE);
  const queueSize = bot.recentUpgrades.length;

  // 1. Critical Resource Shortage
  if (totalResources < 3) {
    return BotRole.SURVIVAL;
  }

  // 2. Queue Mechanics (Cycle Lock)
  if (queueSize < UPGRADE_LOCK_QUEUE_SIZE) {
    return BotRole.EXPAND;
  }

  // 3. Wealth/Dominance check
  // If we are rich and queue is full, we try to rank up (Evolution).
  // If we are VERY rich, we might mix in aggression (not fully implemented in movement, but influences utility).
  return BotRole.EVOLUTION;
};

/**
 * Calculates the utility score of a target hex based on the current Role.
 * Formula: income_gain * w_income + strategic_value * w_position - risk * w_risk - distance * w_distance
 */
const calculateHexUtility = (
  targetHex: Hex,
  bot: Entity,
  player: Entity,
  role: BotRole,
  dist: number,
  totalResources: number
): number => {
  let score = 0;
  
  // --- A. INCOME / POTENTIAL (w_income) ---
  // Base value of the tile (higher level = more potential reward)
  // We prioritize L0/L1 in EXPAND, but high levels in EVOLUTION
  let incomePotential = 0;
  if (role === BotRole.EXPAND) {
      if (targetHex.maxLevel === 0) incomePotential = 20;
      else if (targetHex.maxLevel === 1) incomePotential = 10;
      else incomePotential = 0;
  } else if (role === BotRole.EVOLUTION) {
      // In evolution, we value tiles that match our level (to break through)
      incomePotential = targetHex.maxLevel * 10;
  }
  
  // Bonus if we can grow immediately upon arrival
  const growthCheck = checkGrowthCondition(targetHex, bot);
  if (growthCheck.canGrow) {
      incomePotential += 15;
      // Bonus for fast growth tiles
      const timeToGrow = getSecondsToGrow(targetHex.currentLevel + 1);
      if (timeToGrow <= 20) incomePotential += 5;
  }

  score += incomePotential * WEIGHTS.INCOME;

  // --- B. DISTANCE COST (w_distance) ---
  // Heuristic distance penalty
  score -= (dist * 10) * WEIGHTS.DISTANCE;

  // --- C. STRATEGIC VALUE (w_position) ---
  if (role === BotRole.EVOLUTION) {
      if (targetHex.maxLevel === bot.playerLevel) {
          // CRITICAL OBJECTIVE: This tile allows ranking up
          score += 1000 * WEIGHTS.STRATEGY; 
      } else {
          // Distraction penalty
          score -= 50; 
      }
  }

  if (role === BotRole.EXPAND) {
      // Penalize tiles already in queue
      if (bot.recentUpgrades.includes(targetHex.id)) {
          score -= 500 * WEIGHTS.RISK; // "Cycle Lock" risk
      }
  }

  // Aggression: Slight bonus for moving towards player if resources allow
  if (bot.memory?.lastPlayerPos && totalResources > 15) {
      const distToPlayer = cubeDistance({q: targetHex.q, r: targetHex.r}, bot.memory.lastPlayerPos);
      // Closer to player = higher score (inverted logic)
      score += (20 - distToPlayer) * WEIGHTS.AGGRESSION;
  }

  // --- D. RISK (w_risk) ---
  // Estimating move cost (rough heuristic: maxLevel represents cost)
  // Real path cost is calculated later, this is for filtering.
  const estimatedCost = (targetHex.maxLevel > 1 ? targetHex.maxLevel : 1) + (dist - 1); 
  
  if (estimatedCost >= totalResources) {
      // Bankruptcy Risk: Impossible or suicidal move
      score -= 10000 * WEIGHTS.RISK;
  } else if (estimatedCost > totalResources * 0.7) {
      // High spending risk
      score -= 50 * WEIGHTS.RISK;
  }

  return score;
};

export const calculateBotMove = (
  bot: Entity, 
  grid: Record<string, Hex>,
  player: Entity,
  winCondition: WinCondition | null
): HexCoord[] | null => {
  
  const botHexKey = getHexKey(bot.q, bot.r);
  const totalResources = bot.moves + Math.floor(bot.coins / EXCHANGE_RATE_COINS_PER_MOVE);
  const currentRole = determineRole(bot, player);
  
  const candidates: ScoredCandidate[] = [];

  // 1. SCAN AND SCORE
  for (const key in grid) {
    if (key === botHexKey) continue;
    const hex = grid[key];

    // Hard Rules
    if (hex.maxLevel > bot.playerLevel) continue; // Rank Lock
    if (hex.q === player.q && hex.r === player.r) continue; // Collision

    // Heuristic Distance Check
    const dist = cubeDistance(bot, {q: hex.q, r: hex.r});
    
    // Optimization: Don't look too far unless desperate
    const searchRadius = currentRole === BotRole.SURVIVAL ? 3 : 8;
    if (dist > searchRadius) continue;

    const score = calculateHexUtility(hex, bot, player, currentRole, dist, totalResources);
    
    candidates.push({ 
        coord: { q: hex.q, r: hex.r }, 
        score, 
        role: currentRole,
        pathCost: 0 // calculated later
    });
  }

  // 2. RANK CANDIDATES
  candidates.sort((a, b) => b.score - a.score);

  // 3. PATH VALIDATION (Lookahead Depth 1 essentially)
  // We check the top few candidates to see if a valid path exists and is affordable.
  const checkCount = currentRole === BotRole.SURVIVAL ? 10 : 5;
  
  for (let i = 0; i < Math.min(candidates.length, checkCount); i++) {
      const candidate = candidates[i];
      
      // If score is terrible, stop checking
      if (candidate.score < -5000) break;

      const path = findPath(
        { q: bot.q, r: bot.r },
        candidate.coord,
        grid,
        bot.playerLevel,
        [{ q: player.q, r: player.r }]
      );

      if (path) {
          // Calculate True Cost
          let realCost = 0;
          for (const step of path) {
              const h = grid[getHexKey(step.q, step.r)];
              realCost += (h && h.maxLevel >= 2) ? h.maxLevel : 1;
          }

          // Safety Margin check
          const safetyMargin = currentRole === BotRole.SURVIVAL ? 0 : 1;
          
          if (realCost + safetyMargin <= totalResources) {
              return path;
          }
      }
  }

  return null;
};
