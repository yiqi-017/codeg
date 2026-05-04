"use client"

import { memo, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, CheckCircle2 } from "lucide-react"
import { MessageResponse } from "@/components/ai-elements/message"
import { useTranslations } from "next-intl"

const TURN_MARKER_RE = /(\*{0,2}LLM Running \(Turn \d+\) \.\.\.\*{0,2})/
const SUMMARY_RE = /<summary[\s>/][\s\S]*?<\/summary\s*>/gi
const THINKING_RE = /<think(?:ing)?[\s>/]([\s\S]*?)<\/think(?:ing)?\s*>/gi
const TOOL_USE_RE = /<tool_(?:use|call)[\s>/][\s\S]*?<\/tool_(?:use|call)\s*>/gi
const FILE_CONTENT_RE = /<file_content[\s>/][\s\S]*?<\/file_content\s*>/gi
const BACKTICK_BLOCK_RE = /`{4,}[\s\S]*?`{4,}/g
const STRAY_XML_RE =
  /<\s*\/?\s*(?:think(?:ing)?|summary|tool_(?:use|call|result)|file_content|history|key_info)\s*\/?>/gi

interface TurnSegment {
  marker: string
  content: string
}

function parseTurnSegments(text: string): TurnSegment[] | null {
  const placeholders: string[] = []
  const safe = text.replace(BACKTICK_BLOCK_RE, (m) => {
    placeholders.push(m)
    return `\x00PH${placeholders.length - 1}\x00`
  })

  const parts = safe.split(TURN_MARKER_RE)
  const restored = parts.map((p) =>
    p.replace(/\x00PH(\d+)\x00/g, (_, i) => placeholders[Number(i)])
  )

  if (restored.length < 4) return null

  const segments: TurnSegment[] = []
  for (let i = 1; i < restored.length; i += 2) {
    const marker = restored[i]
    const content = restored[i + 1] ?? ""
    segments.push({ marker, content })
  }
  return segments.length >= 2 ? segments : null
}

function extractSummary(content: string): string | null {
  const cleaned = content
    .replace(/`{3,}[\s\S]*?`{3,}/g, "")
    .replace(THINKING_RE, "")
  const match = cleaned.match(/<summary[\s>/]\s*([\s\S]*?)\s*<\/summary\s*>/i)
  if (!match?.[1]) return null
  const line = match[1].trim().split("\n")[0]
  return line.length > 60 ? line.slice(0, 59) + "…" : line
}

interface ProcessedContent {
  thinkingBlocks: string[]
  cleanedContent: string
  hasEndMarker: boolean
}

