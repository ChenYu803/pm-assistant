"use client";

interface ChatAreaProps {
  tabName: string | null;
}

export default function ChatArea({ tabName }: ChatAreaProps) {
  if (!tabName) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mb-4 text-5xl">💬</div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900">
            选择一个标签页
          </h2>
          <p className="text-sm text-gray-500">
            从上方标签栏选择一个标签页，或新建一个开始工作
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-gray-50">
      {/* Chat messages area — placeholder for Ticket 4 */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <div className="mb-4 text-5xl">🤖</div>
            <h2 className="mb-2 text-xl font-semibold text-gray-900">
              {tabName}
            </h2>
            <p className="text-sm text-gray-500">
              Agent 已就绪，等待您的输入…
            </p>
          </div>
        </div>
      </div>

      {/* Input area placeholder */}
      <div className="border-t border-gray-200 bg-white p-4">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <span className="text-sm text-gray-400">
              输入消息（功能将在后续迭代中实现）
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
