
import React, { useRef, useEffect } from 'react';
import { Group, Circle, Ring } from 'react-konva';
import Konva from 'konva';
import { useGameStore } from '../store.ts';
import { hexToPixel } from '../services/hexUtils.ts';
import { EntityType } from '../types.ts';

interface UnitProps {
  q: number;
  r: number;
  type: EntityType;
  color?: string; // Explicit color override
}

const Unit: React.FC<UnitProps> = ({ q, r, type, color }) => {
  const groupRef = useRef<Konva.Group>(null);
  const user = useGameStore(state => state.user);
  
  const { x, y } = hexToPixel(q, r);

  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.position({ x, y });
    }
  }, []); 

  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.to({
        x,
        y,
        duration: 0.3,
        easing: Konva.Easings.EaseInOut,
      });
    }
  }, [x, y]);

  const isPlayer = type === EntityType.PLAYER;
  
  // Priority: Prop Color -> User Avatar (if player) -> Default Red (if bot)
  const finalColor = color || (isPlayer ? (user?.avatarColor || '#3b82f6') : '#ef4444');

  return (
    <Group ref={groupRef} listening={false}>
      <Circle
        radius={15}
        fill={finalColor}
        opacity={0.3}
        shadowColor={finalColor}
        shadowBlur={10}
      />
      <Circle
        radius={8}
        fill={finalColor}
        stroke="white"
        strokeWidth={2}
      />
      <Ring
        innerRadius={10}
        outerRadius={12}
        stroke={finalColor}
        strokeWidth={1}
        opacity={0.6}
        scaleX={1}
        scaleY={0.8}
      />
    </Group>
  );
};

export default Unit;
