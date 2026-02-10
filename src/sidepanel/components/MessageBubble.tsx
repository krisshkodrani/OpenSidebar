import React, { useMemo } from "react";
import { marked } from "marked";
import { ChatEntry } from "../../types";
import { clsx } from "clsx";
import { ToolCallBadge } from "./ToolCallBadge";
import { StepTimeline } from "./StepTimeline";

marked.setOptions({ breaks: true, gfm: true });

export function MessageBubble({ message }: { message: ChatEntry }) {
    const isUser = message.role === "user";

    const renderedHtml = useMemo(() => {
        if (isUser || !message.content) return "";
        return marked.parse(message.content) as string;
    }, [message.content, isUser]);

    return (
        <div className={clsx("flex flex-col gap-1 mb-4", isUser ? "items-end" : "items-start")}>
            {!isUser && message.steps && message.steps.length > 0 && (
                <StepTimeline
                    steps={message.steps}
                    defaultCollapsed={!message.isStreaming}
                />
            )}
            <div
                className={clsx(
                    "max-w-[85%] px-3 py-2 rounded-lg text-sm shadow-sm",
                    isUser
                        ? "bg-primary-600 text-white rounded-br-none whitespace-pre-wrap"
                        : "bg-surface-light dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-none border border-gray-200 dark:border-gray-700",
                    !isUser && message.isStreaming && "streaming-cursor"
                )}
            >
                {isUser ? (
                    message.content
                ) : message.content ? (
                    <div
                        className="prose-chat"
                        dangerouslySetInnerHTML={{ __html: renderedHtml }}
                    />
                ) : (
                    message.toolCalls.length > 0 ? <span className="text-gray-500 italic">Thinking...</span> : ""
                )}
            </div>

            {/* Tool Calls */}
            {message.toolCalls.length > 0 && (
                <div className="flex flex-col gap-2 w-full max-w-[85%] mt-1">
                    {message.toolCalls.map((tool, idx) => (
                        <ToolCallBadge key={idx} tool={tool} />
                    ))}
                </div>
            )}

            <span className={clsx("text-[10px] text-gray-400 px-1 opacity-70", isUser ? "text-right" : "text-left")}>
                {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
        </div>
    );
}
