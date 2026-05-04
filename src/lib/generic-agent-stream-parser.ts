export type StreamBlockType =
  | "text"
  | "thinking"
  | "thinking_open"
  | "tool_call"
  | "tool_output"
  | "turn_marker"
  | "summary"

export interface StreamParsedBlock {
  type: StreamBlockType
  content: string
  toolName?: string
  toolParams?: string
  turn?: number
  running?: boolean
}

const TURN_RE = /\*{0,2}LLM Running \(Turn (\d+)\)[^*]*\*{0,2}/
const THINKING_CLOSED_RE = /<think(?:ing)?[\s>]([\s\S]*?)<\/think(?:ing)?\s*>/
const SUMMARY_RE = /<summary[\s>]\s*([\s\S]*?)\s*<\/summary\s*>/
const FILE_CONTENT_RE = /<file_content[\s>][\s\S]*?<\/file_content\s*>/
const TOOL_EMOJI_RE =
  /\u{1F6E0}️\s*\*{0,2}(?:正在调用工具:|Tool:)\*{0,2}\s*`?([^`\n]+?)`?\s+📥[^\n]*\n(`{3,})\w*\n([\s\S]*?)\2(?:\n(?!\u{1F6E0}️)(?!`{5,})[^\n]*)*/u
const TOOL_EMOJI_NOPARAM_RE =
  /\u{1F6E0}️\s*\*{0,2}(?:正在调用工具:|Tool:)\*{0,2}\s*`?([^`\n]+?)`?(?:\s+📥|\s*$)[^\n]*(?:\n`{3,}\w*\n([\s\S]*?))?(?=\n\u{1F6E0}️|\n\*{0,2}LLM Running|$)/u
const TOOL_OUTPUT_RE = /`{5,}\n([\s\S]*?)`{5,}/
const THINKING_OPEN_RE = /<think(?:ing)?[\s>]([\s\S]*)$/
const STRAY_XML_RE =
  /<\s*\/?\s*(?:think(?:ing)?|summary|tool_(?:use|call|result)|file_content|history|key_info)\s*\/?>/gi
const FIVE_TICK_LINE_RE = /^`{5,}\w*$/gm
const WARN_RE = /\[Warn\] LLM returned an empty response\. Retrying\.\.\.\n*/g
const END_MARKER_RE = /\n*\[Info\] Final response to user\.[\s\S]*$/

interface Candidate {
  idx: number
  len: number
  block: StreamParsedBlock
}

export function parseStreamBlocks(raw: string): StreamParsedBlock[] {
  if (!raw) return []

  const blocks: StreamParsedBlock[] = []
  let remaining = raw

  while (remaining.length > 0) {
    const candidates: Candidate[] = []

    const turnMatch = TURN_RE.exec(remaining)
    if (turnMatch) {
      candidates.push({
        idx: turnMatch.index,
        len: turnMatch[0].length,
        block: {
          type: "turn_marker",
          content: turnMatch[0],
          turn: parseInt(turnMatch[1]),
        },
      })
    }

    const thinkMatch = THINKING_CLOSED_RE.exec(remaining)
    if (thinkMatch) {
      candidates.push({
        idx: thinkMatch.index,
        len: thinkMatch[0].length,
        block: { type: "thinking", content: thinkMatch[1].trim() },
      })
    }

    const sumMatch = SUMMARY_RE.exec(remaining)
    if (sumMatch) {
      candidates.push({
        idx: sumMatch.index,
        len: sumMatch[0].length,
        block: { type: "summary", content: sumMatch[1]?.trim() ?? "" },
      })
    }

    const fileMatch = FILE_CONTENT_RE.exec(remaining)
    if (fileMatch) {
      candidates.push({
        idx: fileMatch.index,
        len: fileMatch[0].length,
        block: { type: "tool_output", content: "" },
      })
    }

    const emojiMatch = TOOL_EMOJI_RE.exec(remaining)
    if (emojiMatch) {
      candidates.push({
        idx: emojiMatch.index,
        len: emojiMatch[0].length,
        block: {
          type: "tool_call",
          content: emojiMatch[0],
          toolName: emojiMatch[1],
          toolParams: emojiMatch[3].trim(),
        },
      })
    } else {
      const emojiNoParam = TOOL_EMOJI_NOPARAM_RE.exec(remaining)
      if (emojiNoParam) {
        candidates.push({
          idx: emojiNoParam.index,
          len: emojiNoParam[0].length,
          block: {
            type: "tool_call",
            content: emojiNoParam[0],
            toolName: emojiNoParam[1],
            toolParams: emojiNoParam[2]?.trim() || undefined,
            running: true,
          },
        })
      }
    }

    const toolOutMatch = TOOL_OUTPUT_RE.exec(remaining)
    if (toolOutMatch) {
      const covered = candidates.some(
        (c) =>
          c.block.type === "tool_call" &&
          toolOutMatch.index >= c.idx &&
          toolOutMatch.index < c.idx + c.len
      )
      if (!covered) {
        candidates.push({
          idx: toolOutMatch.index,
          len: toolOutMatch[0].length,
          block: { type: "tool_output", content: toolOutMatch[1].trim() },
        })
      }
    }

    if (candidates.length === 0) {
      const text = cleanTrailingText(remaining)
      if (text) {
        const openThink = THINKING_OPEN_RE.exec(text)
        if (openThink) {
          const before = text.slice(0, openThink.index).trim()
          if (before) blocks.push({ type: "text", content: before })
          blocks.push({
            type: "thinking_open",
            content: openThink[1].trim(),
            running: true,
          })
        } else {
          blocks.push({ type: "text", content: text })
        }
      }
      break
    }

    candidates.sort((a, b) => a.idx - b.idx)
    const winner = candidates[0]

    if (winner.idx > 0) {
      const before = cleanTrailingText(remaining.slice(0, winner.idx))
      if (before) {
        const openThink = THINKING_OPEN_RE.exec(before)
        if (openThink) {
          const pre = before.slice(0, openThink.index).trim()
          if (pre) blocks.push({ type: "text", content: pre })
          blocks.push({
            type: "thinking_open",
            content: openThink[1].trim(),
            running: true,
          })
        } else {
          blocks.push({ type: "text", content: before })
        }
      }
    }

    if (
      winner.block.content ||
      winner.block.type === "turn_marker" ||
      winner.block.type === "summary"
    ) {
      blocks.push(winner.block)
    }
    remaining = remaining.slice(winner.idx + winner.len)
  }

  return blocks
}

function cleanTrailingText(text: string): string {
  let cleaned = text
    .replace(FIVE_TICK_LINE_RE, "")
    .replace(STRAY_XML_RE, "")
    .replace(WARN_RE, "")
    .replace(END_MARKER_RE, "")
    .replace(/`{3,}\s*`{3,}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  cleaned = cleaned.replace(/[\s*_]+$/, "").trim()
  return cleaned
}
