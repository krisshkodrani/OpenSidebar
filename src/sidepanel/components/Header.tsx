import React from "react";
import { Settings } from "lucide-react";
import { StatusBar } from "./StatusBar";

interface Props {
    onOpenSettings: () => void;
}

export function Header({ onOpenSettings }: Props) {
    return (
        <header className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800 bg-surface-light dark:bg-surface-dark sticky top-0 z-10 transition-colors">
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                    {/* Logo removed as per user request */}
                </div>
                <StatusBar />
            </div>

            <button
                onClick={onOpenSettings}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                aria-label="Settings"
            >
                <Settings size={18} />
            </button>
        </header>
    );
}
