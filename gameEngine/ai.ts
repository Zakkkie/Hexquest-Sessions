
import { Entity, Hex, HexCoord, WinCondition } from '../types';
import { UPGRADE_LOCK_QUEUE_SIZE, EXCHANGE_RATE_COINS_PER_MOVE } from '../constants';
import { getHexKey, cubeDistance, findPath } from '../services/hexUtils';
import { checkGrowthCondition } from './rules';

// --- CONFIGURATION (Based on JSON Specs) ---
const WEIGHTS = {
  INCOME: 1.0,
  POSITION: 3.0,    
  RISK: 1.5,
  DISTANCE: 2.0,    
  AGGRESSION: 1.2
};

enum BotRole {
  SURVIVAL = 'SURVIVAL',
  EXPAND = 'EXPAND',           // Harvest L0s
  EVOLUTION = 'EVOLUTION',     // Early game Rank Up (L0-L2)
  COMPETITION = 'COMPETITION', // Mid-resource aggression
  DEVELOPMENT = 'DEVELOPMENT'  // Late game Tower Building (L3+)
}

interface ScoredCandidate {
  coord: HexCoord;
  score: number;
  role: BotRole;
  estimatedCost: number;
}

/**
 * Determines the current tactical role of the Bot.
 */
const determineRole = (bot: Entity, player: Entity, grid: Record<string, Hex>, winCondition: WinCondition | null): BotRole => {
  const totalResources = bot.moves + Math.floor(bot.coins / EXCHANGE_RATE_COINS_PER_MOVE);
  const queueSize = bot.recentUpgrades.length;

  // 1. SURVIVAL
  // If we can't move more than once or twice, we are in trouble.
  if (totalResources < 3) {
    return BotRole.SURVIVAL;
  }

  // 2. HARVEST MODE (Cycle Lock)
  // If the queue isn't full, we are legally blocked from upgrading high-level hexes.
  // We MUST expand to fill the queue.
  if (queueSize < UPGRADE_LOCK_QUEUE_SIZE) {
    return BotRole.EXPAND;
  }

  // 3. EVOLUTION (Rank Up - Early Game)
  // If we haven't reached Level 3 yet, focus on simply hitting the next rank 
  // rather than complex development strategies.
  if (bot.playerLevel < 3) {
    return BotRole.EVOLUTION;
  }

  // 4. DEVELOPMENT (Return to Power)
  // If Domination is active, prioritize Development to reach the target rank.
  if (winCondition?.type === 'DOMINATION' && totalResources >= 5) {
      return BotRole.DEVELOPMENT;
  }

  // Standard Development threshold
  if (totalResources >= 5) {
      return BotRole.DEVELOPMENT;
  }

  // 5. COMPETITION (Fallback)
  return BotRole.COMPETITION;
};

/**
 * UTILITY FUNCTION
 */