function preprocessTurnContent(content: string): ProcessedContent {
  const thinkingBlocks: string[] = []
  let cleaned = content.replace(/\r\n/g, "\n")

  const removedTags: string[] = []

  // Strip 5+ backtick fence marker lines. GenericAgent's agent_loop wraps
  // every tool handler output in `````...````` pairs. These are rendering
  // artifacts — remove the marker lines, keep the content between them.
  const fiveTickLineRe = /^`{5,}\w*$/gm
  const fiveTickCount = (cleaned.match(fiveTickLineRe) ?? []).length
  cleaned = cleaned.replace(fiveTickLineRe, "")
  if (fiveTickCount) removedTags.push(`5-tick lines x${fiveTickCount}`)

  // Extract "[Info] Final response to user." end marker — strip the line
  // and any trailing junk, render as a styled component instead.
  const hasEndMarker = /\[Info\] Final response to user\./.test(cleaned)
  cleaned = cleaned.replace(/\n*\[Info\] Final response to user\.[\s\S]*$/, "")

  cleaned = cleaned.replace(THINKING_RE, (_match, inner) => {
    const trimmed = (inner as string).trim()
    if (trimmed) thinkingBlocks.push(trimmed)
    removedTags.push(`<thinking> (${trimmed.length} chars)`)
    return ""
  })
  const toolUseCount = (cleaned.match(TOOL_USE_RE) ?? []).length
  cleaned = cleaned.replace(TOOL_USE_RE, "")
  if (toolUseCount) removedTags.push(`<tool_use> x${toolUseCount}`)

  const fileContentCount = (cleaned.match(FILE_CONTENT_RE) ?? []).length
  cleaned = cleaned.replace(FILE_CONTENT_RE, "")
  if (fileContentCount) removedTags.push(`<file_content> x${fileContentCount}`)

  const summaryCount = (cleaned.match(SUMMARY_RE) ?? []).length
  cleaned = cleaned.replace(SUMMARY_RE, "")
  if (summaryCount) removedTags.push(`<summary> x${summaryCount}`)

  const strayCount = (cleaned.match(STRAY_XML_RE) ?? []).length
  cleaned = cleaned.replace(STRAY_XML_RE, "")
  if (strayCount) removedTags.push(`stray XML tags x${strayCount}`)

  const emptyFenceCount = (cleaned.match(/`{3,}\s*`{3,}/g) ?? []).length
  cleaned = cleaned.replace(/`{3,}\s*`{3,}/g, "")
  if (emptyFenceCount) removedTags.push(`empty fences x${emptyFenceCount}`)

  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim()

  // Strip internal retry warnings — these are noise, not user-facing content.
  cleaned = cleaned
    .replace(
      /\[Warn\] LLM returned an empty response\. Retrying\.\.\.[\n]*/g,
      ""
    )
    .trim()

  // Strip trailing orphan markdown markers (*, _, **) left after tag/fence removal.
  cleaned = cleaned.replace(/[\s*_]+$/, "").trim()

  // Remove duplicate tail fragment: when <summary> tag removal fails and
  // STRAY_XML_RE strips only the tags, the summary content leaks as a short
  // trailing line that duplicates the end of the previous line (e.g.
  // "精扫。\n扫。*"). Detect and remove it.
  const lines = cleaned.split("\n")
  if (lines.length >= 2) {
    const last = lines[lines.length - 1].replace(/[*_\s]+$/, "").trim()
    const prev = lines[lines.length - 2].trim()
    if (last.length > 0 && last.length <= 30 && prev.endsWith(last)) {
      lines.pop()
      cleaned = lines.join("\n").trim()
    }
  }

  if (removedTags.length > 0) {
    console.log("[GA-Renderer] preprocessed:", removedTags.join(", "))
  }

  return { thinkingBlocks, cleanedContent: cleaned, hasEndMarker }
}

export const ThinkingBlock = memo(function ThinkingBlock({
  content,
}: {
  content: string
}) {
  const [expanded, setExpanded] = useState(false)
  const preview = content.split("\n")[0]?.trim() ?? ""
  const short = preview.length > 50 ? preview.slice(0, 49) + "…" : preview

  return (
    <div className="rounded border border-purple-500/20 bg-purple-500/5 my-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left text-xs hover:bg-purple-500/10 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-purple-500" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-purple-500" />
        )}
        <span className="font-medium text-purple-600 dark:text-purple-400">
          Thinking
        </span>
        {!expanded && short && (
          <span className="min-w-0 flex-1 truncate text-muted-foreground/60">
            {short}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-2.5 pb-2 border-t border-purple-500/15">
          <div className="mt-1.5 text-xs text-muted-foreground whitespace-pre-wrap">
            {content}
          </div>
        </div>
      )}
    </div>
  )
})

interface ContentSegment {
  type: "text" | "tool"
  content: string
  toolName?: string
}

function splitToolBlocks(content: string): ContentSegment[] {
  const toolRe = /^🛠️ Tool: `?([^`\n]+?)`?(?:\s|$).*$/m
  const segments: ContentSegment[] = []
  let remaining = content

  while (remaining.length > 0) {
    const match = remaining.match(toolRe)
    if (!match || match.index === undefined) {
      if (remaining.trim()) {
        segments.push({ type: "text", content: remaining })
      }
      break
    }

    const before = remaining.slice(0, match.index)
    if (before.trim()) {
      segments.push({ type: "text", content: before })
    }

    const afterHeader = remaining.slice(match.index)
    const nextMatch = afterHeader.slice(1).match(toolRe)
    const toolBlock =
      nextMatch?.index !== undefined
        ? afterHeader.slice(0, nextMatch.index + 1)
        : afterHeader

    segments.push({
      type: "tool",
      content: toolBlock,
      toolName: match[1],
    })

    remaining =
      nextMatch?.index !== undefined
        ? afterHeader.slice(nextMatch.index + 1)
        : ""
  }

  return segments
}

export const ToolBlock = memo(function ToolBlock({
  content,
  toolName,
}: {
  content: string
  toolName: string
}) {
  const [expanded, setExpanded] = useState(false)

  const isAskUser = /^ask.?user/i.test(toolName)

  const questionData = useMemo(() => {
    if (!isAskUser) return null
    const fenceMatch = content.match(/`{3,}\w*\n([\s\S]*?)`{3,}/)
    const raw = fenceMatch ? fenceMatch[1].trim() : null
    const jsonStr =
      raw || content.match(/\{[\s\S]*?"question"[\s\S]*?\}\s*$/m)?.[0]
    if (!jsonStr) return null
    try {
      const parsed = JSON.parse(jsonStr)
      const question =
        typeof parsed.question === "string" ? parsed.question : null
      const candidates: string[] = Array.isArray(parsed.candidates)
        ? (parsed.candidates as string[]).filter(
            (c: unknown) => typeof c === "string",
          )
        : []
      if (!question) return null
      return { question, candidates }
    } catch {
      return null
    }
  }, [content, isAskUser])

  const statusLine = useMemo(() => {
    const m = content.match(/\[(?:Status|Action)\]\s*(.+)/)
    return m?.[1]?.trim() ?? null
  }, [content])

  if (questionData) {
    return (
      <div className="rounded border border-amber-500/25 bg-amber-500/5 my-1.5 px-3 py-2.5 space-y-2">
        <p className="text-sm font-medium">{questionData.question}</p>
        {questionData.candidates.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {questionData.candidates.map((c, i) => (
              <div
                key={i}
                className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
              >
                {c}
              </div>
            ))}
          </div>
        )}
        <div className="text-xs text-muted-foreground/60 italic">
          Waiting for your answer …
        </div>
      </div>
    )
  }

  return (
    <div className="rounded border border-blue-500/20 bg-blue-500/5 my-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left text-xs hover:bg-blue-500/10 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-blue-500" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-blue-500" />
        )}
        <span className="font-medium text-blue-600 dark:text-blue-400">
          🛠️ {toolName}
        </span>
        {!expanded && statusLine && (
          <span className="min-w-0 flex-1 truncate text-muted-foreground/60">
            {statusLine}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-2.5 pb-2 border-t border-blue-500/15 mt-1.5">
          {renderTextWithCodeBlocks(content)}
        </div>
      )}
    </div>
  )
})

