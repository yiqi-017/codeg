"use client"

import { memo, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react"
import { MessageResponse } from "@/components/ai-elements/message"
import {
  parseStreamBlocks,
  type StreamParsedBlock,
} from "@/lib/generic-agent-stream-parser"
import {
  ThinkingBlock,
  CollapsibleCodeBlock,
  CollapsedTurn,
  parseTurnSegments,
} from "@/components/message/generic-agent-text-renderer"

const OpenThinkingBlock = memo(function OpenThinkingBlock({
  content,
}: {
  content: string
}) {
  return (
    <div className="rounded border border-purple-500/20 bg-purple-500/5 my-1.5">
      <div className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left text-xs">
        <Loader2 className="h-3 w-3 shrink-0 text-purple-500 animate-spin" />
        <span className="font-medium text-purple-600 dark:text-purple-400">
          Thinking…
        </span>
      </div>
      {content && (
        <div className="px-2.5 pb-2 border-t border-purple-500/15">
          <div className="mt-1.5 text-xs text-muted-foreground whitespace-pre-wrap">
            {content}
          </div>
        </div>
      )}
    </div>
  )
})

const StreamToolBlock = memo(function StreamToolBlock({
  content,
  toolName,
  toolParams,
  output,
  running,
  onAnswer,
}: {
  content: string
  toolName: string
  toolParams?: string
  output?: string
  running?: boolean
  onAnswer?: (answer: string) => void
}) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null)
  const [answered, setAnswered] = useState(false)
  const [customInput, setCustomInput] = useState("")
  const isAskUser = /^ask.?user/i.test(toolName)
  const expanded = manualExpanded ?? !!running

  const questionData = useMemo(() => {
    if (!isAskUser) return null
    const source = toolParams || content
    const fenceMatch = source.match(/`{3,}\w*\n([\s\S]*?)`{3,}/)
    const raw = fenceMatch ? fenceMatch[1].trim() : null
    const jsonStr =
      raw ||
      source.match(/\{[\s\S]*?"question"[\s\S]*?\}\s*$/m)?.[0] ||
      toolParams?.trim()
    if (!jsonStr) return null
    try {
      const parsed = JSON.parse(jsonStr)
      const question =
        typeof parsed.question === "string" ? parsed.question : null
      const candidates: string[] = Array.isArray(parsed.candidates)
        ? (parsed.candidates as string[]).filter(
            (c: unknown) => typeof c === "string"
          )
        : []
      if (!question) return null
      return { question, candidates }
    } catch {
      return null
    }
  }, [content, toolParams, isAskUser])

  const params = isAskUser ? null : toolParams || null

  const handleAnswer = (text: string) => {
    if (answered || !onAnswer || !text.trim()) return
    setAnswered(true)
    onAnswer(text.trim())
  }

  if (questionData) {
    return (
      <div className="rounded border border-amber-500/25 bg-amber-500/5 my-1.5 px-3 py-2.5 space-y-2">
        <p className="text-sm font-medium">{questionData.question}</p>
        {questionData.candidates.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {questionData.candidates.map((c, i) => (
              <button
                key={i}
                disabled={answered}
                onClick={() => handleAnswer(c)}
                className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-left text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-default"
              >
                {c}
              </button>
            ))}
          </div>
        )}
        {!answered && (
          <div className="flex gap-2 pt-1">
            <input
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleAnswer(customInput)
                }
              }}
              placeholder="Or type your own answer…"
              className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <button
              disabled={!customInput.trim()}
              onClick={() => handleAnswer(customInput)}
              className="rounded-md bg-amber-500/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 transition-colors disabled:opacity-40"
            >
              Send
            </button>
          </div>
        )}
        {answered ? (
          <div className="text-xs text-muted-foreground/60 italic">
            Answered
          </div>
        ) : (
          <div className="text-xs text-muted-foreground/60 italic">
            Waiting for your answer …
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded border border-blue-500/20 bg-blue-500/5 my-1.5 overflow-hidden">
      <button
        onClick={() => setManualExpanded(expanded ? false : true)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left text-xs hover:bg-blue-500/10 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-blue-500" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-blue-500" />
        )}
        <code className="rounded bg-muted/50 px-1 py-0.5 text-[11px] font-mono">
          {toolName}
        </code>
        <span className="min-w-0 flex-1" />
        {running ? (
          <Loader2 className="h-3 w-3 shrink-0 text-blue-500 animate-spin" />
        ) : (
          <span className="truncate text-muted-foreground/60">done</span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-blue-500/15">
          {params && (
            <div className="px-2.5 pt-2">
              <div className="text-[11px] font-medium text-muted-foreground/60 mb-1">
                Parameters
              </div>
              <pre className="rounded bg-muted/30 px-2.5 py-2 text-xs overflow-x-auto whitespace-pre-wrap break-all">
                <code>{params}</code>
              </pre>
            </div>
          )}
          {output && (
            <div className="px-2.5 pt-2 pb-2">
              <div className="text-[11px] font-medium text-muted-foreground/60 mb-1">
                Output
              </div>
              <pre className="rounded bg-muted/30 px-2.5 py-2 text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto">
                <code>{output}</code>
              </pre>
            </div>
          )}
          {!params && !output && (
            <div className="px-2.5 py-2 text-xs text-muted-foreground/50 italic">
              No parameters
            </div>
          )}
        </div>
      )}
    </div>
  )
})

