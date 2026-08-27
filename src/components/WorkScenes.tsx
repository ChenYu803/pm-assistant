"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import styles from "./OnboardingExperience.module.css";

type Choice = { id: string; label: string; detail: string };
type Judgment = {
  id: string;
  concept: string;
  question: string;
  hint: string;
  options: Choice[];
  correct: string;
  correctReason: string;
  wrongReason: Record<string, string>;
  action: string;
};
type Scene = {
  id: number;
  phase: string;
  title: string;
  background: string;
  contextTitle: string;
  contextCopy: string;
  mentor: string;
  questions: Judgment[];
};

const scenes: Scene[] = [
  {
    id: 2,
    phase: "问题定义",
    title: "证据已经有了，问题还没有被说清楚",
    background: "几天的访谈、观察和案例整理后，团队手里有了不少原始记录，但还没有形成可以推进的产品问题。访谈中，一位学生说：“我希望 AI 直接告诉我每道题的答案。”前辈让你把这句话放回真实学习处境里判断。",
    contextTitle: "把问题\n看清楚。",
    contextCopy: "收集到的原话不是产品问题。现在要把真实处境、行为和目标归纳成可讨论、可验证的判断。",
    mentor: "产品经理的第一步不是替用户决定功能，而是把问题看清楚。",
    questions: [
      {
        id: "02-A", concept: "传统 PM 共同底盘 / 需求判断", question: "面对已经收集到的多源证据，你接下来最应该做什么？", hint: "先问自己：团队现在拥有的是一堆原话，还是一个经过证据支持的问题？",
        options: [
          { id: "A", label: "先让算法工程师比较几个热门大模型", detail: "确定技术路线" },
          { id: "B", label: "先让 AI 生成一份完整 PRD", detail: "让团队有东西可以讨论" },
          { id: "C", label: "把学生的真实处境、行为和目标归纳成待验证的问题", detail: "再决定是否进入方案讨论" },
          { id: "D", label: "先研究竞品", detail: "把竞品已有的核心功能做成第一版" },
        ],
        correct: "C", correctReason: "收集方法只是得到证据，产品经理还要把证据归纳成可讨论、可验证的问题。只有先确认学生真正卡在哪里，团队才能判断后面是否需要 AI。",
        wrongReason: { A: "模型比较可以在明确问题后进行。现在先选模型，会让技术方案反过来牵着产品走。", B: "AI 可以帮助整理已有信息，但不能替团队凭空制造用户证据。没有事实支撑的 PRD 只是猜测的排版。", C: "这是当前最合适的下一步。产品经理要把多源证据转成问题定义，再讨论功能和技术。", D: "竞品研究有价值，但不能替代对目标用户的理解。照搬功能可能解决的是竞品用户的问题。" },
        action: "团队从原始记录中归纳出学生在大而模糊的学习任务中缺少拆解和进展判断的方法，形成第一版问题定义。",
      },
      {
        id: "02-B", concept: "需求表达与问题定义", question: "你会怎样记录“我希望 AI 直接告诉我每道题的答案”这条访谈信息？", hint: "用户说出的功能，背后可能藏着什么任务和困难？",
        options: [
          { id: "A", label: "记录为明确需求", detail: "增加“拍照搜题并直接给答案”功能" },
          { id: "B", label: "记录为待追问的问题", detail: "他在什么学习任务中卡住，为什么需要立即得到答案？" },
          { id: "C", label: "记录为用户不懂学习方法", detail: "后续教育他不要依赖 AI" },
          { id: "D", label: "记录为模型能力需求", detail: "寻找准确率最高的解题模型" },
        ],
        correct: "B", correctReason: "用户表达的是一个解决方案想法，不一定是完整需求。继续追问触发场景、目标和困难，才能判断他需要的是答案、解释、任务拆解还是进度反馈。",
        wrongReason: { A: "直接把功能愿望当需求，会过早锁定方案，也可能强化用户并不真正需要的行为。", B: "这是合适的记录方式。先保留原话，再追问背后的任务、动机和约束。", C: "产品经理不能因为担心滥用就替用户下结论。风险需要被理解和设计，而不是用评价代替研究。", D: "模型准确率是后续需要验证的能力指标，但还不能回答“到底要解决什么问题”。" },
        action: "团队把“直接给答案”还原为“在大而模糊的学习任务中缺少拆解和判断进展的方法”，问题定义获得了具体用户证据。",
      },
    ],
  },
  {
    id: 3,
    phase: "理解 AI 能力",
    title: "AI 能做什么，不能做什么？",
    background: "完成场景 02 的问题定义后，团队把三个高频问题和 AI 能力放在一起：学生不知道怎样拆解大型学习任务；找课程资料很麻烦；遇到概念问题时，希望获得符合自己理解水平的解释。前辈提醒你，了解 AI 不能只停在“它很强”，要把市场上已经可用的能力和限制放到同一张表里。",
    contextTitle: "建立 AI\n能力雷达。",
    contextCopy: "把用户任务、现成能力、市场现状、能力限制和验证方式放到同一张表里，才不会把模型想象成魔法。",
    mentor: "AI 产品经理要知道现成 AI 能力的边界，不把模型想象成无所不知的魔法。",
    questions: [
      {
        id: "03-A", concept: "AI 能力认知", question: "为了帮助学生拆解大型学习任务，哪种现成 AI 能力最值得先研究？", hint: "关注“理解目标并生成可调整计划”的能力，而不是只看有没有 AI 标签。",
        options: [
          { id: "A", label: "文本生成与对话", detail: "根据学生目标生成任务拆解，并允许继续追问和调整" },
          { id: "B", label: "人脸识别", detail: "确认学生每天是否坐在书桌前学习" },
          { id: "C", label: "固定规则提醒", detail: "每天晚上九点提醒学生打开学习页面" },
          { id: "D", label: "把所有课程文件交给模型", detail: "让它自动记住全部内容" },
        ],
        correct: "A", correctReason: "任务拆解需要理解自然语言目标、生成结构化计划并根据反馈调整。文本生成和对话能力是值得研究的起点，但还要验证计划质量和稳定性。",
        wrongReason: { A: "这是最匹配当前任务的 AI 能力方向。它能处理模糊目标，但输出仍需被检查和调整。", B: "人脸识别解决的是身份或出勤判断，不能解决“如何把目标拆成行动”。", C: "固定提醒可以用普通规则稳定完成，不需要为了使用 AI 而使用 AI。", D: "模型不会因为“交给它”就可靠地记住全部课程资料；资料范围、检索方式和引用来源都必须被设计。" },
        action: "团队开始验证“目标理解、任务拆解、追问调整”这条 AI 能力链，而不是泛泛寻找一个大模型。",
      },
      {
        id: "03-B", concept: "AI 能力边界与验证", question: "学生希望助手“根据本学期课程资料回答问题，并标明答案出处”。接入现成大模型前，你最需要先核实什么？", hint: "模型能生成流畅答案，不等于答案一定来自指定资料。",
        options: [
          { id: "A", label: "只看模型回答是否自然流畅", detail: "流畅就说明可以上线" },
          { id: "B", label: "核实模型能否基于指定资料检索回答", detail: "展示来源，并在资料不足时承认不知道" },
          { id: "C", label: "直接把模型参数调到最大", detail: "让它记住更多内容" },
          { id: "D", label: "先承诺所有课程问题都能回答", detail: "再根据投诉补功能" },
        ],
        correct: "B", correctReason: "这是一个有资料范围和可信度要求的场景。必须验证回答是否受指定资料约束、来源是否可追溯，以及资料不足时能否拒答或请求补充，而不是只看语言是否漂亮。",
        wrongReason: { A: "流畅只是表达质量，不能证明事实正确、来源真实或符合课程范围。", B: "这是必要的能力验证。用户需要知道答案根据什么产生，也需要知道系统什么时候不能回答。", C: "调参数不能自动解决资料检索、来源展示和事实可靠性问题。", D: "把未知能力包装成承诺，会把模型的不确定性变成用户和团队的风险。" },
        action: "团队把“课程资料问答”定义为有资料边界、引用要求和拒答机制的 AI 能力，而不是一个万能问答框。",
      },
    ],
  },
  {
    id: 4,
    phase: "判断 AI 价值",
    title: "不是所有问题，都值得加上 AI",
    background: "团队把三个用户问题和能力地图放在一起：拆解大型学习任务、查找课程资料、获得分层解释。负责人要求你提出第一版 AI 产品机会，且要说明为什么这个机会值得做，而不是为了展示 AI 而添加 AI。",
    contextTitle: "找到值得用\nAI 的机会。",
    contextCopy: "比较用户痛点、AI 的独特增量和可衡量结果。AI 价值不是“用了模型”，而是比普通规则多解决了一部分真实问题。",
    mentor: "AI 价值不是“用了模型”，而是 AI 比普通规则多解决了一部分真实问题。",
    questions: [
      {
        id: "04-A", concept: "发现 AI 价值", question: "以下哪个机会最值得优先做 AI 验证？", hint: "比较“用户痛点、AI 独特增量和结果是否可衡量”，不要只比较功能听起来有多酷。",
        options: [
          { id: "A", label: "用 AI 把课程表重新排版", detail: "做成更漂亮的颜色" },
          { id: "B", label: "用固定规则每天提醒", detail: "所有学生完成同一项任务" },
          { id: "C", label: "根据学习目标和当前进展动态拆解下一步", detail: "并调整解释方式" },
          { id: "D", label: "在首页放一个向 AI 提问的输入框", detail: "让用户自由聊天" },
        ],
        correct: "C", correctReason: "学生的目标、基础和进展各不相同，动态拆解和分层解释需要理解上下文并生成个性化建议，这是 AI 相比固定规则的增量；同时可以用任务完成率、继续执行率和求助后的进展来验证。",
        wrongReason: { A: "视觉排版可以用普通模板或设计工具完成。加入 AI 没有解决核心学习困难。", B: "固定提醒有用，但不需要模型理解复杂情境，AI 不是必要条件。", C: "这是当前最值得验证的机会。它同时连接了明确痛点、AI 能力和可观察结果。", D: "开放聊天看似灵活，却没有明确任务和成功标准，容易变成无法评估的“AI 很方便”。" },
        action: "团队把资源集中到“任务拆解与分层解释”这条 AI 增量上，暂不把普通提醒和展示优化包装成 AI 功能。",
      },
      {
        id: "04-B", concept: "AI 价值判断与产品指标", question: "负责人问：“怎么证明这个 AI 机会真的有价值？”你会先提出哪组验证指标？", hint: "价值要连接用户是否更接近目标，而不只是模型调用次数。",
        options: [
          { id: "A", label: "只统计每天调用了多少次模型", detail: "调用越多价值越大" },
          { id: "B", label: "只比较模型回答的字数", detail: "回答越长说明帮助越多" },
          { id: "C", label: "观察学生能否完成拆解后的下一步", detail: "是否减少卡住时间，并核对建议准确性和采纳情况" },
          { id: "D", label: "只看团队是否觉得功能先进", detail: "团队满意就可以继续投入" },
        ],
        correct: "C", correctReason: "AI 机会的价值要回到用户任务：是否更快开始、是否继续完成、建议是否准确且被采纳。同时还要关注成本、延迟和错误风险，避免用热闹的调用量替代真实结果。",
        wrongReason: { A: "调用量可能代表用户反复追问或无法解决问题，不能直接等同于价值。", B: "字数是输出表面特征，长答案甚至可能增加理解负担。", C: "这组指标把用户结果、建议质量和产品代价放在一起，才足以验证机会。", D: "团队判断可以作为输入，但不能替代用户行为和结果证据。" },
        action: "团队为第一版验证设定“开始任务、完成下一步、建议准确性和采纳率”等指标，并保留成本与错误记录。",
      },
    ],
  },
  {
    id: 5,
    phase: "设计人机协作",
    title: "技术能运行，还不等于产品能使用",
    background: "技术同学做出了一个可运行的版本：学生输入学习目标，模型生成计划和解释。内部演示时结果很快，但偶尔会给出不符合课程要求的建议，也会把不确定的内容说得很肯定。前辈让你决定第一版产品应如何处理这些情况，并说明不同岗位的责任。",
    contextTitle: "把 AI 能力\n产品化。",
    contextCopy: "技术可运行只是起点。第一版要限定范围、展示依据、允许纠正，并给用户一条可退出和求助的退路。",
    mentor: "研发负责把复杂性兜住，产品经理负责让用户不必替系统承担复杂性。",
    questions: [
      {
        id: "05-A", concept: "AI 不可靠性与人机协作", question: "当 AI 生成的学习建议可能不准确时，第一版产品最合适的处理方式是什么？", hint: "不要在“完全相信”和“完全不用”之间二选一，想想怎样让错误可发现、可纠正、可退出。",
        options: [
          { id: "A", label: "把建议写得更肯定", detail: "让学生更愿意执行" },
          { id: "B", label: "在限定资料范围内生成建议", detail: "展示依据和不确定性，关键行动前确认，并提供纠正或人工求助入口" },
          { id: "C", label: "抽测准确率达到 90% 就隐藏提示", detail: "避免打扰用户" },
          { id: "D", label: "先让学生自己判断对错", detail: "产品不需要设计任何兜底" },
        ],
        correct: "B", correctReason: "AI 输出有概率性，产品需要把风险显性化并设置恢复路径。范围约束、依据展示、确认、纠正和兜底共同构成可控的人机协作，而不是把责任转给学生。",
        wrongReason: { A: "语气更肯定不会让内容更可靠，只会让错误更难被识别。", B: "这是合适的第一版边界。用户仍能获得 AI 帮助，但关键判断和纠错路径不会消失。", C: "整体准确率不能覆盖每个高风险错误，隐藏限制会让用户误以为系统无条件可靠。", D: "产品经理不能把系统风险推给用户。用户可以参与确认，但系统必须提供看得见的依据和退路。" },
        action: "方案增加资料范围、来源、不确定性、确认和兜底设计，验证指标也包含错误发现和纠正成功率。",
      },
      {
        id: "05-B", concept: "AI 产品岗位边界", question: "负责人问：“这个方案里，谁来负责什么？”哪种分工最合理？", hint: "岗位边界不是把责任互相推走，而是让每类判断有明确 owner。",
        options: [
          { id: "A", label: "PM 负责所有模型细节", detail: "算法工程师只写代码，AI 工程师不参与产品决策" },
          { id: "B", label: "PM 负责用户问题、产品取舍、体验和验收标准", detail: "算法工程师负责模型/评测，AI 工程师负责接入、编排、监控和稳定性，三方共同验证" },
          { id: "C", label: "只要模型效果好，岗位分工不重要", detail: "谁有空谁就决定产品行为" },
          { id: "D", label: "PM 写完 PRD 后交给研发", detail: "等研发给出最终产品" },
        ],
        correct: "B", correctReason: "PM 不需要替代研发做所有技术工作，但必须理解能力边界并负责用户价值、取舍和验收。算法工程师和 AI 工程师分别关注模型能力与系统落地，方案需要共同验证。",
        wrongReason: { A: "把 PM 变成算法专家、又把研发排除在产品判断外，既不现实也不利于协作。", B: "这是清晰且可协作的分工。责任各有 owner，但关键方案需要共同验证。", C: "没有 owner 的团队遇到错误时无法追责，也无法稳定迭代。", D: "只交 PRD、等待研发替你决定，是传统的交接思维，不符合 AI 产品经理需要理解 AI 能力和价值的要求。" },
        action: "团队明确用户价值、模型能力、系统落地和共同验收的责任边界，进入方案评审。",
      },
    ],
  },
  {
    id: 6,
    phase: "提升效率与成长",
    title: "把时间省下来，用在更重要的判断上",
    background: "方案进入评审前，需要整理访谈摘要、数据表、流程图、PRD 初稿和一轮交互原型。前辈打开 AI 工具，又讲起团队里一位“超级个体”同事：他能理解用户问题和 AI 边界，也能把确认过的方案快速做成 Demo，和研发一起缩短验证周期。但他并不是靠写更多文档或炫技来证明自己。",
    contextTitle: "AI 时代的\n产品经理。",
    contextCopy: "把低创新性的整理工作交给 AI，把省下来的时间还给证据核对、产品判断、验证和协作。",
    mentor: "AI 节省的是执行时间，产品经理要把省下来的时间还给判断、验证和协作。",
    questions: [
      {
        id: "06-A", concept: "AI 提效与 PM 责任", question: "面对一批访谈记录和即将到来的评审，你会怎样借助 AI 提效？", hint: "把低创新性的整理工作交给 AI，但把事实核对、取舍和决策留在自己手里。",
        options: [
          { id: "A", label: "让 AI 直接总结访谈并写成最终结论", detail: "自己只负责复制到 PRD" },
          { id: "B", label: "让 AI 先整理摘要、聚类主题、生成流程和 PRD 初稿", detail: "再回到原始证据核对并做产品判断" },
          { id: "C", label: "为了体现 AI 能力重新生成所有文档", detail: "不必确认是否有变化" },
          { id: "D", label: "认为 AI 会替代产品经理", detail: "不再做访谈和评审，只等待它给出方案" },
        ],
        correct: "B", correctReason: "摘要、聚类、流程和初稿属于 AI 可以加速的执行工作；哪些证据可信、问题是否值得解决、方案如何取舍和能否验收，仍由产品经理负责。",
        wrongReason: { A: "AI 可能漏掉反例或误读语境，未经核对的总结不能直接成为产品结论。", B: "这是合适的协作方式。AI 提高产出速度，PM 用原始证据和目标校验结果。", C: "重复生成不是提效。没有新的判断目标时，更多文档只会增加噪声和返工。", D: "AI 可以处理信息和生成草稿，但不能替代对用户、价值和责任的判断。" },
        action: "团队快速得到可评审的交付物，同时保留证据核对、决策记录和验收标准。",
      },
      {
        id: "06-B", concept: "Vibe Coding 与超级个体成长位置", question: "前辈介绍那位能把方案快速做成 Demo 的“超级个体”后，哪句话最准确？", hint: "区分“会写代码”与“能把判断、AI 能力和实现连成验证闭环”。",
        options: [
          { id: "A", label: "现在就能独立完成正式产品上线", detail: "才算合格的 AI 产品经理" },
          { id: "B", label: "Vibe Coding 只是炫技", detail: "与产品经理工作无关，应该完全交给研发" },
          { id: "C", label: "先把用户问题、AI 能力边界和产品取舍做可靠", detail: "在此基础上学习 Vibe Coding，逐步缩短从判断到验证的距离" },
          { id: "D", label: "只要 Demo 能跑", detail: "就可以跳过评测、协作和上线前的风险处理" },
        ],
        correct: "C", correctReason: "超级个体的价值不只是会写代码，而是能把用户理解、AI 判断和实现验证连成更短的闭环。Vibe Coding 是最终阶段可以持续扩大的能力，不取代可靠的 PM 基础，也不能跳过评测和责任。",
        wrongReason: { A: "正式上线涉及安全、稳定性、数据和协作，不应把它设为入职第一天的合格线。", B: "会使用 Vibe Coding 能扩大 PM 的验证能力，但前提是它服务于明确判断，而不是把产品责任推给研发。", C: "这是合理的成长路径：可靠 PM → 懂 AI、能发现价值的 AI PM → 能扩大产研闭环的超级个体。", D: "Demo 是验证工具，不是正式产品。跑通不代表可靠，更不代表可以跳过风险和交付流程。" },
        action: "团队把确认过的方案推进到可验证 Demo 计划，同时保留评测、协作和后续交付边界。",
      },
    ],
  },
];