const ACTION_BLOCK_RE =
  /(\[Action\][^\n]*(?:\n(?!\[Action\]|🛠️ Tool:)[^\n]*)*)/g

export const CollapsibleActionBlock = memo(function CollapsibleActionBlock({
  content,
}: {
  content: string
}) {
  if (!content.trim()) return null
  const [expanded, setExpanded] = useState(false)
  const lines = content.split("\n")
  const lineCount = lines.length

  return (
    <div className="rounded border border-emerald-500/25 bg-emerald-500/5 my-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left text-xs hover:bg-emerald-500/10 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-emerald-500" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-emerald-500" />
        )}
        <pre className="min-w-0 flex-1 font-medium text-emerald-600 dark:text-emerald-400 whitespace-pre-wrap break-all">
          {lines[0]}
        </pre>
        {lineCount > 1 && (
          <span className="shrink-0 text-muted-foreground/50">
            {lineCount} lines
          </span>
        )}
      </button>
      {expanded && (
        <pre className="px-3 pb-2 text-xs overflow-x-auto border-t border-emerald-500/15">
          <code>{content}</code>
        </pre>
      )}
    </div>
  )
})

const CODE_FENCE_RE = /^(`{3,})(\w*)\r?\n([\s\S]*?)\r?\n\1\s*$/gm

interface TextOrCode {
  type: "text" | "code"
  content: string
  lang?: string
}

function splitCodeBlocks(text: string): TextOrCode[] {
  const normalized = text.replace(/\r\n/g, "\n")
  if (normalized.length > 50) {
    console.log(
      "[GA-Renderer] splitCodeBlocks input tail:",
      JSON.stringify(normalized.slice(-100))
    )
  }
  const result: TextOrCode[] = []
  let lastIndex = 0
  let matchCount = 0

  for (const m of normalized.matchAll(CODE_FENCE_RE)) {
    matchCount++
    const before = normalized.slice(lastIndex, m.index)
    if (before.trim()) result.push({ type: "text", content: before })
    if (m[3].trim()) {
      result.push({ type: "code", content: m[3], lang: m[2] || undefined })
    }
    lastIndex = m.index! + m[0].length
  }

  const after = normalized.slice(lastIndex)
  if (after.trim()) result.push({ type: "text", content: after })

  if (result.length > 1) {
    console.log(
      `[GA-Renderer] splitCodeBlocks: ${matchCount} fences matched, ${result.length} segments`,
      result.map((s) => ({
        type: s.type,
        len: s.content.length,
        preview: s.content.slice(0, 80),
        tail: s.content.slice(-40),
      }))
    )
  }

  return result
}

export const CollapsibleCodeBlock = memo(function CollapsibleCodeBlock({
  content,
  lang,
}: {
  content: string
  lang?: string
}) {
  if (!content.trim()) return null
  const [expanded, setExpanded] = useState(false)
  const lines = content.split("\n")
  const lineCount = lines.length
  const trimmedFirst = content.trimStart()

  const isArgs = lang === "text" && trimmedFirst.startsWith("{")
  const isAction =
    /^\[Action\]/.test(trimmedFirst) || /^\[Status\]/.test(trimmedFirst)

  const label = isArgs
    ? "📥 args"
    : isAction
      ? "▶ output"
      : lines[0]?.trim().slice(0, 60) || (lang ? `${lang}` : "code")

  if (lineCount <= 3 && !isAction) {
    return (
      <pre className="my-1.5 rounded border border-border/40 bg-muted/30 px-3 py-2 text-xs overflow-x-auto">
        <code>{content}</code>
      </pre>
    )
  }

  const borderClass = isAction
    ? "border-emerald-500/25 bg-emerald-500/5"
    : "border-border/40 bg-muted/30"
  const hoverClass = isAction ? "hover:bg-emerald-500/10" : "hover:bg-muted/50"
  const chevronClass = isAction ? "text-emerald-500" : "text-muted-foreground"
  const labelClass = isAction
    ? "font-medium text-emerald-600 dark:text-emerald-400"
    : "text-muted-foreground"

  return (
    <div className={`rounded border ${borderClass} my-1.5`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left text-xs ${hoverClass} transition-colors`}
      >
        {expanded ? (
          <ChevronDown className={`h-3 w-3 shrink-0 ${chevronClass}`} />
        ) : (
          <ChevronRight className={`h-3 w-3 shrink-0 ${chevronClass}`} />
        )}
        <span className={labelClass}>{label}</span>
        <span className="shrink-0 text-muted-foreground/50">
          {lineCount} lines
        </span>
      </button>
      {expanded && (
        <pre className="px-3 pb-2 text-xs overflow-x-auto border-t border-border/20">
          <code>{content}</code>
        </pre>
      )}
    </div>
  )
})

