import type {
  AnthropicContentPart,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicMessage,
  AnthropicStreamEvent,
  AnthropicTool,
  ChatCompletionChunk,
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  ChatContentPart,
  ChatMessage,
  ChatTool,
  ResponsesInputItem,
  ResponsesRequest,
  ResponsesResponse,
  ResponsesSSEEvent
} from "./types.js";

export function translateRequest(responsesReq: ResponsesRequest, defaultModel?: string): ChatCompletionsRequest {
  const messages: ChatMessage[] = [];
  if (responsesReq.instructions) {
    messages.push({ role: "system", content: responsesReq.instructions });
  }

  if (typeof responsesReq.input === "string") {
    messages.push({ role: "user", content: responsesReq.input });
  } else {
    for (const item of responsesReq.input) {
      messages.push(toChatMessage(item));
    }
  }

  const request: ChatCompletionsRequest = {
    model: defaultModel || responsesReq.model || "",
    messages
  };
  if (responsesReq.stream !== undefined) request.stream = responsesReq.stream;
  if (responsesReq.temperature !== undefined) request.temperature = responsesReq.temperature;
  if (responsesReq.top_p !== undefined) request.top_p = responsesReq.top_p;
  if (responsesReq.max_output_tokens !== undefined) request.max_tokens = responsesReq.max_output_tokens;

  const tools = responsesReq.tools?.flatMap(toChatTool) ?? [];
  if (tools.length > 0) {
    request.tools = tools;
  }
  return request;
}

export function translateAnthropicRequest(responsesReq: ResponsesRequest, defaultModel?: string): AnthropicMessagesRequest {
  const messages: AnthropicMessage[] = [];
  const systemParts: string[] = [];
  if (responsesReq.instructions) {
    systemParts.push(responsesReq.instructions);
  }

  if (typeof responsesReq.input === "string") {
    messages.push({ role: "user", content: responsesReq.input });
  } else {
    for (const item of responsesReq.input) {
      if (item.type === "message" && (item.role === "system" || item.role === "developer")) {
        systemParts.push(contentToText(item.content));
        continue;
      }
      messages.push(toAnthropicMessage(item));
    }
  }

  const request: AnthropicMessagesRequest = {
    model: defaultModel || responsesReq.model || "",
    messages,
    max_tokens: responsesReq.max_output_tokens ?? 1024
  };
  if (systemParts.length > 0) request.system = systemParts.join("\n\n");
  if (responsesReq.stream !== undefined) request.stream = responsesReq.stream;
  if (responsesReq.temperature !== undefined) request.temperature = responsesReq.temperature;
  if (responsesReq.top_p !== undefined) request.top_p = responsesReq.top_p;

  const tools = responsesReq.tools?.flatMap(toAnthropicTool) ?? [];
  if (tools.length > 0) {
    request.tools = tools;
  }
  return request;
}

function toChatMessage(item: ResponsesInputItem): ChatMessage {
  if (item.type === "function_call") {
    return {
      role: "assistant",
      content: "",
      tool_calls: [{ id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } }]
    };
  }
  if (item.type === "function_call_output") {
    return { role: "tool", tool_call_id: item.call_id, content: item.output };
  }

  const role = item.role === "developer" ? "system" : item.role;
  return { role, content: convertContent(item.content) };
}

function toAnthropicMessage(item: ResponsesInputItem): AnthropicMessage {
  if (item.type === "function_call") {
    return {
      role: "assistant",
      content: [{ type: "tool_use", id: item.call_id, name: item.name, input: parseJsonObject(item.arguments) }]
    };
  }
  if (item.type === "function_call_output") {
    return { role: "user", content: [{ type: "tool_result", tool_use_id: item.call_id, content: item.output }] };
  }

  return {
    role: item.role === "assistant" ? "assistant" : "user",
    content: convertAnthropicContent(item.content)
  };
}

function convertAnthropicContent(content: Array<{ type: string; text?: string; image_url?: string }>): string | AnthropicContentPart[] {
  if (content.every((part) => part.type !== "input_image")) {
    return contentToText(content);
  }
  return content.map((part) => {
    if (part.type === "input_image") {
      return { type: "image", source: { type: "url", url: part.image_url ?? "" } };
    }
    return { type: "text", text: part.text ?? "" };
  });
}

function contentToText(content: Array<{ text?: string }>): string {
  return content.map((part) => part.text ?? "").join("");
}

