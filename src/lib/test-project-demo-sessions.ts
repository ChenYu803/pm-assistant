export const TEST_PROJECT_DEMO_SESSIONS = [
  { id: "demo-goal", title: "目标与验证依据", messages: [
    ["user", "我们现在只有访谈笔记，没有量化数据。"], ["assistant", "先把访谈中的重复信号标出来，再区分事实、推测和待验证假设。"], ["user", "最常出现的是“不知道从哪里开始”。"], ["assistant", "这可以成为首个问题假设。你知道用户通常在什么时刻遇到这个问题吗？"], ["user", "大多是第一次创建项目时，面对空白页面不知道先做什么。"], ["assistant", "那问题可能不只是缺少说明，也可能是起步任务和下一步不够明确。"], ["user", "我们希望用户能完成一轮完整的产品思考。"], ["assistant", "这是产品目标。可以再拆成首次进入、需求澄清、形成方案等可观察步骤。"], ["user", "初步成功标准是十分钟内能说清四个阶段分别做什么。"], ["assistant", "已记录为待验证标准。还需要通过新手测试确认用户能独立复述并完成一次阶段选择。"],
  ] as ["user" | "assistant", string][] },
  { id: "demo-first-use", title: "用户首次进入产品", messages: [["assistant", "先把目标从“让用户理解产品”拆成可观察的行为结果。"], ["user", "我希望第一次打开产品的人，十分钟内理解 AI 产品经理的工作方式。"], ["assistant", "可以先验证：用户能否说出 AI PM 与传统 PM 的差异，并完成一次从需求到交付的判断。"]] as ["user" | "assistant", string][] },
  { id: "demo-scope", title: "范围取舍记录", messages: [["assistant", "当前阶段先确认用户与成功标准，再讨论具体方案。"], ["user", "那是否先不讨论技术实现？"], ["assistant", "是。先记录约束和判断依据，技术方案留到后续阶段。"]] as ["user" | "assistant", string][] },
];
