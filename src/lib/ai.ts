import OpenAI from "openai";
import type { AgentType } from "@/lib/agent-constants";

export type AIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

type AIRequest = {
  agentType?: AgentType;
  messages: AIMessage[];
  maxTokens: number;
  timeoutMs: number;
};

type ReplayChunk = {
  choices: [{ delta: { content?: string } }];
};

/**
 * 开发环境默认使用固定回放，避免测试意外消耗 API 额度。
 * 真实调用必须显式设置 AI_MODE=live。
 */
export const AI_MODE =
  process.env.AI_MODE ??
  (process.env.NODE_ENV === "production" ? "live" : "replay");
export const AI_MODEL = process.env.AI_MODEL ?? "gpt-4o-mini";

export function isLiveAI(): boolean {
  return AI_MODE === "live";
}

export function isAIConfigured(): boolean {
  return !isLiveAI() || Boolean(process.env.AI_API_KEY);
}

/** 创建真实 OpenAI 兼容客户端；回放模式不会调用此函数。 */
export function createAIClient(): OpenAI {
  if (!process.env.AI_API_KEY) {
    throw new Error("AI_API_KEY is not set");
  }
  return new OpenAI({
    apiKey: process.env.AI_API_KEY,
    baseURL: process.env.AI_BASE_URL || "https://api.openai.com/v1",
  });
}

function lastUserMessage(messages: AIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user" && typeof message.content === "string") {
      return message.content;
    }
  }
  return "";
}

