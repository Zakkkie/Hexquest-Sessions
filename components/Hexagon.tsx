
import React, { useEffect, useRef } from 'react';
import { Group, RegularPolygon, Rect, Path } from 'react-konva';
import Konva from 'konva';
import { Hex } from '../types.ts';
import { HEX_SIZE } from '../constants.ts';
import { getSecondsToGrow } from '../services/hexUtils.ts';
import { useGameStore } from '../store.ts';

interface HexagonVisualProps {
  hex: Hex;
  isPlayerNeighbor: boolean;
  playerRank: number;
  isOccupied: boolean;
  onHexClick: (q: number, r: number) => void;
  onHover: (id: string | null) => void;
}

// Visual Color Table
const LEVEL_COLORS: Record<number, { fill: string; stroke: string }> = {
  0: { fill: '#1e293b', stroke: '#334155' }, 
  1: { fill: '#1e3a8a', stroke: '#3b82f6' }, 
  2: { fill: '#065f46', stroke: '#10b981' }, 
  3: { fill: '#155e75', stroke: '#06b6d4' }, 
  4: { fill: '#3f6212', stroke: '#84cc16' }, 
  5: { fill: '#92400e', stroke: '#f59e0b' }, 
  6: { fill: '#9a3412', stroke: '#ea580c' }, 
  7: { fill: '#991b1b', stroke: '#dc2626' }, 
  8: { fill: '#831843', stroke: '#db2777' }, 
  9: { fill: '#581c87', stroke: '#9333ea' }, 
  10: { fill: '#4c1d95', stroke: '#a855f7' }, 
  11: { fill: '#0f172a', stroke: '#f8fafc' }, // Special case for high levels
};

const LOCK_PATH = "M12 1a5 5 0 0 0-5 5v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v2H9V6a3 3 0 0 1 3-3z";