function convertContent(content: Array<{ type: string; text?: string; image_url?: string }>): string | ChatContentPart[] {
  if (content.every((part) => part.type !== "input_image")) {
    return content.map((part) => part.text ?? "").join("");
  }
  return content.map((part) => {
    if (part.type === "input_image") {
      return { type: "image_url", image_url: { url: part.image_url ?? "" } };
    }
    return { type: "text", text: part.text ?? "" };
  });
}

function toChatTool(tool: { type: string; name?: string; description?: string; parameters?: object }): ChatTool[] {
  if (tool.type !== "function" || !tool.name) {
    return [];
  }
  return [{ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }];
}

function toAnthropicTool(tool: { type: string; name?: string; description?: string; parameters?: object }): AnthropicTool[] {
  if (tool.type !== "function" || !tool.name) {
    return [];
  }
  return [{ name: tool.name, description: tool.description, input_schema: tool.parameters ?? { type: "object" } }];
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { arguments: value };
  }
}

export function translateResponse(chatRes: ChatCompletionsResponse): ResponsesResponse {
  const message = chatRes.choices[0]?.message;
  const output: ResponsesResponse["output"] = [];
  if (message?.content) {
    output.push({
      type: "message",
      id: `${chatRes.id}_msg_0`,
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: message.content, annotations: [] }]
    });
  }
  for (const call of message?.tool_calls ?? []) {
    output.push({
      type: "function_call",
      id: call.id,
      call_id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
      status: "completed"
    });
  }

  return {
    id: chatRes.id,
    object: "response",
    created_at: chatRes.created,
    model: chatRes.model,
    status: "completed",
    output,
    usage: chatRes.usage ? {
      input_tokens: chatRes.usage.prompt_tokens,
      output_tokens: chatRes.usage.completion_tokens,
      total_tokens: chatRes.usage.total_tokens
    } : undefined
  };
}

export function translateAnthropicResponse(anthropicRes: AnthropicMessagesResponse): ResponsesResponse {
  const output: ResponsesResponse["output"] = [];
  for (const part of anthropicRes.content) {
    if (part.type === "text" && part.text) {
      output.push({
        type: "message",
        id: `${anthropicRes.id}_msg_${output.length}`,
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: part.text, annotations: [] }]
      });
    }
    if (part.type === "tool_use") {
      output.push({
        type: "function_call",
        id: part.id,
        call_id: part.id,
        name: part.name,
        arguments: JSON.stringify(part.input ?? {}),
        status: "completed"
      });
    }
  }

  return {
    id: anthropicRes.id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model: anthropicRes.model,
    status: "completed",
    output,
    usage: anthropicRes.usage ? {
      input_tokens: anthropicRes.usage.input_tokens,
      output_tokens: anthropicRes.usage.output_tokens,
      total_tokens: anthropicRes.usage.input_tokens + anthropicRes.usage.output_tokens
    } : undefined
  };
}

export class StreamTranslator {
  private outputIndex = 0;
  private contentIndex = 0;
  private responseId: string;
  private model: string;
  private text = "";
  private toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  private textStarted = false;

  constructor(responseId = `resp_${Date.now()}`, model = "") {
    this.responseId = responseId;
    this.model = model;
  }

  onStart(): ResponsesSSEEvent[] {
    this.textStarted = true;
    return [
      { type: "response.created", response: this.response("in_progress") },
      { type: "response.output_item.added", output_index: this.outputIndex, item: this.messageItem("in_progress") },
      {
        type: "response.content_part.added",
        output_index: this.outputIndex,
        content_index: this.contentIndex,
        part: { type: "output_text", text: "", annotations: [] }
      }
    ];
  }

  onDelta(chunk: ChatCompletionChunk): ResponsesSSEEvent[] {
    const events: ResponsesSSEEvent[] = [];
    if (chunk.model) {
      this.model = chunk.model;
    }
    for (const choice of chunk.choices) {
      const content = choice.delta.content;
      if (content) {
        this.text += content;
        events.push({
          type: "response.output_text.delta",
          output_index: this.outputIndex,
          content_index: this.contentIndex,
          delta: content
        });
      }
      for (const call of choice.delta.tool_calls ?? []) {
        const index = call.index ?? 0;
        const existing = this.toolCalls.get(index);
        const current = existing ?? { id: call.id ?? `call_${index}`, name: "", arguments: "" };
        if (call.id) current.id = call.id;
        if (call.function?.name) current.name = call.function.name;
        if (call.function?.arguments) current.arguments += call.function.arguments;
        this.toolCalls.set(index, current);
        if (!existing) {
          events.push({
            type: "response.output_item.added",
            output_index: index + 1,
            item: {
              type: "function_call",
              id: current.id,
              call_id: current.id,
              name: current.name,
              arguments: "",
              status: "in_progress"
            }
          });
        }
        events.push({
          type: "response.function_call_arguments.delta",
          output_index: index + 1,
          delta: call.function?.arguments ?? "",
          item_id: current.id
        });
      }
    }
    return events;
  }