function replayResponse(agentType: AgentType | undefined, messages: AIMessage[]): string {
  const user = lastUserMessage(messages);
  const userCount = messages.filter((message) => message.role === "user").length;
  const lines = (...items: string[]) => items.join("\n");

  if (agentType === "requirement_analyst") {
    return lines(
      "## 需求分析",
      "",
      "### 用户与场景",
      "本校大学生在毕业季和日常生活中买卖闲置物品，当前主要依靠微信群，检索和交易效率较低。",
      "",
      "### 用户故事",
      "作为本校学生，我想发布、搜索并沟通二手商品，以便更高效地完成交易。",
      "",
      "### 功能范围",
      "做 X：商品发布、分类浏览与搜索、站内私聊、用户评价。",
      "不做 Y：物流配送和担保交易（MVP 聚焦校内自取，避免引入履约和资金托管复杂度）。",
      "",
      "### 成功指标",
      "上线首月发布商品 100 件，完成交易 30 笔。",
      "",
      "# 排除清单",
      "",
      "- 物流配送：MVP 采用校内自取，暂不接入物流。",
      "- 担保交易：MVP 暂不处理资金托管。",
      "",
      "%%%FILE_BEGIN%%% 需求分析-工作文档（回放）.md",
      "# 需求分析工作文档",
      "",
      "- 已确认目标用户：本校大学生",
      "- 已确认 MVP 范围：发布、搜索、私聊、评价",
      "%%%FILE_END%%%",
      "",
      "%%%FILE_BEGIN%%% 需求分析.md",
      "# 需求分析",
      "",
      "### 用户与场景",
      "本校大学生在毕业季和日常生活中买卖闲置物品，当前主要依靠微信群，检索和交易效率较低。",
      "",
      "### 用户故事",
      "作为本校学生，我想发布、搜索并沟通二手商品，以便更高效地完成交易。",
      "",
      "### 功能范围",
      "做 X：商品发布、分类浏览与搜索、站内私聊、用户评价。不做 Y：物流配送和担保交易（MVP 聚焦校内自取）。",
      "",
      "### 成功指标",
      "上线首月发布商品 100 件，完成交易 30 笔。",
      "%%%FILE_END%%%"
    );
  }

  if (agentType === "prototype") {
    if (userCount >= 3 || /完满|确认写入|确认/.test(user)) {
      return lines(
        "已完成自检：页面清单覆盖需求范围，页面五要素齐全，用户流程包含主路径和异常分支，元素包含显示文案。",
        "",
        "%%%SCOPE_FROZEN%%%",
        "%%%FILE_BEGIN%%% 原型.md",
        "# 原型",
        "",
        "## 商品浏览页",
        "- **目的**：让学生浏览和搜索二手商品。",
        "- **元素**：搜索框（显示文案「搜索商品」）、商品列表、分类筛选、商品卡片（显示文案「查看详情」）。",
        "- **操作**：输入关键词后过滤列表；点击商品卡片进入详情。",
        "- **入口·出口**：从首页进入；可进入商品详情页。",
        "- **依赖**：商品数据、分类数据。",
        "",
        "## 用户流程：发布商品",
        "- **触发**：学生决定出售闲置物品。",
        "- **主路径**：填写标题、描述和价格 → 上传图片 → 点击「发布」→ 展示发布成功。",
        "- **异常分支**：必填项为空时提示并停留在表单页。",
        "- **边界情况**：图片格式不支持时提示重新选择。",
        "%%%FILE_END%%%"
      );
    }
    return lines(
      "我建议采用「商品浏览 → 商品详情 → 发布商品」的简单网页流程。",
      "",
      "%%%HTML_BEGIN%%%",
      "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>校园二手</title></head><body><main><h1>校园二手</h1><input placeholder=\"搜索商品\"><button>发布商品</button><p>浏览校内闲置商品，快速找到需要的东西。</p></main></body></html>",
      "%%%HTML_END%%%",
      "",
      "这个方向可以吗？"
    );
  }

  if (agentType === "mvp_prd") {
    if (userCount >= 3 || /六章|详细撰写|继续/.test(user)) {
      return lines(
        "# 在线点餐 - MVP PRD",
        "",
        "## 1. 概念",
        "核心用户：公司员工。要解决的一件事：减少午餐排队时间。产品形态：Web 应用。MVP 功能：菜品浏览、购物车、提交订单、订单状态。外部依赖声明：无。",
        "",
        "## 2. Out of Scope",
        "在线支付和外卖配送暂不实现，分别因为接入复杂度和履约成本较高。",
        "",
        "## 3. 页面清单",
        "## 菜品浏览页",
        "- **目的**：浏览和搜索菜品。",
        "- **元素**：菜品列表、搜索框、加入购物车按钮。",
        "- **操作**：搜索过滤列表，点击按钮加入购物车。",
        "- **入口·出口**：从首页进入，可前往购物车页。",
        "- **依赖**：菜品数据、购物车状态。",
        "",
        "## 4. 实体级数据模型",
        "### 菜品",
        "定义：店铺可售卖的菜。字段表：名称、价格、状态。状态机：在售 → 售罄。关系：订单引用菜品。",
        "",
        "## 5. 用户流程 + 验收标准",
        "## 用户流程：提交订单",
        "- **触发**：顾客在购物车确认菜品。",
        "- **主路径**：点击提交订单 → 创建订单 → 跳转订单详情。",
        "- **异常分支**：购物车为空时提示并停留原页。",
        "#### 验收标准",
        "- [ ] 当购物车非空时提交订单，系统创建订单并跳转详情页。",
        "",
        "## 6. 文案基调",
        "轻松、直接、口语化。",
        "%%%FILE_BEGIN%%% prd.md",
        "# 在线点餐 - MVP PRD",
        "",
        "## 1. 概念",
        "核心用户：公司员工。要解决的一件事：减少午餐排队时间。产品形态：Web 应用。MVP 功能：菜品浏览、购物车、提交订单、订单状态。外部依赖声明：无。",
        "",
        "## 2. Out of Scope",
        "在线支付和外卖配送暂不实现。",
        "",
        "## 3. 页面清单",
        "## 菜品浏览页",
        "- **目的**：浏览和搜索菜品。",
        "- **元素**：菜品列表、搜索框、加入购物车按钮。",
        "- **操作**：搜索过滤列表，点击按钮加入购物车。",
        "- **入口·出口**：从首页进入，可前往购物车页。",
        "- **依赖**：菜品数据、购物车状态。",
        "",
        "## 4. 实体级数据模型",
        "### 菜品",
        "定义：店铺可售卖的菜。字段表：名称、价格、状态。状态机：在售 → 售罄。关系：订单引用菜品。",
        "",
        "## 5. 用户流程 + 验收标准",
        "## 用户流程：提交订单",
        "- **触发**：顾客在购物车确认菜品。",
        "- **主路径**：点击提交订单 → 创建订单 → 跳转订单详情。",
        "- **异常分支**：购物车为空时提示并停留原页。",
        "#### 验收标准",
        "- [ ] 当购物车非空时提交订单，系统创建订单并跳转详情页。",
        "",
        "## 6. 文案基调",
        "轻松、直接、口语化。",
        "%%%FILE_END%%%"
      );
    }
    if (userCount >= 2 || /概念版|范围|确认/.test(user)) {
      return lines(
        "范围已确认，下面先记录概念版并冻结范围。",
        "",
        "**概念版**",
        "- 核心用户：公司员工",
        "- 要解决的一件事：减少午餐排队时间",
        "- 产品形态：Web 应用",
        "- MVP 功能：菜品浏览、购物车、提交订单、订单状态",
        "- 本版本不做什么：在线支付、外卖配送",
        "- 商业模式：免费使用，菜品利润分成",
        "- 外部依赖声明：无",
        "",
        "以上范围是否确认？确认后不可更改，将进入详细撰写。",
        "",
        "%%%FILE_BEGIN%%% 概念版（回放）.md",
        "# 概念版",
        "",
        "核心用户：公司员工；要解决的一件事：减少午餐排队时间；产品形态：Web 应用；MVP 功能：菜品浏览、购物车、提交订单、订单状态；本版本不做在线支付和外卖配送；商业模式：免费使用；外部依赖声明：无。",
        "%%%FILE_END%%%",
        "%%%SCOPE_FROZEN%%%"
      );
    }
    return lines(
      "我先复述已加载的需求分析和原型结论：目标是让公司员工提前点餐，减少午餐排队；MVP 包含菜品浏览、购物车、提交订单和订单状态，暂不做在线支付与外卖配送。",
      "接下来我会整理概念版并请你确认范围。"
    );
  }

  if (agentType === "ticket_splitter") {
    if (userCount >= 2 || /输出|重新切分|合并/.test(user)) {
      return lines(
        "## 切分后的 issues 文件集",
        "",
        "%%%FILE_BEGIN%%% issues/01-data-model.md",
        "# 01 — 数据模型",
        "",
        "**What to build:** 建立点餐流程所需的菜品、购物车和订单数据，使后续页面可以共享同一份状态。",
        "",
        "**Blocked by:** None — can start immediately",
        "",
        "**Status:** ready-for-agent",
        "",
        "## 验收标准",
        "- [ ] 当系统创建订单时，订单包含已提交的菜品和总价。",
        "%%%FILE_END%%%",
        "",
        "%%%FILE_BEGIN%%% issues/02-order-flow.md",
        "# 02 — 提交订单流程",
        "",
        "**What to build:** 用户从购物车提交订单并查看订单详情。",
        "",
        "**Blocked by:** #01 — 数据模型",
        "",
        "**Status:** ready-for-agent",
        "",
        "## 验收标准",
        "- [ ] 当购物车非空时提交订单，系统创建订单并跳转订单详情页。",
        "%%%FILE_END%%%"
      );
    }
    return lines(
      "## 切分草案",
      "",
      "1. 数据模型",
      "   - Blocked by: None",
      "   - 交付行为：建立菜品、购物车和订单数据。",
      "2. 提交订单流程",
      "   - Blocked by: #01 数据模型",
      "   - 交付行为：用户提交订单并查看订单状态。",
      "",
      "请确认粒度和依赖关系是否合适？"
    );
  }

  return "回放模式已收到消息。";
}

function replayStream(content: string): AsyncIterable<ReplayChunk> {
  return (async function* () {
    for (let i = 0; i < content.length; i += 80) {
      yield { choices: [{ delta: { content: content.slice(i, i + 80) } }] };
    }
  })();
}

export async function createAIStream({
  agentType,
  messages,
  maxTokens,
  timeoutMs,
}: AIRequest): Promise<AsyncIterable<ReplayChunk> | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  if (!isLiveAI()) {
    return replayStream(replayResponse(agentType, messages));
  }
  return createAIClient().chat.completions.create(
    { model: AI_MODEL, max_tokens: maxTokens, messages, stream: true },
    { timeout: timeoutMs }
  );
}

export async function createAICompletion({
  agentType,
  messages,
  maxTokens,
  timeoutMs,
}: AIRequest): Promise<string> {
  if (!isLiveAI()) {
    return replayResponse(agentType, messages);
  }
  const response = await createAIClient().chat.completions.create(
    { model: AI_MODEL, max_tokens: maxTokens, messages, stream: false },
    { timeout: timeoutMs }
  );
  return response.choices[0]?.message?.content?.trim() ?? "";
}
