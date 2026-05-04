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
}: {
  content: string
  toolName: string
  toolParams?: string
  output?: string
  running?: boolean
}) {
  const [userToggled, setUserToggled] = useState(false)
  const isAskUser = /^ask.?user/i.test(toolName)
  const expanded = userToggled ? !running : !!running

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
            (c: unknown) => typeof c === "string"
          )
        : []
      if (!question) return null
      return { question, candidates }
    } catch {
      return null
    }
  }, [content, isAskUser])

  const params = isAskUser ? null : toolParams || null

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
    <div className="rounded border border-blue-500/20 bg-blue-500/5 my-1.5 overflow-hidden">
      <button
        onClick={() => setUserToggled(!userToggled)}
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

function renderStreamBlocks(blocks: StreamParsedBlock[], isStreaming: boolean) {
  const elements: React.ReactNode[] = []

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const key = `stream-block-${i}`

    switch (block.type) {
      case "turn_marker":
        elements.push(
          <div
            key={key}
            className="text-xs font-medium text-muted-foreground px-1 py-1 mt-2"
          >
            {block.content.replace(/\*/g, "")}
          </div>
        )
        break
      case "thinking":
        elements.push(<ThinkingBlock key={key} content={block.content} />)
        break
      case "thinking_open":
        elements.push(<OpenThinkingBlock key={key} content={block.content} />)
        break
      case "tool_call": {
        const next = i + 1 < blocks.length ? blocks[i + 1] : undefined
        const output = next?.type === "tool_output" ? next.content : undefined
        if (output) i++
        const isRunning = isStreaming && (block.running || !output)
        elements.push(
          <StreamToolBlock
            key={key}
            content={block.content}
            toolName={block.toolName ?? "unknown"}
            toolParams={block.toolParams}
            output={output}
            running={isRunning}
          />
        )
        break
      }
      case "tool_output":
        if (!block.content.trim()) break
        elements.push(
          <CollapsibleCodeBlock key={key} content={block.content} lang="text" />
        )
        break
      case "text": {
        if (!block.content.trim()) break
        elements.push(
          <div
            key={key}
            className="break-words text-sm prose prose-sm dark:prose-invert max-w-none [&_ul]:list-outside [&_ol]:list-outside [&_ul]:pl-5 [&_ol]:pl-5"
          >
            <MessageResponse>{block.content}</MessageResponse>
          </div>
        )
        break
      }
    }
  }

  return elements
}

export const GenericAgentStreamRenderer = memo(
  function GenericAgentStreamRenderer({ text }: { text: string }) {
    const blocks = useMemo(() => parseStreamBlocks(text), [text])

    if (blocks.length === 0) {
      return (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Agent is working…</span>
        </div>
      )
    }

    return <div>{renderStreamBlocks(blocks, true)}</div>
  }
)
