import React from 'react'
import type { VoiceState } from '../../../shared/types'

interface ResponseBubbleProps {
  text: string
  cursorX: number
  cursorY: number
  voiceState: VoiceState
}

/**
 * The floating text bubble that appears next to the cursor,
 * showing Claude's streamed response in real time.
 *
 * Automatically repositions to stay within the viewport when
 * the cursor is near an edge.
 */
export function ResponseBubble({ text, cursorX, cursorY, voiceState }: ResponseBubbleProps) {
  const bubbleWidth = 340
  const bubbleOffset = 30

  // Position the bubble to the right of the cursor by default,
  // but flip left if near the right edge of the screen
  const isNearRightEdge = cursorX + bubbleWidth + bubbleOffset > window.innerWidth
  const bubbleLeft = isNearRightEdge
    ? cursorX - bubbleWidth - bubbleOffset
    : cursorX + bubbleOffset

  // Position vertically centered on the cursor, clamped to viewport
  const bubbleTop = Math.max(16, Math.min(cursorY - 60, window.innerHeight - 200))

  const isStreaming = voiceState === 'responding'

  return (
    <div
      className="response-bubble"
      style={{
        position: 'fixed',
        top: bubbleTop,
        left: bubbleLeft,
        width: bubbleWidth,
        maxWidth: bubbleWidth,
      }}
    >
      <p className="response-text">
        {text}
        {/* Blinking block cursor while streaming */}
        {isStreaming && <span className="streaming-cursor" />}
      </p>
    </div>
  )
}