  onDone(): ResponsesSSEEvent[] {
    const events: ResponsesSSEEvent[] = [];
    if (this.textStarted) {
      const item = this.messageItem("completed");
      events.push({
        type: "response.output_text.done",
        output_index: this.outputIndex,
        content_index: this.contentIndex,
        text: this.text
      });
      events.push({ type: "response.output_item.done", output_index: this.outputIndex, item });
    }

    for (const [index, call] of this.toolCalls) {
      events.push({
        type: "response.output_item.done",
        output_index: index + 1,
        item: {
          type: "function_call",
          id: call.id,
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
          status: "completed"
        }
      });
    }
    events.push({ type: "response.completed", response: this.response("completed") });
    return events;
  }

  private response(status: "in_progress" | "completed"): Record<string, unknown> {
    return {
      id: this.responseId,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      model: this.model,
      status,
      output: status === "completed" ? [this.messageItem("completed")] : []
    };
  }

  private messageItem(status: "in_progress" | "completed"): Record<string, unknown> {
    return {
      type: "message",
      id: `${this.responseId}_msg_0`,
      status,
      role: "assistant",
      content: [{ type: "output_text", text: this.text, annotations: [] }]
    };
  }
}

export class AnthropicStreamTranslator {
  private outputIndex = 0;
  private contentIndex = 0;
  private responseId: string;
  private model: string;
  private text = "";
  private toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

  constructor(responseId = `resp_${Date.now()}`, model = "") {
    this.responseId = responseId;
    this.model = model;
  }

  onStart(): ResponsesSSEEvent[] {
    return [
      { type: "response.created", response: this.response("in_progress") },
      { type: "response.output_item.added", output_index: this.outputIndex, item: this.messageItem("in_progress") },
      {
        type: "response.content_part.added",
        output_index: this.outputIndex,
        content_index: this.contentIndex,
        part: { type: "output_text", text: "", annotations: [] }
      }
    ];
  }

  onDelta(event: AnthropicStreamEvent): ResponsesSSEEvent[] {
    const events: ResponsesSSEEvent[] = [];
    if (event.type === "message_start") {
      this.responseId = event.message.id;
      this.model = event.message.model;
    }
    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      const index = event.index + 1;
      this.toolCalls.set(index, {
        id: event.content_block.id,
        name: event.content_block.name,
        arguments: JSON.stringify(event.content_block.input ?? {})
      });
      events.push({
        type: "response.output_item.added",
        output_index: index,
        item: {
          type: "function_call",
          id: event.content_block.id,
          call_id: event.content_block.id,
          name: event.content_block.name,
          arguments: "",
          status: "in_progress"
        }
      });
    }
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      this.text += event.delta.text;
      events.push({
        type: "response.output_text.delta",
        output_index: this.outputIndex,
        content_index: this.contentIndex,
        delta: event.delta.text
      });
    }
    if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
      const index = event.index + 1;
      const current = this.toolCalls.get(index) ?? { id: `call_${index}`, name: "", arguments: "" };
      current.arguments += event.delta.partial_json;
      this.toolCalls.set(index, current);
      events.push({
        type: "response.function_call_arguments.delta",
        output_index: index,
        delta: event.delta.partial_json,
        item_id: current.id
      });
    }
    return events;
  }

  onDone(): ResponsesSSEEvent[] {
    const events: ResponsesSSEEvent[] = [
      {
        type: "response.output_text.done",
        output_index: this.outputIndex,
        content_index: this.contentIndex,
        text: this.text
      },
      { type: "response.output_item.done", output_index: this.outputIndex, item: this.messageItem("completed") }
    ];

    for (const [index, call] of this.toolCalls) {
      events.push({
        type: "response.output_item.done",
        output_index: index,
        item: {
          type: "function_call",
          id: call.id,
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
          status: "completed"
        }
      });
    }
    events.push({ type: "response.completed", response: this.response("completed") });
    return events;
  }

  private response(status: "in_progress" | "completed"): Record<string, unknown> {
    return {
      id: this.responseId,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      model: this.model,
      status,
      output: status === "completed" ? [this.messageItem("completed")] : []
    };
  }

  private messageItem(status: "in_progress" | "completed"): Record<string, unknown> {
    return {
      type: "message",
      id: `${this.responseId}_msg_0`,
      status,
      role: "assistant",
      content: [{ type: "output_text", text: this.text, annotations: [] }]
    };
  }
}