function renderSingleBlock(
  block: StreamParsedBlock,
  i: number,
  blocks: StreamParsedBlock[],
  isStreaming: boolean,
  onAnswer?: (answer: string) => void,
  skipRef?: { current: number }
): React.ReactNode {
  const key = `stream-block-${i}`
  switch (block.type) {
    case "turn_marker":
    case "summary":
      return null
    case "thinking":
      return <ThinkingBlock key={key} content={block.content} />
    case "thinking_open":
      return <OpenThinkingBlock key={key} content={block.content} />
    case "tool_call": {
      const next = i + 1 < blocks.length ? blocks[i + 1] : undefined
      const output = next?.type === "tool_output" ? next.content : undefined
      if (output && skipRef) skipRef.current = i + 1
      const isLast = (output ? i + 1 : i) >= blocks.length - 1
      const isRunning = isStreaming && !output && (block.running || isLast)
      return (
        <StreamToolBlock
          key={key}
          content={block.content}
          toolName={block.toolName ?? "unknown"}
          toolParams={block.toolParams}
          output={output}
          running={isRunning}
          onAnswer={onAnswer}
        />
      )
    }
    case "tool_output":
      if (!block.content.trim()) return null
      return (
        <CollapsibleCodeBlock key={key} content={block.content} lang="text" />
      )
    case "text": {
      if (!block.content.trim()) return null
      return (
        <div
          key={key}
          className="break-words text-sm prose prose-sm dark:prose-invert max-w-none [&_ul]:list-outside [&_ol]:list-outside [&_ul]:pl-5 [&_ol]:pl-5"
        >
          <MessageResponse>{block.content}</MessageResponse>
        </div>
      )
    }
    default:
      return null
  }
}

function renderLastTurnBlocks(
  blocks: StreamParsedBlock[],
  isStreaming: boolean,
  onAnswer?: (answer: string) => void
) {
  const elements: React.ReactNode[] = []
  const skipRef = { current: -1 }

  for (let i = 0; i < blocks.length; i++) {
    if (i === skipRef.current) continue
    const block = blocks[i]
    if (block.type === "turn_marker") {
      elements.push(
        <div
          key={`stream-block-${i}`}
          className="text-xs font-medium text-muted-foreground px-1 py-1 mt-2"
        >
          {block.content.replace(/\*/g, "")}
        </div>
      )
      continue
    }
    const el = renderSingleBlock(
      block,
      i,
      blocks,
      isStreaming,
      onAnswer,
      skipRef
    )
    if (el) elements.push(el)
  }

  return elements
}

export const GenericAgentStreamRenderer = memo(
  function GenericAgentStreamRenderer({
    text,
    onAnswer,
  }: {
    text: string
    onAnswer?: (answer: string) => void
  }) {
    const segments = useMemo(() => parseTurnSegments(text), [text])

    const lastTurnBlocks = useMemo(() => {
      if (!segments || segments.length < 2) return parseStreamBlocks(text)
      const lastContent =
        segments[segments.length - 1].marker +
        segments[segments.length - 1].content
      return parseStreamBlocks(lastContent)
    }, [text, segments])

    if (lastTurnBlocks.length === 0 && (!segments || segments.length < 2)) {
      return (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Agent is working…</span>
        </div>
      )
    }

    return (
      <div>
        {segments &&
          segments
            .slice(0, -1)
            .map((seg, i) => (
              <CollapsedTurn
                key={`turn-${i}`}
                segment={seg}
                turnIndex={i + 1}
              />
            ))}
        {renderLastTurnBlocks(lastTurnBlocks, true, onAnswer)}
      </div>
    )
  }
)