const FinalResponseMarker = memo(function FinalResponseMarker() {
  return (
    <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-border/30">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
      <span className="text-xs font-medium text-muted-foreground/70">
        Task completed
      </span>
    </div>
  )
})

function renderTextSegment(text: string, key?: number) {
  if (!text.trim()) return null
  const actionParts = text.split(ACTION_BLOCK_RE)
  if (actionParts.length <= 1) {
    return (
      <div
        key={key}
        className="break-words text-sm prose prose-sm dark:prose-invert max-w-none [&_ul]:list-outside [&_ol]:list-outside [&_ul]:pl-5 [&_ol]:pl-5"
      >
        <MessageResponse>{text}</MessageResponse>
      </div>
    )
  }
  return (
    <div key={key}>
      {actionParts.map((part, j) =>
        /^\[Action\]/.test(part) ? (
          <CollapsibleActionBlock key={j} content={part.trim()} />
        ) : part.trim() ? (
          <div
            key={j}
            className="break-words text-sm prose prose-sm dark:prose-invert max-w-none [&_ul]:list-outside [&_ol]:list-outside [&_ul]:pl-5 [&_ol]:pl-5"
          >
            <MessageResponse>{part}</MessageResponse>
          </div>
        ) : null
      )}
    </div>
  )
}