const calculateHexUtility = (
  targetHex: Hex,
  bot: Entity,
  player: Entity,
  role: BotRole,
  dist: number,
  totalResources: number,
  ownedHexCount: number,
  winCondition: WinCondition | null
): number => {
  let utility = 0;

  // --- A. STRATEGIC VALUE (w_position) ---
  let strategicValue = 0;
  const isQueued = bot.recentUpgrades.includes(targetHex.id);

  // Determine Level Cap based on Win Condition
  const levelCap = (winCondition?.type === 'DOMINATION') ? 99 : 7;

  switch (role) {
    case BotRole.SURVIVAL:
      // Just find any cheap land. Prioritize L0 heavily to jumpstart economy.
      if (targetHex.maxLevel === 0) strategicValue = 200;
      else if (targetHex.maxLevel <= 1) strategicValue = 50;
      break;

    case BotRole.EXPAND:
      // HARVEST LOGIC: Target L0s exclusively.
      if (targetHex.maxLevel === 0) {
          strategicValue = 200; // Massive base score for L0
      } else {
          // If we are standing on a non-L0, we want to leave it to find an L0.
          if (dist === 0) strategicValue = 0;
          else strategicValue = -500; // Ignore everything else
      }
      break;

    case BotRole.EVOLUTION:
      // Target current max level to rank up
      if (targetHex.maxLevel === bot.playerLevel) {
        strategicValue = 150;
      } else {
        strategicValue = -50;
      }
      break;

    case BotRole.DEVELOPMENT:
        // BUILD TALL LOGIC: Target the absolute highest level hex we can find.
        if (targetHex.maxLevel >= 2 && targetHex.maxLevel < levelCap) {
            strategicValue = 100;
            // Exponential bonus for higher levels to differentiate L5 from L2
            strategicValue += Math.pow(targetHex.maxLevel, 2) * 10;
            
            // Extra bonus if this hex IS the bot's current max level (the "King" hex)
            if (targetHex.maxLevel === bot.playerLevel) {
                strategicValue += 100;
            }

            // DOMINATION SPECIAL:
            // Explicitly prioritize the hex that allows ranking up (Level == PlayerLevel)
            if (winCondition?.type === 'DOMINATION' && targetHex.maxLevel === bot.playerLevel) {
                strategicValue += 1000;
            }
        } else if (targetHex.maxLevel === 0) {
            strategicValue = -100; // Ignore L0s in Development phase
        } else {
            strategicValue = -50;
        }
        break;

    case BotRole.COMPETITION:
      if (!isQueued && targetHex.maxLevel === 0) {
        strategicValue = 50;
        if (bot.memory?.lastPlayerPos) {
           const distToPlayer = cubeDistance({q: targetHex.q, r: targetHex.r}, bot.memory.lastPlayerPos);
           strategicValue += (15 - distToPlayer) * WEIGHTS.AGGRESSION;
        }
      } else {
        strategicValue = -20;
      }
      break;
  }
  utility += strategicValue * WEIGHTS.POSITION;

  // --- B. INCOME GAIN (w_income) ---
  const nextLevel = targetHex.maxLevel + 1;
  const potentialIncome = Math.pow(nextLevel, 2) * 1.5; 
  utility += potentialIncome * WEIGHTS.INCOME;

  // --- C. RISK & COST (w_risk) ---
  const entryCost = targetHex.maxLevel >= 2 ? targetHex.maxLevel : 1;
  const travelCost = Math.max(0, dist - 1); 
  const totalEstimatedCost = travelCost + entryCost;

  // FIX: Allow spending the very last resource (use > instead of >=)
  // This allows the bot to move when Moves=1 and Cost=1
  if (totalEstimatedCost > totalResources) {
    utility -= 5000 * WEIGHTS.RISK; // Bankruptcy Check
  } else {
    utility -= totalEstimatedCost * WEIGHTS.RISK;
  }

  // --- D. DISTANCE (w_distance) ---
  if (role === BotRole.EXPAND && targetHex.maxLevel === 0) {
      // In Expand mode, we want the NEAREST L0. 
      utility -= dist * (WEIGHTS.DISTANCE * 5.0); 
  } else {
      utility -= dist * WEIGHTS.DISTANCE;
  }

  // --- E. SPECIAL MODIFIERS ---
  
  // Growth Bonus: If we are already there and can grow, huge plus.
  const growthCheck = checkGrowthCondition(targetHex, bot);
  
  if (dist === 0 && growthCheck.canGrow) {
      utility += 50;
      // If we are in Dev/Evo mode and on a relevant hex, STAY and GROW.
      if ((role === BotRole.DEVELOPMENT || role === BotRole.EVOLUTION) && targetHex.maxLevel >= 2) {
          utility += 1000; // irresistible urge to upgrade high level hexes
      }
  }

  // Penalize blocked hexes to avoid looping
  // CRITICAL for early game: If I can't grow here (e.g. rank lock), I MUST move.
  if (!growthCheck.canGrow && targetHex.maxLevel > 0) {
      utility -= 200;
  }

  // Soft Cap for High Levels (Higher for Domination)
  if (targetHex.maxLevel >= levelCap) {
      utility -= (targetHex.maxLevel - levelCap) * 100;
  }

  return utility;
};