type AnswerState = Record<string, { selected: string; submitted: boolean }>;
const motionStorageKey = "pm-assistant-work-scene-motion-v2";
const inMemoryVisitedScenes = new Set<number>([1]);
const inMemoryAnswers: AnswerState = {};

function scheduleFrame(callback: () => void): number {
  return typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame(callback)
    : window.setTimeout(callback, 0);
}

function cancelScheduledFrame(frame: number) {
  if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(frame);
  else window.clearTimeout(frame);
}

export default function WorkScenes({ initialScene, replayMotion = false }: { initialScene: number; replayMotion?: boolean }) {
  const router = useRouter();
  const pageRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const questionTransitionTimer = useRef<number | null>(null);
  const sceneId = Math.max(2, Math.min(6, initialScene));
  const scene = useMemo(() => scenes.find((item) => item.id === sceneId) ?? scenes[0], [sceneId]);
  const [visited, setVisited] = useState<number[]>(() => Array.from(new Set([...inMemoryVisitedScenes, sceneId])));
  const [answers, setAnswers] = useState<AnswerState>(() => ({ ...inMemoryAnswers }));
  const [questionIndex, setQuestionIndex] = useState(0);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackCycle, setFeedbackCycle] = useState(0);
  const [pendingQuestionSwap, setPendingQuestionSwap] = useState(false);
  const [questionSwapOut, setQuestionSwapOut] = useState(false);
  const [questionTransitioning, setQuestionTransitioning] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [motionVisibleKeys, setMotionVisibleKeys] = useState<Set<string>>(() => new Set());
  const [motionStaticKeys, setMotionStaticKeys] = useState<Set<string>>(() => new Set());
  const question = scene.questions[questionIndex];
  const answer = answers[question.id];
  const selected = answer?.selected;
  const submitted = answer?.submitted;
  const correct = selected === question.correct;
  const canReturn = (id: number) => visited.includes(id);

  useEffect(() => {
    inMemoryVisitedScenes.add(1);
    inMemoryVisitedScenes.add(sceneId);
  }, [sceneId]);

  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    let revealed = new Set<string>();
    try {
      revealed = new Set(JSON.parse(window.sessionStorage.getItem(motionStorageKey) || "[]"));
    } catch {
      revealed = new Set();
    }

    const targets = [...page.querySelectorAll<HTMLElement>("[data-motion-key]")];
    const forceReplay = replayMotion && questionIndex === 0;
    const applyMotionState = (keys: string[], staticMotion: boolean) => {
      if (!keys.length) return;
      setMotionVisibleKeys((current) => new Set([...current, ...keys]));
      if (staticMotion) setMotionStaticKeys((current) => new Set([...current, ...keys]));
    };
    const reveal = (targetsToReveal: HTMLElement[], staticMotion = false) => {
      const keys = targetsToReveal.map((target) => target.dataset.motionKey).filter((key): key is string => Boolean(key));
      if (keys.length === 0) return;
      keys.forEach((key) => revealed.add(key));
      try { window.sessionStorage.setItem(motionStorageKey, JSON.stringify([...revealed])); } catch { /* 动效记录失败时仍显示内容。 */ }
      targetsToReveal.forEach((target) => {
        target.classList.add(styles.revealVisible);
        if (staticMotion) target.classList.add(styles.motionStatic);
      });
      applyMotionState(keys, staticMotion);
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      reveal(targets, true);
      return;
    }

    const scrollRoot = page.parentElement instanceof HTMLElement ? page.parentElement : null;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const target = entry.target as HTMLElement;
        reveal([target]);
        observer.unobserve(target);
      });
    }, { root: scrollRoot, rootMargin: "0px 0px -12% 0px", threshold: 0.12 });

    const cachedTargets: HTMLElement[] = [];
    targets.forEach((target) => {
      const key = target.dataset.motionKey;
      if (!forceReplay && key && revealed.has(key)) cachedTargets.push(target);
      else observer.observe(target);
    });
    if (cachedTargets.length) reveal(cachedTargets, true);

    return () => observer.disconnect();
  }, [question.id, questionIndex, replayMotion]);

  useEffect(() => {
    if (!feedbackCycle || !submitted || !feedbackRef.current) return;
    void feedbackRef.current.offsetWidth;
    const frame = scheduleFrame(() => setFeedbackPending(false));
    return () => cancelScheduledFrame(frame);
  }, [feedbackCycle, submitted]);

  useEffect(() => {
    if (!pendingQuestionSwap) return;
    const timer = window.setTimeout(() => setPendingQuestionSwap(false), 620);
    return () => window.clearTimeout(timer);
  }, [pendingQuestionSwap]);

  useEffect(() => () => {
    if (questionTransitionTimer.current !== null) window.clearTimeout(questionTransitionTimer.current);
  }, []);

  function selectChoice(id: string) {
    if (answer?.submitted && editingQuestionId !== question.id) return;
    setAnswers((current) => {
      const next = { ...current, [question.id]: { selected: id, submitted: false } };
      Object.assign(inMemoryAnswers, next);
      return next;
    });
  }

  function submitChoice() {
    if (!answer?.selected) return;
    setFeedbackPending(true);
    setFeedbackCycle((current) => current + 1);
    setAnswers((current) => {
      const next = { ...current, [question.id]: { selected: answer.selected, submitted: true } };
      Object.assign(inMemoryAnswers, next);
      return next;
    });
    setEditingQuestionId(null);
    inMemoryVisitedScenes.add(sceneId);
    setVisited(Array.from(inMemoryVisitedScenes));
  }

  function redoQuestion() {
    if (!answer?.submitted) return;
    setEditingQuestionId(question.id);
    setFeedbackPending(false);
    setAnswers((current) => {
      const next = { ...current, [question.id]: { selected: answer.selected, submitted: false } };
      Object.assign(inMemoryAnswers, next);
      return next;
    });
  }

  function next() {
    if (!answer?.submitted) return;
    if (questionIndex < scene.questions.length - 1) {
      if (questionTransitioning) return;
      setQuestionTransitioning(true);
      setQuestionSwapOut(true);
      questionTransitionTimer.current = window.setTimeout(() => {
        setQuestionSwapOut(false);
        setPendingQuestionSwap(true);
        setQuestionIndex((current) => current + 1);
        setQuestionTransitioning(false);
        questionTransitionTimer.current = null;
      }, 420);
    } else {
      pageRef.current?.scrollTo({ top: 0, behavior: "auto" });
      pageRef.current?.parentElement?.scrollTo({ top: 0, behavior: "auto" });
      if (sceneId < 6) router.push(`/onboarding/scenes?scene=${sceneId + 1}`);
      else router.push("/onboarding/assessment");
    }
  }

  const titleParts = scene.title.split("，");
  const motionClasses = (key: string) => [
    motionVisibleKeys.has(key) ? styles.revealVisible : "",
    motionStaticKeys.has(key) ? styles.motionStatic : "",
  ].filter(Boolean).join(" ");

  return (
    <div ref={pageRef} className={`${styles.page} ${styles.scenePage} ${styles.workScenesPage}`}>
      <div className={styles.topline}><div className={`${styles.container} ${styles.toplineInner}`}><span>AI PRODUCT FIELD / WORK SCENE {String(sceneId).padStart(2, "0")}</span><span>你的选择不会改变后续路线</span></div></div>
      <header className={`${styles.nav} ${styles.container}`}>
        <Link className={styles.brand} href="/onboarding/brief"><span className={styles.brandMark} aria-hidden="true">A</span><span>AI 产品现场</span></Link>
        <Link className={styles.navBack} href="/onboarding/brief">← 返回任务简报</Link>
      </header>
      <main>
        <section className={`${styles.container} ${styles.sceneIntro} ${styles.scrollReveal} ${motionClasses(`scene-${sceneId}-intro`)}`} data-motion-key={`scene-${sceneId}-intro`}><span className={styles.sceneNo}>{String(sceneId).padStart(2, "0")} / 06</span><div><p className={styles.eyebrow}>工作场景 {String(sceneId).padStart(2, "0")} · {scene.phase}</p><h1>{titleParts[0]}{titleParts.length > 1 ? <>{"，"}<br /><em>{titleParts.slice(1).join("，")}</em></> : null}</h1><p>{scene.background}</p><div className={styles.sceneKicker}><i /><span>成果链 · {sceneId === 2 ? "问题定义" : sceneId === 3 ? "AI 能力地图" : sceneId === 4 ? "AI 机会判断" : sceneId === 5 ? "人机协作方案" : "可验证产品方案"}</span></div><div className={styles.progress}>{[1, 2, 3, 4, 5, 6].map((id) => <span key={id} className={id < sceneId ? styles.progressDone : id === sceneId ? styles.progressCurrent : ""} />)}</div></div></section>
        <section className={styles.workbench}><div className={`${styles.container} ${styles.workGrid}`}><div className={`${styles.context} ${styles.scrollReveal} ${motionClasses(`scene-${sceneId}-brief`)}`} data-motion-key={`scene-${sceneId}-brief`}><span className={styles.contextLabel}>SCENE {String(sceneId).padStart(2, "0")} / FIELD NOTE</span><h2>{scene.contextTitle.split("\n").map((line) => <span key={line}>{line}<br /></span>)}</h2><p>{scene.contextCopy}</p><ul className={styles.contextList}><li><b>IN</b><span>上一场景的已确认成果</span></li><li><b>NOW</b><span>{scene.questions.length} 个连续判断</span></li><li><b>OUT</b><span>{sceneId === 6 ? "进入职业认知测试" : "推进下一场景"}</span></li></ul></div><div className={`${styles.questionBox} ${styles.scrollReveal} ${questionSwapOut ? styles.questionSwapOut : ""} ${pendingQuestionSwap ? styles.questionSwapIn : ""} ${submitted ? styles.questionStatic : ""} ${motionClasses(`scene-${sceneId}-question-${question.id}`)}`} data-motion-key={`scene-${sceneId}-question-${question.id}`}>
          <div className={styles.questionSessionGrid}><div className={styles.questionMain}><div className={styles.questionMeta}><span>判断 {questionIndex + 1} / {scene.questions.length} · 四选一</span><span>{submitted ? "已提交" : editingQuestionId === question.id ? "重新作答" : "未作答"}</span></div><p className={styles.questionConcept}>{question.concept}</p><h2>{question.question}</h2><p className={styles.questionHelp}>提示：{question.hint}</p><div className={`${styles.options} ${styles.scrollReveal} ${motionClasses(`scene-${sceneId}-question-${question.id}-options`)}`} data-motion-key={`scene-${sceneId}-question-${question.id}-options`} role="group" aria-label={question.question}>{question.options.map((option, index) => <button type="button" key={option.id} className={`${styles.option} ${selected === option.id ? styles.optionSelected : ""}`} style={{ "--option-index": index } as CSSProperties} disabled={submitted && editingQuestionId !== question.id} onClick={() => selectChoice(option.id)}><span className={styles.check}>{selected === option.id ? "✓" : ""}</span><span className={styles.optionCopy}><strong>{option.id} · {option.label}</strong><span>{option.detail}</span></span></button>)}</div><div className={styles.submitRow}><span className={styles.submitNote}>选择只影响即时反馈，不改变剧情和后续顺序。</span><button className={styles.scenePrimary} type="button" disabled={!selected || (submitted && editingQuestionId !== question.id)} onClick={submitChoice}>{submitted ? "已完成判断" : "提交我的判断"} ↗</button></div></div><div className={styles.feedbackPanel}><div className={styles.feedbackSlot}>{!submitted ? <div className={styles.feedbackPlaceholder}>前辈的反馈 · 提交后在此展开</div> : null}<div ref={feedbackRef} className={`${styles.feedback} ${submitted ? styles.feedbackVisible : ""} ${feedbackPending ? styles.feedbackPending : ""}`}><div className={styles.feedbackTop}><h3>前辈的反馈</h3><span className={styles.feedbackStatus}>{correct ? "判断成立" : "再想一步"}</span></div><p>{correct ? "你的判断抓住了这道题的关键。" : "这个选项有它的直觉，但还不足以支撑当前的产品判断。错误不会让任务失败，回到问题本身再看一遍。"}</p><div className={styles.feedbackColumns}><div><strong>你的选择</strong><p>{selected} · {question.options.find((item) => item.id === selected)?.label}</p></div><div><strong>{correct ? "为什么成立" : "为什么需要调整"}</strong><p>{correct ? question.correctReason : question.wrongReason[selected ?? ""]}</p></div><div><strong>正确答案</strong><p className={styles.correctAnswer}>{question.correct} · {question.options.find((item) => item.id === question.correct)?.label}<br />{question.correctReason}</p></div><div className={styles.actionNote}><strong>下一步项目动作：</strong>{question.action}</div></div></div></div><div className={styles.sessionAction}><button className={`${styles.scenePrimary} ${styles.continue} ${submitted ? styles.continueVisible : ""}`} type="button" disabled={!submitted} onClick={next}>{sceneId === 6 && questionIndex === scene.questions.length - 1 ? "进入职业认知测试" : questionIndex === scene.questions.length - 1 ? "进入下一个工作场景" : "进入下一判断"} ↗</button>{submitted ? <button className={styles.redoButton} type="button" onClick={redoQuestion}>重新作答</button> : null}</div></div></div>
        </div></div></section>
        <section className={`${styles.mentor} ${styles.scrollReveal}`} data-motion-key={`scene-${sceneId}-mentor`}><div className={`${styles.container} ${styles.mentorInner}`}><div className={styles.mentorCopy}><span className={styles.mentorMark}>“</span><div><p>{scene.mentor}</p><small>你的前辈 · AI 教育产品团队</small></div></div></div></section>
        <section className={`${styles.sceneNav} ${styles.scrollReveal}`} data-motion-key={`scene-${sceneId}-nav`}><div className={`${styles.container} ${styles.sceneNavInner}`}><span className={styles.sceneNavLabel}><span>已体验的工作场景 · 可返回重做</span><small className={styles.sceneNavHint}>进度仅保存在本次打开期间；刷新或重新打开标签页后会重置。</small></span><div className={styles.sceneLinks}>{[1, 2, 3, 4, 5, 6].map((id) => id === 1 ? <Link className={`${styles.sceneLink} ${sceneId === 1 ? styles.sceneLinkActive : ""} ${styles.sceneLinkVisited}`} href="/onboarding/scenes?scene=1" key={id}>01</Link> : canReturn(id) ? <Link className={`${styles.sceneLink} ${sceneId === id ? styles.sceneLinkActive : ""} ${styles.sceneLinkVisited}`} href={`/onboarding/scenes?scene=${id}`} key={id}>{String(id).padStart(2, "0")}</Link> : <span className={`${styles.sceneLink} ${styles.sceneLinkLocked}`} aria-disabled="true" key={id}>{String(id).padStart(2, "0")}</span>)}</div></div></section>
      </main>
    </div>
  );
}
