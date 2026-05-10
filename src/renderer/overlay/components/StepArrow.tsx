import React, { useEffect, useRef, useState } from 'react'
import type { StepCommand } from '../../../shared/types'

interface StepArrowProps {
  steps: StepCommand[]
  currentStepIndex: number
  onStepComplete?: (stepIndex: number) => void
  onAdvanceStep?: () => void
  onAllStepsComplete?: () => void
}

export function StepArrow({ steps, currentStepIndex, onStepComplete, onAdvanceStep, onAllStepsComplete }: StepArrowProps) {
  const [activeStep, setActiveStep] = useState(-1)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())
  const stepRefs = useRef<(HTMLDivElement | null)[]>([])
  const animationFrameRef = useRef<number>()
  const currentPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const targetPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const startTimeRef = useRef<number>(0)
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const arrowRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<SVGLineElement>(null)

  useEffect(() => {
    if (currentStepIndex >= 0 && currentStepIndex < steps.length) {
      animateToStep(currentStepIndex)
    }
  }, [currentStepIndex, steps])

  const animateToStep = (stepIndex: number) => {
    const step = steps[stepIndex]
    if (!step) return

    const targetX = step.xFraction * window.innerWidth
    const targetY = step.yFraction * window.innerHeight

    if (activeStep === -1) {
      currentPosRef.current = { x: targetX, y: targetY }
      setActiveStep(stepIndex)
      updateArrowPosition(targetX, targetY)
      markStepComplete(stepIndex)
      advanceToNextStep(stepIndex)
      return
    }

    const startX = currentPosRef.current.x
    const startY = currentPosRef.current.y
    const distance = Math.hypot(targetX - startX, targetY - startY)
    const duration = Math.min(800, Math.max(300, distance * 0.5))

    startPosRef.current = { x: startX, y: startY }
    targetPosRef.current = { x: targetX, y: targetY }
    startTimeRef.current = performance.now()

    const animate = (now: number) => {
      const elapsed = now - startTimeRef.current
      const progress = Math.min(1, elapsed / duration)
      const eased = easeInOutCubic(progress)

      const currentX = startPosRef.current.x + (targetPosRef.current.x - startPosRef.current.x) * eased
      const currentY = startPosRef.current.y + (targetPosRef.current.y - startPosRef.current.y) * eased

      currentPosRef.current = { x: currentX, y: currentY }
      updateArrowPosition(currentX, currentY)

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate)
      } else {
        setActiveStep(stepIndex)
        markStepComplete(stepIndex)
        onStepComplete?.(stepIndex)
        if (stepIndex === steps.length - 1) {
          onAllStepsComplete?.()
        } else {
          advanceToNextStep(stepIndex)
        }
      }
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }
    animationFrameRef.current = requestAnimationFrame(animate)
  }

  const easeInOutCubic = (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

  const updateArrowPosition = (x: number, y: number) => {
    if (arrowRef.current) {
      arrowRef.current.style.transform = `translate(${x - 18}px, ${y - 18}px)`
    }
  }

  const markStepComplete = (stepIndex: number) => {
    setCompletedSteps(prev => {
      const next = new Set(prev)
      next.add(stepIndex)
      return next
    })
  }

  // Auto-advance to next step after animation completes
  const advanceToNextStep = (currentIdx: number) => {
    if (currentIdx < steps.length - 1) {
      setTimeout(() => {
        onAdvanceStep?.()
      }, 1500) // Pause at each step before advancing
    }
  }

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  if (steps.length === 0) return null

  const svgWidth = window.innerWidth
  const svgHeight = window.innerHeight

  return (
    <div className="step-arrow-container" style={{ position: 'fixed', top: 0, left: 0, width: svgWidth, height: svgHeight, pointerEvents: 'none', zIndex: 9997 }}>
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        {steps.map((step, index) => {
          if (index === 0) return null
          const prevStep = steps[index - 1]
          const x1 = prevStep.xFraction * svgWidth
          const y1 = prevStep.yFraction * svgHeight
          const x2 = step.xFraction * svgWidth
          const y2 = step.yFraction * svgHeight
          const isCompleted = completedSteps.has(index)
          const isActive = index === activeStep

          return (
            <line
              key={index}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={`step-line ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}
            />
          )
        })}
      </svg>

      {steps.map((step, index) => {
        const x = step.xFraction * window.innerWidth
        const y = step.yFraction * window.innerHeight
        const isCompleted = completedSteps.has(index)
        const isActive = index === activeStep
        const isPending = !isCompleted && !isActive

        return (
          <div
            key={index}
            ref={(el) => { stepRefs.current[index] = el }}
            className={`step-marker ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''} ${isPending ? 'pending' : ''}`}
            style={{
              position: 'absolute',
              left: x - 14,
              top: y - 14,
            }}
          >
            <div className="step-number">{index + 1}</div>
            {isActive && (
              <div className="step-label" style={{ left: x + 20, top: y - 10 }}>
                {step.label}
              </div>
            )}
          </div>
        )
      })}

      <div ref={arrowRef} className="step-guide-arrow" style={{ position: 'fixed', top: 0, left: 0, width: 36, height: 36 }}>
        <svg viewBox="0 0 36 36" width="36" height="36">
          <defs>
            <linearGradient id="arrowGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
            <filter id="arrowGlow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <polygon
            points="8,4 28,18 8,32 12,18"
            fill="url(#arrowGradient)"
            filter="url(#arrowGlow)"
          />
          <polygon
            points="10,8 24,18 10,28"
            fill="rgba(255,255,255,0.4)"
          />
        </svg>
        <div className="step-arrow-pulse" />
      </div>
    </div>
  )
}