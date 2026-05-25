export interface Provider {
  providerType?: "chat" | "anthropic";
  name: string;
  baseUrl: string;
  apiKey: string;
  defaultModel?: string;
}

export interface Config {
  port: number;
  providers: Provider[];
  defaultProvider: string;
}

export type PublicProvider = Omit<Provider, "apiKey"> & { apiKey: string };
export type PublicConfig = Omit<Config, "providers"> & { providers: PublicProvider[] };

export interface ResponsesRequest {
  model: string;
  input: string | ResponsesInputItem[];
  instructions?: string;
  tools?: ResponsesTool[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  previous_response_id?: string;
}

export type ResponsesInputItem =
  | ResponsesMessageInput
  | ResponsesFunctionCall
  | ResponsesFunctionCallOutput;

export interface ResponsesMessageInput {
  type: "message";
  role: "user" | "assistant" | "system" | "developer";
  content: ResponsesContentPart[] | null;
}

export interface ResponsesContentPart {
  type: "input_text" | "input_image" | "output_text";
  text?: string;
  image_url?: string;
}

export interface ResponsesFunctionCall {
  type: "function_call";
  name: string;
  call_id: string;
  arguments: string;
}

export interface ResponsesFunctionCallOutput {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export interface ResponsesTool {
  type: "function" | "web_search" | "code_interpreter";
  name?: string;
  description?: string;
  parameters?: object;
}

export interface ChatCompletionsRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | ChatContentPart[];
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

export interface ChatContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatTool {
  type: "function";
  function: { name: string; description?: string; parameters?: object };
}

export interface ChatCompletionsResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    finish_reason?: string | null;
    message: {
      role: "assistant";
      content?: string | null;
      tool_calls?: ChatToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string;
  tools?: AnthropicTool[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentPart[];
}

export type AnthropicContentPart =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "url"; url: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: object;
}

export interface AnthropicMessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export type AnthropicStreamEvent =
  | { type: "message_start"; message: { id: string; model: string } }
  | { type: "content_block_start"; index: number; content_block: { type: "text"; text?: string } | { type: "tool_use"; id: string; name: string; input?: unknown } }
  | { type: "content_block_delta"; index: number; delta: { type: "text_delta"; text: string } | { type: "input_json_delta"; partial_json: string } }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta?: { stop_reason?: string | null } }
  | { type: "message_stop" };

export interface ResponsesResponse {
  id: string;
  object: "response";
  created_at: number;
  model: string;
  status: "completed";
  output: ResponsesOutputItem[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

export type ResponsesOutputItem =
  | {
      type: "message";
      id: string;
      status: "completed";
      role: "assistant";
      content: Array<{ type: "output_text"; text: string; annotations: unknown[] }>;
    }
  | {
      type: "function_call";
      id: string;
      call_id: string;
      name: string;
      arguments: string;
      status: "completed";
    };

export interface ChatCompletionChunk {
  id: string;
  model?: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

export interface ResponsesSSEEvent {
  type: string;
  [key: string]: any;
}
