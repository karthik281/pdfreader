import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import type { ChatMessage } from "@/types";

interface ChatRequestBody {
  message: string;
  documentContext: string;   // truncated PDF text used as system context
  history: ChatMessage[];
  webSearch?: boolean;       // use compound-beta for live web lookup
}

const CHAT_MODEL        = "llama-3.3-70b-versatile";
const WEBSEARCH_MODEL   = "compound-beta";
const MAX_CONTEXT_CHARS = 12_000;
const MAX_HISTORY_TURNS = 10;

/**
 * POST /api/chat
 *
 * Streams an LLM answer to a user question about the loaded PDF.
 * When `webSearch` is true, uses Groq compound-beta which can fetch
 * live web results to supplement document context.
 *
 * @body message         - User question (required).
 * @body documentContext - PDF text used as system context.
 * @body history         - Prior turns (last N kept for context window).
 * @body webSearch       - (optional) Enable web search. Default false.
 *
 * @returns text/event-stream — `data: {"content":"..."}` per token,
 *          terminated by `data: [DONE]`.
 */
export async function POST(req: NextRequest) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
  }

  let body: Partial<ChatRequestBody>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, documentContext = "", history = [], webSearch = false } = body;

  if (!message?.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const groq   = new Groq({ apiKey: groqKey });
  const model  = webSearch ? WEBSEARCH_MODEL : CHAT_MODEL;
  const ctx    = documentContext.slice(0, MAX_CONTEXT_CHARS);

  const systemPrompt = ctx
    ? `You are a helpful reading companion. The user is listening to the following document:\n\n${ctx}\n\nAnswer questions concisely based on the document. If the answer isn't in the document, say so and offer general knowledge if useful.`
    : "You are a helpful assistant.";

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(-MAX_HISTORY_TURNS).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: message.trim() },
  ];

  try {
    const stream = await groq.chat.completions.create({
      model,
      messages,
      stream: true,
      max_tokens: 1024,
      temperature: 0.6,
    });

    const encoder  = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content ?? "";
            if (content) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
              );
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
      },
    });
  } catch (err) {
    console.error("[chat] Groq error:", err);
    return NextResponse.json(
      { error: "Chat failed", detail: String(err) },
      { status: 502 }
    );
  }
}
