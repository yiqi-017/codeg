"use client"

import { memo, useMemo, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { MessageResponse } from "@/components/ai-elements/message"
import { useTranslations } from "next-intl"

const TURN_MARKER_RE = /(\*{0,2}LLM Running \(Turn \d+\) \.\.\.\*{0,2})/
const SUMMARY_RE = /<summary>\s*([\s\S]*?)\s*<\/summary>/
const BACKTICK_BLOCK_RE = /`{4,}[\s\S]*?`{4,}/g

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
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
  const match = cleaned.match(SUMMARY_RE)
  if (!match?.[1]) return null
  const line = match[1].trim().split("\n")[0]
  return line.length > 60 ? line.slice(0, 59) + "…" : line
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

  return (
    <div className="rounded-md border border-border/40 my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="text-xs font-medium text-muted-foreground">
          {t("turnLabel", { number: turnIndex })}
        </span>
        {!expanded && summary && (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/70">
            {summary}
          </span>
        )}
        {!expanded && toolCount > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground/50">
            {t("toolCallCount", { count: toolCount })}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-border/20">
          <div className="mt-2 break-words text-sm prose prose-sm dark:prose-invert max-w-none [&_ul]:list-inside [&_ol]:list-inside">
            <MessageResponse>{segment.content}</MessageResponse>
          </div>
        </div>
      )}
    </div>
  )
})

export const GenericAgentTextRenderer = memo(
  function GenericAgentTextRenderer({ text }: { text: string }) {
    const segments = useMemo(() => parseTurnSegments(text), [text])

    if (!segments) {
      return (
        <div className="break-words text-sm prose prose-sm dark:prose-invert max-w-none [&_ul]:list-inside [&_ol]:list-inside">
          <MessageResponse>{text}</MessageResponse>
        </div>
      )
    }

    const lastIdx = segments.length - 1
    return (
      <div>
        {segments.map((seg, i) =>
          i < lastIdx ? (
            <CollapsedTurn key={i} segment={seg} turnIndex={i + 1} />
          ) : (
            <div key={i}>
              <div className="text-xs font-medium text-muted-foreground px-1 py-1 mt-2">
                {seg.marker.replace(/\*/g, "")}
              </div>
              <div className="break-words text-sm prose prose-sm dark:prose-invert max-w-none [&_ul]:list-inside [&_ol]:list-inside">
                <MessageResponse>{seg.content}</MessageResponse>
              </div>
            </div>
          )
        )}
      </div>
    )
  }
)
