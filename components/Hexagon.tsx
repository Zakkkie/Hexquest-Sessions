
import React, { useEffect, useRef } from 'react';
import { Group, RegularPolygon, Text, Rect } from 'react-konva';
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
};

const HexagonVisual: React.FC<HexagonVisualProps> = React.memo(({ hex, isPlayerNeighbor, playerRank, isOccupied, onHexClick }) => {
  const groupRef = useRef<Konva.Group>(null);
  const glowRef = useRef<Konva.RegularPolygon>(null);
  
  // Cartesian Coordinates
  const x = HEX_SIZE * (3/2 * hex.q);
  const y = HEX_SIZE * Math.sqrt(3) * (hex.r + hex.q / 2);

  const levelIndex = Math.min(hex.maxLevel, 10);
  const colorSet = LEVEL_COLORS[levelIndex] || LEVEL_COLORS[10];

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

      {/* Stylized Level Number (Watermark) */}
      {!isOccupied && hex.maxLevel > 0 && (
        <Text
          text={hex.maxLevel.toString()}
          fontSize={HEX_SIZE * 1.5}
          fontFamily="Impact, Arial Black, sans-serif"
          fontStyle="bold"
          fill="rgba(255,255,255,0.07)" // Very transparent watermark
          align="center"
          verticalAlign="middle"
          width={HEX_SIZE * 2}
          height={HEX_SIZE * 2}
          x={-HEX_SIZE}
          y={-HEX_SIZE + 2}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}

      {/* Lock Icon */}
      {isLocked && (
        <Text
          text="🔒"
          fontSize={14}
          x={-7}
          y={-20}
          fill="#ef4444"
          perfectDrawEnabled={false}
          shadowColor="black"
          shadowBlur={3}
        />
      )}

      {/* Progress Bar */}
      {(isGrowing && !isLocked) && (
        <Group y={18} listening={false}>
          <Rect
            x={-15}
            width={30}
            height={3}
            fill="rgba(0,0,0,0.5)"
            cornerRadius={1.5}
            perfectDrawEnabled={false}
          />
          <Rect
            x={-15}
            width={30 * progressPercent}
            height={3}
            fill="#10b981"
            cornerRadius={1.5}
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
}

const SmartHexagon: React.FC<SmartHexagonProps> = React.memo(({ id, isPlayerNeighbor, playerRank, isOccupied, onHexClick }) => {
  const hex = useGameStore(state => state.grid[id]);
  if (!hex) return null;

  return (
    <HexagonVisual 
      hex={hex} 
      isPlayerNeighbor={isPlayerNeighbor} 
      playerRank={playerRank}
      isOccupied={isOccupied}
      onHexClick={onHexClick} 
    />
  );
});

export default SmartHexagon;
