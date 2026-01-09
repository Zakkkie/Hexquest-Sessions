
import React, { useRef, useEffect } from 'react';

const HEX_SIZE = 40;
const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;
const HEX_HEIGHT = 2 * HEX_SIZE;
const ROWS = 20; // Number of rows to render
const COLS = 15; // Number of columns to render

const Background: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let time = 0;

    // Handle Resize
    const handleResize = () => {
      if (canvas) {
        // Render at lower resolution for performance/retro feel, then scale up via CSS
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight * 1.5; // Extra height for tilt coverage
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    const drawHex = (x: number, y: number, size: number, color: string, height: number) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle_deg = 60 * i + 30;
        const angle_rad = Math.PI / 180 * angle_deg;
        ctx.lineTo(x + size * Math.cos(angle_rad), y + size * Math.sin(angle_rad));
      }
      ctx.closePath();
      
      // Base Fill
      ctx.fillStyle = color;
      ctx.fill();

      // Top Highlight (Fake 3D extruded look)
      if (height > 0.2) {
          ctx.beginPath();
          const innerSize = size * (1 - height * 0.5); // Higher = Smaller top (pyramid) or Larger?
          // Let's do: Higher = Brighter center
          for (let i = 0; i < 6; i++) {
            const angle_deg = 60 * i + 30;
            const angle_rad = Math.PI / 180 * angle_deg;
            ctx.lineTo(x + innerSize * Math.cos(angle_rad), y + innerSize * Math.sin(angle_rad));
          }
          ctx.closePath();
          ctx.fillStyle = `rgba(255, 255, 255, ${height * 0.3})`;
          ctx.fill();
      }

      ctx.strokeStyle = `rgba(71, 85, 105, ${0.3 + height * 0.5})`; // Slate-600 with varying opacity
      ctx.lineWidth = 1 + height * 2;
      ctx.stroke();
    };

    const render = () => {
      time += 0.005;
      
      // Clear
      ctx.fillStyle = '#020617'; // Slate-950
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const startX = -HEX_WIDTH;
      const startY = -HEX_HEIGHT;
      
      // Simple loop to cover screen
      // We render a grid that is larger than screen to account for tilt
      const numCols = Math.ceil(canvas.width / HEX_WIDTH) + 2;
      const numRows = Math.ceil(canvas.height / (HEX_HEIGHT * 0.75)) + 4;

      const flyOffset = (time * 50) % (HEX_HEIGHT * 1.5); // Infinite scroll Y

      for (let r = -2; r < numRows; r++) {
        for (let q = -2; q < numCols; q++) {
           // Axial Logic for Hex Grid Staggering
           const xOffset = (r % 2) * (HEX_WIDTH / 2);
           const cx = q * HEX_WIDTH + xOffset;
           const cy = r * (HEX_HEIGHT * 0.75) + flyOffset;

           // Noise Function for "Height"
           // Combine sine waves on different frequencies
           const h1 = Math.sin(q * 0.3 + time) * Math.cos(r * 0.2 - time);
           const h2 = Math.sin(q * 0.7 - time * 2) * Math.cos(r * 0.5 + time);
           const rawH = (h1 + h2) / 2; // -1 to 1
           const height = Math.max(0, rawH); // 0 to 1 (clamped, valleys are flat)

           // Determine color based on height
           let color = '#0f172a'; // Base Slate-900
           if (height > 0.6) color = '#1e3a8a'; // Blue-900
           if (height > 0.8) color = '#b45309'; // Amber-700 (High peaks)

           // Draw
           drawHex(cx, cy, HEX_SIZE, color, height);
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
};

export default Background;
