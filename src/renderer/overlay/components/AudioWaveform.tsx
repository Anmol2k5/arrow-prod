import React, { useRef, useEffect } from 'react'

interface AudioWaveformProps {
  cursorX: number
  cursorY: number
  audioLevel: number
}

export function AudioWaveform({ cursorX, cursorY, audioLevel }: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number>()
  const levelHistoryRef = useRef<number[]>(new Array(18).fill(0))
  const smoothLevelRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const draw = () => {
      smoothLevelRef.current = smoothLevelRef.current * 0.7 + audioLevel * 0.3
      const currentLevel = smoothLevelRef.current

      levelHistoryRef.current.unshift(currentLevel)
      levelHistoryRef.current.pop()

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const history = levelHistoryRef.current
      const barWidth = 3
      const barGap = 3
      const activeWidth = history.length * (barWidth + barGap) - barGap
      const startX = Math.round((canvas.width - activeWidth) / 2)
      const baseY = canvas.height / 2

      const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0)
      gradient.addColorStop(0, '#7dd3fc')
      gradient.addColorStop(0.5, '#38bdf8')
      gradient.addColorStop(1, '#0ea5e9')

      history.forEach((level, index) => {
        const amplitude = Math.max(3, level * 25)
        const height = Math.min(canvas.height - 4, amplitude)
        const x = startX + index * (barWidth + barGap)
        const y = baseY - height / 2

        ctx.fillStyle = gradient
        ctx.globalAlpha = Math.max(0.2, 1 - index * 0.045)
        ctx.shadowBlur = index < 4 ? 10 * level : 0
        ctx.shadowColor = 'rgba(56, 189, 248, 0.55)'
        ctx.beginPath()
        ctx.roundRect(x, y, barWidth, height, 2)
        ctx.fill()
      })

      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
      animationFrameRef.current = requestAnimationFrame(draw)
    }

    animationFrameRef.current = requestAnimationFrame(draw)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [audioLevel])

  return (
    <div
      className="waveform-container"
      style={{
        position: 'fixed',
        top: cursorY + 12,
        left: cursorX + 28,
        width: 116,
        height: 20,
        pointerEvents: 'none',
        zIndex: 1000,
        filter: 'drop-shadow(0 0 10px rgba(56, 189, 248, 0.38))',
      }}
    >
      <canvas
        ref={canvasRef}
        width={116}
        height={20}
        style={{ display: 'block' }}
      />
    </div>
  )
}