export function renderTextWithCodeBlocks(text: string) {
  const parts = splitCodeBlocks(text)
  if (parts.length === 0) return null
  if (parts.length === 1 && parts[0].type === "text") {
    return renderTextSegment(text)
  }
  return (
    <>
      {parts.map((p, i) =>
        p.type === "code" ? (
          <CollapsibleCodeBlock key={i} content={p.content} lang={p.lang} />
        ) : (
          renderTextSegment(p.content, i)
        )
      )}
    </>
  )
}

function renderProcessedContent(content: string) {
  if (!content.trim()) return null
  const segments = splitToolBlocks(content)
  if (segments.length <= 1 && segments[0]?.type === "text") {
    return renderTextWithCodeBlocks(content)
  }
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "tool" ? (
          <ToolBlock
            key={`tool-${i}`}
            content={seg.content}
            toolName={seg.toolName!}
          />
        ) : (
          <div key={`text-${i}`}>{renderTextWithCodeBlocks(seg.content)}</div>
        )
      )}
    </>
  )
}

const CollapsedTurn = memo(function CollapsedTurn({
  segment,
  turnIndex,
}: {
  segment: TurnSegment
  turnIndex: number
}) {
  const [expanded, setExpanded] = useState(false)
  const t = useTranslations("Folder.chat.messageList")

  const summary = useMemo(
    () => extractSummary(segment.content),
    [segment.content]
  )
  const toolCount = useMemo(() => {
    const matches = segment.content.match(/🛠️/g)
    return matches?.length ?? 0
  }, [segment.content])
  const processed = useMemo(
    () => preprocessTurnContent(segment.content),
    [segment.content]
  )

  return (
    <div className="rounded-md border border-border/70 shadow-sm my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground/50" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground/50" />
        )}
        <span className="text-xs font-semibold text-foreground/70">
          {t("turnLabel", { number: turnIndex })}
        </span>
        {!expanded && summary && (
          <span className="min-w-0 flex-1 truncate text-xs text-foreground/50">
            {summary}
          </span>
        )}
        {!expanded && toolCount > 0 && (
          <span className="shrink-0 text-xs text-foreground/40">
            {t("toolCallCount", { count: toolCount })}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-border/40">
          {processed.thinkingBlocks.map((tb, i) => (
            <ThinkingBlock key={i} content={tb} />
          ))}
          {renderProcessedContent(processed.cleanedContent)}
          {processed.hasEndMarker && <FinalResponseMarker />}
        </div>
      )}
    </div>
  )
})

export const GenericAgentTextRenderer = memo(function GenericAgentTextRenderer({
  text,
}: {
  text: string
}) {
  const segments = useMemo(() => parseTurnSegments(text), [text])

  if (!segments) {
    const processed = preprocessTurnContent(text)
    return (
      <div>
        {processed.thinkingBlocks.map((tb, i) => (
          <ThinkingBlock key={i} content={tb} />
        ))}
        {renderProcessedContent(processed.cleanedContent)}
        {processed.hasEndMarker && <FinalResponseMarker />}
      </div>
    )
  }

  const lastIdx = segments.length - 1
  return (
    <div>
      {segments.map((seg, i) => {
        const processed = preprocessTurnContent(seg.content)
        const isEmpty =
          !processed.cleanedContent &&
          processed.thinkingBlocks.length === 0 &&
          !processed.hasEndMarker
        if (isEmpty) return null
        if (i < lastIdx) {
          return <CollapsedTurn key={i} segment={seg} turnIndex={i + 1} />
        }
        return (
          <div key={i}>
            <div className="text-xs font-medium text-muted-foreground px-1 py-1 mt-2">
              {seg.marker.replace(/\*/g, "")}
            </div>
            {processed.thinkingBlocks.map((tb, j) => (
              <ThinkingBlock key={j} content={tb} />
            ))}
            {renderProcessedContent(processed.cleanedContent)}
            {processed.hasEndMarker && <FinalResponseMarker />}
          </div>
        )
      })}
    </div>
  )
})
