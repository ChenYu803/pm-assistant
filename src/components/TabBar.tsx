"use client";

import { useState, useRef, useEffect } from "react";
import type { TabData } from "@/lib/agent-constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface TabBarProps {
  tabs: TabData[];
  activeTabId: string | null;
  onSwitch: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string, newName: string) => void;
  onNew: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onSwitch,
  onClose,
  onRename,
  onNew,
}: TabBarProps) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  // Track whether the blur should be skipped (e.g., Escape was pressed)
  const skipBlurRef = useRef(false);

  useEffect(() => {
    if (editingTabId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTabId]);

  function handleDoubleClick(tab: TabData) {
    skipBlurRef.current = false;
    setEditingTabId(tab.id);
    setEditValue(tab.display_name);
  }

  function handleEditKeyDown(e: React.KeyboardEvent, tabId: string) {
    if (e.key === "Enter") {
      const trimmed = editValue.trim();
      if (trimmed) {
        onRename(tabId, trimmed);
      }
      setEditingTabId(null);
    } else if (e.key === "Escape") {
      skipBlurRef.current = true;
      setEditingTabId(null);
    }
  }

  function handleEditBlur() {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    // Confirm on blur if there's a valid value
    if (editValue.trim() && editingTabId) {
      onRename(editingTabId, editValue.trim());
    }
    setEditingTabId(null);
  }

  return (
    <div className="flex items-center border-b border-gray-200 bg-white">
      {/* Tab list with horizontal scroll */}
      <div className="flex flex-1 items-center overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isEditing = tab.id === editingTabId;

          return (
            <div
              key={tab.id}
              onClick={() => onSwitch(tab.id)}
              onDoubleClick={() => handleDoubleClick(tab)}
              className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-gray-100 px-4 py-2.5 text-sm transition-colors select-none ${
                isActive
                  ? "bg-white text-gray-900 font-medium"
                  : "bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              }`}
            >
              {isEditing ? (
                <Input
                  ref={editInputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => handleEditKeyDown(e, tab.id)}
                  onBlur={handleEditBlur}
                  onClick={(e) => e.stopPropagation()}
                  className="h-auto w-28 rounded px-1.5 py-0.5 shadow-none focus:ring-2"
                />
              ) : (
                <span className="max-w-[160px] truncate">
                  {tab.display_name}
                </span>
              )}

              {/* Close button */}
              {!isEditing && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-sm p-0 text-gray-400 opacity-0 transition-opacity hover:bg-gray-200 hover:text-gray-600 group-hover:opacity-100 focus-visible:opacity-100"
                  title="关闭标签页"
                >
                  ×
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* New tab button */}
      <Button
        variant="ghost"
        onClick={onNew}
        className="shrink-0 px-3 py-2.5 text-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        title="新建标签页"
      >
        +
      </Button>
    </div>
  );
}
