
import React, { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import { Stage, Layer, Line } from 'react-konva';
import Konva from 'konva';
import { useGameStore } from '../store.ts';
import { getHexKey, getNeighbors, checkGrowthCondition, getSecondsToGrow, hexToPixel } from '../services/hexUtils.ts';
import Hexagon from './Hexagon.tsx'; 
import Unit from './Unit.tsx';
import Background from './Background.tsx';
import { 
  AlertCircle, Pause, Play, Trophy, Coins, Footprints, AlertTriangle, Menu, LogOut,
  Crown, Target, TrendingUp, ChevronDown, ChevronUp, Shield, Clock
} from 'lucide-react';
import { UPGRADE_LOCK_QUEUE_SIZE, EXCHANGE_RATE_COINS_PER_MOVE, HEX_SIZE } from '../constants.ts';
import { Hex } from '../types.ts';

const VIEWPORT_PADDING = 150; 
const ANIMATION_STEP_MS = 250; 

const GameView: React.FC = () => {
  // Dimensions
  const [dimensions, setDimensions] = useState({ 
    width: window.innerWidth, 
    height: window.innerHeight 
  });

  // Viewport
  const [viewState, setViewState] = useState({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    scale: 1
  });

  // UI Local State
  const [showExitConfirmation, setShowExitConfirmation] = useState(false);
  // Default rankings to closed on mobile (< 768px), open on desktop
  const [isRankingsOpen, setIsRankingsOpen] = useState(window.innerWidth >= 768);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  
  const { 
    grid, player, bots, user, winCondition, gameStatus,
    messageLog, isPlayerGrowing, toast, pendingConfirmation, sessionStartTime,
    movePlayer, togglePlayerGrowth, hideToast,
    abandonSession, processMovementStep, confirmPendingAction, cancelPendingAction
  } = useGameStore();

  // Scroll logs to bottom on update
  useEffect(() => {
    if (logsContainerRef.current) {
        logsContainerRef.current.scrollTop = 0; 
    }
  }, [messageLog]);

  // Movement Animation Loop
  useEffect(() => {
    let interval: number;
    if (player.movementQueue.length > 0) {
      interval = window.setInterval(() => {
        processMovementStep();
      }, ANIMATION_STEP_MS);
    }
    return () => clearInterval(interval);
  }, [player.movementQueue.length, processMovementStep]);

  // Toast Auto-Hide
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => hideToast(), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast, hideToast]);

  // Resize Handler
  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Derived State
  const currentHex = grid[getHexKey(player.q, player.r)];
  const growthCondition = currentHex 
    ? checkGrowthCondition(currentHex, player) 
    : { canGrow: false, reason: '' };
  
  const isMoving = player.movementQueue.length > 0;
  
  // Growth Progress Calculation
  const growthProgressPercent = currentHex 
    ? (currentHex.progress / (getSecondsToGrow(currentHex.currentLevel + 1) || 1)) * 100 
    : 0;
  
  // BUTTON LABEL LOGIC
  const growthButtonLabel = useMemo(() => {
    if (isPlayerGrowing) return 'GROWING';
    if (currentHex && currentHex.currentLevel >= currentHex.maxLevel) return 'UPGRADE';
    return 'GROWTH';
  }, [isPlayerGrowing, currentHex]);

  const isUpgradeAction = growthButtonLabel === 'UPGRADE';

  // --- HELPER: TIME FORMATTER ---
  const formatTime = (ms: number) => {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / 1000 / 60) % 60);
    const hours = Math.floor(ms / 1000 / 60 / 60);
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    return `${minutes}m ${seconds}s`;
  };

  // --- CAMERA CONTROLS ---

  const centerOnPlayer = useCallback(() => {
    const { x: px, y: py } = hexToPixel(player.q, player.r);
    setViewState(prev => ({
      ...prev,
      x: (dimensions.width / 2) - (px * prev.scale),
      y: (dimensions.height / 2) - (py * prev.scale)
    }));
  }, [player.q, player.r, dimensions]);

  // Zoom Logic
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;

    const scaleBy = 1.1;
    const oldScale = viewState.scale;
    const pointer = stage.getPointerPosition();

    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - viewState.x) / oldScale,
      y: (pointer.y - viewState.y) / oldScale,
    };

    let newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    newScale = Math.max(0.2, Math.min(newScale, 3));

    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };

    setViewState({
      x: newPos.x,
      y: newPos.y,
      scale: newScale
    });
  }, [viewState]);

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    setViewState(prev => ({
      ...prev,
      x: e.target.x(),
      y: e.target.y()
    }));
  };

  const playerNeighbors = useMemo(() => {
    return getNeighbors(player.q, player.r);
  }, [player.q, player.r]);

  const playerNeighborKeys = useMemo(() => {
    return new Set(playerNeighbors.map(n => getHexKey(n.q, n.r)));
  }, [playerNeighbors]);

  const visibleHexIds = useMemo(() => {
    const visibleIds: string[] = [];
    const allHexes = Object.values(grid) as Hex[];
    
    const minX = -viewState.x / viewState.scale - VIEWPORT_PADDING / viewState.scale;
    const minY = -viewState.y / viewState.scale - VIEWPORT_PADDING / viewState.scale;
    const maxX = (dimensions.width - viewState.x) / viewState.scale + VIEWPORT_PADDING / viewState.scale;
    const maxY = (dimensions.height - viewState.y) / viewState.scale + VIEWPORT_PADDING / viewState.scale;

    for (const hex of allHexes) {
      const px = HEX_SIZE * (3/2 * hex.q);
      const py = HEX_SIZE * Math.sqrt(3) * (hex.r + hex.q / 2);

      if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
        visibleIds.push(hex.id);
      }
    }
    return visibleIds;
  }, [grid, viewState, dimensions]);

  const connectorData = useMemo(() => {
    if (isMoving) return [];

    const start = hexToPixel(player.q, player.r);
    const lines: Array<{ key: string, points: number[], color: string, dash: number[], opacity: number }> = [];

    playerNeighbors.forEach(neighbor => {
       const key = getHexKey(neighbor.q, neighbor.r);
       const hex = grid[key];
       // Check against ANY bot
       const isBot = bots.some(b => b.q === neighbor.q && b.r === neighbor.r);
       const isLocked = hex && hex.maxLevel > player.playerLevel;
       
       if (isBot) return; 
       
       const end = hexToPixel(neighbor.q, neighbor.r);
       
       let cost = 1;
       if (hex && hex.maxLevel >= 2) cost = hex.maxLevel;

       const canAfford = player.moves >= cost || player.coins >= (cost * EXCHANGE_RATE_COINS_PER_MOVE);
       const color = canAfford ? '#3b82f6' : '#ef4444'; 
       const dash = [5, 5];

       lines.push({
         key: `conn-${key}`,
         points: [start.x, start.y, end.x, end.y],
         color,
         dash,
         opacity: isLocked ? 0.2 : 0.6
       });
    });
    
    return lines;
  }, [player.q, player.r, player.moves, player.coins, player.playerLevel, playerNeighbors, grid, bots, isMoving]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#020617]">
      
      {/* --- BACKGROUND AMBIENCE (Canvas) --- */}
      <div className="absolute inset-0 pointer-events-none z-0">
         <Background variant="GAME" />
         {/* Vignette Overlay */}
         <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#020617_100%)] opacity-70" />
      </div>

      {/* --- CANVAS LAYER --- */}
      <div className="absolute inset-0 z-10">
        <Stage 
          width={dimensions.width} 
          height={dimensions.height} 
          draggable
          onWheel={handleWheel}
          onDragEnd={handleDragEnd}
          x={viewState.x}
          y={viewState.y}
          scaleX={viewState.scale}
          scaleY={viewState.scale}
        >
          <Layer>
            {visibleHexIds.map((id) => {
              const hex = grid[id];
              const isPlayerHere = hex.q === player.q && hex.r === player.r;
              const isBotHere = bots.some(b => b.q === hex.q && b.r === hex.r);
              const isOccupied = isPlayerHere || isBotHere;

              return (
                <Hexagon 
                  key={id} 
                  id={id} 
                  isPlayerNeighbor={playerNeighborKeys.has(id)}
                  playerRank={player.playerLevel} 
                  isOccupied={isOccupied}
                  onHexClick={movePlayer} 
                />
              );
            })}
            
            {connectorData.map(line => (
              <Line 
                key={line.key}
                points={line.points}
                stroke={line.color}
                strokeWidth={2}
                dash={line.dash}
                opacity={line.opacity}
                listening={false}
              />
            ))}

            <Unit q={player.q} r={player.r} type={player.type} />
            {bots.map(b => (
                <Unit key={b.id} q={b.q} r={b.r} type={b.type} color={b.avatarColor} />
            ))}
          </Layer>
        </Stage>
      </div>

      {/* --- HUD HEADER --- */}
      <div className="absolute inset-x-0 top-0 p-2 md:p-4 z-30 pointer-events-none select-none">
          
          {/* CENTER: Stats Bar & Objective */}
          {/* Mobile: Anchored Left with width constraint. Desktop: Centered. */}
          <div className="absolute top-2 md:top-4 left-2 md:left-1/2 md:-translate-x-1/2 flex flex-col items-start md:items-center gap-2 md:gap-3 max-w-[calc(100%-4rem)] md:max-w-fit pointer-events-auto transition-all duration-300 z-40">
               
               {/* Stats Panel */}
               <div className="flex items-center gap-2 md:gap-6 px-3 md:px-8 py-2 md:py-3 bg-slate-900/90 backdrop-blur-2xl rounded-[1.5rem] md:rounded-[2rem] border border-slate-800 shadow-2xl overflow-x-auto no-scrollbar max-w-full">
                   
                   {/* LEVEL */}
                   <div className="flex flex-col items-center gap-0.5 md:gap-1 shrink-0">
                       <span className="text-[8px] md:text-[9px] font-bold text-slate-500 tracking-widest uppercase">Level</span>
                       <div className="flex items-center gap-1.5 md:gap-2">
                           <Crown className="w-4 h-4 md:w-5 md:h-5 text-indigo-500" />
                           <span className="text-lg md:text-2xl font-black text-white leading-none">{player.playerLevel}</span>
                       </div>
                   </div>

                   <div className="w-px h-6 md:h-8 bg-slate-800 shrink-0"></div>

                   {/* UPGRADE */}
                   <div className="flex flex-col items-center gap-0.5 md:gap-1 shrink-0">
                       <span className="text-[8px] md:text-[9px] font-bold text-slate-500 tracking-widest uppercase">Upgrade</span>
                       <div className="flex items-center gap-1.5 md:gap-2">
                           <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-emerald-500" />
                           <div className="flex gap-0.5 md:gap-1 h-4 md:h-5 items-center">
                               {Array.from({length: UPGRADE_LOCK_QUEUE_SIZE}).map((_, i) => (
                                  <div 
                                    key={i} 
                                    className={`w-1.5 md:w-2 h-3 md:h-4 rounded-sm transition-all duration-300 ${
                                        player.recentUpgrades.length > i 
                                        ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] scale-110' 
                                        : 'bg-slate-800'
                                    }`} 
                                  />
                               ))}
                           </div>
                       </div>
                   </div>

                   <div className="w-px h-6 md:h-8 bg-slate-800 shrink-0"></div>

                   {/* CREDITS */}
                   <div className="flex flex-col items-center gap-0.5 md:gap-1 shrink-0">
                       <span className="text-[8px] md:text-[9px] font-bold text-slate-500 tracking-widest uppercase">Credits</span>
                       <div className="flex items-center gap-1.5 md:gap-2">
                           <Coins className="w-4 h-4 md:w-5 md:h-5 text-amber-500" />
                           <span className="text-lg md:text-2xl font-black text-white leading-none">{player.coins}</span>
                       </div>
                   </div>

                   <div className="w-px h-6 md:h-8 bg-slate-800 shrink-0"></div>

                   {/* MOVES */}
                   <div className="flex flex-col items-center gap-0.5 md:gap-1 shrink-0">
                       <span className="text-[8px] md:text-[9px] font-bold text-slate-500 tracking-widest uppercase">Moves</span>
                       <div className="flex items-center gap-1.5 md:gap-2">
                           <Footprints className={`w-4 h-4 md:w-5 md:h-5 ${isMoving ? 'text-slate-400 animate-pulse' : 'text-blue-500'}`} />
                           <span className="text-lg md:text-2xl font-black text-white leading-none">{player.moves}</span>
                       </div>
                   </div>
               </div>

               {/* Objective */}
               {winCondition && (
                  <div className="bg-slate-950/80 backdrop-blur-md px-3 md:px-5 py-1 md:py-1.5 rounded-full border border-slate-800/60 flex items-center gap-2 shadow-lg animate-in slide-in-from-top-2 fade-in self-center">
                      <Target className="w-3 h-3 text-cyan-400" />
                      <span className="text-[9px] md:text-[10px] font-mono text-cyan-100 uppercase tracking-widest">
                          Objective: <span className="text-white font-bold ml-1">{winCondition.label}</span>
                      </span>
                  </div>
               )}
          </div>

          {/* RIGHT: Rankings + Menu */}
          <div className="absolute top-2 md:top-4 right-2 md:right-4 flex items-start gap-2 pointer-events-auto z-50">
               
               {/* Rankings Widget */}
               <div className={`
                  flex flex-col bg-slate-900/90 backdrop-blur-2xl border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 ease-in-out origin-top-right
                  ${isRankingsOpen ? 'w-56 md:w-64' : 'w-auto'}
               `}>
                   <div 
                      onClick={() => setIsRankingsOpen(!isRankingsOpen)}
                      className="flex items-center justify-between p-2 md:p-3 cursor-pointer hover:bg-white/5 transition-colors gap-2 md:gap-4 h-11"
                   >
                       <div className="flex items-center gap-2 md:gap-2.5">
                           <Trophy className="w-4 h-4 text-amber-500" />
                           {isRankingsOpen && <span className="text-[9px] md:text-[10px] font-bold text-slate-300 uppercase tracking-wider whitespace-nowrap">Live Rankings</span>}
                       </div>
                       {isRankingsOpen 
                          ? <ChevronUp className="w-3 h-3 text-slate-500" /> 
                          : <ChevronDown className="w-3 h-3 text-slate-500" />
                       }
                   </div>
                   
                   {isRankingsOpen && (
                       <div className="flex flex-col p-2 pt-0 gap-1.5 max-h-[40vh] overflow-y-auto no-scrollbar">
                           {[player, ...bots].sort((a, b) => (b.totalCoinsEarned || 0) - (a.totalCoinsEarned || 0)).map((e) => {
                               const isPlayer = e.type === 'PLAYER';
                               const color = isPlayer ? (user?.avatarColor || '#3b82f6') : (e.avatarColor || '#ef4444');
                               return (
                                   <div key={e.id} className="flex items-center justify-between p-2 rounded-xl bg-slate-950/50 border border-slate-800/50">
                                       <div className="flex items-center gap-3 overflow-hidden">
                                           <div className="w-2 h-2 rounded-full shrink-0 shadow-[0_0_8px_currentColor]" style={{ color, backgroundColor: color }} />
                                           <div className="flex flex-col min-w-0">
                                               <span className={`text-[10px] md:text-[11px] font-bold truncate leading-tight ${isPlayer ? 'text-white' : 'text-slate-400'}`}>
                                                   {isPlayer ? (user?.nickname || 'YOU') : e.id.toUpperCase()}
                                               </span>
                                               {/* Mini Dots */}
                                               <div className="flex gap-0.5 mt-0.5">
                                                   {Array.from({length: UPGRADE_LOCK_QUEUE_SIZE}).map((_, i) => (
                                                       <div key={i} className={`w-1 h-1 rounded-full ${e.recentUpgrades.length > i ? 'bg-emerald-500' : 'bg-slate-800'}`} />
                                                   ))}
                                               </div>
                                           </div>
                                       </div>
                                       <div className="flex flex-col items-end leading-none">
                                           <span className="text-[10px] md:text-[11px] font-mono text-amber-500 font-bold">{e.coins}</span>
                                           <span className="text-[8px] md:text-[9px] font-mono text-indigo-400">L{e.playerLevel}</span>
                                       </div>
                                   </div>
                               );
                           })}
                       </div>
                   )}
               </div>

               {/* EXIT Button (Replaces Menu) */}
               <button 
                  onClick={() => setShowExitConfirmation(true)}
                  className="w-11 h-11 flex items-center justify-center bg-slate-900/90 backdrop-blur-2xl border border-slate-700/80 rounded-2xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all shadow-xl active:scale-95"
                  title="Exit Session"
               >
                  <LogOut className="w-5 h-5" />
               </button>
          </div>
      </div>

      {/* --- HUD: RIGHT SIDE (Logs) --- */}
      {/* Logs moved to below rankings but detached, hidden on mobile */}
      <div className="hidden md:flex absolute top-24 right-4 z-20 pointer-events-none flex-col items-end gap-1.5 w-64">
          {messageLog.slice(0, 5).map((msg, idx) => (
             <div key={idx} className="bg-black/70 backdrop-blur-sm border-r-2 border-slate-700 px-3 py-2 text-[10px] font-mono text-cyan-100/90 text-right rounded-l-lg shadow-sm animate-in slide-in-from-right-10 fade-in duration-300 pointer-events-auto">
               {msg}
             </div>
          ))}
      </div>

      {/* --- HUD: BOTTOM CENTER (Actions) --- */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-3 w-[90%] md:w-80 pointer-events-auto">
        
        {/* Warning Pill */}
        {currentHex && !growthCondition.canGrow && !isPlayerGrowing && !isMoving && (
          <div className="flex gap-2 px-3 py-1.5 bg-red-950/90 backdrop-blur-md rounded-lg border border-red-500/50 shadow-lg animate-pulse">
            <AlertCircle className="w-3 h-3 text-red-500 mt-0.5 shrink-0" />
            <span className="text-[9px] text-red-100 uppercase font-bold tracking-tight">{growthCondition.reason}</span>
          </div>
        )}

        {/* Action Bar */}
        <div className="bg-slate-900/95 backdrop-blur-3xl p-2 rounded-2xl border border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.8)] w-full flex gap-2">
          
          {/* Combined Growth Button with Progress Fill */}
          <button 
            onClick={() => {
              centerOnPlayer();
              togglePlayerGrowth();
            }}
            disabled={isMoving}
            className={`relative flex-grow w-full h-14 rounded-xl font-black text-xs uppercase tracking-[0.15em] flex items-center justify-center overflow-hidden transition-all border
              ${!growthCondition.canGrow || isMoving 
                  ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed' 
                  : isUpgradeAction
                    ? 'bg-amber-500 border-amber-600 text-slate-900 hover:bg-amber-400'
                    : 'bg-slate-800 border-emerald-900 text-white hover:border-emerald-500'
              }
            `}
          >
             {/* Progress Fill Layer */}
             <div 
                className={`absolute left-0 bottom-0 top-0 transition-all duration-1000 ease-linear ${isUpgradeAction ? 'bg-white/30' : 'bg-emerald-600'}`}
                style={{ width: `${growthProgressPercent}%`, opacity: isPlayerGrowing ? 1 : 0.5 }}
             />

             {/* Content Layer (Above Progress) */}
             <div className="relative z-10 flex flex-col items-center gap-1 drop-shadow-md">
                <div className="flex items-center gap-2">
                    {isPlayerGrowing ? <Pause className={`w-4 h-4 ${isUpgradeAction ? 'fill-black' : 'fill-white'}`}/> : <Play className={`w-4 h-4 ${isUpgradeAction ? 'fill-black' : 'fill-white'}`}/>}
                    <span>{growthButtonLabel}</span>
                </div>
                {/* Timer text */}
                <span className={`text-[9px] font-mono ${isUpgradeAction ? 'opacity-100 font-bold' : 'opacity-80'}`}>
                   {currentHex ? `${currentHex.progress}s / ${getSecondsToGrow(currentHex.currentLevel+1)}s` : '-'}
                </span>
             </div>
          </button>
        </div>
      </div>

      {/* --- MODALS --- */}

      {/* VICTORY MODAL */}
      {gameStatus === 'VICTORY' && (
        <div className="absolute inset-0 z-[80] bg-black/80 backdrop-blur-md flex items-center justify-center pointer-events-auto p-4">
          <div className="bg-slate-900 border border-amber-500/50 p-8 md:p-10 rounded-3xl shadow-[0_0_100px_rgba(245,158,11,0.3)] max-w-lg w-full text-center relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-amber-400 to-transparent"></div>
             
             <div className="mx-auto w-16 h-16 md:w-20 md:h-20 bg-amber-500/20 rounded-full flex items-center justify-center mb-6 border border-amber-500/50 animate-bounce">
               <Crown className="w-8 h-8 md:w-10 md:h-10 text-amber-500" />
             </div>
             
             <h2 className="text-3xl md:text-4xl font-black text-white mb-2 uppercase tracking-tighter">Mission Accomplished</h2>
             <p className="text-amber-500 font-bold text-sm tracking-widest uppercase mb-8">Objective Verified</p>
             
             <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 mb-8 space-y-4">
               <div className="flex justify-between items-center text-sm border-b border-slate-800 pb-2">
                 <span className="text-slate-500 font-bold uppercase">Condition</span>
                 <span className="text-white font-mono">{winCondition?.label}</span>
               </div>
               <div className="flex justify-between items-center text-sm border-b border-slate-800 pb-2">
                 <span className="text-slate-500 font-bold uppercase">Net Credits</span>
                 <span className="text-amber-500 font-mono">{player.totalCoinsEarned}</span>
               </div>
               <div className="flex justify-between items-center text-sm">
                 <span className="text-slate-500 font-bold uppercase">Duration</span>
                 <span className="text-white font-mono">{formatTime(Date.now() - sessionStartTime)}</span>
               </div>
             </div>

             <button 
                 onClick={abandonSession}
                 className="w-full py-4 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl shadow-lg shadow-amber-600/20 transition-all uppercase tracking-wider text-sm"
               >
                 Return to Command
             </button>
          </div>
        </div>
      )}

      {/* DEFEAT MODAL */}
      {gameStatus === 'DEFEAT' && (
        <div className="absolute inset-0 z-[80] bg-black/80 backdrop-blur-md flex items-center justify-center pointer-events-auto p-4">
          <div className="bg-slate-900 border border-red-500/50 p-8 md:p-10 rounded-3xl shadow-[0_0_100px_rgba(239,68,68,0.3)] max-w-lg w-full text-center relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-red-500 to-transparent"></div>
             
             <div className="mx-auto w-16 h-16 md:w-20 md:h-20 bg-red-500/20 rounded-full flex items-center justify-center mb-6 border border-red-500/50">
               <Shield className="w-8 h-8 md:w-10 md:h-10 text-red-500" />
             </div>
             
             <h2 className="text-3xl md:text-4xl font-black text-white mb-2 uppercase tracking-tighter">Mission Failed</h2>
             <p className="text-red-500 font-bold text-sm tracking-widest uppercase mb-8">Sentinel Victory</p>
             
             <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 mb-8 space-y-4">
               <div className="flex justify-between items-center text-sm border-b border-slate-800 pb-2">
                 <span className="text-slate-500 font-bold uppercase">Condition</span>
                 <span className="text-white font-mono">{winCondition?.label}</span>
               </div>
               <div className="flex justify-between items-center text-sm border-b border-slate-800 pb-2">
                 <span className="text-slate-500 font-bold uppercase">Sentinel Status</span>
                 <span className="text-red-500 font-mono">OBJECTIVE MET</span>
               </div>
               <div className="flex justify-between items-center text-sm">
                 <span className="text-slate-500 font-bold uppercase">Duration</span>
                 <span className="text-white font-mono">{formatTime(Date.now() - sessionStartTime)}</span>
               </div>
             </div>

             <button 
                 onClick={abandonSession}
                 className="w-full py-4 bg-red-900 hover:bg-red-800 text-white font-bold rounded-xl shadow-lg shadow-red-900/20 transition-all uppercase tracking-wider text-sm"
               >
                 Return to Command
             </button>
          </div>
        </div>
      )}

      {/* MOVE COST CONFIRMATION MODAL */}
      {pendingConfirmation && (
        <div className="absolute inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center pointer-events-auto p-4">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-3xl shadow-2xl max-w-sm w-full text-center">
             <div className="mx-auto w-12 h-12 bg-amber-500/10 rounded-full flex items-center justify-center mb-4">
               <Coins className="w-6 h-6 text-amber-500" />
             </div>
             <h3 className="text-xl font-bold text-white mb-2">Resource Conversion</h3>
             <p className="text-slate-400 text-xs mb-6 px-4">
               High-level sectors require additional propulsion. 
               <br/><span className="text-amber-500">Insufficient moves available.</span>
             </p>
             
             <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 mb-6 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-500 uppercase">Total Move Cost</span>
                  <span className="text-white font-mono font-bold">{pendingConfirmation.data.costMoves + (pendingConfirmation.data.costCoins / EXCHANGE_RATE_COINS_PER_MOVE)}</span>
                </div>
                <div className="w-full h-px bg-slate-800 my-1"></div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-500 uppercase">Available Moves</span>
                  <span className="text-emerald-500 font-mono font-bold">{player.moves}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-amber-500 uppercase">Credit Cost</span>
                  <div className="text-amber-500 font-mono font-bold flex items-center gap-1">
                     -{pendingConfirmation.data.costCoins} <Coins className="w-3 h-3" />
                  </div>
                </div>
             </div>

             <div className="flex gap-3">
               <button 
                 onClick={cancelPendingAction}
                 className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-bold text-xs uppercase tracking-wider"
               >
                 Abort
               </button>
               <button 
                 onClick={confirmPendingAction}
                 className="flex-1 py-3 bg-amber-600 hover:bg-amber-500 rounded-xl text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20"
               >
                 Authorize
               </button>
             </div>
          </div>
        </div>
      )}

      {/* EXIT SESSION CONFIRMATION MODAL */}
      {showExitConfirmation && (
        <div className="absolute inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center pointer-events-auto p-4">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-3xl shadow-2xl max-w-sm w-full text-center relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-red-500 to-transparent opacity-50"></div>
             
             <div className="mx-auto w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mb-4 border border-red-500/20">
               <LogOut className="w-6 h-6 text-red-500" />
             </div>
             <h3 className="text-xl font-bold text-white mb-2">Abort Mission?</h3>
             <p className="text-slate-400 text-xs mb-6 leading-relaxed">
               Terminating the session will disconnect from the current sector. <br/>
               <span className="text-red-400 font-bold">All unsaved tactical data will be lost.</span>
             </p>
             
             <div className="flex gap-3">
               <button 
                 onClick={() => setShowExitConfirmation(false)}
                 className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-bold text-xs uppercase tracking-wider transition-colors"
               >
                 Cancel
               </button>
               <button 
                 onClick={() => {
                   abandonSession();
                   setShowExitConfirmation(false);
                 }}
                 className="flex-1 py-3 bg-red-900/50 hover:bg-red-800/50 border border-red-800/50 rounded-xl text-red-200 hover:text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-red-900/20 transition-all"
               >
                 Confirm Exit
               </button>
             </div>
          </div>
        </div>
      )}

      {/* POPUP TOAST MESSAGE - Updated Positioning & Styling */}
      {toast && (
        <div className="absolute bottom-24 md:bottom-auto md:top-24 left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-md pointer-events-none">
          <div className="mx-auto bg-red-950/95 border border-red-500/50 text-red-100 px-4 py-3 rounded-2xl shadow-[0_0_30px_rgba(239,68,68,0.6)] backdrop-blur-xl flex flex-col md:flex-row items-center justify-center gap-2 md:gap-3 animate-in fade-in slide-in-from-bottom-4 md:slide-in-from-top-4 duration-300">
             <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
             <span className="text-xs md:text-sm font-bold uppercase tracking-wider text-center leading-tight break-words">{toast.message}</span>
          </div>
        </div>
      )}

    </div>
  );
};

export default GameView;