const HexagonVisual: React.FC<HexagonVisualProps> = React.memo(({ hex, isPlayerNeighbor, playerRank, isOccupied, onHexClick, onHover }) => {
  const groupRef = useRef<Konva.Group>(null);
  const glowRef = useRef<Konva.RegularPolygon>(null);
  
  // Cartesian Coordinates
  const x = HEX_SIZE * (3/2 * hex.q);
  const y = HEX_SIZE * Math.sqrt(3) * (hex.r + hex.q / 2);

  const levelIndex = Math.min(hex.maxLevel, 11);
  const colorSet = LEVEL_COLORS[levelIndex] || LEVEL_COLORS[0];

  let fillColor = colorSet.fill;
  let strokeColor = colorSet.stroke;
  let strokeWidth = 1 + (hex.maxLevel * 0.2);

  // Fog of war effect for L0
  const opacity = (hex.currentLevel === 0 && hex.maxLevel > 0) ? 0.5 : 1;

  if (isPlayerNeighbor) {
    strokeColor = '#3b82f6';
    strokeWidth = Math.max(strokeWidth, 2.5);
  }

  const isGrowing = hex.progress > 0;
  const targetLevel = hex.currentLevel + 1;
  const neededSeconds = getSecondsToGrow(targetLevel) || 1;
  const progressPercent = Math.min(1, hex.progress / neededSeconds);
  const isLocked = hex.maxLevel > playerRank;

  // Animation Effect for Growth
  useEffect(() => {
    if (!glowRef.current) return;
    
    const anim = new Konva.Animation((frame) => {
      if (!glowRef.current) return;
      if (isGrowing) {
        // Breathing effect
        const scale = 1 + (Math.sin(frame!.time / 300) * 0.08);
        const op = 0.4 + (Math.sin(frame!.time / 300) * 0.3);
        glowRef.current.opacity(op);
        glowRef.current.scale({x: scale, y: scale});
      } else {
        glowRef.current.opacity(0);
        glowRef.current.scale({x: 1, y: 1});
      }
    }, glowRef.current.getLayer());

    if (isGrowing) {
      anim.start();
    } else {
      anim.stop();
      if (glowRef.current) glowRef.current.opacity(0);
    }

    return () => anim.stop();
  }, [isGrowing]);

  const handleClick = () => {
    onHexClick(hex.q, hex.r);
  };

  return (
    <Group 
      ref={groupRef}
      x={x} 
      y={y} 
      onClick={handleClick}
      onTap={handleClick}
      onMouseEnter={() => onHover(hex.id)}
      onMouseLeave={() => onHover(null)}
      listening={true}
    >
      {/* Base Layer */}
      <RegularPolygon
        sides={6}
        radius={HEX_SIZE}
        fill="#020617" 
        y={6} 
        opacity={0.5}
        rotation={30}
        listening={false}
        perfectDrawEnabled={false}
      />
      
      {/* Growth Pulse Layer */}
      <RegularPolygon
        ref={glowRef}
        sides={6}
        radius={HEX_SIZE}
        fill={strokeColor}
        opacity={0}
        rotation={30}
        listening={false}
        perfectDrawEnabled={false}
      />

      {/* Main Hexagon */}
      <RegularPolygon
        sides={6}
        radius={HEX_SIZE}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        opacity={opacity}
        rotation={30}
        perfectDrawEnabled={false}
      />

      {/* NEW LOCK VISUAL: Large white semi-transparent with vignette */}
      {isLocked && (
        <Group listening={false}>
          {/* 1. Vignette Gradient: Transparent center, Dark edges */}
          <RegularPolygon
            sides={6}
            radius={HEX_SIZE - 2}
            rotation={30}
            fillRadialGradientStartPoint={{ x: 0, y: 0 }}
            fillRadialGradientStartRadius={0}
            fillRadialGradientEndPoint={{ x: 0, y: 0 }}
            fillRadialGradientEndRadius={HEX_SIZE}
            fillRadialGradientColorStops={[0, 'rgba(255,255,255,0.1)', 0.7, 'rgba(0,0,0,0.4)', 1, 'rgba(0,0,0,0.8)']}
            opacity={0.8}
            perfectDrawEnabled={false}
          />
          
          {/* 2. Large White Lock Icon - CENTERED */}
          <Path
            data={LOCK_PATH}
            x={0}
            y={0}
            scaleX={1.5}
            scaleY={1.5}
            offsetX={12} // Center pivot (24x24 icon)
            offsetY={12}
            fill="white"
            opacity={0.3} // Semi-transparent
            perfectDrawEnabled={false}
            shadowColor="black"
            shadowBlur={10}
            shadowOpacity={0.5}
          />
        </Group>
      )}

      {/* Progress Bar - Visible for ANY entity growing this hex */}
      {isGrowing && (
        <Group y={18} listening={false}>
          <Rect
            x={-15}
            width={30}
            height={4}
            fill="rgba(0,0,0,0.7)"
            cornerRadius={2}
            perfectDrawEnabled={false}
          />
          <Rect
            x={-15}
            width={30 * progressPercent}
            height={4}
            fill={isLocked ? "#f59e0b" : "#10b981"} // Amber if locked (bot), Emerald if player
            cornerRadius={2}
            perfectDrawEnabled={false}
          />
        </Group>
      )}
    </Group>
  );
});

// --- SMART WRAPPER ---
interface SmartHexagonProps {
  id: string;
  isPlayerNeighbor: boolean;
  playerRank: number; 
  isOccupied: boolean;
  onHexClick: (q: number, r: number) => void;
  onHover: (id: string | null) => void;
}

const SmartHexagon: React.FC<SmartHexagonProps> = React.memo(({ id, isPlayerNeighbor, playerRank, isOccupied, onHexClick, onHover }) => {
  const hex = useGameStore(state => state.grid[id]);
  if (!hex) return null;

  return (
    <HexagonVisual 
      hex={hex} 
      isPlayerNeighbor={isPlayerNeighbor} 
      playerRank={playerRank}
      isOccupied={isOccupied}
      onHexClick={onHexClick} 
      onHover={onHover}
    />
  );
});

export default SmartHexagon;
