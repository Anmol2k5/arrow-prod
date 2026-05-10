import type { PointCommand, StepCommand } from '@shared/types'

/**
 * Parses all [POINT:x,y:label:screenN] tags from Claude's response text.
 *
 * Claude embeds these tags when it wants the cursor overlay to fly to a
 * specific UI element on screen. The coordinates are expressed as fractions
 * of the screen dimensions (0.0 to 1.0) so they work across any resolution.
 *
 * Example tag: [POINT:0.72:0.45:Submit Button:screen0]
 *
 * Returns both the cleaned text (with tags removed for display) and an
 * array of all point commands found in the text.
 */
export function parsePointCommandsFromClaudeResponse(rawResponseText: string): {
  cleanedText: string
  pointCommands: PointCommand[]
  stepCommands: StepCommand[]
} {
  const pointCommands: PointCommand[] = []
  const stepCommands: StepCommand[] = []

  // Regex matches: [POINT:xFraction:yFraction:label:screenN]
  const pointTagRegex = /\[POINT:([\d.]+):([\d.]+):([^:]+):(screen\d+)\]/g

  // Regex matches: [STEP:xFraction:yFraction:label:screenN]
  const stepTagRegex = /\[STEP:([\d.]+):([\d.]+):([^:]+):(screen\d+)\]/g

  let match: RegExpExecArray | null

  while ((match = pointTagRegex.exec(rawResponseText)) !== null) {
    const xFraction = parseFloat(match[1])
    const yFraction = parseFloat(match[2])
    const label = match[3].trim()
    const screenIndexString = match[4]
    const screenIndex = parseInt(screenIndexString.replace('screen', ''), 10)

    if (
      !isNaN(xFraction) &&
      !isNaN(yFraction) &&
      !isNaN(screenIndex) &&
      xFraction >= 0 &&
      xFraction <= 1 &&
      yFraction >= 0 &&
      yFraction <= 1
    ) {
      pointCommands.push({ xFraction, yFraction, label, screenIndex })
    }
  }

  while ((match = stepTagRegex.exec(rawResponseText)) !== null) {
    const xFraction = parseFloat(match[1])
    const yFraction = parseFloat(match[2])
    const label = match[3].trim()
    const screenIndexString = match[4]
    const screenIndex = parseInt(screenIndexString.replace('screen', ''), 10)

    if (
      !isNaN(xFraction) &&
      !isNaN(yFraction) &&
      !isNaN(screenIndex) &&
      xFraction >= 0 &&
      xFraction <= 1 &&
      yFraction >= 0 &&
      yFraction <= 1
    ) {
      stepCommands.push({ xFraction, yFraction, label, screenIndex })
    }
  }

  // Remove all POINT and STEP tags from the text
  const cleanedText = rawResponseText
    .replace(pointTagRegex, '')
    .replace(stepTagRegex, '')
    .trim()

  return { cleanedText, pointCommands, stepCommands }
}

/**
 * Converts a PointCommand's fractional coordinates to absolute pixel
 * coordinates on the given screen, accounting for Windows DPI scaling.
 */
export function convertFractionalCoordsToAbsolutePixels(
  pointCommand: PointCommand,
  screenBounds: { x: number; y: number; width: number; height: number },
  scaleFactor: number
): { absoluteX: number; absoluteY: number } {
  const absoluteX = Math.round(
    screenBounds.x + pointCommand.xFraction * screenBounds.width * scaleFactor
  )
  const absoluteY = Math.round(
    screenBounds.y + pointCommand.yFraction * screenBounds.height * scaleFactor
  )

  return { absoluteX, absoluteY }
}