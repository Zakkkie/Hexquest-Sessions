
import { Hex, Entity } from '../types';
import { SECONDS_PER_LEVEL_UNIT, UPGRADE_LOCK_QUEUE_SIZE } from '../constants';

/**
 * Calculates the reward for reaching a specific level.
 * Quadratic scaling for coins to reward high-level play.
 */
export const calculateReward = (newHexLevel: number): { coins: number, moves: number } => {
  return {
    coins: newHexLevel, 
    moves: 1
  };
};

/**
 * Calculates time required to grow a hex to the next level.
 * Formula is cumulative/summed based on level to increase difficulty/investment.
 * e.g. Level 1 = 10s, Level 2 = 15s (if SECONDS_PER_LEVEL_UNIT is 5)
 */
export const getSecondsToGrow = (targetLevel: number): number => {
  // Base time + incremental increase per level
  // Old: targetLevel * 5
  // New: 10 + (targetLevel - 1) * 5
  // If targetLevel is 1: 10s
  // If targetLevel is 2: 15s
  const baseTime = 10;
  if (targetLevel <= 1) return baseTime;
  
  return baseTime + ((targetLevel - 1) * SECONDS_PER_LEVEL_UNIT);
};

/**
 * Validates if an entity can grow a specific hex.
 * Enforces Rank limits and Cycle/Queue mechanics.
 */
export const checkGrowthCondition = (
  hex: Hex, 
  entity: Entity
): { canGrow: boolean; reason?: string } => {
  const targetLevel = Number(hex.currentLevel) + 1;

  if (targetLevel > hex.maxLevel) {
    if (targetLevel === 1) return { canGrow: true };

    // Rule: Cycle Lock
    if (entity.recentUpgrades.length < UPGRADE_LOCK_QUEUE_SIZE) {
      return { 
        canGrow: false, 
        reason: `CYCLE INCOMPLETE (${entity.recentUpgrades.length}/${UPGRADE_LOCK_QUEUE_SIZE})` 
      };
    }

    // Rule: Global Rank
    if (entity.playerLevel < targetLevel - 1) {
      return { 
        canGrow: false, 
        reason: `RANK TOO LOW (NEED L${targetLevel - 1})` 
      };
    }
  }

  return { canGrow: true };
};
