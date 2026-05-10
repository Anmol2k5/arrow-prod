import React, { useEffect, useRef, useState, useCallback } from 'react'
import type { VoiceState } from '../../../shared/types'

interface ClickyCursorProps {
  x: number
  y: number
  voiceState: VoiceState
  isPointing: boolean
}

export function ClickyCursor({ x, y, voiceState, isPointing }: ClickyCursorProps) {
  const cursorRef = useRef<HTMLDivElement>(null)
  const animStateRef = useRef({
    currentX: 0,
    currentY: 0,
    targetX: 0,
    targetY: 0,
    startX: 0,
    startY: 0,
    startedAt: 0,
    duration: 0,
    isAnimating: false,
    rotation: 18,
  })
  const targetRef = useRef({ x: 0, y: 0 })
  const isPointingRef = useRef(false)

  useEffect(() => {
    targetRef.current = { x, y }
  }, [x, y])

  useEffect(() => {
    isPointingRef.current = isPointing
  }, [isPointing])

  useEffect(() => {
    animStateRef.current.currentX = x
    animStateRef.current.currentY = y
    animStateRef.current.targetX = x
    animStateRef.current.targetY = y
  }, []) // Initialize once on mount

  useEffect(() => {
    const cursor = cursorRef.current
    if (!cursor) return

    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

    let animationId: number

    const animate = (now: number) => {
      const state = animStateRef.current
      const target = targetRef.current

      if (state.isAnimating) {
        const rawProgress = Math.min(1, (now - state.startedAt) / state.duration)
        const progress = easeInOutCubic(rawProgress)

        state.currentX = state.startX + (state.targetX - state.startX) * progress
        state.currentY = state.startY + (state.targetY - state.startY) * progress

        if (rawProgress >= 1) {
          state.isAnimating = false
          state.currentX = state.targetX
          state.currentY = state.targetY
        }
      } else {
        const dx = target.x - state.currentX
        const dy = target.y - state.currentY
        const distance = Math.hypot(dx, dy)

        if (distance > 0.5) {
          const followSpeed = isPointingRef.current ? 0.08 : 0.25
          state.currentX += dx * followSpeed
          state.currentY += dy * followSpeed

          const targetAngle = (Math.atan2(dy, dx) * 180) / Math.PI
          const angleDiff = targetAngle - state.rotation
          const normalizedDiff = ((angleDiff + 180) % 360) - 180
          state.rotation += normalizedDiff * 0.2
        }
      }

      cursor.style.transform = `translate(${state.currentX - 18}px, ${state.currentY - 18}px) rotate(${state.rotation}deg)`
      animationId = requestAnimationFrame(animate)
    }

    animationId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animationId)
    }
  }, []) // Animation loop starts once, runs forever

  useEffect(() => {
    const state = animStateRef.current
    const distance = Math.hypot(x - state.targetX, y - state.targetY)

    state.startX = state.currentX
    state.startY = state.currentY
    state.targetX = x
    state.targetY = y
    state.startedAt = performance.now()

    if (isPointing) {
      state.duration = Math.min(1000, Math.max(400, distance * 0.8))
      state.isAnimating = true
    } else {
      state.isAnimating = false
    }

    if (distance > 1) {
      state.rotation = (Math.atan2(y - state.currentY, x - state.currentX) * 180) / Math.PI
    }
  }, [x, y, isPointing])

  const getCursorStateClass = () => {
    if (isPointing) return 'cursor-pointing'
    switch (voiceState) {
      case 'listening': return 'cursor-listening'
      case 'processing': return 'cursor-processing'
      case 'responding': return 'cursor-responding'
      default: return 'cursor-idle'
    }
  }

  return (
    <div
      ref={cursorRef}
      className={`clicky-cursor ${getCursorStateClass()}`}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        willChange: 'transform',
      }}
    >
      <div className="cursor-glow-ring" />
      <div className="cursor-arrow">
        <div className="cursor-arrow-core" />
        <div className="cursor-arrow-wing" />
      </div>
      {isPointing && <div className="cursor-ripple" />}
    </div>
  )
}