export const calculateBotMove = (
  bot: Entity, 
  grid: Record<string, Hex>,
  player: Entity,
  winCondition: WinCondition | null,
  obstacles: HexCoord[]
): HexCoord[] | null => {
  
  const botHexKey = getHexKey(bot.q, bot.r);
  const currentHex = grid[botHexKey];

  // 0. COMMITMENT CHECK (Persistence)
  if (currentHex && currentHex.progress > 0 && currentHex.maxLevel < 99) {
     // Check if we hit the cap based on mode, but generally if we started, we finish.
     return [{ q: bot.q, r: bot.r, upgrade: true }];
  }

  const totalResources = bot.moves + Math.floor(bot.coins / EXCHANGE_RATE_COINS_PER_MOVE);
  const currentRole = determineRole(bot, player, grid, winCondition);
  
  let ownedHexCount = 0;
  for (const k in grid) {
      if (grid[k].maxLevel > 0 && cubeDistance(bot, grid[k]) < cubeDistance(player, grid[k])) {
          ownedHexCount++;
      }
  }

  const candidates: ScoredCandidate[] = [];

  // 1. SCAN AND SCORE
  for (const key in grid) {
    const hex = grid[key];

    // Optimization: In EXPAND mode, skip non-L0s early
    if (currentRole === BotRole.EXPAND && hex.maxLevel > 0 && key !== botHexKey) continue;

    // Hard Constraint: Rank Lock
    // In DEVELOPMENT mode, we can visit our own max level hex (to upgrade it to level+1)
    if (
      hex.maxLevel > bot.playerLevel &&
      !(currentRole === BotRole.DEVELOPMENT && hex.maxLevel === bot.playerLevel + 1)
    ) {
      continue;
    }

    if (hex.q === player.q && hex.r === player.r) continue;

    const dist = cubeDistance(bot, {q: hex.q, r: hex.r});
    const searchRadius = currentRole === BotRole.SURVIVAL ? 4 : 15;
    if (dist > searchRadius) continue;

    const score = calculateHexUtility(hex, bot, player, currentRole, dist, totalResources, ownedHexCount, winCondition);
    
    if (score > -5000) {
        candidates.push({ 
            coord: { q: hex.q, r: hex.r }, 
            score, 
            role: currentRole,
            estimatedCost: (hex.maxLevel >= 2 ? hex.maxLevel : 1) + (dist - 1)
        });
    }
  }

  // 2. RANK CANDIDATES
  candidates.sort((a, b) => b.score - a.score);

  // 3. CHECK FOR IN-PLACE UPGRADE
  const growthCheck = currentHex 
    ? checkGrowthCondition(currentHex, bot) 
    : { canGrow: false };

  // A. RESCUE MODE (Critical Resource Shortage)
  // Only force growth if we lack the resources to make even a basic move (Cost 1).
  // If we have enough coins (totalResources >= 1), we should consider moving.
  if (totalResources < 1 && growthCheck.canGrow) {
      return [{ q: bot.q, r: bot.r, upgrade: true }];
  }

  // B. STRATEGIC DEVELOPMENT
  if (currentRole === BotRole.DEVELOPMENT || currentRole === BotRole.EVOLUTION) {
      const levelCap = (winCondition?.type === 'DOMINATION') ? 99 : 7;
      if (
          currentHex && 
          currentHex.maxLevel >= 2 && 
          currentHex.maxLevel < levelCap &&
          growthCheck.canGrow
      ) {
         return [{ q: bot.q, r: bot.r, upgrade: true }];
      }
  }

  // 4. PATH VALIDATION
  const checkCount = currentRole === BotRole.SURVIVAL ? 15 : 5;
  
  for (let i = 0; i < Math.min(candidates.length, checkCount); i++) {
      const candidate = candidates[i];
      
      // If staying put
      if (candidate.coord.q === bot.q && candidate.coord.r === bot.r) {
           const growthCheck = currentHex ? checkGrowthCondition(currentHex, bot) : { canGrow: false };
           if (growthCheck.canGrow) {
               return [{ q: bot.q, r: bot.r, upgrade: true }];
           } else {
               continue;
           }
      }

      // If moving
      const path = findPath(
        { q: bot.q, r: bot.r },
        candidate.coord,
        grid,
        bot.playerLevel,
        obstacles
      );

      if (path) {
          let realCost = 0;
          for (const step of path) {
              const h = grid[getHexKey(step.q, step.r)];
              realCost += (h && h.maxLevel >= 2) ? h.maxLevel : 1;
          }

          if (realCost <= totalResources) {
              return path;
          }
      }
  }

  return null;
};