export function ClickyCursor({ x, y, voiceState, isPointing }: ClickyCursorProps) {
  const cursorRef = useRef<HTMLDivElement>(null)
  const animationFrameRef = useRef<number>()
  const [renderKey, setRenderKey] = useState(0)

  // Animation state in REFS to avoid re-renders during animation
  const animStateRef = useRef({
    startX: 0,
    startY: 0,
    targetX: 0,
    targetY: 0,
    currentX: 0,
    currentY: 0,
    startedAt: 0,
    duration: 0,
    arcLift: 0,
    isAnimating: false,
    isPointing: false,
    rotation: 18,
  })

  // Update target position via ref (called from parent)
  const updateTarget = useCallback((newX: number, newY: number, pointing: boolean) => {
    const state = animStateRef.current
    state.startX = state.currentX
    state.startY = state.currentY
    state.targetX = newX
    state.targetY = newY
    state.isPointing = pointing

    const deltaX = newX - state.currentX
    const deltaY = newY - state.currentY
    const distance = Math.hypot(deltaX, deltaY)

    const duration = pointing
      ? Math.min(1400, Math.max(650, distance * 0.75))
      : Math.min(400, Math.max(100, distance * 0.3))

    const arcLift = pointing ? Math.min(180, Math.max(50, distance * 0.18)) : 0

    state.startedAt = performance.now()
    state.duration = duration
    state.arcLift = arcLift
    state.isAnimating = true

    // Update rotation
    if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
      state.rotation = (Math.atan2(deltaY, deltaX) * 180) / Math.PI
    }
  }, [])

  // Expose updateTarget via ref for parent access
  useEffect(() => {
    (cursorRef.current as any)?.__updateTarget?.(updateTarget)
  }, [updateTarget])

  // Main animation loop - runs continuously without restarts
  useEffect(() => {
    const cursor = cursorRef.current
    if (!cursor) return

    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

    const animate = (now: number) => {
      const state = animStateRef.current

      if (state.isAnimating) {
        const rawProgress = Math.min(1, (now - state.startedAt) / state.duration)
        const progress = easeInOutCubic(rawProgress)

        const deltaX = state.targetX - state.startX
        const deltaY = state.targetY - state.startY

        state.currentX = state.startX + deltaX * progress
        state.currentY = state.startY + deltaY * progress - Math.sin(progress * Math.PI) * state.arcLift

        if (rawProgress >= 1) {
          state.isAnimating = false
          state.currentX = state.targetX
          state.currentY = state.targetY
        }
      }

      // Apply transform directly (no state update = no re-render)
      cursor.style.transform = `translate(${state.currentX - 18}px, ${state.currentY - 18}px) rotate(${state.rotation}deg)`

      animationFrameRef.current = requestAnimationFrame(animate)
    }

    // Initialize position
    animStateRef.current.currentX = x
    animStateRef.current.currentY = y
    animStateRef.current.rotation = 18

    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, []) // Empty deps - loop runs forever

  // Update target when props change
  useEffect(() => {
    updateTarget(x, y, isPointing)
  }, [x, y, isPointing, updateTarget])

  const getCursorStateClass = () => {
    if (isPointing) return 'cursor-pointing'
    switch (voiceState) {
      case 'listening': return 'cursor-listening'
      case 'processing': return 'cursor-processing'
      case 'responding': return 'cursor-responding'
      default: return 'cursor-idle'
    }
  }

  return (
    <div
      ref={cursorRef}
      className={`clicky-cursor ${getCursorStateClass()}`}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        willChange: 'transform',
      }}
    >
      <div className="cursor-glow-ring" />
      <div className="cursor-arrow">
        <div className="cursor-arrow-core" />
        <div className="cursor-arrow-wing" />
      </div>
      {isPointing && <div className="cursor-ripple" />}
    </div>
  )
}